# Changelog

## 0.1.0

Initial release.

- **12 BEAM introspection tools**: eval, docs, source, SQL, logs, hex search, schemas, supervision tree, process top, process info, dependency tree, type specs
- **Auto-connect** to running Tidewave instances (probes localhost:4000–4009, matches by app name)
- **Embedded MCP server** starts automatically for any Elixir project — no config or deps needed. Uses Bandit/Plug when available (Phoenix), falls back to a zero-dep OTP gen_tcp server (libraries)
- **Syntax highlighting** for Elixir output, SQL results, docs, and logs in the TUI
- **Skill** that teaches the agent BEAM introspection patterns (runtime module discovery, Ecto schema introspection, process state, Phoenix routes, OTP supervision trees, AST manipulation)
