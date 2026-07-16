# Architecture

`pi_bridge` is an isolated control plane. It does not run inside target projects.

## Runtime boundaries

- **Control bridge** — the supervised `pi_bridge` application started by the TypeScript extension.
- **Project worker** — a separate dependencyless VM that loads the target Mix project without starting its application.
- **Application worker** — the same isolated worker boundary with intentional target application startup.
- **Attached runtime** — an explicitly configured distributed node inspected without starting another application copy.

Target-worker source is a manifest-driven bundle under `priv/target`. The control bridge resolves it with `Application.app_dir/2`; package layouts and compile-time source paths are not part of the runtime contract.

## Supervision

The application callback owns all always-on infrastructure through the root supervisor:

- transport task supervision;
- eval and target registries/dynamic supervisors;
- attached-runtime state;
- the BEAM-to-pi LLM broker;
- an optional-service supervisor for lazy plugin, session, agent, log, and mirror services.

Lazy services are transient supervised children. Normal shutdown removes them; unexpected exits restart them. Callers never unlink infrastructure processes or become their accidental owners.

## Dependency direction

`Pi.Transport` is the outbound port used by domain code. `Pi.Transport.Stdio` is the concrete adapter and orchestration boundary. Plugins, sessions, and LLM code may emit through the port but must not call the stdio adapter.

`Pi.Protocol.*` defines wire values. TypeScript decodes stdio envelopes into a discriminated union before dispatch. The policy in `.reach.exs` enforces the transport/protocol/target-runtime dependency rules.

The output facade invokes its rendering protocol, while built-in protocol implementations live in a separate module boundary. This preserves the public output and protocol contracts without introducing an xref cycle.

## Project context

Filesystem, git, Mix environment, and build paths flow through `Pi.Project.Context`. Helpers must not infer target identity from the control bridge's current working directory.
