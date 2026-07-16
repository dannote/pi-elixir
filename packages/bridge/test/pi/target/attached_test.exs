defmodule Pi.Target.AttachedTest do
  use ExUnit.Case, async: false

  alias Pi.Target.Attached

  setup_all do
    unless Node.alive?() do
      {_, 0} = System.cmd("epmd", ["-daemon"], stderr_to_stdout: true)
      {:ok, _pid} = Node.start(:pi_attached_test, name_domain: :shortnames)
    end

    %{node: Node.self()}
  end

  setup do
    :ok = Attached.reset()
  end

  test "observes pre-existing runtime state and keeps attached bindings", %{node: node} do
    :ets.new(:pi_attached_fixture, [:named_table, :public])
    :ets.insert(:pi_attached_fixture, {:answer, 42})

    assert {:ok, first} =
             Attached.run_structured(":ets.lookup(:pi_attached_fixture, :answer)",
               node: Atom.to_string(node),
               session_id: "attached"
             )

    assert first.result == "[answer: 42]"
    assert first.state.runtime.profile == "attached"
    assert first.state.runtime.node == node

    assert {:ok, _payload} =
             Attached.run_structured("attached_value = 40",
               node: Atom.to_string(node),
               session_id: "attached"
             )

    assert {:ok, second} =
             Attached.run_structured("attached_value + 2",
               node: Atom.to_string(node),
               session_id: "attached"
             )

    assert second.result == "42"
  after
    if :ets.whereis(:pi_attached_fixture) != :undefined, do: :ets.delete(:pi_attached_fixture)
  end

  test "reports the canonical node when attachment is unreachable" do
    missing_node = :pi_missing_runtime@localhost

    assert {:error, message} =
             Attached.run_structured("1 + 1", node: missing_node, cookie: Node.get_cookie())

    assert message =~ "node_unreachable"
    assert message =~ inspect(missing_node)
    refute message =~ "{:ok,"
  end

  test "requires an explicit node", %{node: _node} do
    previous = System.get_env("PI_ELIXIR_NODE")
    System.delete_env("PI_ELIXIR_NODE")

    try do
      assert {:error, message} = Attached.run_structured("1 + 1")
      assert message =~ "PI_ELIXIR_NODE"
    after
      if previous,
        do: System.put_env("PI_ELIXIR_NODE", previous),
        else: System.delete_env("PI_ELIXIR_NODE")
    end
  end
end
