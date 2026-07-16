defmodule Pi.ProcessOwner do
  @moduledoc false

  def register(key, owner) when is_pid(owner) do
    :persistent_term.put(owner_key(key), owner)
    :ok
  end

  def unregister(key, owner) when is_pid(owner) do
    if :persistent_term.get(owner_key(key), nil) == owner do
      :persistent_term.erase(owner_key(key))
    end

    :ok
  end

  def notify(key, message) do
    case :persistent_term.get(owner_key(key), nil) do
      owner when is_pid(owner) -> send(owner, message)
      nil -> :ok
    end

    :ok
  end

  defp owner_key(key), do: {__MODULE__, key}
end
