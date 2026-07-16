runtime_root =
  System.fetch_env!("PI_ELIXIR_TARGET_SOURCE_ROOT")
  |> Path.join("runtime")

Code.require_file(Path.join(runtime_root, "manifest.ex"))

for file <- Pi.Target.Runtime.Manifest.files() do
  Code.require_file(Path.join(runtime_root, file))
end

Pi.Target.Runtime.Worker.run()
