defmodule Pi.Eval.Context do
  @moduledoc false

  @control_key {__MODULE__, :control}
  @binding_info_key {__MODULE__, :binding_info}
  @session_id_key {__MODULE__, :session_id}

  def prepare(session_id, binding_info) do
    Process.put(@session_id_key, session_id)
    Process.put(@binding_info_key, binding_info)
    Process.delete(@control_key)
    :ok
  end

  def clear do
    Process.delete(@session_id_key)
    Process.delete(@binding_info_key)
    :ok
  end

  def session_id, do: Process.get(@session_id_key)
  def binding_info, do: Process.get(@binding_info_key, [])
  def take_control, do: Process.delete(@control_key)
  def put_control(control), do: Process.put(@control_key, control)
end
