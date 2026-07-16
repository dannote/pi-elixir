defmodule Pi.Target.Runtime.Evaluator do
  @moduledoc false

  use GenServer

  alias Pi.Target.Runtime.{Diagnostics, Snapshot}

  defstruct binding: [], env: nil, state_path: nil, loaded_path: nil

  def start(opts), do: GenServer.start(__MODULE__, opts)

  def evaluate(pid, request), do: GenServer.call(pid, {:evaluate, request}, :infinity)
  def reset(pid), do: GenServer.call(pid, :reset)

  @impl true
  def init(opts) do
    restore_path = opts[:restore_path] || opts[:state_path]
    {binding, env, loaded_path} = initial_context(restore_path)

    {:ok,
     %__MODULE__{
       binding: binding,
       env: env,
       state_path: opts[:state_path],
       loaded_path: loaded_path
     }}
  end

  @impl true
  def handle_call({:evaluate, request}, _from, state) do
    state = update_path(state, request)
    {reply, next_state} = captured_eval(request.code, state)
    {:reply, reply, next_state}
  end

  def handle_call(:reset, _from, state) do
    state = %{state | binding: [], env: initial_env()}
    {:reply, :ok, state}
  end

  defp captured_eval(code, state) do
    {result, io} = capture_io(fn -> eval(code, state) end)

    case result do
      {:ok, value, next_state, diagnostics} ->
        persisted = Snapshot.store(next_state.state_path, next_state.binding, next_state.env)
        inspected = inspect(value, inspect_opts())
        preview = inspect(value, preview_inspect_opts())

        {%{
           ok: true,
           io: io,
           result: inspected,
           preview: preview,
           text: result_text(io, inspected),
           diagnostics: diagnostics,
           bindings: Snapshot.binding_info(next_state.binding),
           state: state_meta(next_state, persisted)
         }, next_state}

      {:error, text, exception, diagnostics} ->
        text = error_text(io, Diagnostics.append(text, diagnostics))

        {%{
           ok: false,
           io: io,
           error: text,
           text: text,
           exception: exception,
           diagnostics: diagnostics,
           bindings: Snapshot.binding_info(state.binding),
           state: state_meta(state, %{persisted?: false, dropped_bindings: []})
         }, state}
    end
  end

  defp eval(code, state) do
    {result, raw_diagnostics} =
      Code.with_diagnostics([log: false], fn ->
        try do
          quoted = Code.string_to_quoted!(code, file: "pi://target/eval")

          {value, binding, env} =
            Code.eval_quoted_with_env(quoted, state.binding, state.env, prune_binding: true)

          next_state = %{state | binding: merge_binding(state.binding, binding), env: env}
          {:ok, value, next_state}
        catch
          kind, reason ->
            stacktrace = __STACKTRACE__

            {:error, Exception.format(kind, reason, stacktrace),
             Diagnostics.exception(kind, reason, stacktrace)}
        end
      end)

    diagnostics = Diagnostics.normalize(raw_diagnostics)

    case result do
      {:ok, value, next_state} -> {:ok, value, next_state, diagnostics}
      {:error, text, exception} -> {:error, text, exception, diagnostics}
    end
  end

  defp capture_io(fun) do
    {:ok, capture} = StringIO.open("")
    previous = Process.group_leader()
    Process.group_leader(self(), capture)

    try do
      result = fun.()
      {_input, output} = StringIO.contents(capture)
      {result, output}
    after
      Process.group_leader(self(), previous)
      StringIO.close(capture)
    end
  end

  defp update_path(state, request) do
    state_path = Map.get(request, :state_path, state.state_path)
    restore_path = Map.get(request, :restore_path)

    if state_path == state.state_path do
      state
    else
      {binding, env, loaded_path} = initial_context(restore_path || state_path)
      %{state | binding: binding, env: env, state_path: state_path, loaded_path: loaded_path}
    end
  end

  defp initial_context(path) do
    case Snapshot.load(path) do
      {:ok, binding, env} -> {binding, env, path}
      :error -> {[], initial_env(), nil}
    end
  end

  defp initial_env do
    env = Code.env_for_eval([])

    if Code.ensure_loaded?(IEx.Helpers) do
      quoted = Code.string_to_quoted!("import IEx.Helpers, warn: false")
      {_value, _binding, env} = Code.eval_quoted_with_env(quoted, [], env, prune_binding: true)
      env
    else
      env
    end
  end

  defp merge_binding(previous, current) do
    names = MapSet.new(current, &elem(&1, 0))
    current ++ Enum.reject(previous, fn {name, _value} -> MapSet.member?(names, name) end)
  end

  defp state_meta(state, persisted) do
    %{
      persisted: Map.get(persisted, :persisted?, false),
      bytes: Map.get(persisted, :bytes),
      binding_count: length(state.binding),
      dropped_bindings: Map.get(persisted, :dropped_bindings, []),
      loaded_path: state.loaded_path
    }
  end

  defp result_text("", inspected), do: inspected
  defp result_text(io, inspected), do: "IO:\n\n#{io}\n\nResult:\n\n#{inspected}"
  defp error_text("", text), do: text
  defp error_text(io, text), do: "IO:\n\n#{io}\n\nError:\n\n#{text}"

  defp inspect_opts,
    do: [charlists: :as_lists, limit: 50, pretty: true, printable_limit: 4_096]

  defp preview_inspect_opts,
    do: [
      charlists: :as_lists,
      limit: 20,
      pretty: false,
      printable_limit: 200,
      width: 1_000_000
    ]
end
