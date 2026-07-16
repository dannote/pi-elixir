defmodule Pi.Mirror.QuackDB.ConfigTest do
  use ExUnit.Case, async: false

  alias Pi.Mirror.QuackDB.Config

  @variables ~w(
    PI_ELIXIR_MIRROR_POOL_SIZE
    PI_ELIXIR_MIRROR_BATCH_SIZE
    PI_ELIXIR_MIRROR_SYNC_BATCH_SIZE
    PI_ELIXIR_MIRROR_WAIT_TIMEOUT
  )

  setup do
    previous = Map.new(@variables, &{&1, System.get_env(&1)})

    on_exit(fn ->
      Enum.each(previous, fn
        {name, nil} -> System.delete_env(name)
        {name, value} -> System.put_env(name, value)
      end)
    end)

    :ok
  end

  test "uses positive configured integer values" do
    System.put_env("PI_ELIXIR_MIRROR_POOL_SIZE", "3")
    System.put_env("PI_ELIXIR_MIRROR_BATCH_SIZE", "25")
    System.put_env("PI_ELIXIR_MIRROR_SYNC_BATCH_SIZE", "100")
    System.put_env("PI_ELIXIR_MIRROR_WAIT_TIMEOUT", "2500")

    assert Config.pool_size() == 3
    assert Config.batch_size() == 25
    assert Config.sync_batch_size() == 100
    assert Config.wait_timeout() == 2_500
  end

  test "falls back safely for malformed or non-positive values" do
    System.put_env("PI_ELIXIR_MIRROR_POOL_SIZE", "invalid")
    System.put_env("PI_ELIXIR_MIRROR_BATCH_SIZE", "0")
    System.put_env("PI_ELIXIR_MIRROR_SYNC_BATCH_SIZE", "-1")
    System.put_env("PI_ELIXIR_MIRROR_WAIT_TIMEOUT", "1.5")

    assert Config.pool_size() == 1
    assert Config.batch_size() == 1
    assert Config.sync_batch_size() == 5_000
    assert Config.wait_timeout() == 10_000
  end
end
