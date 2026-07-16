defmodule Pi.Mirror.QuackDB.Lifecycle do
  @moduledoc false

  use GenServer

  alias Pi.Mirror.QuackDB.Resources
  alias Pi.Supervisor.Install

  def ensure_started do
    with {:ok, pid} <- ensure_process(), do: GenServer.call(pid, :ensure_started, 30_000)
  end

  def status do
    case Process.whereis(__MODULE__) do
      nil -> %{status: :stopped}
      pid -> GenServer.call(pid, :status)
    end
  end

  def stop do
    case Process.whereis(__MODULE__) do
      nil -> :ok
      pid -> GenServer.stop(pid, :normal, 10_000)
    end
  catch
    :exit, _reason -> :ok
  end

  def start_link(_opts), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  @impl true
  def init(state) do
    Process.flag(:trap_exit, true)
    {:ok, state}
  end

  @impl true
  def handle_call(:ensure_started, _from, %{resources: resources} = state) do
    if resources_alive?(resources) do
      {:reply, {:ok, resources}, state}
    else
      start_resources(state)
    end
  end

  def handle_call(:ensure_started, _from, state), do: start_resources(state)

  def handle_call(:status, _from, %{resources: resources} = state) do
    {:reply, %{status: :ready, resources: resources}, state}
  end

  def handle_call(:status, _from, state), do: {:reply, %{status: :stopped}, state}

  @impl true
  def handle_info(
        {:EXIT, supervisor, reason},
        %{resources: %{supervisor: supervisor}} = state
      ) do
    {:noreply, state |> Map.delete(:resources) |> Map.put(:error, reason)}
  end

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{resources: %{supervisor: supervisor}}) do
    if Process.alive?(supervisor), do: Supervisor.stop(supervisor)
    :ok
  catch
    :exit, _reason -> :ok
  end

  def terminate(_reason, _state), do: :ok

  defp start_resources(state) do
    case Resources.start() do
      {:ok, resources} -> {:reply, {:ok, resources}, Map.put(state, :resources, resources)}
      {:error, reason} -> {:reply, {:error, reason}, Map.put(state, :error, reason)}
    end
  end

  defp resources_alive?(%{supervisor: supervisor, conn: conn}) do
    Process.alive?(supervisor) and connection_alive?(conn)
  end

  defp resources_alive?(_resources), do: false

  defp connection_alive?(conn) do
    match?(:ok, QuackDB.ping(conn, timeout: 1_000))
  catch
    :exit, _reason -> false
  end

  defp ensure_process do
    with :ok <- Install.ensure(__MODULE__),
         pid when is_pid(pid) <- Process.whereis(__MODULE__) do
      {:ok, pid}
    else
      nil -> {:error, :lifecycle_not_started}
      error -> error
    end
  end
end
