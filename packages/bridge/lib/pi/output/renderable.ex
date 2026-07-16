defprotocol Pi.Output.Renderable do
  @moduledoc "Converts eval-domain values into pi structured output when possible."

  @fallback_to_any true

  @doc "Returns structured output for `value`, or `nil` when no semantic renderer exists."
  @spec to_output(term(), keyword()) :: struct() | nil
  def to_output(value, opts)
end
