# Starts the pi-elixir stdio bridge from the extension-owned pi_bridge Mix project
# while loading the target project's Mix context and code paths. This file must not
# edit the target project or require {:pi_bridge, ...} in its mix.exs.

target_cwd = System.fetch_env!("PI_ELIXIR_TARGET_CWD")
bridge_code_paths = :code.get_path()
target_app =
  target_cwd
  |> Path.basename()
  |> String.replace(~r/[^A-Za-z0-9_]/u, "_")
  |> String.trim("_")
  |> case do
    "" -> :pi_elixir_target
    name -> String.to_atom(name)
  end

start_stdio = fn ->
  Mix.Task.run("loadpaths", [])
  bridge_code_paths |> Enum.reverse() |> Enum.each(&:code.add_patha/1)
  {:ok, _apps} = Application.ensure_all_started(:pi_bridge)
  :pi_bridge |> Application.spec(:modules) |> Enum.each(&Code.ensure_loaded?/1)
  Pi.Transport.Stdio.start()
end

if Path.expand(target_cwd) == File.cwd!() do
  start_stdio.()
else
  Mix.Project.in_project(target_app, target_cwd, fn _project_module -> start_stdio.() end)
end
