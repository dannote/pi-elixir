defmodule Pi.Agent.Events do
  @moduledoc false

  alias Pi.ProcessOwner

  def register(owner), do: ProcessOwner.register(__MODULE__, owner)
  def unregister(owner), do: ProcessOwner.unregister(__MODULE__, owner)
  def notify(event), do: ProcessOwner.notify(__MODULE__, event)
end
