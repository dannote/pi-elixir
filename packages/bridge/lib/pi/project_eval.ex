defmodule Pi.ProjectEval do
  @moduledoc "Runs stateful eval snippets in a persistent dependencyless target-project VM."

  alias Pi.Project.Context
  alias Pi.Target.{Compiler, Connection, Result, Supervisor}

  def run(code, opts \\ []) when is_binary(code),
    do: code |> run_target(opts) |> Result.text()

  def run_structured(code, opts \\ []) when is_binary(code),
    do: code |> run_target(opts) |> Result.structured()

  def available?, do: Context.current() |> Context.mix_project?()

  def compile(opts \\ []), do: Compiler.compile(opts)

  def status(opts \\ []) do
    context = Context.current(opts)

    with {:ok, connection} <- Supervisor.connection(context, profile(opts)) do
      Connection.status(connection)
    end
  end

  def reset(session_id, opts \\ []) when is_binary(session_id) do
    context = Context.current(opts)

    with {:ok, connection} <- Supervisor.connection(context, profile(opts)) do
      Connection.request(connection, :reset, %{session_id: session_id})
    end
  end

  defp run_target(code, opts) do
    context = Context.current(opts)

    with {:ok, connection} <- Supervisor.connection(context, profile(opts)) do
      Connection.eval(connection, code, opts)
    end
  end

  defp profile(opts) do
    case Keyword.get(opts, :profile, :project) do
      profile when profile in [:project, :application] -> profile
      _other -> :project
    end
  end
end
