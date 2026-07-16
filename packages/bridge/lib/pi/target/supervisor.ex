defmodule Pi.Target.Supervisor do
  @moduledoc "Supervises persistent target-project runtime connections."

  use DynamicSupervisor

  alias Pi.Project.Context
  alias Pi.Supervisor.Install
  alias Pi.Target.Connection

  def start_link(opts \\ []),
    do: DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)

  def connection(%Context{} = context, profile \\ :project) do
    with :ok <- install() do
      lookup_connection(context, profile)
    end
  end

  defp lookup_connection(context, profile) do
    key = {context.root, profile}

    case Registry.lookup(Pi.Target.Registry, key) do
      [{pid, _value}] ->
        {:ok, pid}

      [] ->
        case DynamicSupervisor.start_child(
               __MODULE__,
               {Connection, context: context, profile: profile}
             ) do
          {:ok, pid} -> {:ok, pid}
          {:error, {:already_started, pid}} -> {:ok, pid}
          other -> other
        end
    end
  end

  def install do
    if Process.whereis(__MODULE__) && Process.whereis(Pi.Target.Registry),
      do: :ok,
      else: {:error, :target_runtime_not_started}
  end

  @doc false
  def reset, do: Install.reset_dynamic(__MODULE__)

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)
end
