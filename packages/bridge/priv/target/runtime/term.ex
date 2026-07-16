defmodule Pi.Target.Runtime.Term do
  @moduledoc false

  def serializable?(term)
      when is_pid(term) or is_port(term) or is_reference(term) or is_function(term),
      do: false

  def serializable?(term) when is_list(term), do: Enum.all?(term, &serializable?/1)

  def serializable?(term) when is_tuple(term),
    do: term |> Tuple.to_list() |> Enum.all?(&serializable?/1)

  def serializable?(%_module{} = term), do: term |> Map.from_struct() |> serializable?()

  def serializable?(term) when is_map(term) do
    Enum.all?(term, fn {key, value} -> serializable?(key) and serializable?(value) end)
  end

  def serializable?(_term), do: true
end
