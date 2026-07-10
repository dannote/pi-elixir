defmodule Pi.Supervisor.Install do
  @moduledoc false

  def start_link(module, opts) do
    DynamicSupervisor.start_link(module, opts, name: module)
  end

  def ensure(module) do
    case dynamic(module) do
      :ok -> :ok
      {:ok, _pid} -> :ok
      {:error, {:already_started, _pid}} -> :ok
      error -> error
    end
  end

  def dynamic(module) do
    case Process.whereis(module) do
      nil ->
        case module.start_link([]) do
          {:ok, pid} ->
            Process.unlink(pid)
            {:ok, pid}

          other ->
            other
        end

      _pid ->
        :ok
    end
  end
end
