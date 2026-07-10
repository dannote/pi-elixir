defmodule Pi.Protocol.Tool.EvalRequest do
  @moduledoc "Arguments for project eval tools."

  use JSONCodec, fast_path: :json

  defstruct [
    :code,
    :session_id,
    :state_path,
    :restore_path,
    timeout: nil,
    mode: :trusted,
    target: :project
  ]

  @type mode :: :trusted | :sandbox
  @type target :: :project | :application | :bridge | :runtime
  @type t :: %__MODULE__{
          code: String.t(),
          timeout: non_neg_integer() | nil,
          mode: :trusted | :sandbox,
          target: :project | :application | :bridge | :runtime,
          session_id: String.t() | nil,
          state_path: String.t() | nil,
          restore_path: String.t() | nil
        }

  codec(:session_id, as: "sessionId")
  codec(:state_path, as: "statePath")
  codec(:restore_path, as: "restorePath")
end
