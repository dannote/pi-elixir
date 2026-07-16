defmodule Pi.Target.Runtime.Manifest do
  @moduledoc false

  @files ~w(diagnostics.ex term.ex transport.ex snapshot.ex evaluator.ex worker.ex)

  def files, do: @files
end
