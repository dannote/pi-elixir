defmodule Pi.Target.Runtime.Diagnostics do
  @moduledoc false

  def normalize(diagnostics) do
    Enum.map(diagnostics, fn diagnostic ->
      %{
        severity: Map.get(diagnostic, :severity),
        message: diagnostic |> Map.get(:message, "") |> to_string(),
        file: string_value(Map.get(diagnostic, :file)),
        source: string_value(Map.get(diagnostic, :source)),
        position: Map.get(diagnostic, :position),
        span: Map.get(diagnostic, :span),
        stacktrace: normalize_stacktrace(Map.get(diagnostic, :stacktrace, []))
      }
    end)
  end

  def exception(kind, reason, stacktrace) do
    normalized = Exception.normalize(kind, reason, stacktrace)

    %{
      kind: inspect(kind),
      type: exception_type(kind, normalized),
      message: exception_message(kind, normalized, stacktrace),
      stacktrace: Enum.map(stacktrace, &stacktrace_entry/1)
    }
  end

  def append(text, []), do: text

  def append(text, diagnostics) do
    text <> "\n\nDiagnostics:\n" <> Enum.map_join(diagnostics, "\n", &format/1)
  end

  defp normalize_stacktrace(stacktrace) when is_list(stacktrace) do
    Enum.map(stacktrace, fn entry -> %{text: Exception.format_stacktrace_entry(entry)} end)
  end

  defp normalize_stacktrace(_stacktrace), do: []

  defp exception_type(_kind, %module{}), do: inspect(module)
  defp exception_type(kind, _reason), do: Atom.to_string(kind)

  defp exception_message(_kind, %_module{} = exception, _stacktrace),
    do: Exception.message(exception)

  defp exception_message(kind, reason, stacktrace),
    do: Exception.format_banner(kind, reason, stacktrace)

  defp stacktrace_entry(entry) do
    location = if tuple_size(entry) == 4, do: elem(entry, 3), else: []

    %{
      text: Exception.format_stacktrace_entry(entry),
      file: location |> Keyword.get(:file) |> string_value(),
      line: Keyword.get(location, :line)
    }
  end

  defp format(diagnostic) do
    severity = diagnostic.severity |> to_string() |> String.upcase()
    "#{severity}#{location(diagnostic)}: #{diagnostic.message}"
  end

  defp location(%{file: file, position: position}) when is_binary(file) and is_integer(position),
    do: " #{file}:#{position}"

  defp location(%{file: file, position: {line, column}})
       when is_binary(file) and is_integer(line) and is_integer(column),
       do: " #{file}:#{line}:#{column}"

  defp location(%{file: file}) when is_binary(file), do: " #{file}"
  defp location(_diagnostic), do: ""

  defp string_value(nil), do: nil
  defp string_value(value), do: to_string(value)
end
