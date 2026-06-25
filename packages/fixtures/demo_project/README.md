# pi-elixir demo project

This tiny Mix project is both a playground and an integration-test fixture for pi-elixir.

It demonstrates:

- extension-owned bundled `pi_bridge` sidecar startup
- executable skill discovery from `priv/skills`
- plugin discovery from `priv/pi_plugins`
- BEAM-initiated `Pi.LLM` requests through the extension

Run manually:

```sh
cd ../../bridge
PI_ELIXIR_TARGET_CWD=../fixtures/demo_project mix do deps.get + run --no-halt ../extension/scripts/stdio_launcher.exs
```
