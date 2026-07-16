defmodule Pi.Transport.Payload do
  @moduledoc false

  alias Pi.Protocol.PluginHookResponse
  alias Pi.Protocol.Result

  @spec encode(map() | struct()) :: map()
  def encode(%Result{} = result) do
    normalize(%{
      type: result.type,
      id: result.id,
      text: result.text,
      isError: result.is_error
    })
  end

  def encode(%PluginHookResponse{} = response) do
    response
    |> JSONCodec.dump()
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
    |> normalize()
  end

  def encode(%_module{} = struct), do: struct |> JSONCodec.dump() |> normalize()
  def encode(map) when is_map(map), do: normalize(map)

  @spec normalize(map()) :: map()
  def normalize(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {key, normalize_value(value)} end)
  end

  defp normalize_value(%_module{} = value), do: encode(value)
  defp normalize_value(value) when is_boolean(value), do: value
  defp normalize_value(nil), do: nil
  defp normalize_value(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_value(value) when is_map(value), do: normalize(value)
  defp normalize_value(value) when is_list(value), do: Enum.map(value, &normalize_value/1)
  defp normalize_value(value), do: value
end
