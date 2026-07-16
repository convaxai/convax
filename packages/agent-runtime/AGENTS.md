# Agent Runtime Package Contract

This is the only package allowed to depend on `opencode-ai` or `@opencode-ai/*`.

The runtime remains host-agnostic. Callers inject scope ids, directories, structured
resources, prompt instructions, protected paths, tool providers, and server names.
Do not import other Convax packages or add Canvas/Project/Workbench tool schemas,
product prompts, UI, or storage knowledge here; those belong in Desktop adapters.

OpenCode Skills remain native runtime capabilities. The Node entry may own a bounded
host-managed Skill directory adapter, discovery isolation and cache refresh, but it
must not learn about Convax Plugins, catalogs, Project identity, or management UI.
Normal external global Skills may be listed; project-local ambient Skills and remote
Skill indexes stay disabled. Refresh volatile discovery without deleting sessions.

Do not weaken the security boundary:

- no workspace-discovered executable OpenCode extension/config behavior;
- loopback-only authenticated MCP transport and host-bound scope;
- lexical plus symlink-aware protected-path checks;
- fail closed when the strong guard is not loaded;
- shell/LSP disabled when strong path confinement is required;
- shutdown must close in-flight local transport promptly.

Security and lifecycle changes require rejection, symlink, scope-isolation, and
shutdown tests. Run `bun typecheck && bun test`; run root `bun run pack:check` for
dependency or export changes.
