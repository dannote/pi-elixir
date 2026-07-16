defmodule Pi.Eval.Supervisor do
  @moduledoc "Dynamic supervisor for stateful eval session evaluators."

  use DynamicSupervisor

  alias Pi.Supervisor.Install

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec install() :: :ok | {:error, :eval_runtime_not_started}
  def install do
    if Process.whereis(__MODULE__) && Process.whereis(Pi.Eval.Registry),
      do: :ok,
      else: {:error, :eval_runtime_not_started}
  end

  @spec evaluator(String.t(), keyword()) :: {:ok, pid()} | {:error, term()}
  def evaluator(session_id, opts \\ []) when is_binary(session_id) do
    with :ok <- install() do
      lookup_evaluator(session_id, opts)
    end
  end

  defp lookup_evaluator(session_id, opts) do
    case Registry.lookup(Pi.Eval.Registry, session_id) do
      [{pid, _value}] when is_pid(pid) ->
        {:ok, pid}

      [] ->
        child_spec = {Pi.Eval.Evaluator, Keyword.put(opts, :session_id, session_id)}
        DynamicSupervisor.start_child(__MODULE__, child_spec)
    end
  end

  @doc false
  def reset, do: Install.reset_dynamic(__MODULE__)

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)
end
