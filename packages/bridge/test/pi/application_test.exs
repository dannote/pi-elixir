defmodule Pi.ApplicationTest do
  use ExUnit.Case, async: false

  alias Pi.Eval.Registry, as: EvalRegistry
  alias Pi.Eval.Supervisor, as: EvalSupervisor
  alias Pi.LLM.Broker
  alias Pi.OptionalSupervisor
  alias Pi.Plugin.Event
  alias Pi.Supervisor, as: RootSupervisor
  alias Pi.Target.Attached
  alias Pi.Target.Registry, as: TargetRegistry
  alias Pi.Target.Supervisor, as: TargetSupervisor
  alias Pi.Transport.TaskSupervisor

  test "owns core runtime services in one supervision tree" do
    assert Process.alive?(Process.whereis(RootSupervisor))
    assert Process.alive?(Process.whereis(OptionalSupervisor))
    assert Process.alive?(Process.whereis(TaskSupervisor))
    assert Process.alive?(Process.whereis(EvalSupervisor))
    assert Process.alive?(Process.whereis(EvalRegistry))
    assert Process.alive?(Process.whereis(TargetSupervisor))
    assert Process.alive?(Process.whereis(TargetRegistry))
    assert Process.alive?(Process.whereis(Attached))
    assert Process.alive?(Process.whereis(Broker))
  end

  test "supervises lazy services without linking them to callers" do
    assert :ok = Event.install()
    event = Process.whereis(Event)
    assert Process.alive?(event)

    assert Enum.any?(DynamicSupervisor.which_children(OptionalSupervisor), fn
             {_id, ^event, :worker, [Event]} -> true
             _child -> false
           end)

    GenServer.stop(event)
    refute Process.alive?(event)
    assert Process.alive?(Process.whereis(OptionalSupervisor))
  end
end
