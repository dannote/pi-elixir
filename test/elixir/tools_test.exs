defmodule Pi.MCP.ToolsTest do
  use ExUnit.Case, async: true

  @scripts_dir Path.expand("../../scripts/tools", __DIR__)

  defp eval_script(name, bindings) do
    source = File.read!(Path.join(@scripts_dir, "#{name}.exs"))

    assigns =
      Enum.map_join(bindings, "\n", fn {key, value} ->
        "#{key} = #{inspect(value)}"
      end)

    code = "#{assigns}\n\n#{source}"
    {result, _bindings} = Code.eval_string(code, [], __ENV__)
    result
  end

  describe "top.exs" do
    test "returns process list sorted by memory" do
      result = eval_script(:top, sort_by: "memory", max_results: 5)
      assert is_binary(result)
      lines = String.split(result, "\n")
      assert length(lines) == 5
      assert Enum.all?(lines, &String.contains?(&1, "mem="))
      assert Enum.all?(lines, &String.contains?(&1, "reds="))
    end

    test "respects max_results limit" do
      result = eval_script(:top, sort_by: "memory", max_results: 2)
      lines = String.split(result, "\n")
      assert length(lines) == 2
    end

    test "sorts by reductions" do
      result = eval_script(:top, sort_by: "reductions", max_results: 3)
      assert is_binary(result)
      lines = String.split(result, "\n")
      assert length(lines) == 3
    end
  end

  describe "process_info.exs" do
    test "inspects a registered process by name" do
      {:ok, pid} = Agent.start_link(fn -> :test_state end, name: __MODULE__.TestAgent)
      result = eval_script(:process_info, target_ref: inspect(__MODULE__.TestAgent))
      Agent.stop(pid)
      assert result =~ "PID:"
      assert result =~ "Memory:"
      assert result =~ "Reductions:"
      assert result =~ "State:"
    end

    test "inspects a process by PID string" do
      {:ok, pid} = Agent.start_link(fn -> :test_state end)
      pid_str = pid |> :erlang.pid_to_list() |> to_string() |> String.trim_leading("<") |> String.trim_trailing(">")
      result = eval_script(:process_info, target_ref: "pid:#{pid_str}")
      Agent.stop(pid)
      assert result =~ "PID:"
      assert result =~ "Memory:"
    end

    test "returns error for unknown process" do
      result = eval_script(:process_info, target_ref: "NonExistent.Process.Name")
      assert result =~ "Process not found"
    end
  end

  describe "types.exs" do
    test "returns specs for a module" do
      result = eval_script(:types, reference: "Enum")
      assert result =~ "# Enum"
      assert result =~ "@spec"
    end

    test "returns spec for a specific function" do
      result = eval_script(:types, reference: "Enum.map/2")
      assert result =~ "@spec"
      assert result =~ "map"
    end

    test "returns error for module without types" do
      defmodule EmptyModule do
      end

      result = eval_script(:types, reference: "Pi.MCP.ToolsTest.EmptyModule")
      assert result =~ "No types, specs, or callbacks"
    end
  end

  describe "ets.exs" do
    test "lists all ETS tables" do
      result = eval_script(:ets, table_name: nil, match_pattern: nil, max_rows: 50, sort_by: "memory")
      assert result =~ "ETS tables (sorted by memory)"
      assert result =~ "Name"
      assert result =~ "Size"
      assert result =~ "Memory"
    end

    test "lists tables sorted by size" do
      result = eval_script(:ets, table_name: nil, match_pattern: nil, max_rows: 50, sort_by: "size")
      assert result =~ "ETS tables (sorted by size)"
    end

    test "inspects a specific table" do
      :ets.new(:pi_test_table, [:named_table, :set, :public])
      :ets.insert(:pi_test_table, {:key1, "value1"})
      :ets.insert(:pi_test_table, {:key2, "value2"})

      result = eval_script(:ets, table_name: "pi_test_table", match_pattern: nil, max_rows: 50, sort_by: "memory")
      assert result =~ "Name:       :pi_test_table"
      assert result =~ "Type:       set"
      assert result =~ "Contents (2 rows)"
      assert result =~ "key1"
      assert result =~ "key2"

      :ets.delete(:pi_test_table)
    end

    test "applies match pattern" do
      :ets.new(:pi_match_table, [:named_table, :set, :public])
      :ets.insert(:pi_match_table, {:a, :active})
      :ets.insert(:pi_match_table, {:b, :inactive})
      :ets.insert(:pi_match_table, {:c, :active})

      result = eval_script(:ets, table_name: "pi_match_table", match_pattern: "{:_, :active}", max_rows: 50, sort_by: "memory")
      assert result =~ "Contents (2 rows)"
      assert result =~ ":a"
      assert result =~ ":c"
      refute result =~ ":b, :inactive"

      :ets.delete(:pi_match_table)
    end

    test "respects max_rows limit" do
      :ets.new(:pi_limit_table, [:named_table, :set, :public])
      for i <- 1..10, do: :ets.insert(:pi_limit_table, {:"key_#{i}", i})

      result = eval_script(:ets, table_name: "pi_limit_table", match_pattern: nil, max_rows: 3, sort_by: "memory")
      assert result =~ "(10 total, showing first 3)"

      :ets.delete(:pi_limit_table)
    end

    test "returns error for non-existent table" do
      result = eval_script(:ets, table_name: "nonexistent_table_12345", match_pattern: nil, max_rows: 50, sort_by: "memory")
      assert result =~ "ETS table not found"
    end
  end
end
