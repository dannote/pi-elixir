# Documentation

Rules for `@moduledoc` and published-docs visibility. No exceptions.

## Every module is documented

Every `defmodule` gets a real `@moduledoc` that explains what the module is, not what it is not. "No moduledoc" is not a state; an absent moduledoc is a bug.

Do not write `@moduledoc false`. There is no carve-out for generated modules, protocol `__impl__` modules, or "private" internals. If the module exists, it gets a doc. If you cannot write a sentence describing what the module is, that is a signal that the module is poorly scoped — fix the module, do not hide it.

`@doc false` on individual functions is permitted only when the function is a callback implementation whose contract is documented at the behaviour, or when the function is genuinely unreachable through the public surface. Do not use `@doc false` as a lazy substitute for a one-line doc.

## Visibility is controlled by ex_doc config, not by stripping docs

Internal modules stay out of published HexDocs by configuring ex_doc in `mix.exs`, never by deleting their `@moduledoc`. Use one or more of:

```elixir
defp deps do
  [
    {:ex_doc, "~> 0.34", only: :dev, runtime: false}
  ]
end

def project do
  [
    # ...
    docs: docs()
  ]
end

defp docs do
  [
    # Drop internal modules from the published HTML entirely.
    skip_modules: [MyApp.Meta.Lower.Internal, MyApp.Config.State],

    # Or group them under an "Internals" heading instead of hiding them.
    groups_for_modules: [
      Internals: [MyApp.Meta.Lower.Internal, MyApp.Config.State]
    ],

    # Or filter by prefix.
    filter_modules: ~r/^MyApp\.([^\.]+)$/
  ]
end
```

Prefer `groups_for_modules` over `skip_modules` when the internals are useful to contributors — hiding from the public site is enough. Use `skip_modules` only for modules that would mislead public readers.

## Why this matters

`@moduledoc false` is a documentation debt disguised as a visibility decision: it removes the doc from every reader, including contributors, and it removes the pressure to write one. ex_doc config removes the module from the published site only, while keeping the doc in the source for everyone who works on the code.

A project with thirty `@moduledoc false` modules (the RustQ state) has thirty undocumented internals that contributors must reverse-engineer from source. The same project with thirty documented internals plus an ex_doc `groups_for_modules: [Internals: ...]` entry has thirty documented internals that the public site presents as a single "Internals" group.
