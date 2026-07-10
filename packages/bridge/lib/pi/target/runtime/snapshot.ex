defmodule Pi.Target.Runtime.Snapshot do
  @moduledoc false

  alias Pi.Target.Runtime.Term

  @version 1
  @max_bytes 10 * 1_024 * 1_024

  def load(nil), do: :error

  def load(path) do
    with true <- File.regular?(path),
         {:ok, binary} <- File.read(path),
         %{version: @version, binding: binding, aliases: aliases} <-
           :erlang.binary_to_term(binary, [:safe]) do
      {:ok, restore_binding(binding), restore_env(aliases)}
    else
      _other -> :error
    end
  rescue
    _exception in [ArgumentError] -> :error
  end

  def store(nil, _binding, _env), do: %{persisted?: false, dropped_bindings: []}

  def store(path, binding, %Macro.Env{} = env) do
    {binding, dropped} = shrink_binding(binding, env)

    payload = %{
      version: @version,
      binding: snapshot_binding(binding),
      aliases: snapshot_aliases(env.aliases)
    }

    binary = :erlang.term_to_binary(payload)

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- atomic_write(path, binary) do
      %{
        persisted?: true,
        bytes: byte_size(binary),
        binding_count: length(binding),
        dropped_bindings: dropped
      }
    else
      {:error, reason} -> %{persisted?: false, error: inspect(reason), dropped_bindings: dropped}
    end
  rescue
    exception in [ArgumentError, ErlangError, File.Error] ->
      %{persisted?: false, error: Exception.message(exception), dropped_bindings: []}
  end

  def binding_info(binding) do
    Enum.map(binding, fn {name, value} ->
      %{
        name: Atom.to_string(name),
        type: value_type(value),
        bytes: value_bytes(value),
        preview: inspect(value, charlists: :as_lists, limit: 20, pretty: true)
      }
    end)
  end

  defp shrink_binding(binding, env) do
    binding = Enum.filter(binding, fn {_name, value} -> Term.serializable?(value) end)
    drop_until_fits(binding, env, [])
  end

  defp drop_until_fits([], _env, dropped), do: {[], Enum.reverse(dropped)}

  defp drop_until_fits(binding, env, dropped) do
    binary =
      :erlang.term_to_binary(%{
        version: @version,
        binding: snapshot_binding(binding),
        aliases: snapshot_aliases(env.aliases)
      })

    if byte_size(binary) <= @max_bytes do
      {binding, Enum.reverse(dropped)}
    else
      {name, _value} = Enum.max_by(binding, fn {_name, value} -> value_bytes(value) end)
      drop_until_fits(Keyword.delete(binding, name), env, [name | dropped])
    end
  end

  defp atomic_write(path, binary) do
    temporary = path <> ".tmp-" <> Integer.to_string(System.unique_integer([:positive]))

    try do
      with :ok <- File.write(temporary, binary), do: File.rename(temporary, path)
    after
      File.rm(temporary)
    end
  end

  defp snapshot_binding(binding),
    do: Enum.map(binding, fn {name, value} -> {Atom.to_string(name), value} end)

  defp restore_binding(binding) do
    binding
    |> Enum.map(fn {name, value} -> {existing_atom(name), value} end)
    |> Enum.reject(fn {name, _value} -> is_nil(name) end)
  end

  defp snapshot_aliases(aliases),
    do: Enum.map(aliases, fn {name, module} -> {Atom.to_string(name), module} end)

  defp restore_env(aliases) do
    aliases =
      aliases
      |> Enum.map(fn {name, module} -> {existing_atom(name), module} end)
      |> Enum.reject(fn {name, _module} -> is_nil(name) end)

    struct(Code.env_for_eval([]), %{aliases: aliases})
  end

  defp existing_atom(name) do
    String.to_existing_atom(name)
  rescue
    _exception in [ArgumentError] -> nil
  end

  defp value_type(%module{}), do: inspect(module)
  defp value_type(value) when is_binary(value), do: "binary"
  defp value_type(value) when is_boolean(value), do: "boolean"
  defp value_type(value) when is_atom(value), do: "atom"
  defp value_type(value) when is_integer(value), do: "integer"
  defp value_type(value) when is_float(value), do: "float"
  defp value_type(value) when is_list(value), do: "list"
  defp value_type(value) when is_tuple(value), do: "tuple"
  defp value_type(value) when is_map(value), do: "map"
  defp value_type(_value), do: "term"

  defp value_bytes(value), do: value |> :erlang.term_to_binary() |> byte_size()
end
