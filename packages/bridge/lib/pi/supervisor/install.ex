defmodule Pi.Supervisor.Install do
  @moduledoc false

  def start_link(module, opts) do
    DynamicSupervisor.start_link(module, opts, name: module)
  end

  def ensure(module) do
    case dynamic(module) do
      :ok -> :ok
      {:ok, _pid} -> :ok
      {:ok, _pid, _info} -> :ok
      {:error, {:already_started, _pid}} -> :ok
      error -> error
    end
  end

  def reset_dynamic(supervisor) do
    supervisor
    |> DynamicSupervisor.which_children()
    |> Enum.each(fn {_id, pid, _type, _modules} ->
      DynamicSupervisor.terminate_child(supervisor, pid)
    end)

    :ok
  end

  def dynamic(module) do
    case Process.whereis(module) do
      nil ->
        child_spec = Supervisor.child_spec({module, []}, restart: :transient)
        DynamicSupervisor.start_child(Pi.OptionalSupervisor, child_spec)

      _pid ->
        :ok
    end
  end
end
