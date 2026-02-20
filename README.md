# pi-elixir

BEAM runtime tools for [pi](https://github.com/badlogic/pi-mono) — connects to the running Elixir application via [Tidewave](https://github.com/tidewave-ai/tidewave_phoenix).

LLMs already know how to run `mix compile` and `mix test`. What they don't know is that the BEAM VM is a living runtime they can interrogate — evaluating code inside the running app, reading docs from compiled bytecode, locating any module/function without grep, querying the database through Ecto, and inspecting process state. This package bridges Tidewave's MCP tools into pi and teaches the agent to use BEAM introspection to its full potential.

## Install

```sh
pi install github:dannote/pi-elixir
```

### Prerequisites

Add Tidewave to your Phoenix app:

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

Start `mix phx.server`. The extension auto-detects the running app.

## Configuration

By default the extension connects to `http://localhost:4000/tidewave/mcp`. Override with:

```sh
export TIDEWAVE_URL=http://localhost:4001/tidewave/mcp
```

## What's Included

### Extension — Tidewave Bridge

Bridges 7 Tidewave MCP tools into pi as native tools:

| Tool | Tidewave MCP | What it does |
|---|---|---|
| `elixir_eval` | `project_eval` | Evaluate code inside the running app with IEx helpers |
| `elixir_docs` | `get_docs` | Documentation from the runtime (exact dep versions) |
| `elixir_source` | `get_source_location` | File:line from BEAM bytecode — no grep |
| `elixir_sql` | `execute_sql_query` | SQL through the app's Ecto repo |
| `elixir_logs` | `get_logs` | Server logs with level/grep filtering |
| `elixir_hex_search` | `search_package_docs` | HexDocs search scoped to your mix.lock |
| `elixir_schemas` | `get_ecto_schemas` | List all Ecto schemas with paths |

Tool results are syntax-highlighted: Elixir output, SQL results, documentation with code blocks, and log levels are all color-coded in the TUI.

When the BEAM is unreachable, tools return a clear error message instead of a cryptic connection failure.

### Skill — BEAM Introspection

Teaches the agent to use `elixir_eval` for runtime introspection that no other language can match:

- Module discovery: `exports/1`, `:code.all_loaded/0`
- Ecto schema introspection: `__schema__/1`, `__schema__/2`
- Process state: `:sys.get_state/1`, `Process.info/1`
- Phoenix routes: `Router.__routes__/0`
- OTP supervision trees: `Supervisor.which_children/1`
- Erlang system info: `:erlang.memory/0`, `:erlang.system_info/1`
- AST manipulation: `Code.string_to_quoted/1`, `Macro.prewalk/3`, Sourceror

## Why Tidewave

[Tidewave MCP vs LSP](https://hexdocs.pm/tidewave/mcp.html#tidewave-mcp-vs-language-server-protocol-tools) — LSP is FILE+LINE+COLUMN and can't find code that isn't used yet. Tidewave uses the language's own notation (`Module.function/arity`) and works at runtime, catching metaprogrammed code that static analysis misses.
