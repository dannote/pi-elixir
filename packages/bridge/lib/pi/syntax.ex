defmodule Pi.Syntax do
  @moduledoc "Syntax highlighting metadata for pi renderers."

  @max_highlight_bytes 100 * 1024
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
    case scoped_tag(text) do
      {:close, scope, rest} ->
        parse_scoped(rest, lines, current, pop_scope(scopes, scope))

      {:open, scope, rest} ->
        parse_scoped(rest, lines, current, [scope | scopes])

      :none ->
        parse_scoped_text(text, lines, current, scopes)
    end
  end

  defp parse_scoped_text("\n" <> rest, lines, current, scopes) do
    parse_scoped(rest, [Enum.reverse(current) | lines], [], scopes)
  end

  defp parse_scoped_text(text, lines, current, scopes) do
    {chunk, rest} = next_text_chunk(text)

    {chunk, rest} =
      if chunk == "" do
        String.next_grapheme(text)
      else
        {chunk, rest}
      end

    span = %{text: html_unescape(chunk), scopes: Enum.reverse(scopes)}
    parse_scoped(rest, lines, [span | current], scopes)
  end

  defp scoped_tag("[/" <> rest), do: finish_scoped_tag(rest, :close)
  defp scoped_tag("[" <> rest), do: finish_scoped_tag(rest, :open)
  defp scoped_tag(_text), do: :none

  defp finish_scoped_tag(text, kind) do
    case :binary.match(text, "]") do
      {closing_index, 1} ->
        scope = binary_part(text, 0, closing_index)

        if valid_scope?(scope) do
          rest = binary_part(text, closing_index + 1, byte_size(text) - closing_index - 1)
          {kind, scope, rest}
        else
          :none
        end

      :nomatch ->
        :none
    end
  end

  defp valid_scope?(scope) when byte_size(scope) > 0 do
    scope
    |> :binary.bin_to_list()
    |> Enum.all?(fn character ->
      character in ?a..?z or character in ?A..?Z or character in ?0..?9 or
        character in [?_, ?., ?-]
    end)
  end

  defp valid_scope?(_scope), do: false

  defp next_text_chunk(text) do
    index =
      [binary_index(text, "["), binary_index(text, "\n")]
      |> Enum.reject(&is_nil/1)
      |> Enum.min(fn -> byte_size(text) end)

    {binary_part(text, 0, index), binary_part(text, index, byte_size(text) - index)}
  end

  defp binary_index(text, pattern) do
    case :binary.match(text, pattern) do
      {index, _length} -> index
      :nomatch -> nil
    end
  end

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
    |> decode_numeric_entities()
  end

  defp decode_numeric_entities(text) do
    case :binary.match(text, "&#") do
      {entity_index, 2} ->
        prefix = binary_part(text, 0, entity_index)
        candidate = binary_part(text, entity_index + 2, byte_size(text) - entity_index - 2)
        prefix <> decode_numeric_entity(candidate)

      :nomatch ->
        text
    end
  end

  defp decode_numeric_entity(candidate) do
    case Integer.parse(candidate) do
      {codepoint, ";" <> rest}
      when codepoint in 0..0xD7FF or codepoint in 0xE000..0x10FFFF ->
        <<codepoint::utf8>> <> decode_numeric_entities(rest)

      _invalid ->
        "&#" <> decode_numeric_entities(candidate)
    end
  end
end
