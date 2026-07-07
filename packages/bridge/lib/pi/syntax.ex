defmodule Pi.Syntax do
  @moduledoc "Syntax highlighting metadata for pi renderers."

  @max_highlight_bytes 100 * 1024
  @open_tag ~r/\A\[([A-Za-z0-9_.-]+)\]/
  @close_tag ~r/\A\[\/([A-Za-z0-9_.-]+)\]/

  @type span :: %{text: String.t(), scopes: [String.t()]}
  @type highlight :: %{engine: String.t(), language: String.t(), lines: [[span()]]}

  @doc "Returns renderer-neutral Lumis scope spans for source, or nil when unavailable."
  @spec metadata(String.t(), keyword()) :: map()
  def metadata(source, opts \\ []) when is_binary(source) do
    case highlight(source, opts) do
      {:ok, highlight} -> %{highlight: highlight}
      :error -> %{}
    end
  end

  @spec highlight(String.t(), keyword()) :: {:ok, highlight()} | :error
  def highlight(source, opts \\ []) when is_binary(source) do
    language = opts |> Keyword.get(:language, :elixir) |> to_string()

    with true <- byte_size(source) <= @max_highlight_bytes,
         true <- Code.ensure_loaded?(Lumis),
         {:ok, scoped} <- lumis_scoped(source, language) do
      {:ok, %{engine: "lumis", language: language, lines: scoped_to_lines(scoped)}}
    else
      _ -> :error
    end
  rescue
    _exception in [ArgumentError, RuntimeError, Lumis.HighlightError] -> :error
  end

  defp lumis_scoped(source, language) do
    {:ok,
     Lumis.highlight!(source,
       formatter: {:bbcode_scoped, language: language, rainbow_brackets: true}
     )}
  rescue
    _exception in [ArgumentError, RuntimeError, Lumis.HighlightError] -> :error
  end

  defp scoped_to_lines(scoped) do
    {lines, current, _scopes} = parse_scoped(scoped, [], [], [])
    lines = [Enum.reverse(current) | lines]

    lines
    |> Enum.reverse()
    |> Enum.map(&merge_adjacent/1)
  end

  defp parse_scoped("", lines, current, scopes), do: {lines, current, scopes}

  defp parse_scoped(text, lines, current, scopes) do
    cond do
      match = Regex.run(@close_tag, text) ->
        [tag, scope] = match

        parse_scoped(
          String.slice(text, byte_size(tag)..-1//1),
          lines,
          current,
          pop_scope(scopes, scope)
        )

      match = Regex.run(@open_tag, text) ->
        [tag, scope] = match
        parse_scoped(String.slice(text, byte_size(tag)..-1//1), lines, current, [scope | scopes])

      String.starts_with?(text, "\n") ->
        parse_scoped(String.slice(text, 1..-1//1), [Enum.reverse(current) | lines], [], scopes)

      true ->
        {chunk, rest} = next_text_chunk(text)
        chunk = if chunk == "", do: String.first(text), else: chunk

        rest =
          if chunk == String.first(text) and rest == text,
            do: String.slice(text, 1..-1//1),
            else: rest

        span = %{text: html_unescape(chunk), scopes: Enum.reverse(scopes)}
        parse_scoped(rest, lines, [span | current], scopes)
    end
  end

  defp next_text_chunk(text) do
    tag_index = Regex.run(~r/\[/, text, return: :index) |> first_index()
    newline_index = Regex.run(~r/\n/, text, return: :index) |> first_index()

    index =
      [tag_index, newline_index]
      |> Enum.reject(&is_nil/1)
      |> Enum.min(fn -> byte_size(text) end)

    {String.slice(text, 0, index), String.slice(text, index..-1//1)}
  end

  defp first_index([{index, _length} | _]), do: index
  defp first_index(_), do: nil

  defp pop_scope([scope | rest], scope), do: rest
  defp pop_scope([other | rest], scope), do: [other | pop_scope(rest, scope)]
  defp pop_scope([], _scope), do: []

  defp merge_adjacent([]), do: []

  defp merge_adjacent(spans) do
    spans
    |> Enum.chunk_by(& &1.scopes)
    |> Enum.map(fn [first | _] = group ->
      %{first | text: Enum.map_join(group, & &1.text)}
    end)
  end

  defp html_unescape(text) do
    text
    |> String.replace("&lt;", "<")
    |> String.replace("&gt;", ">")
    |> String.replace("&amp;", "&")
    |> String.replace("&quot;", "\"")
    |> String.replace("&#39;", "'")
    |> then(fn escaped ->
      Regex.replace(~r/&#(\d+);/, escaped, fn _, number ->
        number |> String.to_integer() |> List.wrap() |> List.to_string()
      end)
    end)
  end
end
