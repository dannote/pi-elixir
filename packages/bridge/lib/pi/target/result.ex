defmodule Pi.Target.Result do
  @moduledoc false

  alias Pi.Eval.Output, as: EvalOutput
  alias Pi.Protocol.Tool.Eval, as: EvalPayload
  alias Pi.Protocol.Tool.OutputPart

  def text({:ok, %{text: text, ok: true}}), do: {:ok, text}
  def text({:ok, %{text: text, ok: false}}), do: {:error, text}
  def text({:error, reason}), do: {:error, error_text(reason)}

  def structured({:ok, %{ok: true} = result}) do
    parts =
      []
      |> maybe_io_part(result.io)
      |> Kernel.++([
        OutputPart.inspect(result.result,
          language: :elixir,
          title: result.preview,
          data:
            result.result
            |> Pi.Syntax.metadata(language: :elixir)
            |> Map.put(:runtime, result.runtime)
        )
      ])

    {:ok,
     %EvalPayload{
       io: result.io,
       result: result.result,
       diagnostics: result.diagnostics,
       text: result.text,
       parts: parts,
       display: EvalOutput.display(parts),
       bindings: result.bindings,
       state: Map.put(result.state, :runtime, result.runtime)
     }}
  end

  def structured({:ok, %{ok: false} = result}) do
    parts = [] |> maybe_io_part(result.io) |> Kernel.++([OutputPart.error(result.text)])

    {:error,
     %EvalPayload{
       io: result.io,
       error: result.text,
       exception: result.exception,
       diagnostics: result.diagnostics,
       text: result.text,
       parts: parts,
       display: EvalOutput.display(parts),
       bindings: result.bindings,
       state: Map.put(result.state, :runtime, result.runtime)
     }}
  end

  def structured({:error, reason}), do: {:error, error_text(reason)}

  defp maybe_io_part(parts, ""), do: parts
  defp maybe_io_part(parts, io), do: parts ++ [OutputPart.text(io)]

  defp error_text(%{message: message}) when is_binary(message), do: message
  defp error_text(reason), do: inspect(reason, pretty: true)
end
