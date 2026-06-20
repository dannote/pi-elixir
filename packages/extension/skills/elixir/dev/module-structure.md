# Module Structure

Rules for shaping Elixir modules. These are defaults, not suggestions; deviate only with a stated reason.

## One concept per module

A module names a concept, not a count and not a sub-shape. If four `@moduledoc false` modules are all called only from one facade and all return the same kind of value, they are one module with four functions named for what each produces — not four files.

Bad: `Atoms`, `AtomDecoder`, `AtomDispatch`, `CachedAtoms` (one atom-handling concept in four files).
Good: `RustQ.Rustler.Atom` with `declaration/2`, `decoder/2`, `dispatch/2`, `cached/2`.

Bad: `TermBuilders`, `TermDecoder`, `TermHelpers` (one term concept in three files).
Good: `RustQ.Rustler.Term` covering encode, decode, and helper functions for terms.

## No defstruct-only suffix files

Do not scatter one-line files that exist only to hold a `defstruct`. Group struct holders as nested modules in a single `Syntax.ex` / `Nodes.ex` / equivalent.

Bad: `rust/block.ex`, `rust/const.ex`, `rust/field.ex`, `rust/struct.ex`, … eleven 10-line files.
Good: `RustQ.Rust.Syntax` with `Block`, `Const`, `Field`, `Struct`, … as nested `defmodule` blocks in one file.

## Direction-paired codegen merges

Encode + decode + helpers for one concept live in one module. Don't split `FooBuilders` from `FooDecoder` from `FooHelpers` — they are two directions plus shared helpers for a single concept, so one module.

## Split god modules by concern

A module that owns a macro frontend (`defrust`, `defschema`, …) should not also own lowering helpers, validators, and body generators. Split by concern:

- `MyApp.Meta` — the public macros (`defrust`, `__using__`, `__before_compile__`) only.
- `MyApp.Meta.Lower` — the lowering pipeline.
- `MyApp.Meta.Validate` — validation and diagnostics.
- `MyApp.Meta.Ast` — AST construction helpers.

Each sub-module gets a real `@moduledoc` (see `documentation.md`); internals are not hidden via `@moduledoc false` or `__underscored__` names.

## Prefix hygiene

A shared prefix must name one concept. If `Native*` means NIF stubs, external-item descriptors, and self-hosting codegen, that is three namespaces, not one. Split:

- `MyApp.Native` — the NIF boundary itself.
- `MyApp.Native.Ref`, `MyApp.Native.Descriptor` — external-item metadata submodules.
- `MyApp.Codegen` — generation of the app's own support crate (do not call it `NativeCodegen` unless "native" adds a real distinction).

## Function names describe the produced output

`Foo.build/2` is vague. Name the function for what it produces: `Foo.declaration/2` (produces a declaration), `Foo.decoder/2` (produces a decoder function), `Foo.dispatch/2` (produces a dispatch function). The caller reads the call site and knows the output shape.

## Module names are singular concepts

`Atom`, not `Atoms`. `Logger`, `Registry`, `GenServer` — Elixir convention is singular. Plurals are acceptable only when the module genuinely owns a collection (e.g. `Aliases`, `Variants` as a registry). Don't name a module by the macro it happens to emit (`Atoms` because it emits `rustler::atoms!`) or by a count.

## Internals are named and documented, not hidden

Internal pipeline stages get a real module name and a real `@moduledoc`. Do not leak internal functions as `__underscored__` public API on a public module, and do not mark an entire module `@moduledoc false` to avoid writing docs. See `documentation.md` for how to keep internals out of published docs without stripping them.
