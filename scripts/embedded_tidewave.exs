# Embedded Tidewave MCP server for pi-elixir.
# Runs inside the project's Mix context via `mix run --no-halt <this_file>`.
# Provides the same MCP tools as Tidewave without requiring it as a dependency.
#
# Derived from Tidewave (https://github.com/tidewave-ai/tidewave_phoenix)
# Copyright (c) 2025 Dashbit — Licensed under the Apache License, Version 2.0

port =
  case System.argv() do
    ["--port", p | _] -> String.to_integer(p)
    _ -> 4041
  end

defmodule Pi.MCP.Logger do
  use GenServer

  @levels Map.new(~w[emergency alert critical error warning notice info debug]a, &{"#{&1}", &1})

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  def get_logs(n, opts \\ []) do
    grep = Keyword.get(opts, :grep)
    regex = grep && Regex.compile!(grep, "iu")
    level = Keyword.get(opts, :level)
    level_atom = level && Map.fetch!(@levels, level)
    GenServer.call(__MODULE__, {:get_logs, n, regex, level_atom})
  end

  def clear_logs, do: GenServer.call(__MODULE__, :clear_logs)

  def log(%{meta: meta, level: level} = event, config) do
    if meta[:pi_mcp] do
      :ok
    else
      %{formatter: {formatter_mod, formatter_config}} = config
      chardata = formatter_mod.format(event, formatter_config)
      GenServer.cast(__MODULE__, {:log, level, IO.chardata_to_string(chardata)})
    end
  end

  @impl true
  def init(_) do
    {:ok, %{logs: :queue.new(), size: 0, max: 1024}}
  end

  @impl true
  def handle_cast({:log, level, message}, state) do
    {logs, size} =
      if state.size >= state.max do
        {_, q} = :queue.out(state.logs)
        {:queue.in({level, message}, q), state.size}
      else
        {:queue.in({level, message}, state.logs), state.size + 1}
      end

    {:noreply, %{state | logs: logs, size: size}}
  end

  @impl true
  def handle_call({:get_logs, n, regex, level_filter}, _from, state) do
    logs = :queue.to_list(state.logs)

    logs =
      if level_filter do
        Enum.filter(logs, fn {level, _} -> level == level_filter end)
      else
        logs
      end

    logs =
      if regex do
        Enum.filter(logs, fn {_, message} -> Regex.match?(regex, message) end)
      else
        logs
      end

    messages = Enum.map(logs, &elem(&1, 1))
    {:reply, Enum.take(messages, -n), state}
  end

  def handle_call(:clear_logs, _from, state) do
    {:reply, :ok, %{state | logs: :queue.new(), size: 0}}
  end
end

defmodule Pi.MCP.Tools do
  @inspect_opts [charlists: :as_lists, limit: 50, pretty: true]
  @sql_limit 50

  def dispatch(name, args) do
    case name do
      "project_eval" -> project_eval(args)
      "get_docs" -> get_docs(args)
      "get_source_location" -> get_source_location(args)
      "execute_sql_query" -> execute_sql_query(args)
      "get_logs" -> get_logs(args)
      "get_ecto_schemas" -> get_ecto_schemas(args)
      "search_package_docs" -> search_package_docs(args)
      _ -> {:error, "Unknown tool: #{name}"}
    end
  end

  # --- project_eval ---

  def project_eval(%{"code" => code} = args) do
    timeout = Map.get(args, "timeout", 30_000)
    parent = self()

    reloader = :"Elixir.Phoenix.CodeReloader"

    if Code.ensure_loaded?(reloader) do
      for endpoint <- endpoints() do
        try do
          reloader.reload(endpoint)
        rescue
          _ -> :ok
        end
      end
    end

    {pid, ref} =
      spawn_monitor(fn ->
        Logger.metadata(pi_mcp: true)
        send(parent, {:result, eval_with_captured_io(code)})
      end)

    receive do
      {:result, result} ->
        Process.demonitor(ref, [:flush])
        {:ok, result}

      {:DOWN, ^ref, :process, ^pid, reason} ->
        {:error, "Process exited: #{Exception.format_exit(reason)}"}
    after
      timeout ->
        Process.demonitor(ref, [:flush])
        Process.exit(pid, :brutal_kill)
        {:error, "Evaluation timed out after #{timeout}ms"}
    end
  end

  def project_eval(_), do: {:error, "Missing required parameter: code"}

  defp eval_with_captured_io(code) do
    {{success?, result}, io} =
      capture_io(fn ->
        try do
          {result, _bindings} = Code.eval_string(code, [arguments: []], env())
          {true, result}
        catch
          kind, reason -> {false, Exception.format(kind, reason, __STACKTRACE__)}
        end
      end)

    case result do
      :"do not show this result in output" -> io
      _ when not success? -> result
      _ when io == "" -> inspect(result, @inspect_opts)
      _ -> "IO:\n\n#{io}\n\nResult:\n\n#{inspect(result, @inspect_opts)}"
    end
  end

  defp env do
    import IEx.Helpers, warn: false
    __ENV__
  end

  defp capture_io(fun) do
    {:ok, pid} = StringIO.open("")
    original = Application.get_env(:elixir, :ansi_enabled)
    Application.put_env(:elixir, :ansi_enabled, false)
    original_gl = Process.group_leader()
    Process.group_leader(self(), pid)

    try do
      result = fun.()
      {_, content} = StringIO.contents(pid)
      {result, content}
    after
      Process.group_leader(self(), original_gl)
      StringIO.close(pid)
      Application.put_env(:elixir, :ansi_enabled, original)
    end
  end

  defp endpoints do
    for {app, _, _} <- Application.started_applications(),
        mod <- (Application.get_env(app, :phoenix_endpoint) || []) |> List.wrap() do
      mod
    end
  end

  # --- get_docs ---

  def get_docs(%{"reference" => ref}) do
    {ref, lookup} =
      case ref do
        "c:" <> r -> {r, [:callback]}
        _ -> {ref, [:function, :macro]}
      end

    case parse_reference(ref) do
      {:ok, mod, nil, :*} ->
        case Code.fetch_docs(mod) do
          {:docs_v1, _, _, "text/markdown", %{"en" => content}, _, _} ->
            {:ok, "# #{inspect(mod)}\n\n#{content}"}

          {:docs_v1, _, _, _, _, _, _} ->
            {:error, "Documentation not found for #{inspect(mod)}"}

          _ ->
            {:error, "No documentation available for #{inspect(mod)}"}
        end

      {:ok, mod, fun, arity} ->
        case Code.ensure_loaded(mod) do
          {:module, _} -> find_fun_docs(mod, fun, arity, lookup)
          {:error, reason} -> {:error, "Could not load module #{inspect(mod)}: #{reason}"}
        end

      :error ->
        {:error, "Failed to parse reference: #{inspect(ref)}"}
    end
  end

  def get_docs(_), do: {:error, "Missing required parameter: reference"}

  defp find_fun_docs(mod, fun, arity, lookup) do
    case Code.fetch_docs(mod) do
      {:docs_v1, _, _, "text/markdown", _, _, docs} ->
        docs =
          for {{kind, ^fun, a}, _, signature, %{"en" => content}, _metadata} <- docs,
              kind in lookup,
              arity == :* or a == arity do
            """
            # #{inspect(mod)}.#{fun}/#{a}

            ```elixir
            #{Enum.join(signature, "\n")}
            ```

            #{content}\
            """
          end

        case docs do
          [] -> {:error, "Documentation not found for #{inspect(mod)}.#{fun}/#{arity}"}
          _ -> {:ok, Enum.join(docs, "\n\n")}
        end

      _ ->
        {:error, "No documentation available for #{inspect(mod)}"}
    end
  end

  # --- get_source_location ---

  def get_source_location(%{"reference" => "dep:" <> package}) do
    path =
      try do
        Mix.Project.deps_paths()[String.to_existing_atom(package)]
      rescue
        _ -> nil
      end

    if path, do: {:ok, Path.relative_to_cwd(path)}, else: {:error, "Package #{package} not found"}
  end

  def get_source_location(%{"reference" => ref}) do
    case parse_reference(ref) do
      {:ok, mod, fun, arity} -> find_source(mod, fun, arity)
      :error -> {:error, "Failed to parse reference: #{inspect(ref)}"}
    end
  end

  def get_source_location(_), do: {:error, "Missing required parameter: reference"}

  defp find_source(mod, fun, arity) do
    case Code.ensure_loaded(mod) do
      {:module, _} ->
        source =
          case mod.module_info(:compile)[:source] do
            [_ | _] = s -> List.to_string(s)
            _ -> nil
          end

        if is_nil(source) do
          {:error, "Source not available for #{inspect(mod)}"}
        else
          case find_fun_line(mod, fun, arity) do
            nil -> {:ok, Path.relative_to_cwd(source)}
            line -> {:ok, "#{Path.relative_to_cwd(source)}:#{line}"}
          end
        end

      _ ->
        {:error, "Module not available: #{inspect(mod)}"}
    end
  end

  defp find_fun_line(_mod, nil, _arity), do: nil

  defp find_fun_line(mod, fun, arity) do
    fun_str = Atom.to_string(fun)

    with [_ | _] = beam <- :code.which(mod),
         {:ok, {_, [abstract_code: {:raw_abstract_v1, code}]}} <-
           :beam_lib.chunks(beam, [:abstract_code]) do
      Enum.find_value(code, fn
        {:function, ann, ann_fun, ann_arity, _} ->
          case Atom.to_string(ann_fun) do
            "MACRO-" <> ^fun_str when arity == :* or ann_arity == arity + 1 ->
              :erl_anno.line(ann)

            ^fun_str when arity == :* or ann_arity == arity ->
              :erl_anno.line(ann)

            _ ->
              nil
          end

        _ ->
          nil
      end)
    else
      _ -> nil
    end
  end

  # --- execute_sql_query ---

  def execute_sql_query(%{"query" => query} = args) do
    repos = ecto_repos()

    if repos == [] do
      {:error, "No Ecto repos configured"}
    else
      repo =
        case args["repo"] do
          nil -> List.first(repos)
          r -> Module.concat([r])
        end

      case repo.query(query, args["arguments"] || []) do
        {:ok, result} ->
          {preamble, result} =
            case result do
              %{num_rows: n, rows: rows} when n > @sql_limit ->
                {"Query returned #{n} rows (showing first #{@sql_limit}).\n\n",
                 %{result | rows: Enum.take(rows, @sql_limit)}}

              _ ->
                {"", result}
            end

          {:ok, preamble <> inspect(result, Keyword.put(@inspect_opts, :limit, :infinity))}

        {:error, reason} ->
          {:error, "Query failed: #{inspect(reason, @inspect_opts)}"}
      end
    end
  end

  def execute_sql_query(_), do: {:error, "Missing required parameter: query"}

  # --- get_logs ---

  def get_logs(%{"tail" => n} = args) do
    opts =
      [grep: Map.get(args, "grep"), level: Map.get(args, "level")]
      |> Enum.reject(fn {_, v} -> is_nil(v) end)

    {:ok, Enum.join(Pi.MCP.Logger.get_logs(n, opts), "\n")}
  end

  def get_logs(_), do: {:error, "Missing required parameter: tail"}

  # --- get_ecto_schemas ---

  def get_ecto_schemas(_args) do
    schemas =
      for module <- project_modules(),
          Code.ensure_loaded?(module),
          function_exported?(module, :__changeset__, 0) do
        location =
          case get_source_location(%{"reference" => inspect(module)}) do
            {:ok, loc} -> " at #{loc}"
            _ -> ""
          end

        "* #{inspect(module)}#{location}"
      end

    case schemas do
      [] -> {:error, "No Ecto schemas found"}
      _ -> {:ok, Enum.join(schemas, "\n")}
    end
  end

  # --- search_package_docs ---

  def search_package_docs(%{"q" => q} = args) do
    Mix.ensure_application!(:inets)
    Mix.ensure_application!(:ssl)
    Application.ensure_all_started(:inets)
    Application.ensure_all_started(:ssl)

    filter_by =
      case args["packages"] do
        p when p in [nil, []] -> filter_from_mix_lock()
        packages -> filter_from_packages(packages)
      end

    params = URI.encode_query(%{"q" => q, "query_by" => "doc,title", "filter_by" => filter_by})
    url = ~c"https://search.hexdocs.pm/?#{params}"

    case :httpc.request(:get, {url, [{~c"user-agent", ~c"pi-elixir"}]}, [ssl: [verify: :verify_none]], []) do
      {:ok, {{_, 200, _}, _, body}} ->
        case Jason.decode(to_string(body)) do
          {:ok, %{"found" => found, "hits" => hits}} ->
            results =
              hits
              |> Enum.with_index(1)
              |> Enum.map(fn {hit, i} ->
                doc = hit["document"] || %{}
                """
                <result index="#{i}" package="#{doc["package"]}" ref="#{doc["ref"]}" title="#{doc["title"]}">
                #{doc["doc"] || ""}
                </result>
                """
              end)
            {:ok, "Results: #{found}\n\n#{Enum.join(results, "\n")}"}

          {:error, reason} ->
            {:error, "Failed to parse HexDocs response: #{inspect(reason)}"}
        end

      {:ok, {{_, status, _}, _, _}} ->
        {:error, "HexDocs search failed (HTTP #{status})"}

      {:error, reason} ->
        {:error, "HexDocs search error: #{inspect(reason)}"}
    end
  end

  def search_package_docs(_), do: {:error, "Missing required parameter: q"}

  defp filter_from_mix_lock do
    app = Mix.Project.config()[:app]
    Application.load(app)
    deps = Application.spec(app, :applications) || []

    filter =
      deps
      |> Enum.uniq()
      |> Enum.map(fn dep ->
        "#{dep}-#{Application.spec(dep, :vsn)}"
      end)
      |> Enum.join(", ")

    "package:=[#{filter}]"
  end

  defp filter_from_packages(packages) do
    Mix.ensure_application!(:inets)
    Mix.ensure_application!(:ssl)
    Application.ensure_all_started(:inets)
    Application.ensure_all_started(:ssl)

    filter =
      packages
      |> Enum.flat_map(fn package ->
        url = ~c"https://hex.pm/api/packages/#{package}"
        case :httpc.request(:get, {url, [{~c"user-agent", ~c"pi-elixir"}]}, [ssl: [verify: :verify_none]], []) do
          {:ok, {{_, 200, _}, _, body}} ->
            case Jason.decode(to_string(body)) do
              {:ok, %{"releases" => releases}} ->
                version =
                  releases
                  |> Enum.flat_map(fn %{"version" => v} ->
                    case Version.parse(v) do
                      {:ok, %{pre: []}} -> [v]
                      _ -> []
                    end
                  end)
                  |> Enum.max_by(&Version.parse!/1, Version, fn -> nil end)
                if version, do: ["#{package}-#{version}"], else: []
              _ -> []
            end
          _ -> []
        end
      end)
      |> Enum.join(", ")

    "package:=[#{filter}]"
  end

  # --- helpers ---

  defp parse_reference(string) when is_binary(string) do
    case Code.string_to_quoted(string) do
      {:ok, {:/, _, [call, arity]}} when arity in 0..255 -> parse_call(call, arity)
      {:ok, call} -> parse_call(call, :*)
      _ -> :error
    end
  end

  defp parse_call({{:., _, [mod, fun]}, _, _}, arity), do: parse_module(mod, fun, arity)
  defp parse_call(mod, :*), do: parse_module(mod, nil, :*)
  defp parse_call(_, _), do: :error

  defp parse_module(mod, fun, arity) when is_atom(mod), do: {:ok, mod, fun, arity}

  defp parse_module({:__aliases__, _, [h | _] = parts}, fun, arity) when is_atom(h),
    do: {:ok, Module.concat(parts), fun, arity}

  defp parse_module(_, _, _), do: :error

  defp ecto_repos do
    app = Mix.Project.config()[:app]
    Application.load(app)
    Application.get_env(app, :ecto_repos, [])
  end

  defp project_modules do
    app = Mix.Project.config()[:app]
    build_path = Mix.Project.build_path()

    Path.join(build_path, "lib/#{app}/ebin")
    |> File.ls!()
    |> Enum.filter(&String.ends_with?(&1, ".beam"))
    |> Enum.map(fn file -> file |> String.trim_trailing(".beam") |> String.to_atom() end)
  end
end

defmodule Pi.MCP.Http do
  @doc """
  Minimal HTTP/1.1 server using OTP's :gen_tcp with `packet: :http_bin`.
  No external dependencies — works in any Elixir project.
  """

  def start_link(port) do
    parent = self()
    pid = spawn_link(fn ->
      {:ok, socket} = :gen_tcp.listen(port, [
        :binary, packet: :http_bin, active: false, reuseaddr: true, backlog: 64
      ])
      {:ok, actual_port} = :inet.port(socket)
      send(parent, {:gen_tcp_port, actual_port})
      accept_loop(socket)
    end)
    {:ok, pid}
  end

  def port(_pid) do
    receive do
      {:gen_tcp_port, p} -> p
    after
      5_000 -> raise "gen_tcp server did not report port"
    end
  end

  defp accept_loop(socket) do
    {:ok, client} = :gen_tcp.accept(socket)
    spawn(fn -> serve(client) end)
    accept_loop(socket)
  end

  defp serve(socket) do
    try do
      {method, path, content_length} = read_request_head(socket)

      body =
        if content_length > 0 do
          :inet.setopts(socket, packet: :raw)
          {:ok, data} = :gen_tcp.recv(socket, content_length, 120_000)
          data
        else
          ""
        end

      {status, resp_body} = route(method, path, body)
      send_response(socket, status, resp_body)
    rescue
      _ -> :ok
    after
      :gen_tcp.close(socket)
    end
  end

  defp read_request_head(socket) do
    {:ok, {:http_request, method, {:abs_path, path}, _}} = :gen_tcp.recv(socket, 0, 10_000)
    content_length = consume_headers(socket, 0)
    {to_string(method), to_string(path), content_length}
  end

  defp consume_headers(socket, cl) do
    case :gen_tcp.recv(socket, 0, 10_000) do
      {:ok, :http_eoh} -> cl
      {:ok, {:http_header, _, :"Content-Length", _, val}} -> consume_headers(socket, String.to_integer(val))
      {:ok, {:http_header, _, _, _, _}} -> consume_headers(socket, cl)
    end
  end

  defp route("GET", "/config", _body) do
    project_name = Mix.Project.config()[:app] |> Atom.to_string()
    {200, Jason.encode!(%{project_name: project_name, framework_type: "embedded"})}
  end

  defp route("POST", "/mcp", body) do
    case Jason.decode(body) do
      {:ok, %{"jsonrpc" => "2.0", "id" => id, "method" => "tools/call", "params" => params}} ->
        name = params["name"]
        args = params["arguments"] || %{}

        resp = case Pi.MCP.Tools.dispatch(name, args) do
          {:ok, text} ->
            %{jsonrpc: "2.0", id: id, result: %{content: [%{type: "text", text: text}]}}
          {:error, message} ->
            %{jsonrpc: "2.0", id: id, result: %{content: [%{type: "text", text: message}], isError: true}}
        end
        {200, Jason.encode!(resp)}

      {:ok, %{"jsonrpc" => "2.0", "id" => id}} ->
        {200, Jason.encode!(%{jsonrpc: "2.0", id: id, result: %{}})}

      _ ->
        {400, Jason.encode!(%{error: "Invalid request"})}
    end
  end

  defp route(_, _, _), do: {404, "Not Found"}

  defp send_response(socket, status, body) do
    status_text = case status do
      200 -> "OK"
      400 -> "Bad Request"
      404 -> "Not Found"
      _ -> "Error"
    end

    header = "HTTP/1.1 #{status} #{status_text}\r\nContent-Type: application/json\r\nContent-Length: #{byte_size(body)}\r\nConnection: close\r\n\r\n"
    :gen_tcp.send(socket, [header, body])
  end
end

# --- Plug-based router (used when Plug + HTTP server are available) ---

has_plug = Code.ensure_loaded?(Plug.Router)
has_bandit = Code.ensure_loaded?(Bandit)
has_cowboy = Code.ensure_loaded?(Plug.Cowboy)

if has_plug and (has_bandit or has_cowboy) do
  defmodule Pi.MCP.Router do
    use Plug.Router

    plug :match
    plug Plug.Parsers, parsers: [:json], json_decoder: Jason
    plug :dispatch

    get "/config" do
      project_name =
        Mix.Project.config()[:app] |> Atom.to_string()

      body = Jason.encode!(%{
        project_name: project_name,
        framework_type: "embedded"
      })

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(200, body)
    end

    post "/mcp" do
      case conn.body_params do
        %{"jsonrpc" => "2.0", "id" => id, "method" => "tools/call", "params" => params} ->
          name = params["name"]
          args = params["arguments"] || %{}

          {_status, body} =
            case Pi.MCP.Tools.dispatch(name, args) do
              {:ok, text} ->
                {200,
                 %{
                   jsonrpc: "2.0",
                   id: id,
                   result: %{content: [%{type: "text", text: text}]}
                 }}

              {:error, message} ->
                {200,
                 %{
                   jsonrpc: "2.0",
                   id: id,
                   result: %{content: [%{type: "text", text: message}], isError: true}
                 }}
            end

          conn
          |> put_resp_content_type("application/json")
          |> send_resp(200, Jason.encode!(body))

        %{"jsonrpc" => "2.0", "id" => id, "method" => "initialize"} ->
          conn
          |> put_resp_content_type("application/json")
          |> send_resp(200, Jason.encode!(%{jsonrpc: "2.0", id: id, result: %{}}))

        %{"jsonrpc" => "2.0", "id" => id} ->
          conn
          |> put_resp_content_type("application/json")
          |> send_resp(200, Jason.encode!(%{jsonrpc: "2.0", id: id, result: %{}}))

        _ ->
          conn
          |> put_resp_content_type("application/json")
          |> send_resp(400, Jason.encode!(%{error: "Invalid request"}))
      end
    end

    match _ do
      send_resp(conn, 404, "Not Found")
    end
  end
end

# --- Boot ---

Pi.MCP.Logger.start_link(nil)

:ok =
  :logger.add_handler(
    Pi.MCP.Logger,
    Pi.MCP.Logger,
    %{formatter: Logger.default_formatter(colors: [enabled: false])}
  )

Process.flag(:trap_exit, true)

{actual_port, http_server} =
  cond do
    has_bandit ->
      {:ok, server} = Bandit.start_link(plug: Pi.MCP.Router, port: port, ip: :loopback)
      p = if port == 0 do
        {:ok, {_, p}} = ThousandIsland.listener_info(server)
        p
      else
        port
      end
      {p, :bandit}

    has_cowboy ->
      {:ok, _} = Plug.Cowboy.http(Pi.MCP.Router, [], port: port)
      {port, :cowboy}

    true ->
      {:ok, pid} = Pi.MCP.Http.start_link(port)
      p = Pi.MCP.Http.port(pid)
      {p, :gen_tcp}
  end

# Wait for port to be accepting connections before signaling ready
Enum.reduce_while(1..50, nil, fn _, _ ->
  case :gen_tcp.connect(~c"127.0.0.1", actual_port, [], 100) do
    {:ok, sock} ->
      :gen_tcp.close(sock)
      {:halt, :ok}

    {:error, _} ->
      Process.sleep(100)
      {:cont, nil}
  end
end)

IO.puts("PI_MCP_READY port=#{actual_port} server=#{http_server}")

receive do
  :stop -> :ok
end
