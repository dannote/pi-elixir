---
name: elixir-dev
description: Develop existing Elixir/Phoenix applications through a minimal BEAM tool surface. Use eval for runtime introspection and helper APIs, AST tools for structural code work, LSP for editor semantics, and Mix only for build/test/format gates. For starting a new Elixir project/package with Igniter or VibeKit, use the elixir-new-project skill instead.
---

# Elixir Development with BEAM Runtime Access

Use the BEAM as the primary control plane. Keep the model-facing Elixir tool surface small, but use the available tools aggressively:

- `elixir_eval` — runtime introspection, helper calls, docs, profiling, filesystem inspection through Elixir stdlib, OTP state, database checks, and small experiments inside the loaded app.
- `elixir_ast_search` — default choice for Elixir code search when the target is syntax/code shape. Prefer this over `rg`/grep for functions, callbacks, pipelines, structs, maps, tuples, calls, macros, and refactor candidates.
- `elixir_ast_replace` — default choice for Elixir refactors and syntax-aware rewrites. Prefer this over regex/text replacement unless the change is purely textual.
- LSP, when available — diagnostics, definitions, references, hover/type info, workspace/file symbols, and code actions.
- Host file/shell tools — file edits, `git`, package managers, and `mix` build/test/format commands.

Use Elixir docs APIs from `elixir_eval` before guessing framework/library behavior. Use `h(Module.fun/arity)`, `exports(Module)`, and `i(term)` for quick direct inspection; use `Pi.Docs.entries/1` and `Pi.Docs.get/3` when you need structured docs that can be filtered with normal `Enum`. Web search is for missing or external docs, not the first step for code that is already loaded in the project.

Treat `elixir_eval` as a typed Elixir shell: prefer plain Elixir expressions and pipelines for BEAM/runtime inspection, installed docs, OTP state, app config, QuackDB/Ecto session analytics, and structured filesystem work where typed maps/lists help follow-up reasoning. Use `bash` for external CLIs and raw text tools; use eval when the result should remain typed and renderable.

Use Elixir/OTP stdlib directly from `elixir_eval` for ordinary runtime, file, and process work. Reach for `Pi.*` shortcuts only when they provide bounded summaries or remove repetitive boilerplate. For bridge self-introspection, prefer the preloaded `Self` alias (`Pi.Self`) for `Self.status()`, `Self.quack()`, `Self.bindings()`, `Self.sessions()`, and `Self.context(query)`. For semantic code diff/review, prefer the preloaded `AST` alias (`Pi.AST`) for `AST.diff(changed: true)` before reading large textual `git diff` output. For semantic code reflection, prefer the preloaded `CodeMap` alias (`Pi.CodeMap`) for `CodeMap.reflect(changed: true)`, `CodeMap.context(target)`, `CodeMap.hotspots(path: file)`, and `CodeMap.smells(path: file)`. For session history analytics, prefer the preloaded short aliases `Q` (`Pi.Quack`), `E` (`Pi.Quack.Event`), and `SF` (`Pi.Quack.SessionFile`) with normal `Ecto.Query`/`QuackDB.Ecto` DSL, then render via `Q.table()` or `Pi.table()`. For structured docs, prefer `Pi.Docs.entries(Mod) |> Enum.filter(...)` and `Pi.Docs.get(Mod, :name, arity)`; use raw `Code.fetch_docs/1` only when inspecting the low-level docs chunk itself. For simple web context, prefer bounded `Pi.Web.fetch!/2` over raw `Req`.

After non-trivial Elixir edits, do not stop at tests. Run `CodeMap.reflect(changed: true)` before the final answer when Reach is available. Apply one small behavior-preserving cleanup if the evidence supports it; otherwise explicitly state why no further refactor is warranted.

## Invariants

These rules apply on every Elixir change. The headlines below are always in context; open the linked file when you need the full rule and examples.

- **One concept per module.** No suffix-module splitting (don't split `Atoms`/`AtomDecoder`/`AtomDispatch`/`CachedAtoms`), no `defstruct`-only suffix files, direction-paired codegen merges, split god modules by concern, prefix hygiene, function names describe the output, module names are singular concepts. Detail: `module-structure.md`.
- **Document every module.** Every `defmodule` gets a real `@moduledoc`. Never `@moduledoc false` — no carve-outs for generated, `__impl__`, or internal modules. Control published-docs visibility through ex_doc config (`groups_for_modules`, `skip_modules`, `filter_modules`), not by stripping docs. `@doc false` only for callback implementations whose contract is at the behaviour. Detail: `documentation.md`.
- **Strict internal contracts.** Structs over maps for any value that crosses a module boundary. No string-keyed maps across boundaries (normalize string keys into a struct once, at the boundary). No ad hoc tagged tuples (`{:literal, v}`, `{:expr, v}`) — use a struct with a `:kind`. Keyword lists are fine for short-lived same-module values, never across boundaries. Pattern-match on structs, not on map shapes. Detail: `internal-contracts.md`.
- **Test tree mirrors source tree.** `lib/my_app/rustler/atom.ex` → `test/my_app/rustler/atom_test.exs`. One test file may cover a module plus its closely-coupled submodules; a submodule with its own `@moduledoc` gets its own file. No ad hoc test files (`helpers_test.exs`, `smoke.exs`) unless they map to a source module. Integration tests are the only exception. Detail: `test-organization.md`.
- **Read the docs before you code against a module.** Before calling, overriding, or implementing for any module you did not author in this session — dep, project module, or stdlib outside the truly-common surface — read its doc via `h/1`, `i/1`, `exports/1`, `b/1`, `t/1`, or `Pi.Docs.*` from `elixir_eval`. No guessing signatures, options, callbacks, or return shapes from a function's name. If the doc is missing or insufficient, read the source next; do not fill gaps by inference. Detail: `reading-docs.md`.
- **Use JSONCodec and Jason.Encoder, not hand-rolled JSON.** Decode JSON-shaped data into structs with `JSONCodec` (`use JSONCodec`, `defstruct`, `@type t`, optional `codec/2`); never write `Jason.decode!` + a hand-rolled `from_map!`. Encode structs to JSON by deriving or implementing the `Jason.Encoder` protocol; never hand-roll a `to_map` + `Jason.encode!`. JSON string keys live only at the boundary; `JSONCodec.from_map!` is the one normalization into a struct (see `internal-contracts.md`). Detail: `serialization.md`.

## Focused guidance files

### Rules

Read these when the situation matches:

- `module-structure.md` — read before splitting, merging, naming, or introducing modules; before adding a `defstruct`-only file; before designing a module prefix.
- `documentation.md` — read before adding or auditing `@moduledoc`/`@doc`; before configuring what shows in published HexDocs.
- `internal-contracts.md` — read before designing a data shape that crosses a boundary; before reaching for a map or tagged tuple; before adding a `Keyword.fetch!`/`Map.get` chain.
- `test-organization.md` — read before adding, splitting, or moving test files; before creating a new test support module.
- `reading-docs.md` — read before calling, overriding, or implementing for a module you didn't author in this session; before guessing a signature, option, callback, or return shape; before `@impl`-ing a behaviour.
- `serialization.md` — read before decoding JSON into a struct or encoding a struct to JSON; before writing `Jason.decode!` + a hand-rolled `from_map!`, or a hand-rolled `to_map` + `Jason.encode!`; before adding a JSONCodec "helper."
- `operating-style.md` — read at the start of non-trivial Elixir work; scope, correctness, context tracking, PR hygiene.
- `tool-discipline.md` — read when choosing between eval / AST / LSP / shell for a given task.

### Reference

Load on demand:

- `runtime-snippets.md` — load when you need a runtime-introspection, docs, OTP, Ecto, QuackDB, or profiling snippet.
- `workflow-verification.md` — load before claiming an edit is verified; the edit-and-verify loop and gate ordering.
- `publishing-packages.md` — load before publishing, releasing, shipping, or updating a Hex package version; creating package docs; or touching GitHub releases.

For Phoenix/LiveView UI, frontend assets, styling, browser-console feedback, PhoenixReplay debugging, or render verification, load `elixir-webdev` in addition to this general Elixir skill.

For phrases like “start a new package”, “see my vibe_kit package”, “use igniter”, `mix igniter.new`, or `mix igniter.install`, load `elixir-new-project` instead of treating the task as ordinary existing-project development.
