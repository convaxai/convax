# Agent Runtime Package Contract

This is the only package allowed to depend on `@deepseek-ai/*`. DeepSeek Harness
(DSH) is the single product Agent runtime. There is no backend router, OpenCode
adapter, executable, SDK, fallback, session decoder, or retry path.

The package owns only host-neutral Cordis boot, official Host ApiProxy projection,
its transport-neutral MessagePort carrier, generic Project-connection routing,
Agent sessions/resources, bounded Skill storage, and deterministic child disposal.
It must not import Electron, redeclare DSH business envelopes, or learn Convax
Project/Canvas/Plugin semantics. Desktop Main owns one independently issued child,
private state root, provider snapshot, and Host MCP capability per live Project.

The runtime remains host-agnostic. Callers inject scope ids, directories, structured
resources, prompt instructions, protected paths, tool providers, and server names.
Do not import other Convax packages or add Canvas/Project/Workbench tool schemas,
product prompts, UI, or storage knowledge here; those belong in Desktop adapters.
Prompt model selection maps the caller's exact provider/model pair to DSH. Provider
secrets resolve only through the child-local credential provider. Do not infer model
identity from generated prose or expose provider configuration through messages.

DSH Skills remain native runtime capabilities. The Node entry may own a bounded
host-managed Skill directory adapter, discovery isolation and cache refresh, but it
must not learn about Convax Plugins, catalogs, Project identity, or management UI.
Host-managed global Skills may be listed; project-local ambient Skills and remote
Skill indexes stay disabled. Refresh retires only the affected Project connection
without deleting its durable DSH sessions.
The managed store may expose generic reversible prepare/publish/commit/rollback
transactions so a host can compose filesystem publication with another capability.
It emits host-agnostic, content-digest-bound recovery receipts for install, replace,
and remove; the host persists and composes those receipts with its ownership decision.
The store must not persist or interpret owner ids, decide whether a Skill is
standalone or owned, or authorize replacement. Mismatched bytes and unjournaled
backups fail closed.

Remote MCP servers supplied by a host are native DSH capabilities. Accept only
host-generic configuration; never learn Plugin ids or persist a second MCP
configuration or credential store. Static non-OAuth rows may be mounted. OAuth rows
remain `needs_auth` until a separately admitted DSH-native Plugin supplies a static
credential envelope. Refresh waits for an active prompt, then rebuilds that Project.

Legacy executable Hook modules are represented only so the cutover can reject them
explicitly. They are never loaded into DSH. A future DSH-native Hook ABI is a
separate Host contract decision; Prompt, Skills, tools, MCP, LLM, and persistence
otherwise compose through exact-pinned DSH/Cordis Plugins.

Do not weaken the security boundary:

- no workspace-discovered executable configuration, Skills, or Plugins;
- loopback-only authenticated MCP transport and host-bound scope;
- no provider credential in Renderer, session metadata, logs, or environment;
- no fallback backend or legacy session/config decoding;
- shell, LSP, web, task, todo, and ambient attachment Plugins stay disabled; and
- shutdown must close streams, Host MCP, Cordis fibers, and children promptly.

Security and lifecycle changes require rejection, symlink, scope-isolation,
cancellation, refresh, and shutdown tests. Run `bun run typecheck && bun test`; run
root `bun run pack:check` for dependency or export changes, then validate the real
ordinary Desktop dev and packaged paths.

Host tools may be long-running. The loopback Streamable HTTP bridge emits bounded,
content-free MCP progress only for a request's validated progress token and still propagates explicit
cancellation, transport closure and runtime disposal through `AbortSignal`.

Every base and lazily resolved MCP entry passes the same admission function.
Host-validated remote MCP entries use absolute HTTPS URLs without URL credentials or
fragments and bounded non-sensitive literal headers. A
Desktop-managed stdio bridge instead uses a Main-owned literal loopback URL with no
credentials/query/fragment, one fixed Authorization header, and a 32-256-character
base64url bearer token. Local command MCP entries remain rejected. Dynamic remote
MCP and Skill contributions arrive in one atomic generic configuration generation;
legacy Hook rows are rejected and Agent Runtime never learns contribution owners.
