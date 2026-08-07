# Architecture Test Coverage Matrix

Status: canonical. This document maps critical architecture invariants to their
test evidence. Keep it and `docs/architecture.md` (§ validation requirements)
in sync when invariants or test coverage change.

## 1. Collaboration Protocol

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| Single current protocol descriptor; no authority selector or dual-version dispatch | `packages/collaboration/src/kernel.test.ts` | Frame magic / wire format rejection |
| `replicaDoc` reconstructed from checkpoints + causal frames only | `packages/collaboration/src/kernel.test.ts` | Rebuild from durable objects |
| `candidateDoc` is isolated; failed candidate never mutates replica | `packages/collaboration/src/kernel.test.ts` | Candidate isolation guards |
| Offline/online use same final frame bytes; reconnect never replays | `packages/collaboration/src/kernel.test.ts` | Reconnect byte-identity |
| Checkpoint pruning requires content certificate + all-active-editor floor ACK | `packages/collaboration/src/kernel.test.ts` | Dual-gate pruning |
| Unsupported bytes return one `unsupported-project-data`; no second decoder | `packages/collaboration/src/kernel.test.ts`, `packages/project/src/node/collaboration/portable-cutover.test.ts` | Protocol rejection |
| Protocol digest mismatch fails closed before decode/sign/reset | `packages/collaboration/src/kernel.test.ts` | Descriptor validation |

## 2. Project Lifecycle

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| ProjectIndexYDoc sole Canvas route/tombstone/shardEpoch authority | `packages/project/src/collaboration/project-index.test.ts` | Route CRUD, tombstone |
| No JSON catalog/revision-counter parallel authority | `packages/project/src/node/collaboration/portable-cutover.test.ts` | Legacy format detection |
| Create Project uses trusted Documents/Convax parent | `packages/project/src/node/project-manager.test.ts` | Create flow |
| Open Project binds existing directory; picker only | `packages/project/src/node/project-manager.test.ts` | Open flow |
| Project directory browsing is transient read-only Canvas projection | `packages/desktop/src/collaboration/canvas-session-real.integration.test.ts` | Directory listing bounds |

## 3. Canvas State

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| CanvasYDoc is sole Canvas authority | `packages/canvas/src/application/service.test.ts` | Typed intents |
| React Flow projection is transient; no competing document store | `packages/canvas/src/application/service.test.ts` | Application commands |
| Plugin surface creation sends only ids through Renderer/Preload | `packages/canvas/src/application/resources.test.ts`, `packages/desktop/src/main/canvas-document-ipc.test.ts` | Plugin surface IPC |
| Group/Fold/Unfold/Ungroup use same bridge as Agent | `packages/canvas/src/collaboration/application-command-adapter.test.ts` | Group commands |

## 4. Persistence

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| `.convax/collaboration/` object/outbox/journal/head durability barrier | `packages/project/src/node/collaboration/persistence-store.test.ts` | fsync ordering |
| Managed asset SHA-256 CAS admission | `packages/project/src/node/project-canvas/project-canvas-resource-preparation.test.ts` | Asset import |
| File publication before Canvas commit; retain on Canvas failure | `packages/project/src/node/project-canvas/project-canvas-resource-preparation.test.ts` | Partial success |
| Browser localStorage is non-authoritative display cache only | `packages/desktop/src/renderer/project-reset-recovery.test.tsx` | Cache rejection |
| Legacy format reset retains byte-exact archive; published UI shows archive path | `packages/project/src/node/collaboration/portable-cutover.test.ts`, `packages/desktop/src/renderer/project-reset-recovery.test.tsx` | Archive renaming + success UI |

## 5. Security & Trust Boundaries

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| Native paths never cross Preload/Renderer | `packages/desktop/src/main/canvas-document-ipc.test.ts` | Message shape |
| Plugin iframe sandbox: `allow-scripts` only | CI workflow: `package-boundaries.yml` | Sandbox attributes |
| Plugin-to-Plugin broker: no direct references, active-set-bound | `packages/desktop/src/main/plugin-capability-stdio-e2e.test.ts` | Broker isolation |

## 6. Generation & Tools

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| Generation is installed Tool Plugin, not built-in provider | `packages/desktop/src/main/canvas-collaboration-session-owner.test.ts` | Tool-only execution |
| `inputKey` is process-ephemeral, crypto-bound opaque ref | `packages/desktop/src/main/canvas-collaboration-session-owner.test.ts` | Key lifecycle |
| Pending-result mode: Canvas creates node, Plugin cannot choose id | `packages/canvas/src/application/service.test.ts` | Pending creation |
| Crash recovery: `submitting`/`running` without live execution marks failed | `packages/desktop/src/main/plugin-installation-crash-e2e.test.ts` | SIGKILL recovery |

## 7. Test Level Distribution

| Level | Location | Count (approx.) | Framework |
|-------|----------|-----------------|-----------|
| Unit | `packages/*/src/**/*.test.ts` | 200+ | Bun test |
| Unit (React) | `packages/desktop/src/renderer/**/*.test.tsx` | 40+ | Bun test + happy-dom |
| Integration | `packages/desktop/src/**/*.integration.test.ts` | 1 | Bun test + tmp fs |
| E2E | `packages/desktop/src/**/*-e2e.test.ts` | 2 | Bun test + child_process |
| Smoke | `scripts/desktop-*-smoke.ts` | 5 | Bun test + CDP |
| Benchmark | `scripts/*-benchmark*.ts`, `*.bench.ts` | 5 | Bun test + perf |
| Boundary | `scripts/package-boundary-check.ts` | 1 | Bun script |

## 8. CI Gates

| Gate | Workflow | Trigger |
|------|----------|---------|
| Lint + Typecheck + `pack:check` | `package-boundaries.yml` | Push/PR |
| Sharded Desktop tests (Linux/Windows) | `package-boundaries.yml` | Push/PR |
| Packaged smoke (macOS/Windows/Linux) | `package-boundaries.yml` | Push/PR |
| `bun check` (full) | `npm-publish.yml` | Release |
| Plugins validation | `convax-plugins validate.yml` | Push/PR |

## Maintenance

When an architecture invariant in `docs/architecture.md` changes, update the
corresponding row in this matrix. When new test coverage is added, add a row.
When a test file is renamed or reorganized, update all affected rows.

Run `bun scripts/architecture-test-coverage-check.ts` to validate that every
referenced test file exists and the invariant descriptions match current sources.
