defmodule Pi.Mirror.QuackDB.Resources do
  @moduledoc false

  alias Pi.Mirror.QuackDB.{Config, Schema}

  @sync_supervisor Pi.Mirror.QuackDB.SyncSupervisor

  def start do
    with :ok <- ensure_quackdb(),
         {:ok, supervisor, connection} <- start_quackdb() do
      initialize(supervisor, connection)
    end
  end

  defp ensure_quackdb do
    case Application.ensure_all_started(:quackdb) do
      {:ok, _apps} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_quackdb do
    server_name = Pi.Mirror.QuackDB.Server
    client_name = Pi.Mirror.QuackDB.Client
    token = "pi_elixir_mirror_#{System.unique_integer([:positive])}"
    port = Config.port()
    endpoint = "quack:127.0.0.1:#{port}"
    uri = System.get_env("PI_ELIXIR_MIRROR_QUACKDB_URI") || "http://127.0.0.1:#{port}"

    server_opts =
      [
        name: server_name,
        duckdb: Config.duckdb(),
        database: Config.database(),
        endpoint: endpoint,
        uri: uri,
        token: Config.token(token),
        wait_timeout: Config.wait_timeout(),
        poll_interval: 25,
        daemon_options: Config.daemon_options()
      ]
      |> Config.compact_keyword()

    client_opts =
      [
        name: client_name,
        uri: uri,
        token: Config.token(token),
        pool_size: Config.pool_size()
      ]
      |> Config.compact_keyword()

    children =
      if System.get_env("PI_ELIXIR_MIRROR_QUACKDB_URI") do
        [{QuackDB, client_opts}]
      else
        QuackDB.Server.child_specs(server: server_opts, client: client_opts)
      end

    case Supervisor.start_link(
           children ++ [{Task.Supervisor, name: @sync_supervisor}],
           strategy: :one_for_one
         ) do
      {:ok, supervisor} -> {:ok, supervisor, client_name}
      {:error, reason} -> {:error, reason}
    end
  end

  defp initialize(supervisor, connection) do
    case Schema.ensure(connection) do
      :ok ->
        {:ok, %{supervisor: supervisor, conn: connection}}

      {:error, reason} ->
        stop(supervisor)
        {:error, reason}
    end
  catch
    kind, reason ->
      stacktrace = __STACKTRACE__
      stop(supervisor)
      {:error, {:schema_initialization_failed, kind, reason, stacktrace}}
  end

  defp stop(supervisor) do
    if Process.alive?(supervisor), do: Supervisor.stop(supervisor)
    :ok
  catch
    :exit, _reason -> :ok
  end
end
