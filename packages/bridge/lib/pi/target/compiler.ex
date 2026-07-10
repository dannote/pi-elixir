defmodule Pi.Target.Compiler do
  @moduledoc "Compiles target code while preserving the last known-good build on failure."

  alias Pi.Project.Context
  alias Pi.Target.{Connection, Supervisor}

  def compile(opts \\ []) do
    context = Context.current(opts)
    profile = Keyword.get(opts, :profile, :project)

    with {:ok, connection} <- Supervisor.connection(context, profile),
         {:ok, handshake} <- Connection.request(connection, :ping, %{}),
         app when is_atom(app) <- handshake[:app] do
      compile_with_backup(context, app, opts)
    else
      nil -> {:error, %{kind: :project_app_unknown}}
      error -> error
    end
  end

  defp compile_with_backup(context, app, opts) do
    app_ebin = Path.join([context.build_path, "lib", Atom.to_string(app), "ebin"])
    manifest = Path.join(context.build_path, ".mix")
    before_hashes = beam_hashes(app_ebin)
    backup = backup_paths([app_ebin, manifest])
    args = if Keyword.get(opts, :force, false), do: ["compile", "--force"], else: ["compile"]

    try do
      {output, status} =
        Context.command(context, "mix", args,
          stderr_to_stdout: true,
          env: [{"MIX_ENV", context.mix_env}]
        )

      if status == 0 do
        changed = changed_beams(before_hashes, beam_hashes(app_ebin))
        reloads = reload_connections(context, changed)

        {:ok,
         %{
           app: app,
           output: output,
           changed_beams: changed,
           reloaded: reloads,
           last_good_preserved: true
         }}
      else
        restore_backup(backup)

        {:error,
         %{
           kind: :compile_error,
           status: status,
           output: output,
           last_good_preserved: true
         }}
      end
    after
      remove_backup(backup)
    end
  end

  defp reload_connections(_context, []), do: []

  defp reload_connections(context, beams) do
    for profile <- [:project, :application],
        [{pid, _value}] <- [Registry.lookup(Pi.Target.Registry, {context.root, profile})] do
      %{profile: profile, result: Connection.request(pid, :reload, %{beams: beams})}
    end
  end

  defp beam_hashes(path) do
    path
    |> Path.join("*.beam")
    |> Path.wildcard()
    |> Map.new(fn beam -> {beam, beam |> File.read!() |> sha256()} end)
  end

  defp changed_beams(before, after_hashes) do
    after_hashes
    |> Enum.filter(fn {path, hash} -> Map.get(before, path) != hash end)
    |> Enum.map(&elem(&1, 0))
    |> Enum.sort()
  end

  defp backup_paths(paths) do
    root = Path.join(System.tmp_dir!(), "pi-target-build-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)

    entries =
      paths
      |> Enum.with_index()
      |> Enum.map(fn {source, index} ->
        target = Path.join(root, Integer.to_string(index))

        if File.exists?(source) do
          {:ok, _files} = File.cp_r(source, target)
          %{source: source, target: target, existed: true}
        else
          %{source: source, target: target, existed: false}
        end
      end)

    %{root: root, entries: entries}
  end

  defp restore_backup(%{entries: entries}) do
    Enum.each(entries, fn entry ->
      File.rm_rf!(entry.source)

      if entry.existed do
        File.mkdir_p!(Path.dirname(entry.source))
        {:ok, _files} = File.cp_r(entry.target, entry.source)
      end
    end)
  end

  defp remove_backup(%{root: root}), do: File.rm_rf(root)

  defp sha256(binary), do: :crypto.hash(:sha256, binary)
end
