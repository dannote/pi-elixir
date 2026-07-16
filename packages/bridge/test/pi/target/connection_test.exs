defmodule Pi.Target.ConnectionTest do
  use ExUnit.Case, async: false

  alias Pi.ProjectEval

  setup do
    stop_targets()

    root = Path.join(System.tmp_dir!(), "pi-target-fixture-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, "lib"))

    File.write!(Path.join(root, "mix.exs"), """
    defmodule TargetFixture.MixProject do
      use Mix.Project

      def project do
        [app: :target_fixture, version: "0.1.0", elixir: "~> 1.16"]
      end

      def application, do: [mod: {TargetFixture.Application, []}]
    end
    """)

    File.write!(Path.join(root, "lib/target_fixture.ex"), """
    defmodule TargetFixture do
      def answer, do: 42
    end

    defmodule TargetFixture.Application do
      use Application

      def start(_type, _args) do
        children = [
          %{
            id: TargetFixture.RuntimeAgent,
            start: {Agent, :start_link, [fn -> 77 end, [name: TargetFixture.RuntimeAgent]]}
          }
        ]
        Supervisor.start_link(children, strategy: :one_for_one)
      end
    end
    """)

    on_exit(fn ->
      stop_targets()
      File.rm_rf(root)
    end)

    %{root: root}
  end

  test "keeps project bindings and modules in one persistent VM", %{root: root} do
    assert {:ok, first} =
             ProjectEval.run_structured("x = TargetFixture.answer()",
               root: root,
               session_id: "persistent"
             )

    assert first.result == "42"
    os_pid = first.state.runtime.os_pid

    assert {:ok, second} =
             ProjectEval.run_structured("x + 1", root: root, session_id: "persistent")

    assert second.result == "43"
    assert second.state.runtime.os_pid == os_pid
    assert Enum.any?(second.bindings, &(&1.name == "x"))

    assert {:ok, started} =
             ProjectEval.run_structured(
               "Application.started_applications() |> Enum.any?(fn {app, _, _} -> app == :target_fixture end)",
               root: root,
               session_id: "application-state"
             )

    assert started.result == "false"
  end

  test "returns a compact one-line preview for multiline inspect results", %{root: root} do
    assert {:ok, payload} =
             ProjectEval.run_structured(
               "%{modules: 42, missing_moduledoc: [:Alpha, :Beta], undocumented_count: 7}",
               root: root,
               session_id: "compact-preview"
             )

    assert [%Pi.Protocol.Tool.OutputPart{kind: :inspect, title: preview}] = payload.parts
    assert preview =~ "modules: 42"
    assert preview =~ "undocumented_count: 7"
    refute preview == "%{"
    refute preview =~ "\n"
  end

  test "starts application side effects only in the explicit application profile", %{root: root} do
    assert {:ok, code_worker} =
             ProjectEval.run_structured("Process.whereis(TargetFixture.RuntimeAgent)",
               root: root,
               session_id: "code-worker"
             )

    assert code_worker.result == "nil"

    assert {:ok, application_worker} =
             ProjectEval.run_structured("Agent.get(TargetFixture.RuntimeAgent, & &1)",
               root: root,
               profile: :application,
               session_id: "application-worker"
             )

    assert application_worker.result == "77"
    assert application_worker.state.runtime.profile == "application"
    refute application_worker.state.runtime.os_pid == code_worker.state.runtime.os_pid
  end

  test "isolates branches and restores sidecar state", %{root: root} do
    state_path = Path.join(root, ".pi-state/parent.term")
    child_path = Path.join(root, ".pi-state/child.term")

    assert {:ok, _payload} =
             ProjectEval.run_structured("branch_value = 10",
               root: root,
               session_id: "parent",
               state_path: state_path
             )

    assert File.regular?(state_path)

    assert {:ok, child} =
             ProjectEval.run_structured("branch_value + 5",
               root: root,
               session_id: "child",
               state_path: child_path,
               restore_path: state_path
             )

    assert child.result == "15"

    assert {:error, sibling} =
             ProjectEval.run_structured("branch_value",
               root: root,
               session_id: "sibling"
             )

    assert sibling.text =~ "undefined variable"
  end

  test "returns diagnostics and recovers after timeout", %{root: root} do
    assert {:error, diagnostic} =
             ProjectEval.run_structured("target_missing_variable",
               root: root,
               session_id: "diagnostic"
             )

    assert [%{severity: :error, message: message}] = diagnostic.diagnostics
    assert message =~ "undefined variable"

    assert {:error, timeout} =
             ProjectEval.run_structured("Process.sleep(500)",
               root: root,
               session_id: "timeout",
               timeout: 25
             )

    assert timeout =~ "timed out"

    assert {:ok, recovered} =
             ProjectEval.run_structured("6 * 7", root: root, session_id: "after-timeout")

    assert recovered.result == "42"
  end

  test "keeps last-good code after compile failure and reloads successful builds", %{root: root} do
    source = Path.join(root, "lib/target_fixture.ex")

    assert {:ok, initial} =
             ProjectEval.run_structured("TargetFixture.answer()",
               root: root,
               session_id: "last-good"
             )

    assert initial.result == "42"

    File.write!(source, "defmodule TargetFixture do\n  def answer(, do: 99\nend\n")

    assert {:error, failed} = ProjectEval.compile(root: root)
    assert failed.kind == :compile_error
    assert failed.last_good_preserved

    assert {:ok, still_good} =
             ProjectEval.run_structured("TargetFixture.answer()",
               root: root,
               session_id: "last-good"
             )

    assert still_good.result == "42"

    File.write!(source, "defmodule TargetFixture do\n  def answer, do: 43\nend\n")

    assert {:ok, compiled} = ProjectEval.compile(root: root)
    assert compiled.last_good_preserved
    assert compiled.changed_beams != []

    assert {:ok, reloaded} =
             ProjectEval.run_structured("TargetFixture.answer()",
               root: root,
               session_id: "last-good"
             )

    assert reloaded.result == "43"
  end

  test "restarts the target VM after a hard VM exit", %{root: root} do
    assert {:ok, before_exit} =
             ProjectEval.run_structured("System.pid()", root: root, session_id: "before-exit")

    assert {:error, _reason} =
             ProjectEval.run_structured(":erlang.halt(9)",
               root: root,
               session_id: "hard-exit",
               timeout: 2_000
             )

    assert {:ok, after_exit} =
             ProjectEval.run_structured("System.pid()", root: root, session_id: "after-exit")

    refute after_exit.result == before_exit.result
  end

  defp stop_targets, do: Pi.Target.Supervisor.reset()
end
