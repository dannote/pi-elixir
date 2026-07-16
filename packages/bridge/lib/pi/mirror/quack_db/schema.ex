defmodule Pi.Mirror.QuackDB.Schema do
  @moduledoc false

  @events_table "pi_events"
  @files_table "pi_session_files"

  @event_columns [
    id: :varchar,
    event_type: :varchar,
    cwd: :varchar,
    session_file: :varchar,
    session_name: :varchar,
    leaf_id: :varchar,
    turn_index: :bigint,
    tool_name: :varchar,
    tool_call_id: :varchar,
    is_error: :boolean,
    occurred_at: :timestamp,
    payload_json: :varchar
  ]

  @file_columns [
    {:session_file, :varchar, primary_key: true},
    file_size: :bigint,
    mtime_seconds: :bigint,
    synced_entries: :bigint,
    synced_at: :timestamp
  ]

  def ensure(conn) do
    QuackDB.query!(
      conn,
      QuackDB.DDL.create_table(@events_table, @event_columns, if_not_exists: true)
    )

    QuackDB.query!(
      conn,
      QuackDB.DDL.create_table(@files_table, @file_columns, if_not_exists: true)
    )

    QuackDB.query!(conn, session_file_index())
    :ok
  rescue
    exception in [QuackDB.Error, DBConnection.ConnectionError, RuntimeError, ArgumentError] ->
      {:error, exception}
  end

  defp session_file_index do
    [
      "CREATE INDEX IF NOT EXISTS ",
      QuackDB.Type.quote_identifier("pi_events_session_entry_file_idx"),
      " ON ",
      QuackDB.Type.quote_identifier(@events_table),
      "(",
      QuackDB.Type.quote_identifier(:event_type),
      ", ",
      QuackDB.Type.quote_identifier(:session_file),
      ")"
    ]
  end
end
