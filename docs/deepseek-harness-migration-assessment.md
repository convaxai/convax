# DeepSeek Harness migration assessment

Status: decision-ready research; not a current runtime contract and not authorization to remove OpenCode.

Research date: 2026-08-18.

## 1. Decision

Do not replace the current OpenCode runtime with DeepSeek Harness immediately.

Adopt DeepSeek Harness as the target runtime only through a new implementation of
the existing `AgentRuntime` boundary, backed by a closed, Convax-managed Harness
subprocess. The preferred transport is a successor to the DeepSeek Harness SDK
JSON-RPC protocol. The current ACP, headless, and SDK transports do not satisfy the
Convax contract.

The first implementation task is therefore an upstream/prototype compatibility
slice, not a product cutover. Product cutover remains blocked until all gates in
§9 pass.

This decision preserves the current ownership boundary:

- `@convax/agent-runtime` owns the host-agnostic runtime adapter, session projection,
  protected execution boundary, and managed Skill filesystem mechanics;
- Desktop Main owns Project scope, product tools, Plugin/Marketplace authority,
  provider credentials, IPC, persistence composition, and packaged-runtime staging;
- Canvas, Project, and Plugin owners keep their existing domain semantics;
- the Renderer continues to depend only on `AgentClient`.

## 2. Evidence baseline

The comparison is pinned to exact source rather than product names.

| Subject             | Evidence used                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convax              | `origin/main` at `226794d2339f8f50d2870698743ba588416f18fb`; `@convax/agent-runtime` pins `opencode-ai` and `@opencode-ai/sdk` `1.18.1`                                                                                                               |
| OpenCode registry   | npm `latest` was `1.18.18`; this assessment evaluates the repository-pinned `1.18.1`, not an assumed latest upgrade                                                                                                                                   |
| DeepSeek Harness    | [`dsh-v0.1.0-rc.7`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7), commit [`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`](https://github.com/deepseek-ai/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca) |
| Harness publication | `0.1.0-rc.7` was published under npm's `next` tag for the inspected SDK/ACP packages; the GitHub release is a prerelease and contains no binary assets                                                                                                |

Primary Harness references are the pinned repository's
[`architecture.md`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/architecture.md),
[`dsh-sdk-client`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/client/README.md),
[`dsh-sdk-jsonrpc-server`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/server/README.md),
[`dsh-acp`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/acp/acp/README.md),
[`dsh-session`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/session/README.md),
and [`dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/mcp/mcp-client/README.md).

The evidence is time-bounded. Re-run the matrix against the exact proposed Harness
release before implementation or dependency changes.

## 3. Current Convax contract

The replacement target is not merely an LLM loop. The current `AgentRuntime` and
Desktop composition require all of the following:

1. list, create, reopen, and project complete session state;
2. prompt an existing session with exact provider/model selection, instructions,
   files, directories, structured Convax resources, and selected Skills;
3. preserve exact response provider/model identity;
4. cancel an admitted prompt and propagate cancellation into long-running Host tools;
5. project busy/retry/idle state, reasoning, tool lifecycle, errors, pending
   permissions, and pending questions;
6. support one-shot and remembered permission replies plus multi-question answers;
7. expose model and capability catalogs;
8. load only Host-selected managed and immutable Plugin-owned Skill directories
   while keeping ambient project execution disabled;
9. load Host-authorized immutable Hook modules from one leased ActiveSet generation;
10. connect Host-authenticated loopback MCP and validated remote HTTPS MCP, including
    OAuth status and authentication operations;
11. deny `.convax` through lexical and symlink-aware enforcement and disable raw
    shell/LSP when the strong guard is required;
12. refresh providers, Skills, Hooks, MCP, and Host tools without deleting durable
    sessions, while admitted work finishes on its original configuration generation;
13. package a verified runtime, license, and provenance record for every supported
    platform/architecture; and
14. dispose the process tree and in-flight transports to quiescence.

Desktop Main already keeps product execution on the correct side of this boundary.
Canvas, generation, Plugin operation, and managed MCP tools enter the runtime through
`AgentToolProvider` and an authenticated local MCP bridge. That composition can be
reused. No Harness adapter should learn Project, Canvas, Plugin, or Marketplace
semantics.

## 4. Harness capability matrix

Harness core is stronger than any one published transport. A green core capability
does not make a transport green.

| Capability                  | Harness rc.7 evidence                                                                                                                    | Convax disposition                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Event-sourced sessions      | Core has an append-only `SessionEvent` log, projections, flush, fork, persistence seams, crash repair, and `agents.resume()`             | Strong fit, but the selected transport must expose list/resume/state                                                                                         |
| Session list/resume         | Core persistence supports list/load/prepare and Agent Loop supports resume                                                               | Blocked: ACP supports fresh sessions only; SDK server calls `agents.create()` and exposes neither list nor resume                                            |
| Prompt cancellation         | Core `Agent.cancel()` is cooperative and durable; ACP exposes cancellation                                                               | Blocked on SDK: no prompt-cancel or per-session-close method; abandoning work closes the whole process                                                       |
| Per-prompt model route      | Core request assembly can select an exact route                                                                                          | Blocked on SDK: provider/model/cwd are fixed by one process-wide `initialize`; `session/prompt` carries content only                                         |
| Session event projection    | SDK streams full `session.event` and whole-Agent status notifications                                                                    | Feasible after adding cold state reads and a stable protocol version                                                                                         |
| Permission                  | Core approval is audited and fail-closed; ACP offers one-shot machine decisions                                                          | Partial: no allow-always rule, no tool arguments, and SDK has no server-to-client request path                                                               |
| User questions              | Core has a typed multi-question seam and Web provider                                                                                    | Blocked: ACP explicitly omits human questions and SDK exposes no question channel                                                                            |
| Skills                      | Scoped registry and filesystem provider are capable and dynamically invalidated                                                          | Partial: default roots include project `.dsh`/`.agents`; Convax requires an isolated custom-root composition and selected-Skill injection over the transport |
| Host tools                  | Harness MCP tools preserve typed schemas/results and propagate `AbortSignal`                                                             | Partial: the client uses an absolute timeout and does not request progress-based timeout reset; Convax Host tools use progress as an inactivity heartbeat    |
| Remote MCP                  | stdio and Streamable HTTP tools, stable names, reconnect, and cancellation exist                                                         | Blocked for parity: no OAuth lifecycle/status surface; Resources and Prompts are not bridged                                                                 |
| Hooks                       | Harness has typed Cordis extension points plus Claude Code/Codex command-hook bridges                                                    | Incompatible with `convax.plugin/8`, whose `hooks` file is an immutable OpenCode Plugin ESM module                                                           |
| Protected paths             | Harness has workspace file policy and OS sandbox providers                                                                               | Insufficient: filesystem reads always pass, policy has one workspace root, and it does not implement Convax's protected subtree contract                     |
| Dynamic configuration       | Cordis profiles and patches can replace plugin rows                                                                                      | Requires a Host-owned generation protocol; user profiles/HMR cannot become Plugin execution authority                                                        |
| Provider mapping            | `dsh-llm-pi-ai` supports hand-declared OpenAI-compatible routes, headers, models, and OpenRouter thinking dialect                        | Feasible with explicit `openai -> openai-completions` and `openrouter -> openai-completions + openrouter compat` mapping and parity tests                    |
| Structured prompt resources | ACP accepts text/images and flattens resource links; SDK accepts LLM content blocks                                                      | Blocked for files, directories, Convax resource snapshots, selected Skills, per-prompt instructions, and current agent/variant fields                        |
| Distribution                | TypeScript SDK requires an explicit command and states that it has no bundled-runtime resolution; Python owns a separate runtime carrier | Blocked: rc.7 has no GitHub binary assets and Convax has no verified cross-platform DSH runtime closure                                                      |
| Compatibility stability     | Session format remains version `0`; SDK handshake reports protocol `0.0.1` with no version negotiation                                   | Blocked for durable product data and rolling upgrades                                                                                                        |

## 5. Rejected integration shapes

### 5.1 Headless profile

Reject for product integration. It accepts one task, creates one fresh Agent, prints
the final text, and exits. It has no follow-up, interactive permission/question,
session browsing, or product lifecycle surface.

### 5.2 ACP subprocess

Reject as the primary Convax transport. ACP has valuable cancellation and approval
semantics, but it is deliberately automation-only. It supports fresh sessions,
committed answers, text/images, and one workspace. It explicitly omits list/load/
resume, transcript replay, questions, model selection UI, MCP configuration,
reasoning, plans, titles, and tool presentation.

ACP remains useful as a conformance oracle for prompt cancellation, not as the
Desktop integration protocol.

### 5.3 In-process Cordis tree inside Electron Main

Reject as the product topology. It could reach all core services and is useful for
a laboratory adapter, but it would put a large, dynamically composed plugin tree in
the Desktop Main process, couple runtime crashes and module loading to the product
composition root, and make bounded process disposal and packaged dependency closure
harder to prove.

It also does not solve the OpenCode Hook ABI or cross-release session-format
compatibility.

### 5.4 Current SDK subprocess

Select as the direction, reject as currently sufficient. Its process ownership,
stdio protocol, durable event stream, and explicit shutdown align with Convax. Its
missing lifecycle and interaction methods are bounded and belong in an SDK protocol
successor instead of private imports into Harness internals.

## 6. Target architecture

```text
Renderer
  -> existing AgentClient IPC
Desktop Main
  -> existing product scope, resources, ActiveSet lease, provider and tool owners
@convax/agent-runtime
  -> DeepSeekHarnessAgentRuntime (new AgentRuntime implementation)
     -> bounded worker pool keyed by host-resolved workspace directory
        -> one closed Convax Harness SDK subprocess per active workspace generation
           -> event-sourced session + persistence
           -> isolated Skill providers
           -> Convax Host-tool MCP bridge
           -> validated remote MCP rows
           -> configured LLM routes
```

The worker pool is lazy and bounded. A worker receives one workspace directory and
one Host-owned state root; `@convax/agent-runtime` does not receive Project identity.
Separate workers avoid cross-Project cwd, credentials, session, and tool-scope
leakage inherent in rc.7's process-wide SDK initialization.

### 6.1 Closed composition

The Convax Harness profile must be generated from code-owned templates and exact
Host inputs. It must:

- disable user profile patches, project `.dsh`/`.agents` discovery, HMR, and ambient
  executable plugin loading;
- resolve bare Harness packages from the packaged runtime closure, never the Project;
- mount no raw filesystem, shell, terminal, LSP, web-fetch, or subprocess-facing
  model tools in the parity release;
- mount the core session/agent/tool services, a durable backend, selected Skill
  providers, the SDK server, approved model adapters, and approved MCP clients only;
- keep secrets out of YAML and disk, using a scrubbed per-generation environment or
  a Host credential bridge;
- set telemetry explicitly rather than inheriting Harness defaults; and
- write state only below the Host-supplied runtime root.

Not mounting raw file/shell tools is the first strong protected-path implementation.
The model can mutate Convax only through typed Host tools, where existing owners
enforce scope. A future raw coding-tool release needs a generic DSH protected-subtree
guard with lexical, realpath, symlink-swap, platform, and cancellation tests before
it can replace this posture.

### 6.2 Configuration generations

Desktop resolves provider routes, Hook/Skill/MCP contributions, and Host tools from
one exact ActiveSet lease. Agent Runtime materializes one content-digested, secret-
free Harness configuration generation.

A hard refresh must:

1. block new Agent operations;
2. validate the candidate configuration against an isolated empty probe root;
3. let admitted operations and Host-tool calls settle on the old generation;
4. close the old process to quiescence;
5. start the candidate against the workspace's durable root;
6. resume requested sessions explicitly; and
7. release the old ActiveSet lease only after no process can load its bytes.

No directory presence, profile patch, or last-good mutable file selects execution
authority. Failed candidates leave the previous generation active until admission
is blocked for the final swap; a failed final start reports runtime error and never
silently starts an ambient profile.

### 6.3 Host tools and MCP

Reuse the existing authenticated loopback Streamable HTTP server for
`AgentToolProvider`. Configure it as a DSH MCP server with a literal loopback URL,
one fixed Authorization header, and a random bearer token. Preserve content-free
progress and cancellation.

Before adoption, the DSH MCP client must either request
`resetTimeoutOnProgress: true` or expose equivalent inactivity semantics. An absolute
deadline is not a substitute for the current one-hour inactivity window because a
progressing generation job may legitimately run longer.

Plugin remote MCP cannot cut over until Harness owns an OAuth flow with status,
connect, authenticate, disconnect, and credential-removal operations equivalent to
the current Agent Runtime surface. Convax must not export or reinterpret OpenCode
OAuth credentials.

### 6.4 Models and credentials

Desktop continues to resolve exact installed Plugin LLM gateways. For each Harness
generation it supplies:

- a namespaced provider id;
- exact model ids/names;
- the gateway base URL;
- `openai-completions` for the current `openai` protocol;
- `openai-completions` plus OpenRouter compatibility for `openrouter`; and
- a generation-scoped credential reference whose secret exists only in the scrubbed
  child environment or Host credential bridge.

The successor SDK protocol must allow exact provider/model selection for each
prompt, not only process initialization. The response projection must read the
provider/model recorded by the committed Harness assistant message.

### 6.5 Skills

Use the DSH Skill registry with isolated filesystem providers configured with
`includeDefaultRoots: false`. Pass only:

- the existing managed standalone-Skill root;
- exact immutable Plugin-owned Skill directories from the ActiveSet lease; and
- separately validated read-only external global roots if Convax continues to expose
  them.

Selected Skills must be loaded through the DSH registry's user-invocation boundary.
Do not copy Skill bodies into prompt strings in Desktop or reimplement discovery.
The SDK successor therefore needs a typed selected-Skill prompt input.

### 6.6 Hooks

There is no safe generic adapter from a `convax.plugin/8` OpenCode Plugin module to a
Cordis or Claude/Codex command hook. The APIs, event vocabulary, loading lifecycle,
and authority model differ.

Choose exactly one before cutover:

1. publish a new Plugin Host major with a generic Harness-native declarative Hook
   contract, update every authoring/reference surface, and keep v8 Hook-bearing
   Plugins unavailable until updated; or
2. retain an OpenCode compatibility runtime for v8 Hooks, which means the product
   has not fully replaced OpenCode and must carry two execution/security boundaries.

The recommended product decision is option 1. It requires explicit human approval
through the Plugin-to-Host change process. An agent-authored proposal is not that
approval.

## 7. Required Harness SDK successor

Do not implement Convax against `./src/*` deep imports. Contribute or wait for a
published protocol that provides at least:

| Method or channel                 | Required semantics                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `initialize`                      | negotiated protocol version/capabilities; no unvalidated `0.0.1` peer                      |
| `session/list`                    | bounded headers/titles for one configured persistence root                                 |
| `session/create`                  | exact session id and immutable cwd                                                         |
| `session/resume`                  | load, repair, and publish an existing persisted session                                    |
| `session/state`                   | bounded cold/live event or projection read with pending interactions                       |
| `session/prompt`                  | exact provider/model, instructions, typed resources, selected Skills, and enqueue identity |
| `session/cancel`                  | address admitted/queued work, reach idle, and propagate `AbortSignal`                      |
| `session/close`                   | dispose one live Agent without shutting down the runtime                                   |
| `capabilities/list`               | selected Skill and tool ids from the actual scoped composition                             |
| `models/list`                     | exact configured provider/model catalog                                                    |
| server request `approval/request` | one-shot and remembered replies or an explicit contract migration                          |
| server request `question/request` | typed multi-question request, answer, rejection, and cancellation                          |
| MCP control                       | status, OAuth start/finish, connect/disconnect, and auth removal                           |
| notifications                     | ordered session events, status, interaction lifecycle, and configuration generation        |

The protocol must define shutdown, transport loss, duplicate request, late reply,
unknown session, restart, and version-mismatch behavior. Client and server conformance
fixtures must be published with the protocol.

## 8. Session and state migration

Do not translate OpenCode records into Harness `SessionEvent` logs. Harness session
format is prerelease version `0`; request headers, tool-pairing, model provenance,
and recovery records have invariants that an OpenCode projection cannot reconstruct.

Use a two-release migration:

1. while OpenCode is still the production runtime, export every reachable session
   through `AgentRuntime.getSessionState()` into a versioned, checksummed, read-only
   neutral archive;
2. verify archive counts and bytes before marking a scope migrated;
3. start new Harness sessions in a separate state root;
4. show archived OpenCode sessions read-only with an explicit provenance label;
5. never replay archived tool calls or pending permission/question requests; and
6. remove the OpenCode executable only in a later release after archive acceptance.

Do not dual-write one live conversation to both runtimes. Do not infer successful
Harness resume from a matching session id. OpenCode-owned MCP OAuth credentials stay
in place and users re-authenticate through the future Harness flow.

For the first cutover, preserve stable legacy identifiers such as audit actor
`opencode:<scope>` and service id `builtin:opencode` if changing them would rewrite
durable or user preference state. Treat them as compatibility tokens and schedule a
separate evidence-backed migration; do not combine identity cleanup with runtime
replacement.

## 9. Go/no-go gates

Cutover is **NO-GO** until every row passes on macOS arm64/x64, Windows x64/arm64,
and Linux x64/arm64 where Convax claims support.

| Gate                | Required evidence                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 protocol         | Published, version-negotiated SDK protocol implements every §7 operation with client/server conformance tests                                  |
| G2 sessions         | create/list/state/resume survive clean restart, crash-tail repair, max-token termination, and incompatible-format rejection                    |
| G3 interaction      | permission once/always/reject and questions round-trip; abort/dispose resolves every waiter; late replies cannot cross sessions                |
| G4 model routing    | one session can change exact provider/model between prompts and projects cannot observe each other's catalogs or credentials                   |
| G5 resources/Skills | file, directory, structured resource, and selected Skill semantics match current contract; no ambient project Skill/config is discovered       |
| G6 Host tools       | schemas/results match; progress resets inactivity; stop and transport loss abort long-running Host work; stale scope cannot call               |
| G7 MCP              | HTTPS validation, reconnect, OAuth, status/auth controls, cancellation, and ActiveSet generation refresh pass                                  |
| G8 Hooks            | approved Host-major decision implemented, or the release explicitly admits OpenCode remains as a compatibility runtime                         |
| G9 protection       | `.convax` read/write/execute probes, symlink aliases/swaps, shell/LSP absence, and platform path cases fail closed                             |
| G10 packaging       | reproducible signed runtime artifact, checksum, license, provenance/SBOM, target-arch verification, and packaged smoke exist                   |
| G11 lifecycle       | concurrent prompt/refresh, cancellation/restart, process crash, Electron quit, and repeated open/close leave no orphan process or locked store |
| G12 migration       | neutral archive is count/byte verified, old sessions are read-only, new sessions use a separate root, and rollback loses neither               |

A focused package test, source build, ACP demo, or successful single prompt proves
none of these gates by itself.

## 10. Delivery slices

1. **Upstream protocol spike:** implement the smallest versioned list/resume/state/
   cancel/interaction extension against a pinned Harness branch and prove it with
   upstream conformance tests. Do not change Convax production dependencies.
2. **Convax contract fixture:** add a vendor-neutral `AgentRuntime` conformance suite
   and run the current OpenCode implementation against it first.
3. **Read-only DSH adapter:** status, list/create/resume/state, event projection, and
   model catalog with mock/replay LLM only.
4. **Prompt parity:** exact model routing, instructions, resources, Skills,
   questions, permissions, and cancellation.
5. **Tool/MCP parity:** authenticated Host bridge, progress/cancel, remote MCP OAuth,
   and atomic configuration generation.
6. **Packaging:** deterministic runtime staging and packaged smoke on the full matrix.
7. **Migration release:** neutral OpenCode archive and opt-in internal DSH runtime.
8. **Cutover release:** DSH default only after G1-G12; remove OpenCode in the later
   archive-accepted release.

Each slice must remain independently revertible. A feature flag may select the
runtime during internal validation, but production must have one authoritative
runtime per new session. Shadow evaluation uses deterministic replay/read-only tools;
it must not execute the same side-effecting prompt in both runtimes.

## 11. Repository impact when implementation is approved

The implementation changes architecture and must update together:

- root `AGENTS.md` package ownership and dependency rules;
- `packages/agent-runtime/AGENTS.md` and public vendor-neutral contract comments;
- `docs/architecture.md` package, canonical state, persistence, Agent, MCP, and
  Electron/package sections;
- `docs/plugin-skill-platform.md` and the Plugin SDK/API release process if Hooks
  change;
- Desktop Main configuration, runtime staging, provenance, packaged smoke, and
  runtime service presentation;
- package-boundary and architecture-test-coverage policy; and
- dependency/license/SBOM records.

This assessment intentionally does not edit those current contracts because no
runtime behavior or approved Plugin Host contract changed.

## 12. Falsifiers

Revisit this decision if a newer exact Harness release proves all of the following:

- a stable interactive SDK transport already exposes §7;
- a verified cross-platform runtime closure is published for TypeScript consumers;
- MCP OAuth and progress-aware inactivity are implemented;
- a supported generic Hook compatibility layer accepts the exact immutable v8 bytes;
  and
- session-format compatibility is promised across the versions Convax must ship.

Conversely, abandon the migration if satisfying the Hook, interaction, and packaging
gates requires a permanent private fork or duplicates more security/lifecycle code
than the OpenCode adapter it replaces.
