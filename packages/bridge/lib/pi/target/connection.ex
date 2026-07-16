defmodule Pi.Target.Connection do
  @moduledoc "Persistent authenticated connection to a dependencyless project VM."

  use GenServer

  alias Pi.Project.Context
  alias Pi.Target.Runtime.{Manifest, Transport}

  @protocol 1
  @required_capabilities [
    :stateful_eval,
    :structured_diagnostics,
    :sidecar_restore,
    :timeout_cancellation
  ]
  @startup_timeout 60_000
  @packet_limit 32 * 1_024 * 1_024

  defstruct [:context, :profile, :socket, :port, :handshake, :bootstrap_hash, request_id: 0]

  def start_link(opts) do
    context = Keyword.fetch!(opts, :context)
    profile = Keyword.get(opts, :profile, :project)
    name = {:via, Registry, {Pi.Target.Registry, {context.root, profile}}}
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  def eval(pid, code, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 30_000)
    GenServer.call(pid, {:eval, code, opts}, timeout + @startup_timeout + 5_000)
  end

  def request(pid, operation, payload, timeout \\ 30_000),
    do:
      GenServer.call(
        pid,
        {:request, operation, payload, timeout},
        timeout + @startup_timeout + 5_000
      )

  def status(pid), do: GenServer.call(pid, :status)

  @impl true
  def init(opts) do
    {:ok,
     %__MODULE__{
       context: Keyword.fetch!(opts, :context),
       profile: Keyword.get(opts, :profile, :project),
       bootstrap_hash: bootstrap_hash()
     }}
  end

  @impl true
  def handle_call({:eval, code, opts}, _from, state) do
    payload = %{
      code: code,
      session_id: Keyword.get(opts, :session_id, "default"),
      state_path: Keyword.get(opts, :state_path),
      restore_path: Keyword.get(opts, :restore_path),
      timeout: Keyword.get(opts, :timeout, 30_000)
    }

    {reply, state} = do_request(state, :eval, payload, payload.timeout + 1_000)
    {:reply, reply, state}
  end

  def handle_call({:request, operation, payload, timeout}, _from, state) do
    {reply, state} = do_request(state, operation, payload, timeout)
    {:reply, reply, state}
  end

  def handle_call(:status, _from, state) do
    status = %{
      connected: is_port(state.socket),
      profile: state.profile,
      project_root: state.context.root,
      handshake: state.handshake
    }

    {:reply, status, state}
  end

  @impl true
  def handle_info({port, {:data, output}}, %{port: port} = state) do
    IO.write(:stderr, output)
    {:noreply, state}
  end

  def handle_info({port, {:exit_status, _status}}, %{port: port} = state) do
    {:noreply, disconnect(state)}
  end

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    if is_port(state.socket) do
      _ = Transport.send_term(state.socket, {:request, state.request_id + 1, :shutdown, %{}})
      :gen_tcp.close(state.socket)
    end

    close_port(state.port)
    :ok
  end

  defp do_request(state, operation, payload, timeout) do
    with {:ok, state} <- ensure_connected(state),
         id = state.request_id + 1,
         :ok <- Transport.send_term(state.socket, {:request, id, operation, payload}),
         {:ok, {:response, ^id, response}} <-
           Transport.recv_trusted_term(state.socket, timeout) do
      {response, %{state | request_id: id}}
    else
      {:error, reason} ->
        {{:error, connection_error(reason)}, disconnect(state)}

      unexpected ->
        {{:error, connection_error({:unexpected_response, unexpected})}, disconnect(state)}
    end
  end

  defp ensure_connected(%{socket: socket} = state) when is_port(socket), do: {:ok, state}

  defp ensure_connected(state) do
    with :ok <- ensure_mix_project(state.context),
         {:ok, listener} <- listen() do
      connect_listener(state, listener)
    end
  end

  defp connect_listener(state, listener) do
    with {:ok, port_number} <- listener_port(listener),
         token = authentication_token(),
         {:ok, port} <- launch(state, port_number, token) do
      finish_connection(state, listener, port, token)
    end
  after
    :gen_tcp.close(listener)
  end

  defp finish_connection(state, listener, port, token) do
    case accept(listener, port, @startup_timeout) do
      {:ok, socket} -> authenticate_connection(state, socket, port, token)
      {:error, _reason} = error -> stop_port(port, error)
    end
  end

  defp authenticate_connection(state, socket, port, token) do
    result =
      with :ok <- authenticate(socket, token),
           {:ok, handshake} <- receive_handshake(socket),
           :ok <- validate_handshake(handshake, state) do
        {:ok, %{state | socket: socket, port: port, handshake: handshake}}
      end

    case result do
      {:ok, _state} = success ->
        success

      error ->
        :gen_tcp.close(socket)
        stop_port(port, error)
    end
  end

  defp stop_port(port, result) do
    if Port.info(port), do: Port.close(port)
    result
  rescue
    ArgumentError -> result
  end

  defp listen do
    :gen_tcp.listen(0, [
      :binary,
      packet: 4,
      packet_size: @packet_limit,
      active: false,
      ip: {127, 0, 0, 1},
      reuseaddr: true
    ])
  end

  defp listener_port(listener) do
    case :inet.sockname(listener) do
      {:ok, {_address, port}} -> {:ok, port}
      error -> error
    end
  end

  defp launch(state, port_number, token) do
    case System.find_executable("mix") do
      executable when is_binary(executable) ->
        args = mix_args(state)

        port =
          Port.open({:spawn_executable, executable}, [
            :binary,
            :exit_status,
            :stderr_to_stdout,
            args: Enum.map(args, &to_charlist/1),
            cd: to_charlist(state.context.root),
            env: worker_env(state, port_number, token)
          ])

        {:ok, port}

      _other ->
        {:error, :mix_not_found}
    end
  rescue
    exception in [ArgumentError, ErlangError] -> {:error, exception}
  end

  defp mix_args(state) do
    no_compile = if usable_build?(state.context), do: ["--no-compile"], else: []
    no_start = if state.profile == :project, do: ["--no-start"], else: []
    ["run"] ++ no_compile ++ no_start ++ ["--no-halt", bootstrap_path()]
  end

  defp usable_build?(context) do
    context.build_path
    |> Path.join("lib/*/ebin")
    |> Path.wildcard()
    |> Enum.any?()
  end

  defp worker_env(state, port_number, token) do
    %{
      "MIX_ENV" => state.context.mix_env,
      "PI_ELIXIR_TARGET_PORT" => Integer.to_string(port_number),
      "PI_ELIXIR_TARGET_TOKEN" => token,
      "PI_ELIXIR_TARGET_PROFILE" => Atom.to_string(state.profile),
      "PI_ELIXIR_TARGET_BOOTSTRAP_HASH" => state.bootstrap_hash,
      "PI_ELIXIR_TARGET_SOURCE_ROOT" => target_source_root()
    }
    |> Enum.map(fn {key, value} -> {to_charlist(key), to_charlist(value)} end)
  end

  defp accept(listener, port, timeout) do
    owner = self()
    tag = make_ref()

    spawn(fn ->
      result =
        case :gen_tcp.accept(listener, timeout) do
          {:ok, socket} -> transfer_socket(socket, owner)
          error -> error
        end

      send(owner, {tag, result})
    end)

    await_accept(tag, port, timeout, [])
  end

  defp transfer_socket(socket, owner) do
    case :gen_tcp.controlling_process(socket, owner) do
      :ok -> {:ok, socket}
      {:error, reason} -> {:error, reason}
    end
  end

  defp await_accept(tag, port, timeout, output) do
    receive do
      {^tag, {:ok, socket}} ->
        {:ok, socket}

      {^tag, {:error, reason}} ->
        {:error, startup_error(reason, output)}

      {^port, {:data, chunk}} ->
        await_accept(tag, port, timeout, [chunk | output])

      {^port, {:exit_status, status}} ->
        {:error, startup_error({:exit_status, status}, output)}
    after
      timeout -> {:error, startup_error(:timeout, output)}
    end
  end

  defp authenticate(socket, expected_token) do
    case Transport.recv_term(socket, 5_000) do
      {:ok, {:authenticate, ^expected_token}} -> :ok
      {:ok, _other} -> {:error, :authentication_failed}
      error -> error
    end
  end

  defp receive_handshake(socket) do
    case Transport.recv_trusted_term(socket, 5_000) do
      {:ok, {:hello, handshake}} when is_map(handshake) -> {:ok, handshake}
      {:ok, other} -> {:error, {:invalid_handshake, other}}
      error -> error
    end
  end

  defp validate_handshake(handshake, state) do
    missing = @required_capabilities -- Map.get(handshake, :capabilities, [])

    cond do
      handshake[:protocol] != @protocol ->
        {:error, {:protocol_mismatch, @protocol, handshake[:protocol]}}

      handshake[:bootstrap_hash] != state.bootstrap_hash ->
        {:error, :bootstrap_hash_mismatch}

      Path.expand(to_string(handshake[:project_root])) != state.context.root ->
        {:error, {:project_root_mismatch, state.context.root, handshake[:project_root]}}

      missing != [] ->
        {:error, {:missing_capabilities, missing}}

      true ->
        :ok
    end
  end

  defp ensure_mix_project(context) do
    if Context.mix_project?(context),
      do: :ok,
      else: {:error, {:mix_project_not_found, context.mix_file}}
  end

  defp disconnect(state) do
    if is_port(state.socket), do: :gen_tcp.close(state.socket)
    close_port(state.port)
    %{state | socket: nil, port: nil, handshake: nil}
  end

  defp close_port(port) when is_port(port) do
    Port.close(port)
  rescue
    _exception in [ArgumentError] -> :ok
  end

  defp close_port(_port), do: :ok

  defp authentication_token,
    do: :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)

  defp bootstrap_hash do
    runtime_root = Path.join(target_source_root(), "runtime")

    [
      bootstrap_path(),
      Path.join(runtime_root, "manifest.ex")
      | Enum.map(Manifest.files(), &Path.join(runtime_root, &1))
    ]
    |> Enum.map(&File.read!/1)
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  defp bootstrap_path, do: Path.join(target_source_root(), "bootstrap.exs")
  defp target_source_root, do: Application.app_dir(:pi_bridge, "priv/target")

  defp startup_error(reason, output) do
    %{
      kind: :target_start_failed,
      reason: reason,
      output: output |> Enum.reverse() |> IO.iodata_to_binary()
    }
  end

  defp connection_error(reason),
    do: %{kind: :target_connection_failed, message: inspect(reason)}
end
