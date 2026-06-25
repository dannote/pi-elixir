defmodule Pi.AST do
  @moduledoc "Structured ExAST helpers for bridge tools."

  alias Pi.Protocol.Tool.AST.Diff
  alias Pi.Protocol.Tool.AST.Match
  alias Pi.Protocol.Tool.AST.Replace
  alias Pi.Protocol.Tool.AST.Replacement
  alias Pi.Protocol.Tool.AST.Search
  alias Pi.Protocol.UI.Block
  alias Pi.Protocol.UI.Display

  @missing_ex_ast "ex_ast is not installed. Add {:ex_ast, \"~> 0.1\", only: [:dev, :test], runtime: false} to mix.exs"

  def search(pattern, opts \\ []) when is_binary(pattern) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      paths = paths(path)

      matches =
        paths
        |> ast_search(pattern, search_opts(opts))
        |> Enum.map(&match_payload/1)

      {:ok,
       %Search{
         pattern: pattern,
         path: path,
         matches: matches,
         total: length(matches),
         display: search_display(matches)
       }}
    end
  end

  def search_many(patterns, opts \\ []) when is_map(patterns) or is_list(patterns) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      paths = paths(path)
      named_patterns = normalize_named_patterns(patterns)

      matches =
        paths
        |> ast_search_many(named_patterns, search_opts(opts))
        |> Enum.map(&match_payload/1)

      {:ok,
       %Search{
         pattern: inspect(named_patterns, limit: 20),
         path: path,
         matches: matches,
         total: length(matches),
         display: search_display(matches)
       }}
    end
  end

  def diff(opts \\ []) do
    with :ok <- ensure_ex_ast() do
      paths = diff_paths(opts)

      files =
        paths
        |> Enum.map(&semantic_file_diff/1)
        |> Enum.reject(&(semantic_file_edit_count(&1) == 0))

      total = Enum.reduce(files, 0, fn file, acc -> acc + semantic_file_edit_count(file) end)

      Pi.Output.tree(
        %{
          summary: semantic_diff_summary(total, files),
          total: total,
          files: files
        },
        opts
        |> Keyword.take([:depth])
        |> Keyword.put_new(:depth, 6)
        |> Keyword.put(:preview, semantic_diff_summary(total, files))
      )
    end
  end

  def replace(pattern, replacement, opts \\ [])
      when is_binary(pattern) and is_binary(replacement) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      dry_run = Keyword.get(opts, :dry_run, false)

      paths = paths(path)
      opts = Keyword.merge(search_opts(opts), dry_run: dry_run)
      diffs = if dry_run, do: replacement_diffs(paths, pattern, replacement, opts), else: []

      replacements =
        paths
        |> ast_replace(pattern, replacement, opts)
        |> Enum.map(fn {file, count} -> %Replacement{file: file, count: count} end)

      total = Enum.reduce(replacements, 0, fn %Replacement{count: count}, acc -> acc + count end)

      {:ok,
       %Replace{
         dry_run: dry_run,
         pattern: pattern,
         replacement: replacement,
         path: path,
         replacements: replacements,
         total: total,
         diffs: diffs,
         display: replace_display(replacements, diffs)
       }}
    end
  end

  defp normalize_named_patterns(patterns) when is_map(patterns) and map_size(patterns) <= 50 do
    Map.new(patterns, fn {name, pattern} -> {pattern_name(name), pattern} end)
  end

  defp normalize_named_patterns(patterns) when is_map(patterns) do
    raise ArgumentError, "expected at most 50 named AST patterns"
  end

  defp normalize_named_patterns(patterns) when is_list(patterns), do: patterns

  defp pattern_name(name) when is_atom(name), do: name

  defp pattern_name(name) when is_binary(name) and byte_size(name) <= 64 do
    if String.match?(name, ~r/^[A-Za-z_][A-Za-z0-9_]*$/u) do
      String.to_existing_atom(name)
    else
      raise ArgumentError, "expected named AST pattern keys to be identifier-like strings"
    end
  end

  defp pattern_name(_name) do
    raise ArgumentError,
          "expected named AST pattern keys to be atoms or existing atom-name strings"
  end

  defp search_opts(opts) do
    []
    |> maybe_put(:inside, Keyword.get(opts, :inside))
    |> maybe_put(:not_inside, Keyword.get(opts, :not_inside))
    |> maybe_put(:allow_broad, Keyword.get(opts, :allow_broad))
    |> maybe_put(:limit, Keyword.get(opts, :limit))
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)

  defp match_payload(%{file: file, line: line, source: source} = match) do
    %Match{
      file: file,
      line: line,
      source: source,
      pattern: match_pattern(match),
      captures: match |> Map.get(:captures, %{}) |> render_captures()
    }
  end

  defp match_pattern(%{pattern: pattern}), do: to_string(pattern)
  defp match_pattern(_match), do: nil

  defp search_display(matches) do
    %Display{
      summary: "#{length(matches)} match(es)",
      blocks:
        Enum.flat_map(matches, fn %Match{} = match ->
          [
            %Block{type: :location, path: match.file, line: match.line},
            %Block{type: :source, text: match.source, language: language_from_path(match.file)}
          ]
        end)
    }
  end

  defp replace_display(replacements, diffs) do
    replacement_blocks =
      Enum.map(replacements, fn %Replacement{} = replacement ->
        %Block{
          type: :text,
          text: "#{replacement.file}: #{replacement.count} replacement(s)",
          path: replacement.file
        }
      end)

    diff_blocks =
      Enum.map(diffs, fn %Diff{} = diff ->
        %Block{type: :diff, text: diff.diff, path: diff.file, language: diff.language}
      end)

    %Display{
      summary: "#{length(replacements)} file(s)",
      blocks: replacement_blocks ++ diff_blocks
    }
  end

  defp replacement_diffs(paths, pattern, replacement, opts) do
    opts = Keyword.drop(opts, [:dry_run])

    paths
    |> Enum.flat_map(&resolve_paths/1)
    |> Enum.flat_map(fn file ->
      source = File.read!(file)
      replaced = ex_ast_replace_all(source, pattern, replacement, opts)

      if source == replaced do
        []
      else
        [
          %Diff{
            file: file,
            diff: unified_diff(source, replaced, file),
            semantic_edits:
              semantic_edits(source, replaced, module_name(replaced) || module_name(source))
          }
        ]
      end
    end)
  end

  defp semantic_edits(old, new, module_name) do
    edits =
      old
      |> ExAST.diff(new, include_moves: false)
      |> Map.fetch!(:edits)

    edits
    |> high_signal_edits()
    |> Enum.map(&semantic_edit(&1, module_name))
  end

  defp high_signal_edits(edits) do
    structural = Enum.filter(edits, &(&1.kind in [:module, :function]))
    if structural == [], do: edits, else: structural
  end

  defp semantic_edit(edit, module_name) do
    range = edit.old_range || edit.new_range
    function = function_info(edit)

    %{
      op: edit.op,
      kind: edit.kind,
      summary: semantic_summary(edit, function, module_name),
      line: range_line(range),
      module: module_name,
      visibility: function && function.visibility,
      name: function && function.name,
      arity: function && function.arity
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp semantic_summary(%{kind: :function} = edit, function, module_name) when is_map(function) do
    target = function_target(function, module_name)
    "#{op_verb(edit.op)} #{visibility_word(function.visibility)} #{target}"
  end

  defp semantic_summary(edit, _function, _module_name), do: edit.summary

  defp function_info(edit) do
    source = get_in(edit.meta, [:new]) || get_in(edit.meta, [:old])

    with source when is_binary(source) <- source,
         {:ok, ast} <- Code.string_to_quoted(source) do
      function_info_from_ast(ast)
    else
      _ -> nil
    end
  end

  defp function_info_from_ast({kind, _, [head | _]})
       when kind in [:def, :defp, :defmacro, :defmacrop] do
    {name, arity} = function_head_name_arity(head)

    if name do
      %{visibility: visibility(kind), name: name, arity: arity}
    end
  end

  defp function_info_from_ast(_ast), do: nil

  defp visibility(kind) when kind in [:def, :defmacro], do: :public
  defp visibility(kind) when kind in [:defp, :defmacrop], do: :private

  defp visibility_word(:public), do: "public"
  defp visibility_word(:private), do: "private"

  defp function_target(%{name: name, arity: arity}, nil), do: "#{name}/#{arity}"

  defp function_target(%{name: name, arity: arity}, module_name),
    do: "#{module_name}.#{name}/#{arity}"

  defp op_verb(:insert), do: "added"
  defp op_verb(:delete), do: "removed"
  defp op_verb(:update), do: "changed"
  defp op_verb(:move), do: "moved"
  defp op_verb(op), do: to_string(op)

  defp function_head_name_arity({:when, _, [head | _guards]}), do: function_head_name_arity(head)

  defp function_head_name_arity({:\\, _, [head, _default]}), do: function_head_name_arity(head)

  defp function_head_name_arity({name, _, args}) when is_atom(name) and is_list(args),
    do: {name, length(args)}

  defp function_head_name_arity(_head), do: {nil, 0}

  defp range_line(nil), do: nil
  defp range_line(%{start: start}), do: start[:line]

  defp module_name(source) do
    case Code.string_to_quoted(source) do
      {:ok, ast} ->
        ast
        |> Macro.prewalk(nil, fn
          {:defmodule, _, [{:__aliases__, _, parts}, _]} = node, nil ->
            {node, Module.concat(parts) |> inspect()}

          node, acc ->
            {node, acc}
        end)
        |> elem(1)

      _ ->
        nil
    end
  end

  defp semantic_diff_summary(0, _files), do: "Elixir syntax diff: no AST changes"

  defp semantic_diff_summary(total, files) do
    "Elixir syntax diff: #{total} edit(s) in #{length(files)} file(s)"
  end

  defp semantic_file_diff(path) do
    git_path = git_tracked_path(path) || path
    old = git_show("HEAD:#{git_path}") || ""
    new = read_worktree_file(path) || ""

    module_name = module_name(new) || module_name(old)

    semantic_file(path, module_name, semantic_edits(old, new, module_name))
  end

  defp semantic_file(path, module_name, edits) do
    public = Enum.filter(edits, &(&1[:visibility] == :public))
    private = Enum.filter(edits, &(&1[:visibility] == :private))
    other = Enum.reject(edits, &(&1[:visibility] in [:public, :private]))

    %{
      file: path,
      module: module_name,
      summary: semantic_file_summary(module_name, public, private, other),
      public_api: public,
      private_helpers: semantic_edit_group(private),
      other_edits: semantic_edit_group(other)
    }
    |> Enum.reject(fn
      {_key, nil} -> true
      {_key, []} -> true
      {_key, %{count: 0}} -> true
      _entry -> false
    end)
    |> Map.new()
  end

  defp semantic_edit_group([]), do: nil
  defp semantic_edit_group(edits), do: %{count: length(edits), edits: edits}

  defp semantic_file_edit_count(file) do
    length(Map.get(file, :public_api, [])) +
      to_i(get_in(file, [:private_helpers, :count])) + to_i(get_in(file, [:other_edits, :count]))
  end

  defp semantic_file_summary(module_name, public, private, other) do
    subject = module_name || "file"

    [
      edit_count(public, "public"),
      edit_count(private, "private"),
      edit_count(other, "other")
    ]
    |> Enum.reject(&is_nil/1)
    |> case do
      [] -> "#{subject}: no syntax changes"
      parts -> "#{subject}: #{Enum.join(parts, ", ")}"
    end
  end

  defp edit_count([], _label), do: nil
  defp edit_count(edits, label), do: "#{length(edits)} #{label}"
  defp to_i(nil), do: 0
  defp to_i(value) when is_integer(value), do: value
  defp to_i(_value), do: 0

  defp diff_paths(opts) do
    cond do
      path = Keyword.get(opts, :path) -> path |> List.wrap() |> Enum.flat_map(&resolve_paths/1)
      Keyword.get(opts, :changed, false) -> changed_elixir_paths()
      true -> []
    end
    |> Enum.filter(&String.ends_with?(&1, [".ex", ".exs"]))
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp changed_elixir_paths do
    diff_names = git_lines(["diff", "--name-only", "HEAD", "--", "*.ex", "*.exs"])
    untracked = git_lines(["ls-files", "--others", "--exclude-standard", "--", "*.ex", "*.exs"])
    diff_names ++ untracked
  end

  defp read_worktree_file(path) do
    cond do
      File.exists?(path) -> File.read!(path)
      root = git_root() -> root |> Path.join(path) |> maybe_read_file()
      true -> nil
    end
  end

  defp maybe_read_file(path) do
    if File.exists?(path), do: File.read!(path)
  end

  defp git_root do
    case System.cmd("git", ["rev-parse", "--show-toplevel"], stderr_to_stdout: true) do
      {output, 0} -> String.trim(output)
      _ -> nil
    end
  rescue
    _ in ErlangError -> nil
  end

  defp git_lines(args) do
    case System.cmd("git", args, stderr_to_stdout: true) do
      {output, 0} -> String.split(output, "\n", trim: true)
      _ -> []
    end
  rescue
    _ in ErlangError -> []
  end

  defp git_tracked_path(path) do
    case System.cmd("git", ["ls-files", "--full-name", "--", path], stderr_to_stdout: true) do
      {output, 0} -> output |> String.split("\n", trim: true) |> List.first()
      _ -> nil
    end
  rescue
    _ in ErlangError -> nil
  end

  defp git_show(revision) do
    case System.cmd("git", ["show", revision], stderr_to_stdout: true) do
      {output, 0} -> output
      _ -> nil
    end
  rescue
    _ in ErlangError -> nil
  end

  defp unified_diff(old, new, file) do
    old_lines = String.split(old, "\n")
    new_lines = String.split(new, "\n")

    if old == new do
      ""
    else
      ["--- ", file, "\n", "+++ ", file, "\n" | diff_lines(old_lines, new_lines)]
      |> IO.iodata_to_binary()
    end
  end

  defp diff_lines(old_lines, new_lines), do: diff_lines(old_lines, new_lines, [])

  defp diff_lines([], [], acc), do: acc |> Enum.reverse() |> List.flatten()

  defp diff_lines([old_line | old_rest], [new_line | new_rest], acc) do
    diff_lines(old_rest, new_rest, [diff_line(old_line, new_line) | acc])
  end

  defp diff_lines([], [new_line | new_rest], acc) do
    diff_lines([], new_rest, [diff_line(nil, new_line) | acc])
  end

  defp diff_lines([old_line | old_rest], [], acc) do
    diff_lines(old_rest, [], [diff_line(old_line, nil) | acc])
  end

  defp diff_line(nil, nil), do: []
  defp diff_line(line, line), do: [" ", line, "\n"]
  defp diff_line(nil, new_line), do: ["+", new_line, "\n"]
  defp diff_line(old_line, nil), do: ["-", old_line, "\n"]
  defp diff_line(old_line, new_line), do: ["-", old_line, "\n", "+", new_line, "\n"]

  defp resolve_paths(path) when is_binary(path) do
    cond do
      String.contains?(path, "*") -> Path.wildcard(path)
      File.dir?(path) -> Path.wildcard(Path.join(path, "**/*.ex*"))
      true -> [path]
    end
  end

  defp language_from_path(path) do
    case Path.extname(path || "") do
      ".ex" -> "elixir"
      ".exs" -> "elixir"
      ".heex" -> "heex"
      ext -> String.trim_leading(ext, ".")
    end
  end

  defp ast_search(paths, pattern, opts) do
    paths
    |> ast_files()
    |> search_files(pattern, opts, &search_file(&1, pattern, &2))
  end

  defp ast_search_many(paths, patterns, opts) do
    paths
    |> ast_files()
    |> search_files(patterns, opts, &search_file_many(&1, patterns, &2))
  end

  defp search_files(files, pattern, opts, search_fun) do
    validate_broad_search!(pattern, opts)
    {limit, opts} = Keyword.pop(opts, :limit)
    opts = Keyword.drop(opts, [:allow_broad])

    files
    |> Enum.reduce_while({[], limit}, fn file, {acc, remaining} ->
      file_matches = search_fun.(file, remaining_opts(opts, remaining))
      next_acc = [file_matches | acc]

      cond do
        remaining == nil -> {:cont, {next_acc, nil}}
        length(file_matches) >= remaining -> {:halt, {next_acc, 0}}
        true -> {:cont, {next_acc, remaining - length(file_matches)}}
      end
    end)
    |> elem(0)
    |> Enum.reverse()
    |> List.flatten()
  end

  defp remaining_opts(opts, nil), do: opts
  defp remaining_opts(opts, remaining), do: Keyword.put(opts, :limit, remaining)

  defp search_file(file, pattern, opts) do
    source = File.read!(file)

    if apply(ExAST.Prefilter, :may_match?, [source, pattern]) do
      matches = apply(ExAST.Patcher, :find_all, [source, pattern, Keyword.drop(opts, [:limit])])
      matches = maybe_take(matches, opts[:limit])
      file_matches(file, source, matches)
    else
      []
    end
  end

  defp search_file_many(file, patterns, opts) do
    source = File.read!(file)

    if Enum.any?(patterns, fn {_name, pattern} ->
         apply(ExAST.Prefilter, :may_match?, [source, pattern])
       end) do
      matches = apply(ExAST.Patcher, :find_many, [source, patterns, Keyword.drop(opts, [:limit])])
      matches = maybe_take(matches, opts[:limit])
      file_matches(file, source, matches)
    else
      []
    end
  end

  defp file_matches(file, source, matches) do
    lines = String.split(source, "\n", trim: false)

    Enum.map(matches, fn match ->
      %{
        file: file,
        line: match_line(match[:range]),
        source: source_fragment(lines, match[:range]) || node_to_string(match[:node]),
        captures: match[:captures] || %{},
        pattern: match[:pattern]
      }
    end)
  end

  defp ast_replace(paths, pattern, replacement, opts) do
    dry_run = Keyword.get(opts, :dry_run, false)
    opts = Keyword.drop(opts, [:dry_run, :allow_broad, :limit])

    paths
    |> ast_files()
    |> Enum.flat_map(&replace_file(&1, pattern, replacement, opts, dry_run))
  end

  defp replace_file(file, pattern, replacement, opts, dry_run) do
    source = File.read!(file)

    if apply(ExAST.Prefilter, :may_match?, [source, pattern]) do
      replacement_for_match(file, source, pattern, replacement, opts, dry_run)
    else
      []
    end
  end

  defp replacement_for_match(file, source, pattern, replacement, opts, dry_run) do
    matches = apply(ExAST.Patcher, :find_all, [source, pattern, opts])
    replaced = ex_ast_replace_all(source, pattern, replacement, opts)

    cond do
      matches == [] -> []
      source == replaced -> []
      true -> write_replacement(file, replaced, matches, dry_run)
    end
  end

  defp write_replacement(file, replaced, matches, dry_run) do
    unless dry_run, do: File.write!(file, replaced)
    [{file, length(matches)}]
  end

  defp ex_ast_replace_all(source, pattern, replacement, opts),
    do: apply(ExAST.Patcher, :replace_all, [source, pattern, replacement, opts])

  defp validate_broad_search!(patterns, opts) when is_list(patterns) do
    Enum.each(patterns, fn {_name, pattern} -> validate_broad_search!(pattern, opts) end)
  end

  defp validate_broad_search!(pattern, opts) do
    if pattern == "_" and is_nil(opts[:limit]) and opts[:allow_broad] != true do
      raise ArgumentError, "refusing broad query without a limit; pass limit or allowBroad"
    end
  end

  defp maybe_take(matches, nil), do: matches
  defp maybe_take(matches, limit), do: Enum.take(matches, limit)

  defp ast_files(paths) do
    paths
    |> Enum.flat_map(&resolve_paths/1)
    |> Enum.filter(&elixir_source?/1)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp elixir_source?(path), do: String.ends_with?(path, [".ex", ".exs"])

  defp match_line(%{start: start}) when is_list(start), do: start[:line] || 1
  defp match_line(_range), do: 1

  defp source_fragment(lines, %{start: start, end: end_}) when is_list(start) and is_list(end_) do
    with start_line when is_integer(start_line) <- start[:line],
         start_column when is_integer(start_column) <- start[:column],
         end_line when is_integer(end_line) <- end_[:line],
         end_column when is_integer(end_column) <- end_[:column] do
      fragment_lines(lines, start_line, start_column, end_line, end_column)
    else
      _ -> nil
    end
  end

  defp source_fragment(_lines, _range), do: nil

  defp fragment_lines(lines, line, start_column, line, end_column) do
    lines
    |> Enum.at(line - 1, "")
    |> String.slice((start_column - 1)..(end_column - 2)//1)
  end

  defp fragment_lines(lines, start_line, start_column, end_line, end_column) do
    lines
    |> Enum.slice((start_line - 1)..(end_line - 1)//1)
    |> trim_fragment_lines(start_column, end_column)
    |> Enum.join("\n")
  end

  defp trim_fragment_lines([], _start_column, _end_column), do: nil

  defp trim_fragment_lines([first | rest], start_column, end_column) do
    {middle, [last]} = Enum.split(rest, max(length(rest) - 1, 0))

    [String.slice(first, (start_column - 1)..-1//1)] ++
      middle ++ [String.slice(last, 0..(end_column - 2)//1)]
  end

  defp node_to_string(node) do
    Sourceror.to_string(node, locals_without_parens: [])
  rescue
    _exception in [ArgumentError, FunctionClauseError, Protocol.UndefinedError] ->
      Macro.to_string(node)
  end

  defp ensure_ex_ast do
    if Code.ensure_loaded?(ExAST), do: :ok, else: {:error, @missing_ex_ast}
  end

  defp paths(path) when is_binary(path), do: [path]
  defp paths(_path), do: ["lib/"]

  defp render_captures(captures) when map_size(captures) == 0, do: %{}

  defp render_captures(captures) do
    Map.new(captures, fn {name, value} ->
      rendered =
        Macro.prewalk(value, fn
          {form, nil, args} -> {form, [], args}
          other -> other
        end)
        |> Macro.to_string()

      {to_string(name), rendered}
    end)
  end
end
