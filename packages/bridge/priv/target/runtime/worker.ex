defmodule Pi.Target.Runtime.Worker do
  @moduledoc false

  alias Pi.Target.Runtime.Evaluator
  alias Pi.Target.Runtime.Transport

  @protocol 1
  @capabilities [
    :stateful_eval,
    :structured_diagnostics,
    :sidecar_restore,
    :timeout_cancellation
  ]

  def run do
    with {:ok, socket} <- connect(),
         :ok <- Transport.send_term(socket, {:hello, handshake()}),
         :ok <- loop(socket, %{}) do
      :ok
    else
      {:error, reason} ->
        IO.puts(:stderr, "pi target worker stopped: #{inspect(reason)}")
        System.halt(70)
    end
  end

  defp loop(socket, evaluators) do
    case Transport.recv_term(socket, :infinity) do
      {:ok, {:request, id, :ping, _payload}} ->
        with :ok <- Transport.send_term(socket, {:response, id, {:ok, handshake()}}) do
          loop(socket, evaluators)
        end

      {:ok, {:request, id, :eval, payload}} when is_map(payload) ->
        {response, evaluators} = evaluate(evaluators, payload)

        with :ok <- Transport.send_term(socket, {:response, id, response}) do
          loop(socket, evaluators)
        end

      {:ok, {:request, id, :reset, %{session_id: session_id}}} ->
        {response, evaluators} = reset(evaluators, session_id)

        with :ok <- Transport.send_term(socket, {:response, id, response}) do
          loop(socket, evaluators)
        end

      {:ok, {:request, id, :reload, %{beams: beams}}} when is_list(beams) ->
        response = {:ok, reload_beams(beams)}

        with :ok <- Transport.send_term(socket, {:response, id, response}) do
          loop(socket, evaluators)
        end

      {:ok, {:request, id, :shutdown, _payload}} ->
        Transport.send_term(socket, {:response, id, {:ok, :shutdown}})

      {:ok, request} ->
        Transport.send_term(socket, {:protocol_error, inspect(request)})
        loop(socket, evaluators)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp evaluate(evaluators, payload) do
    session_id = Map.get(payload, :session_id, "default")
    timeout = Map.get(payload, :timeout, 30_000)
    {pid, evaluators} = evaluator(evaluators, session_id, payload)
    tag = make_ref()
    owner = self()

    {task, monitor} =
      spawn_monitor(fn -> send(owner, {tag, Evaluator.evaluate(pid, payload)}) end)

    receive do
      {^tag, result} ->
        Process.demonitor(monitor, [:flush])
        {{:ok, Map.put(result, :runtime, runtime_meta())}, evaluators}

      {:DOWN, ^monitor, :process, ^task, reason} ->
        {{:error, %{kind: :worker_eval_exit, message: Exception.format_exit(reason)}},
         Map.delete(evaluators, session_id)}
    after
      timeout ->
        Process.exit(task, :kill)
        Process.exit(pid, :kill)
        Process.demonitor(monitor, [:flush])

        {{:error, %{kind: :timeout, message: "Evaluation timed out after #{timeout}ms"}},
         Map.delete(evaluators, session_id)}
    end
  end

  defp evaluator(evaluators, session_id, payload) do
    case Map.get(evaluators, session_id) do
      pid when is_pid(pid) ->
        if Process.alive?(pid) do
          {pid, evaluators}
        else
          start_evaluator(evaluators, session_id, payload)
        end

      _other ->
        start_evaluator(evaluators, session_id, payload)
    end
  end

  defp start_evaluator(evaluators, session_id, payload) do
    {:ok, pid} = Evaluator.start(payload)
    {pid, Map.put(evaluators, session_id, pid)}
  end

  defp reload_beams(beams) do
    Enum.map(beams, fn path ->
      path = Path.rootname(path)

      case :code.load_abs(String.to_charlist(path)) do
        {:module, module} -> %{path: path <> ".beam", module: module, status: :loaded}
        {:error, reason} -> %{path: path <> ".beam", status: :error, reason: reason}
      end
    end)
  end

  defp reset(evaluators, session_id) do
    case Map.pop(evaluators, session_id) do
      {pid, evaluators} when is_pid(pid) ->
        result = Evaluator.reset(pid)
        {{:ok, result}, evaluators}

      {nil, evaluators} ->
        {{:ok, :not_found}, evaluators}
    end
  end

  defp connect do
    port = System.fetch_env!("PI_ELIXIR_TARGET_PORT") |> String.to_integer()
    token = System.fetch_env!("PI_ELIXIR_TARGET_TOKEN")

    case :gen_tcp.connect({127, 0, 0, 1}, port, [:binary, packet: 4, active: false], 10_000) do
      {:ok, socket} ->
        with :ok <- Transport.send_term(socket, {:authenticate, token}), do: {:ok, socket}

      error ->
        error
    end
  end

  defp handshake do
    %{
      protocol: @protocol,
      bootstrap_hash: System.get_env("PI_ELIXIR_TARGET_BOOTSTRAP_HASH"),
      capabilities: @capabilities,
      project_root: File.cwd!(),
      profile: System.get_env("PI_ELIXIR_TARGET_PROFILE", "project"),
      app: Mix.Project.config()[:app],
      elixir: System.version(),
      otp: System.otp_release(),
      os_pid: System.pid()
    }
  end

  defp runtime_meta do
    %{
      profile: System.get_env("PI_ELIXIR_TARGET_PROFILE", "project"),
      node: Node.self(),
      os_pid: System.pid()
    }
  end
end
