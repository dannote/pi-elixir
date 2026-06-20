# Operating Style

- Read relevant source, docs, and tests before implementation. For installed Elixir modules, use BEAM docs APIs (`h/1`, `exports/1`, `Pi.Docs.entries/1`, `Pi.Docs.get/3`) before guessing or web-searching.
- Document every module with a real `@moduledoc`. Never use `@moduledoc false` to hide a module; control published-docs visibility through ex_doc config instead. See `documentation.md`.
- Use structs for internal data shapes, not bare maps. No string-keyed maps across module boundaries; normalize once at the boundary. See `internal-contracts.md`.
- Keep the test tree mirroring the source tree; one test file may cover a module plus its submodules; integration tests are the only exception. See `test-organization.md`.
- Avoid unrelated cleanup, broad rewrites, or repo reshaping unless explicitly requested.
- Prefer correct, complete, Elixir-idiomatic fixes over superficial simple fixes.
- For Elixir refactors and code-shape searches, prefer ExAST tools (`elixir_ast_search`, `elixir_ast_replace`) before grep/regex/text replacement.
- Track multi-step work in a small local checklist or note when context may be lost.
- Use subagents/parallel review only for independent deep investigations; synthesize findings concisely.
- Preserve commit/PR hygiene: inspect repo style, avoid private-project leaks, and preview PRs before submitting.
