defmodule Pi.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Pi.OptionalSupervisor,
      {Task.Supervisor, name: Pi.Transport.TaskSupervisor},
      {Registry, keys: :unique, name: Pi.Eval.Registry},
      Pi.Eval.Supervisor,
      {Registry, keys: :unique, name: Pi.Target.Registry},
      Pi.Target.Supervisor,
      Pi.Target.Attached,
      Pi.LLM.Broker
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: Pi.Supervisor)
  end
end
