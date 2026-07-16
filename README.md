# pi-elixir

`pi-elixir` is the pi extension for BEAM-native, verifiable Elixir development.

It gives pi an isolated BEAM control plane plus explicit project, application, and attached-runtime eval modes, so an agent can inspect runtime state, make syntax-aware Elixir edits, and verify changes with real project checks. The model-facing surface stays intentionally small: eval for runtime truth, ExAST tools for structural code work, and normal Mix/LSP/shell commands for everything else.

## What it gives pi

- **Persistent project eval** — `elixir_eval` defaults to a dependencyless target-project VM that keeps bindings while avoiding application startup side effects.
- **Explicit runtime modes** — opt into managed application startup or attach to an existing distributed BEAM node to inspect live processes and ETS state.
- **Stateful IEx-like cells** — bindings, aliases, imports, and requires persist per pi execution path via sidecar snapshots; failed compilation/eval keeps the last good state.
- **Structural Elixir tools** — `elixir_ast_search` and `elixir_ast_replace` use [ExAST](https://hex.pm/packages/ex_ast) patterns instead of text/regex matching.
- **Syntax-aware review orientation** — `AST.diff(changed: true)` / `CodeMap.reflect(changed: true)` summarize changed modules/functions before the agent reads a large `git diff`.
- **OTP-backed sessions and agents** — optional BEAM sessions/subagents render as compact pi session trees without spawning more pi processes.
- **Project-local skills/plugins** — trusted local Elixir can add project workflows, guardrails, slash commands, tool hooks, and UI widgets.
- **Strict verification** — this repo gates releases with JS lint/typecheck/tests, BEAM compile/test/Credo/Dialyzer, ExDNA clone detection, Reach architecture/smell checks, Hex build validation, and npm pack validation.

`pi-elixir` follows the broader [Elixir Vibe](https://github.com/elixir-vibe) direction: compact agent APIs outside, rich composable Elixir APIs inside, structured BEAM payloads rendered by pi, and verification through runtime state plus structural analysis.

## Install

```sh
pi install npm:pi-elixir
```

Check the bridge from inside pi:

```text
/elixir:status
```

Use full diagnostics when setup looks wrong:

```text
/elixir:doctor
```

No project dependency or `mix.exs` edit is required. The extension starts its bundled `pi_bridge` in an isolated control VM and starts a separate dependencyless worker for the target Mix project. Startup validates a strict build/protocol/capability handshake.

## Daily workflow

### Inspect project code or a running app

Default eval uses the persistent project VM without starting the application:

```text
iex alias MyApp.Repo; alias MyApp.Billing.Invoice; stale = Repo.all(...); length(stale)

14

Took 0.1s
```

The next eval continues from the same IEx-like state:

```text
iex stale |> Enum.group_by(& &1.customer_id) |> Enum.map(fn {id, xs} -> {id, length(xs)} end)

[{"cust_123", 5}, {"cust_456", 9}]

Took 0.1s
```

Use `target: "application"` when application startup is intentional. Use `target: "runtime"` with `PI_ELIXIR_NODE` (and the matching distributed-node cookie) to inspect an already-running node without starting a second copy. Bridge helper APIs such as `AST`, `CodeMap`, `Self`, `Q`, and `Docs` use `target: "bridge"`.

For Phoenix/Ecto/OTP bugs, prefer asking the intended runtime over guessing from files:

```elixir
Supervisor.which_children(MyApp.Supervisor)
Application.get_env(:my_app, MyApp.Repo)
Process.info(pid, [:status, :message_queue_len, :current_stacktrace])
```

### Search and edit by syntax

Use ExAST-backed tools for Elixir code shape:

```text
ast grep defmodule _ do _ end lib/my_app
ast edit Logger.debug(_) → Logger.info(_) lib/my_app --dry-run
```

These tools use valid-Elixir ExAST syntax, not ast-grep metavariables: lowercase variables capture nodes, `_` matches one node without capturing, and `...` matches zero or more nodes. Never use `$NAME` or `$$$ARGS` with the Elixir AST tools. They are for structural Elixir search/refactors; use LSP for editor semantics and `mix format`/tests for verification.

### Review changed Elixir safely

Before reading a large or truncated textual diff, orient on changed modules/functions:

```elixir
AST.diff(changed: true)
CodeMap.reflect(changed: true)
```

Then inspect only the relevant source slices or `git diff` sections. This keeps review focused on semantic changes instead of raw patch volume.

## Model-facing tools

`pi-elixir` deliberately exposes only three model tools:

| Tool | Label | Purpose |
|---|---:|---|
| `elixir_eval` | `iex` | Trusted eval in `project` (default), `application`, attached `runtime`, or isolated `bridge` mode. Stateful by default for pi session branches; sandbox mode is available for untrusted snippets. |
| `elixir_ast_search` | `ast grep` | ExAST structural search over Elixir code. |
| `elixir_ast_replace` | `ast edit` | ExAST structural rewrite with dry-run diffs. |

Everything else is ordinary Elixir API reachable through eval:

```elixir
Pi.project()
Pi.logs(tail: 50)
Pi.Bridge.Info.runtime_apis()

Pi.Eval.bindings()
Pi.Eval.forget(:huge_result)
Pi.Eval.reset()

Pi.Docs.entries(Pi.Output)
Pi.Docs.get(Pi.Output, :table, 2)
Pi.Web.fetch!("https://example.com", format: :text)

Pi.Session.start(name: :reviewer)
Pi.Agent.parallel(["Review API", "Review tests"], timeout: 60_000)
```

For model calls from the BEAM, pi still owns provider/model selection, credentials, streaming, cancellation, usage, and transcript UI:

```elixir
Pi.LLM.complete("Summarize this module")
Pi.LLM.stream("Draft a migration plan")

Pi.ReqLLM.install()
ReqLLM.generate_text(Pi.ReqLLM.current_model(), "Summarize this module")
```

## Stateful eval and sidecars

`elixir_eval` behaves like an IEx/Livebook cell runtime scoped to the current pi execution path:

- variables persist across calls;
- `alias`, `import`, and `require` persist through `Macro.Env`;
- errors do not replace the previous good state;
- `Pi.Eval.bindings/0`, `forget/1`, and `reset/0` manage state from inside eval;
- snapshots are stored as sidecar blobs, **not** in the JSONL transcript.

Physical storage:

```text
<session.jsonl>.pi-elixir/
  eval-state/
    <toolCallId>.term
    <toolCallId>.term.meta.json
```

Unsafe or oversized bindings are handled defensively: PIDs/ports/refs/functions are not persisted, containers containing them are skipped, and sidecar snapshots have a size budget.

## Connection and runtime model

The normal path is an embedded stdio control bridge started from the extension's bundled `packages/bridge` project. It does not load `pi_bridge` into the target project. HTTP MCP endpoints remain advanced/debug escape hatches.

Resolution order:

1. `PI_MCP_URL`, only when explicitly configured for a manually exposed HTTP MCP endpoint.
2. Discovered local HTTP MCP endpoint matching the Mix app name.
3. Bundled embedded stdio control bridge, with `PI_ELIXIR_PROJECT_CWD` identifying the target project.

The control bridge then routes eval to one of four strict targets: dependencyless persistent `project`, managed `application`, attached distributed `runtime`, or `bridge`. Ready state is accepted only when build, protocol, and required capabilities match; one stale child is replaced atomically before an incompatibility is reported. The supervision and dependency boundaries are documented in [`packages/bridge/docs/architecture.md`](packages/bridge/docs/architecture.md).

```sh
# Advanced/debug only: bypass embedded stdio and use your own HTTP MCP endpoint.
export PI_MCP_URL=http://localhost:4001/mcp
export PI_DISABLE_EMBEDDED=1
```

Status distinguishes the control bridge from the target project and reports external/embedded/starting/incompatible/unavailable state plus the negotiated runtime contract. Project-specific checks belong in explicit eval snippets, prompts, and skills.

Feature flags are escape hatches for noisy, sensitive, or experimental environments:

| Capability | Default | Escape hatch |
|---|---:|---|
| Stateful `elixir_eval` | on | `PI_ELIXIR_STATEFUL_EVAL=0` |
| Eval sidecar snapshots | on | `PI_ELIXIR_EVAL_SIDECAR=0` |
| BEAM LLM / ReqLLM | on | `PI_ELIXIR_LLM=0` |
| BEAM sessions/widgets/control | on | `PI_ELIXIR_SESSIONS=0` |
| Project plugins/hooks/UI/commands | on | `PI_ELIXIR_PLUGINS=0` |
| Executable Elixir skills | on | `PI_ELIXIR_SKILLS=0` |
| Extra-short eval previews | off | `PI_ELIXIR_COMPACT_EVAL_PREVIEW=1` |

## Recommended project stack

For new projects, install Elixir 1.20+ with OTP 27+ when possible. Elixir 1.20 introduced compiler type-system improvements, including gradual set-theoretic types, whole-body type inference, occurrence typing, and richer map typing; pi-elixir still supports older Elixir releases for existing legacy projects.

For new web applications, use Phoenix with Igniter and VibeKit, then add pi-elixir in the project:

```sh
mix archive.install hex phx_new
mix archive.install hex igniter_new
mix phx.new my_app
cd my_app
mix igniter.install vibe_kit --agents-md
pi install npm:pi-elixir
```

For non-web Elixir projects and packages:

```sh
mix archive.install hex igniter_new
mix igniter.new my_lib --install vibe_kit --agents-md
cd my_lib
pi install npm:pi-elixir
```

VibeKit provides the project quality baseline (`mix ci`, Credo strict with ExSlop, Dialyzer, ExDNA, and Reach). pi-elixir provides the BEAM tools used by agents while they work inside that project, without adding `pi_bridge` to project dependencies.

## Troubleshooting setup

| Symptom | What to do |
|---|---|
| `target Mix cwd: not found` | Start pi from a Mix project directory, or from a supported repo root with a known nested Mix project. |
| `Elixir is not installed or not available on PATH` | Start pi from a shell where Elixir/Mix are available. If you just changed `mise`/`asdf` versions, restart pi. |
| Stale `mise` PATH warning | Restart the shell/pi process so removed tool install paths disappear from `PATH`. |
| Embedded BEAM exited before ready | Fix the bundled bridge Mix/Elixir error shown in doctor, then run `/elixir:restart`. |
| Bridge build/protocol/capability mismatch | Run `/elixir:restart`; if it remains, update or reinstall `pi-elixir`. Do not edit the target project's dependencies. |
| Attached runtime cannot connect | Set `PI_ELIXIR_NODE` to the existing distributed node and start pi with a compatible node name/cookie. |
| Tool registration conflicts with another `pi-elixir` path | Remove the duplicate install, usually `pi remove npm:pi-elixir`, then install only the checkout or only the npm package. |

## Local development

```sh
git clone https://github.com/elixir-vibe/pi-elixir
cd pi-elixir
pnpm install
cd packages/bridge && mix deps.get && cd ../..
pi install "$PWD"
```

If you also have `npm:pi-elixir` installed globally, remove it before dogfooding a checkout to avoid duplicate tool registration:

```sh
pi remove npm:pi-elixir
pi install "$PWD"
```

From an already-running local checkout, `/elixir:dogfood` performs that switch for you.

Common commands:

```sh
pnpm run fmt
pnpm run check
pnpm run check:js
pnpm run check:beam
pnpm run test:integration
pnpm run pack:check
```

`pnpm run check` is the release-readiness gate.

## More docs

- [`packages/extension/README.md`](packages/extension/README.md) — pi extension behavior, connection resolution, slash commands, debugging, rendering, and tool discipline.
- [`packages/bridge/README.md`](packages/bridge/README.md) — BEAM APIs for eval, docs, LLM, sessions/agents, plugins, host bridge calls, and protocol concepts.
- [`packages/bridge/docs/protocol.md`](packages/bridge/docs/protocol.md) — stdio/protocol payload examples.

## Part of Elixir Vibe

pi-elixir gives the pi coding agent a live door into the BEAM: stateful eval, AST tools, and composable runtime APIs.

It is one building block of a larger stack — tools that make AI-generated software checkable: structural search, dependency analysis, duplication/slop detection, session replay, and ecosystem-wide code search. See the [Elixir Vibe](https://github.com/elixir-vibe) organization and [Building Blocks for the Future Web](https://github.com/elixir-vibe/building-blocks) for the broader thesis and roadmap.
