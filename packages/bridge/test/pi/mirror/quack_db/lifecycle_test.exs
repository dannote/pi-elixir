defmodule Pi.Mirror.QuackDB.LifecycleTest do
  use ExUnit.Case, async: false

  alias Pi.Mirror.QuackDB, as: Mirror
  alias Pi.Mirror.QuackDB.Lifecycle

  setup do
    db =
      Path.join(
        System.tmp_dir!(),
        "pi-elixir-lifecycle-#{System.unique_integer([:positive])}.duckdb"
      )

    previous_db = System.get_env("PI_ELIXIR_MIRROR_DB")
    previous_uri = System.get_env("PI_ELIXIR_MIRROR_QUACKDB_URI")

    System.put_env("PI_ELIXIR_MIRROR_DB", db)
    System.delete_env("PI_ELIXIR_MIRROR_QUACKDB_URI")
    Lifecycle.stop()

    on_exit(fn ->
      Lifecycle.stop()
      restore_env("PI_ELIXIR_MIRROR_DB", previous_db)
      restore_env("PI_ELIXIR_MIRROR_QUACKDB_URI", previous_uri)
      File.rm(db)
    end)

    :ok
  end

  test "serializes concurrent startup and releases every resource across repeated cycles" do
    for _cycle <- 1..10 do
      resources =
        1..8
        |> Enum.map(fn _index -> Task.async(&Lifecycle.ensure_started/0) end)
        |> Task.await_many(30_000)
        |> Enum.map(fn {:ok, resources} -> resources end)

      assert [supervisor] = resources |> Enum.map(& &1.supervisor) |> Enum.uniq()
      assert Process.alive?(supervisor)
      assert %{status: :ready, resources: %{supervisor: ^supervisor}} = Lifecycle.status()
      assert :ok = QuackDB.ping(Mirror.Client)

      assert :ok = Lifecycle.stop()
      refute Process.alive?(supervisor)
      assert %{status: :stopped} = Lifecycle.status()
      refute Process.whereis(Mirror.Server)
      refute Process.whereis(Mirror.Client)
      refute Process.whereis(Pi.Mirror.QuackDB.SyncSupervisor)
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
