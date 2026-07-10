---
name: elixir
description: Existing Elixir application/library development and debugging. Use for .ex/.exs, Mix, OTP, Ecto, backend Phoenix, dependencies, docs, tests, or BEAM runtime state. Use elixir-web instead when the primary task is UI/LiveView/frontend work, and elixir-new-project instead for creation/bootstrap.
---

# Elixir Development

Use this as the primary skill for existing general/backend Elixir work. Do not also load `elixir-web` unless the task genuinely spans substantial backend and UI work.

## Default routing

1. Runtime values, project APIs, dependencies, docs, processes, or typed data → `elixir_eval`.
2. Elixir code shape, search, or refactoring → `elixir_ast_search` / `elixir_ast_replace`.
3. Definitions, references, diagnostics, symbols, or code actions → LSP.
4. Exact source reading or small textual edits → host `read` / `edit`.
5. Git, external CLIs, and final Mix gates → shell.

Do not shell out to run Elixir snippets, grep for syntax when an AST pattern fits, or web-search before checking docs loaded in the BEAM.

Eval targets: `project` is the dependencyless default without application startup; `application` starts the managed app; `runtime` attaches to `PI_ELIXIR_NODE`; `bridge` hosts helpers such as `AST`, `CodeMap`, `Self`, `Q`, and `Docs`.

Work in a narrow loop: inspect, make the smallest appropriate edit, verify narrowly, then run project format/test/CI gates. Use `AST.diff(changed: true)` before large textual diffs and `CodeMap.reflect(changed: true)` when Reach is available.

## Lazy references

Do **not** preload all references. Read only when the trigger applies:

- `references/tool-routing.md` — tool choice is unclear, or the task involves a broad structural search/refactor.
- `references/runtime-recipes.md` — a concrete docs, OTP, Phoenix, Ecto, QuackDB, reload, or profiling recipe is needed.
- `references/package-release.md` — before publishing/releasing a Hex package or creating package release artifacts.

Before adding test support, inspect and extend the project's existing cases, drivers, assertions, fakes, fixtures, and naming/path conventions rather than creating a parallel hierarchy.
