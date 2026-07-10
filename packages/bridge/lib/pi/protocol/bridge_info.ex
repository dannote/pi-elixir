defmodule Pi.Protocol.BridgeInfo do
  @moduledoc "Startup inventory for a pi_bridge session."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.API.Inventory
  alias Pi.Protocol.PluginCommand
  alias Pi.Protocol.PluginInfo
  alias Pi.Protocol.SkillInfo

  defstruct [
    :project,
    :version,
    :build,
    :protocol,
    :transport,
    capabilities: [],
    skills: [],
    plugins: [],
    commands: [],
    apis: %Inventory{}
  ]

  @type t :: %__MODULE__{
          project: atom() | nil,
          version: String.t() | nil,
          build: String.t(),
          protocol: pos_integer(),
          transport: atom() | nil,
          capabilities: [atom()],
          skills: [SkillInfo.t()],
          plugins: [PluginInfo.t()],
          commands: [PluginCommand.t()],
          apis: Inventory.t()
        }

  codec(:project, atom: :unsafe)
  codec(:transport, atom: :existing)
end
