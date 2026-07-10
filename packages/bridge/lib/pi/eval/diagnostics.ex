defmodule Pi.Eval.Diagnostics do
  @moduledoc false

  alias Pi.Target.Runtime.Diagnostics, as: RuntimeDiagnostics

  @type diagnostic :: %{
          severity: atom() | String.t() | nil,
          message: String.t(),
          file: String.t() | nil,
          source: String.t() | nil,
          position: term(),
          span: term(),
          stacktrace: [map()]
        }

  @spec normalize([map()]) :: [diagnostic()]
  defdelegate normalize(diagnostics), to: RuntimeDiagnostics

  @spec append_to_error(String.t(), [diagnostic()]) :: String.t()
  def append_to_error(text, diagnostics), do: RuntimeDiagnostics.append(text, diagnostics)
end
