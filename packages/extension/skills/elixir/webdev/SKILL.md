---
name: elixir-webdev
description: "Phoenix/LiveView web development in existing projects: UI building, frontend assets, styling, browser-console feedback, PhoenixReplay debugging, and interactive verification. Use elixir-dev for general Elixir work and elixir-new-project for bootstrapping new projects."
---

# Elixir Web Development

Use this skill for Phoenix/LiveView frontend work in existing projects. It layers webdev-specific verification on top of `elixir-dev`; follow `elixir-dev` for all general Elixir discipline (tool choice, module structure, documentation, internal contracts, test organization).

Do not add or expect extra model-facing tools for web development. `elixir_eval` remains the control plane; webdev work verifies UI/runtime claims through package APIs and the running BEAM before final answers.

## Webdev-specific rules

- Do not create a second browser/transport abstraction when the project already has one. Extend the project's existing browser test driver, LiveView test helpers, or transport module instead of forking a parallel one.
- Verify package availability before using webdev recipes. The recipes in the focused guidance files are gated on `Code.ensure_loaded?(Module)`; do not assume a package is installed without checking.
- Prefer BEAM-native checks first (package availability, Volt browser logs, PhoenixReplay recordings, render/eval checks). Reach for a real browser (`phoenix_test_playwright`) only for JavaScript behavior, cross-browser checks, traces, screenshots, iframe/email flows, or browser-only regressions.

Read the focused guidance files as needed:

- `feedback-loops.md` — browser console logs, replay records, render-without-browser checks.
- `replay-debugging.md` — PhoenixReplay timeline debugging and re-render verification.
- `ui-verification.md` — icons, Tailwind candidates, rendered HTML, Vue SFC checks.
- `volt.md` — Volt build/lint/format/Tailwind and HMR feedback.

For general BEAM/source work, use `elixir-dev`. For creating or bootstrapping Phoenix projects, use `elixir-new-project`; the default Phoenix setup should be Phoenix + Igniter + VibeKit, then Igniter-installed Volt and published PhoenixReplay/PhoenixIconify. Do not recommend `phoenix_vapor` by default yet.
