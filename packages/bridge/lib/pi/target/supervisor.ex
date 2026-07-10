defmodule Pi.Target.Supervisor do
  @moduledoc "Supervises persistent target-project runtime connections."

  use DynamicSupervisor

  alias Pi.Project.Context
  alias Pi.Supervisor.Install
  alias Pi.Target.Connection

  def start_link(opts \\ []),
    do: DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)

  def connection(%Context{} = context, profile \\ :project) do
    install()
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
    with :ok <- install_registry(), do: Install.ensure(__MODULE__)
  end

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)

  defp install_registry do
    case Process.whereis(Pi.Target.Registry) do
      nil ->
        case Registry.start_link(keys: :unique, name: Pi.Target.Registry) do
          {:ok, pid} ->
            Process.unlink(pid)
            :ok

          {:error, {:already_started, _pid}} ->
            :ok

          error ->
            error
        end

      _pid ->
        :ok
    end
  end
end
