---
name: elixir-web
description: "Existing Phoenix/LiveView UI and frontend work: HEEx/components, styling, assets, browser behavior, runtime UI feedback, PhoenixReplay, Volt, icons, Tailwind, and interactive verification. Use instead of elixir when UI/frontend behavior is the primary task; not for project creation."
---

# Elixir Web Development

Use this as the primary skill for UI/frontend work in an existing Phoenix project. Use `elixir` instead for general backend/OTP work and `elixir-new-project` for creation/bootstrap. Do not load both general and web skills by default.

Keep the BEAM as the first feedback loop: use `elixir_eval` for runtime/render/log evidence, AST tools for Elixir structure, LSP for editor semantics, and browser tooling only when behavior requires a real browser. Inspect existing test support before adding helpers or a second browser abstraction.

Before the final answer, verify the claim with a concrete witness such as a runtime error, recording event, rendered fragment, icon lookup, Tailwind candidate, compile result, browser trace, or screenshot.

## Lazy references

Do **not** preload all references. Read only the reference matching the task:

- `references/feedback-loops.md` — choosing between BEAM logs, browser console forwarding, replay data, or render-without-browser checks.
- `references/replay-debugging.md` — inspecting PhoenixReplay recordings, assign changes, timelines, or replay-based rerenders.
- `references/ui-verification.md` — icons, Tailwind extraction, rendered HTML, real-browser acceptance tests, or Vue SFC compilation.
- `references/volt.md` — Volt is installed and the task involves HMR, frontend builds, JS checks, Tailwind, or its dev server.

Check package availability with `Code.ensure_loaded?/1` before using package-specific recipes. Verify current package docs/metadata instead of assuming versions.
