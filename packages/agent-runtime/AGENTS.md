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
The managed store may expose generic reversible prepare/publish/commit/rollback
transactions so a host can compose filesystem publication with another capability.
It emits host-agnostic, content-digest-bound recovery receipts for install, replace,
and remove; the host persists and composes those receipts with its ownership decision.
The store must not persist or interpret owner ids, decide whether a Skill is
standalone or owned, or authorize replacement. Mismatched bytes and unjournaled
backups fail closed.

Remote MCP servers supplied by a host are likewise native OpenCode capabilities.
Accept only host-generic configuration and expose thin OpenCode status/auth
operations; never learn Plugin ids, implement OAuth/transport/tool proxying, or
persist a second MCP configuration or credential store. A hard configuration refresh
must block newer prompts until the previous connection is rebuilt, while allowing
already-running prompts to finish.

Host-verified Hook modules are also native OpenCode capabilities. Accept only
generic absolute `file:` URLs to host-owned immutable snapshots; never receive a
Convax Plugin id, manifest, authorization policy, npm package, HTTP URL, or mutable
package path. Preserve deterministic load order after base OpenCode Plugins and
before the strong protected-path guard. Reuse hard configuration refresh, wait
behind a synchronous client-use admission lease for ordinary session, discovery,
and MCP calls, and give loaded Hook instances one bounded graceful `global.dispose`
opportunity before force-closing the old server. Prompt control replies remain on
the admitted generation so refresh cannot deadlock an active prompt. A hard refresh
must absorb Skill/configuration invalidations queued during disposal and leave the
next generation lazy; it must not eagerly start a second OpenCode instance.

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

Host tools may be long-running. The loopback Streamable HTTP bridge emits bounded,
content-free MCP progress only for a request's validated progress token, keeps the
configured OpenCode timeout as an inactivity window, and still propagates explicit
cancellation, transport closure and runtime disposal through `AbortSignal`.

Every base and lazily resolved MCP entry passes the same admission function. Until
OpenCode exposes a real socket-level outbound-policy hook, reject Internet MCP
execution entirely. The only admitted remote is a Main-owned literal loopback URL
with no credentials/query/fragment, one fixed Authorization header, and a
32-256-character base64url bearer token; local command MCP entries remain rejected.
