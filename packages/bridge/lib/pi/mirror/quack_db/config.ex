defmodule Pi.Mirror.QuackDB.Config do
  @moduledoc false

  @default_batch_size 1
  @default_sync_batch_size 5_000

  def database do
    path =
      System.get_env("PI_ELIXIR_MIRROR_DB") ||
        Path.join([System.user_home!(), ".pi", "elixir", "session-mirror.duckdb"])

    File.mkdir_p!(Path.dirname(path))
    path
  end

  def duckdb do
    case System.get_env("PI_ELIXIR_MIRROR_DUCKDB") do
      nil -> :managed
      "managed" -> :managed
      path -> path
    end
  end

  def token(default), do: System.get_env("PI_ELIXIR_MIRROR_QUACKDB_TOKEN") || default

  def port do
    default = available_loopback_port()

    case positive_integer("PI_ELIXIR_MIRROR_QUACKDB_PORT", default) do
      port when port <= 65_535 -> port
      _port -> default
    end
  end

  defp available_loopback_port do
    case :gen_tcp.listen(0, ip: {127, 0, 0, 1}, active: false) do
      {:ok, socket} ->
        try do
          case :inet.sockname(socket) do
            {:ok, {_address, port}} -> port
            _error -> fallback_port()
          end
        after
          :gen_tcp.close(socket)
        end

      _error ->
        fallback_port()
    end
  end

  defp fallback_port, do: 20_000 + rem(System.unique_integer([:positive]), 30_000)

  def pool_size, do: positive_integer("PI_ELIXIR_MIRROR_POOL_SIZE", 1)
  def batch_size, do: positive_integer("PI_ELIXIR_MIRROR_BATCH_SIZE", @default_batch_size)

  def sync_batch_size,
    do: positive_integer("PI_ELIXIR_MIRROR_SYNC_BATCH_SIZE", @default_sync_batch_size)

  def wait_timeout, do: positive_integer("PI_ELIXIR_MIRROR_WAIT_TIMEOUT", 10_000)

  def daemon_options do
    if System.get_env("PI_ELIXIR_DEBUG") == "1", do: [log_output: :debug], else: []
  end

  def compact_keyword(keyword), do: Enum.reject(keyword, fn {_key, value} -> is_nil(value) end)

  defp positive_integer(name, default) do
    case System.get_env(name) do
      nil -> default
      value -> parse_positive_integer(value, default)
    end
  end

  defp parse_positive_integer(value, default) do
    case Integer.parse(value) do
      {integer, ""} when integer > 0 -> integer
      _other -> default
    end
  end
end
