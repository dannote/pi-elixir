# Test Organization

Rules for test file layout. Integration tests are the only exception.

## The test tree mirrors the source tree

The `test/` directory mirrors `lib/`. Same directory structure, same naming, with `_test.exs` appended. The source and test trees are parallel; a reader who finds `lib/my_app/rustler/atom.ex` knows to look at `test/my_app/rustler/atom_test.exs`.

```
lib/my_app/rustler/atom.ex          →  test/my_app/rustler/atom_test.exs
lib/my_app/meta/lower.ex            →  test/my_app/meta/lower_test.exs
lib/my_app/syn/index.ex             →  test/my_app/syn/index_test.exs
```

If a source module has tests, those tests live in the mirrored path. Do not invent an alternate grouping in `test/` (by feature, by layer, by author) that does not exist in `lib/`.

## One test file may cover a module plus its submodules

One test file covers one source module and, where it reads naturally, that module's closely-coupled submodules. This matches how Elixir projects often group a facade with its immediate collaborators.

- `test/my_app/rustler_test.exs` may cover `MyApp.Rustler` plus `MyApp.Rustler.Atom`, `MyApp.Rustler.Nif`, … when those submodules are thin and exercised through the facade.
- `test/my_app/rustler_test.exs` should not cover `MyApp.Rustler.Schema`, which is a standalone DSL with its own behavior and gets `test/my_app/rustler/schema_test.exs`.

The rule of thumb: if the submodule has its own `@moduledoc` describing independent behavior, it gets its own test file. If it is an implementation detail exercised only through the parent, the parent's test file may cover it.

## No ad hoc test files

No `test/helpers.exs`, `test/utils_test.exs`, `test/smoke.exs`, `test/manual.exs` unless they map to a source module or an established integration convention. A test file that does not correspond to a source module is a smell: either the code under test should be extracted into a source module, or the test belongs in an existing mirrored file.

The exception is integration tests, below.

## Integration tests

Integration tests are the one allowed exception to mirroring. They live in the project's conventional integration path — usually `test/` root, sometimes `test/integration/` — and are named for the scenario or feature they cover, not for a source module:

```
test/codegen_pipeline_test.exs           # end-to-end codegen, spans many modules
test/integration/cargo_resolution_test.exs
test/integration/template_include_test.exs
```

A test is an integration test when it exercises a real flow through several modules and would be meaningless if any one of them were mocked. A test that calls one module's function and asserts on its return is a unit test and belongs in the mirrored file.

## Test support follows the project's existing convention

Before adding or moving ExUnit support code, inspect the project's existing test support organization: `test/support`, `test_helpers`, case templates, drivers, assertions, fakes, fixtures, and `test/test_helper.exs`. Extend what is there. Do not introduce a parallel helper hierarchy or an ad hoc flat helper file.

Keep helper file paths, module names, and responsibilities aligned with the project's chosen grouping. Prefer extending an existing case/driver/assertion/fake/helper module when it already covers the responsibility.

## ExUnit module names follow the source hierarchy

Test module names mirror the source path: `lib/my_app/rustler/atom.ex` → `defmodule MyApp.Rustler.AtomTest do`. Do not flatten (`defmodule AtomTest`) or regroup (`defmodule RustlerHelpersTest`) in a way that breaks the parallel with the source tree.
