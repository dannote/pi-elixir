defmodule Pi.Transport do
  @moduledoc "Process-safe outbound boundary for the active extension transport."

  alias Pi.ProcessOwner
  alias Pi.Protocol.Request
  alias Pi.Transport.Payload

  @spec register(pid()) :: :ok
  def register(owner), do: ProcessOwner.register(__MODULE__, owner)

  @spec unregister(pid()) :: :ok
  def unregister(owner), do: ProcessOwner.unregister(__MODULE__, owner)

  @spec request(String.t(), atom(), map()) :: :ok
  def request(id, operation, payload)
      when is_binary(id) and is_atom(operation) and is_map(payload) do
    emit(%Request{type: :request, id: id, op: operation, payload: payload})
  end

  @spec emit(map() | struct()) :: :ok
  def emit(payload) when is_map(payload) do
    ProcessOwner.notify(__MODULE__, {:pi_transport_emit, Payload.encode(payload)})
  end
end
