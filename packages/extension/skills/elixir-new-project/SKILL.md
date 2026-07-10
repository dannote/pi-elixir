---
name: elixir-new-project
description: Create or bootstrap an Elixir/Phoenix project or package with Igniter and VibeKit. Use only for new-project generation or applying initial quality/tooling setup; use elixir for an existing backend project and elixir-web for existing UI/frontend work.
---

# New Elixir Project with Igniter/VibeKit

Use this skill only for creation/bootstrap work. Prefer Elixir 1.20+ with OTP 27+ for new projects when available; preserve the supported toolchain of existing projects.

Before generating:

- Read project-local instructions and any user-provided VibeKit checkout first; never assume a filesystem path.
- Otherwise verify current package/installer behavior from published docs or metadata rather than hard-coding versions.
- Confirm project type, name/path, database, and optional web packages when unclear.

Phoenix/web application:

```sh
mix phx.new my_app
cd my_app
mix igniter.install vibe_kit --agents-md
mix igniter.install volt
mix igniter.install phoenix_replay phoenix_iconify
```

Library/non-web project:

```sh
mix igniter.new my_lib --install vibe_kit --agents-md
```

Existing project receiving initial VibeKit setup:

```sh
mix igniter.install vibe_kit --agents-md
```

Use Phoenix + Igniter + VibeKit as the baseline. Add Volt, PhoenixReplay, and PhoenixIconify when appropriate to the requested web stack, following current installer output/docs. Do not add `phoenix_vapor` by default.

Keep VibeKit's strict defaults unless requested otherwise: project CI alias, warnings-as-errors, tests, strict Credo/ExSlop, Dialyzer, ExDNA, and Reach. Change installer behavior through Igniter APIs rather than raw text edits.

After generation, run focused checks followed by:

```sh
mix deps.get
mix ci
```

Verify generated files and installer idempotency. Do not publish, tag, create a remote repository, or overwrite an existing project unless explicitly requested. Once bootstrap is complete, use `elixir` or `elixir-web` for subsequent implementation rather than keeping this skill loaded.
