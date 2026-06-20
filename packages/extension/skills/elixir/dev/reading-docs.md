# Reading Docs

The invariant: **read before you code against a module.** Before calling, overriding, or implementing for any module you did not author in this session, read its documentation. No guessing signatures, options, callbacks, or return shapes from a function's name.

## What "read" means

Use these from `elixir_eval` — the docs are already loaded in the BEAM, so reading them is a one-line eval, not a web fetch:

```elixir
h(Enum)                        # module overview + @moduledoc
h(Enum.map/2)                  # one function: signature, args, options, return, examples
i(%Ecto.Changeset{})           # term introspection: struct shape, impls, where it's defined
exports(Ecto.Changeset)        # every public function/arity — fast surface scan
b(GenServer)                   # behaviour callbacks — read this before @impl GenServer
t(Ecto.Changeset)              # @type declarations — read this before pattern-matching a return
Pi.Docs.entries(Ecto.Changeset)# structured docs: filter/map to find "which function takes :timeout?"
Pi.Docs.get(Ecto.Changeset, :cast, 4)  # one function's structured doc
```

Prefer `h/1` for reading, `Pi.Docs.entries/1` when you need to filter (e.g. "all functions in `System` that take a keyword list of options"), `b/1` before implementing a behaviour callback, `t/1` before pattern-matching a library's return type.

Mechanics live in `tool-discipline.md` and `runtime-snippets.md`; this file is the *when and why*.

## When you must read

- **Before calling a dep or project module's function** for the first time in a session. The name is not the contract. `render` might return `{:ok, iodata}` or `iodata` or a struct; only the doc knows.
- **Before `@impl`-ing a behaviour callback.** Read `b(Behaviour)` first. Callbacks have required arities, expected return shapes, and sometimes required options. Inventing a callback signature from its name is the most common source of silent bugs.
- **Before overriding `Protocol`/`Jason.Encoder`/`Inspect`/etc.** Read the protocol's callback (`defprotocol` source or `h(Protocol)`) before `defimpl`.
- **Before passing options.** If a function takes `opts` / `keyword()`, read which keys it accepts. Do not pass `:timeout` and hope.
- **Before assuming a return shape.** If you're going to pattern-match the result, read the doc's "Returns" section or `t/1`. Do not guess `{:ok, value}` vs `value`.

## Stdlib carve-out (narrow)

The stdlib exemption applies only to the agent's truly-common surface: `Enum`, `Map`, `Keyword`, `String`, `List`, `MapSet`, `Access` basics (`map/2`, `reduce/3`, `fetch!/2`, `get/3`, `split/2`, `replace/3`, and the like). These are read so often that re-reading on every call is noise.

The carve-out **does not** cover:
- stdlib functions with **options** (`System.cmd/3`, `File.read!/1` is fine but `File.cp!/3`'s `:on_conflict`, `Task.async_stream/3`'s options, `Agent.start_link/2`'s `:name`/`:timeout`).
- stdlib **behaviours and callbacks** (`GenServer`, `Supervisor`, `Application`, `Plug`, `ExUnit.Case`). Read `b/1` before `@impl`.
- stdlib **less-common modules** (`:ets`, `:gen_statem`, `Registry`, `PartitionSupervisor`, `Node`, `:persistent_term`). Read `h/1`.
- **Anything you are not 100% certain of.** If you would hesitate to type the signature from memory, read it.

When in doubt, read. The eval costs one round-trip; a wrong signature costs a debug cycle.

## When source beats docs

Docs are the contract; sometimes you need the implementation. Read source when:

- The doc is `@moduledoc false` or `@doc false` (a smell per `documentation.md`, but you still need the info — read the `.ex` file via `read` or `:code.which(Mod)`).
- The doc says "see source" or is ambiguous about the failure mode you're hitting.
- You need to know what a function *does*, not what it *promises* (e.g. whether it allocates, whether it's O(n), whether it mutates).
- The dep version loaded differs from the hexdocs version you remember.

`:code.which(MyMod)` from eval gives the `.beam` path; the `.ex` source is next to it (or in `deps/<dep>/lib`). Prefer `read` over grepping the beam.

## When to fetch external HexDocs

Only when the module is **not** loaded in the BEAM (`Code.ensure_loaded?(Mod)` is `false`) **and** you cannot read source (e.g. a dep you're considering but haven't added, or a Hex package's published-only module). Then:

```elixir
Pi.Web.fetch!("https://hexdocs.pm/jason/readme.html")
```

Do not blind-web-search for "elixir foo bar" when the module is loaded — that's slower and less accurate than `h/1`.

## Failure modes to reject

These are the behaviors the invariant exists to prevent. If you catch yourself doing one, stop and read the doc:

- "I think this function takes a keyword list of options" — you haven't read which ones.
- "It probably returns `{:ok, value}`" — you haven't read the return type.
- Naming a callback `handle_call/3` from memory without reading `b(GenServer)` — the arity or return tuple shape may have drifted, or you may need `handle_continue`.
- Passing `:as` to a function because `Jason.decode!/2` takes `:as` — not every decode does.
- Implementing `defimpl Jason.Encoder` without reading the protocol's `encode/2` contract (see `serialization.md`).
- Treating a function's *name* as its *contract*. `get` is not `fetch`; `put` is not `update`; `new` is not `start_link`.
