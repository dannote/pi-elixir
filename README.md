# pi-elixir

BEAM runtime tools for [pi](https://github.com/badlogic/pi-mono) — connects to the running Elixir application for live introspection.

LLMs already know how to run `mix compile` and `mix test`. What they don't know is that the BEAM VM is a living runtime they can interrogate — evaluating code inside the running app, reading docs from compiled bytecode, locating any module/function without grep, querying the database through Ecto, and inspecting process state. This package gives pi direct access to the BEAM and teaches the agent to use it.

## Install

```sh
pi install github:dannote/pi-elixir
```

No changes to your Elixir project are required. The extension auto-starts an embedded MCP server using the project's own deps (Plug, Bandit/Cowboy, Jason — already present in any Phoenix app).

If you have [Tidewave](https://github.com/tidewave-ai/tidewave_phoenix) installed, the extension connects to it instead for the best experience (code reloading, Phoenix-aware features).

## How It Connects

The extension resolves the BEAM connection per project:

1. **Native Tidewave** — probes `localhost:4000–4009` for a running Tidewave instance and matches its `project_name` to the `app:` in your `mix.exs`
2. **Embedded server** — if no Tidewave is found, auto-starts `mix run --no-halt` with a bundled MCP server script in the project directory

This means multiple Elixir projects can run simultaneously — each pi session connects to the correct BEAM.

The status bar shows the connection mode:

| Status | Meaning |
|---|---|
| `⬡ BEAM` | Connected via native Tidewave |
| `⬡ BEAM (embedded)` | Running embedded MCP server |
| `⬡ BEAM offline` | No connection (project may not compile yet) |

### Optional: Add Tidewave

For the best experience (Phoenix code reloading, Ash support), add Tidewave:

```elixir
# mix.exs deps
{:tidewave, "~> 0.5", only: :dev}
```

```elixir
# lib/my_app_web/endpoint.ex — above "if code_reloading? do"
if Mix.env() == :dev do
  plug Tidewave
end
```

### Configuration

Override the connection URL (disables auto-detection):

```sh
export TIDEWAVE_URL=http://localhost:4001/tidewave/mcp
```

Disable the embedded fallback:

```sh
export PI_ELIXIR_DISABLE_EMBEDDED=1
```

## Tools

| Tool | What it does |
|---|---|
| `elixir_eval` | Evaluate code inside the running app with IEx helpers |
| `elixir_docs` | Documentation from the runtime (exact dep versions) |
| `elixir_source` | File:line from BEAM bytecode — no grep |
| `elixir_sql` | SQL through the app's Ecto repo |
| `elixir_logs` | Server logs with level/grep filtering |
| `elixir_hex_search` | HexDocs search scoped to your mix.lock |
| `elixir_schemas` | List all Ecto schemas with paths |
| `elixir_sup_tree` | Supervision tree with strategies and PIDs |
| `elixir_top` | Process manager — top processes by memory/reductions/mailbox |
| `elixir_process_info` | Deep inspection of a single process |
| `elixir_deps_tree` | Module dependency graph via Mix.Xref |
| `elixir_types` | Type specs and callbacks for a module or function |

Tool results are syntax-highlighted in the TUI: Elixir output, SQL results, documentation with code blocks, and log levels are all color-coded.

## Skill — BEAM Introspection

Teaches the agent to use `elixir_eval` for runtime introspection that no other language can match:

- Module discovery: `exports/1`, `:code.all_loaded/0`
- Ecto schema introspection: `__schema__/1`, `__schema__/2`
- Process state: `:sys.get_state/1`, `Process.info/1`
- Phoenix routes: `Router.__routes__/0`
- OTP supervision trees: `Supervisor.which_children/1`
- Erlang system info: `:erlang.memory/0`, `:erlang.system_info/1`
- AST manipulation: `Code.string_to_quoted/1`, `Macro.prewalk/3`, Sourceror

## Why Runtime Introspection

[Tidewave MCP vs LSP](https://hexdocs.pm/tidewave/mcp.html#tidewave-mcp-vs-language-server-protocol-tools) — LSP is FILE+LINE+COLUMN and can't find code that isn't used yet. Runtime tools use the language's own notation (`Module.function/arity`) and work at runtime, catching metaprogrammed code that static analysis misses.
