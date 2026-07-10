runtime_root =
  System.fetch_env!("PI_ELIXIR_TARGET_SOURCE_ROOT")
  |> Path.join("lib/pi/target/runtime")

for file <- ~w(diagnostics.ex term.ex transport.ex snapshot.ex evaluator.ex worker.ex) do
  Code.require_file(Path.join(runtime_root, file))
end

Pi.Target.Runtime.Worker.run()
