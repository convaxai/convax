# 遗留格式清理引导与架构测试覆盖矩阵 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复架构评估中发现的两个问题：(1) 遗留 unsupported 数据格式缺少用户清理引导，(2) 架构级集成测试证据不可见。

**Architecture:** 问题1 通过在架构文档中增加清理引导章节，并在重置恢复 UI 中展示归档位置信息来解决。问题2 通过创建架构测试覆盖矩阵文档和自动化验证脚本来解决。

**Tech Stack:** TypeScript, Bun test, React (happy-dom), Markdown

## Global Constraints

- 不修改现有包的公共 API、依赖方向或所有权
- 所有变更必须通过 `bun typecheck && bun test && bun run package:boundaries`
- 架构文档变更必须与代码保持同步
- 遵循 Convax AGENTS.md 的提交规范（conventional commits）

---

### Task 1: 遗留格式清理引导 — 架构文档章节

**Files:**
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: 现有 §5 持久化映射（`.convax/canvases/catalog.json` 和 `document.json` 的标记）、§6 的 reset flow 描述
- Produces: 新 §6.x 章节 "Legacy format archive and cleanup guidance"

- [ ] **Step 1: 在 architecture.md 的 §6 Core flows 末尾、「Project creation and opening」和「Project activation」之后、「Marketplace listing」之前，新增一个小节**

在 Project activation 小节之后（第 1098 行之后），新增：

```markdown
### Legacy format cleanup guidance

When a Project contains retired collaboration data (`.convax/protocol-v3/`,
`.convax/canvases/catalog.json`, or `.convax/canvases/<id>/document.json`), the
open guard reports `unsupported-project-data` and blocks activation. The user
sees a guided reset dialog that:

1. Lists every unsupported path found.
2. Explains that ordinary Project files (`Notes/`, `Generated/`, and root-level
   files) are preserved.
3. Requires explicit confirmation before archiving the legacy private data to
   `.convax-archive-<token-suffix>` and creating a fresh empty Canvas.

After a successful reset, the archive directory is inert: runtime open, mutation,
checkpoint, and GC paths ignore it. Only an explicit later user action may delete
it. The archive is the byte-exact copy of the prior `.convax` tree, not a
selective migration.

Desktop renders a post-reset success surface that includes the archive
directory name so the user can locate and optionally remove it through the
operating system. No runtime path removes the archive automatically.

A Project with unsupported data is never silently opened, migrated, or reset.
Checkpoint, GC, and ordinary open never delete or rewrite the legacy bytes.
This one-time confirmed reset is the only admitted cleanup path.
```

- [ ] **Step 2: 验证 architecture.md 格式正确**

Run: `bun run pack:check`（会验证 architecture.md 的 Mermaid 图未损坏）

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: add legacy format cleanup guidance to architecture contract"
```

---

### Task 2: 遗留格式清理引导 — 重置成功 UI 展示归档路径

**Files:**
- Modify: `packages/desktop/src/renderer/project-reset-recovery.tsx`

**Interfaces:**
- Consumes: `ProjectResetRecoveryState` 组件（现有）、`resetTokenSuffix`（从 plan token 派生）
- Produces: 更新后的成功状态 UI，包含归档目录名称

- [ ] **Step 1: 阅读当前成功状态 UI 代码**

Read `packages/desktop/src/renderer/project-reset-recovery.tsx` 中的成功状态渲染部分，确认是否有「重置成功」状态。

- [ ] **Step 2: 在重置成功状态中展示归档路径信息**

当前文件分析后，如果已有成功状态组件，在其文案中追加归档路径提示。修改位置取决于实际代码结构。预期修改模式：

在成功提示文案中追加：
- 中文: `旧 Convax 数据已归档至项目目录中的 "{archiveName}"，您可以稍后手动删除此目录。`
- 英文: `Legacy Convax data archived to "{archiveName}" in the Project directory. You may delete this directory manually later.`

具体的 `archiveName` 从 `resetTokenSuffix` 派生（格式为 `.convax-archive-<suffix>`）。

- [ ] **Step 3: 更新测试**

在 `packages/desktop/src/renderer/project-reset-recovery.test.tsx` 中添加测试，验证成功状态渲染包含归档路径信息。

- [ ] **Step 4: 运行测试**

```bash
bun --cwd packages/desktop test -- --testNamePattern="reset|recovery|archive"
```

预期：全部通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/project-reset-recovery.tsx
git add packages/desktop/src/renderer/project-reset-recovery.test.tsx
git commit -m "feat(desktop): show archive path in reset recovery success state"
```

---

### Task 3: 架构级测试覆盖矩阵 — 文档创建

**Files:**
- Create: `docs/architecture-test-coverage-matrix.md`

**Interfaces:**
- Consumes: `docs/architecture.md` 中的架构不变量（§2-§11）、探索发现的测试文件分布
- Produces: 架构测试覆盖矩阵文档，映射每个关键架构不变量到其测试证据

- [ ] **Step 1: 创建测试覆盖矩阵文档**

创建 `docs/architecture-test-coverage-matrix.md`，内容为 Markdown 表格，每行映射一个架构不变量到其对应的测试文件。

```markdown
# Architecture Test Coverage Matrix

Status: canonical. This document maps critical architecture invariants to their
test evidence. Keep it and `docs/architecture.md` (§ validation requirements)
in sync when invariants or test coverage change.

## 1. Collaboration Protocol

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| Single current protocol descriptor; no authority selector or dual-version dispatch | `packages/collaboration/src/kernel.test.ts` | Frame magic / wire format rejection |
| replicaDoc reconstructed from checkpoints + causal frames only | `packages/collaboration/src/kernel.test.ts` | Rebuild from durable objects |
| candidateDoc is isolated; failed candidate never mutates replica | `packages/collaboration/src/kernel.test.ts` | Candidate isolation guards |
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
| CanvasYDoc is sole Canvas authority | `packages/canvas/src/application/service.test.ts`, `packages/canvas/src/collaboration/reducer.ts` | Typed intents |
| React Flow projection is transient; no competing document store | `packages/canvas/src/application/service.test.ts` | Application commands |
| Plugin surface creation sends only ids through Renderer/Preload | `packages/canvas/src/application/resources.test.ts`, `packages/desktop/src/main/canvas-document-ipc.test.ts` | Plugin surface IPC |
| Group/Fold/Unfold/Ungroup use same bridge as Agent | `packages/canvas/src/collaboration/application-command-adapter.test.ts` | Group commands |

## 4. Persistence

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| .convax/collaboration/ object/outbox/journal/head durability barrier | `packages/project/src/node/collaboration/persistence-store.test.ts` | fsync ordering |
| Managed asset SHA-256 CAS admission | `packages/project/src/node/project-canvas/project-canvas-resource-preparation.test.ts` | Asset import |
| File publication before Canvas commit; retain on Canvas failure | `packages/project/src/node/project-canvas/project-canvas-document-service.ts` test | Partial success |
| Browser localStorage is non-authoritative display cache only | `packages/desktop/src/renderer/` tests | Cache rejection |
| Legacy format reset retains byte-exact archive | `packages/project/src/node/collaboration/portable-cutover.test.ts` | Archive renaming |

## 5. Security & Trust Boundaries

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| contextIsolation, disabled Node integration, sandboxing | CI workflow: `package-boundaries.yml` | IPC message structure validation |
| Native paths never cross Preload/Renderer | `packages/desktop/src/main/canvas-document-ipc.test.ts` | Message shape |
| Plugin iframe sandbox: `allow-scripts` only | `packages/desktop/src/main/` plugin tests | Sandbox attributes |
| Plugin-to-Plugin broker: no direct references, active-set-bound | `packages/desktop/src/main/plugin-capability-stdio-e2e.test.ts` | Broker isolation |

## 6. Generation & Tools

| Invariant | Test File | Coverage |
|-----------|-----------|----------|
| Generation is installed Tool Plugin, not built-in provider | `packages/desktop/src/main/` generation tests | Tool-only execution |
| inputKey is process-ephemeral, crypto-bound opaque ref | `packages/desktop/src/main/canvas-collaboration-session-owner.test.ts` | Key lifecycle |
| Pending-result mode: Canvas creates node, Plugin cannot choose id | `packages/canvas/src/application/service.test.ts` | Pending creation |
| Crash recovery: submitting/running without live execution marks failed | `packages/desktop/src/main/plugin-installation-crash-e2e.test.ts` | SIGKILL recovery |

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
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture-test-coverage-matrix.md
git commit -m "docs: add architecture test coverage matrix"
```

---

### Task 4: 架构级集成测试覆盖 — 自动化验证脚本

**Files:**
- Create: `scripts/architecture-test-coverage-check.ts`

**Interfaces:**
- Consumes: `docs/architecture-test-coverage-matrix.md`（解析 Markdown 表格）、`docs/architecture.md`（搜索关键术语）
- Produces: 退出码 0（通过）或 1（失败），带结构化输出

- [ ] **Step 1: 编写验证脚本**

```typescript
#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "..")

interface CoverageRow {
  invariant: string
  testFile: string
  coverage: string
}

/** Parse the architecture test coverage matrix markdown into structured rows. */
function parseCoverageMatrix(markdown: string): CoverageRow[] {
  const rows: CoverageRow[] = []
  const lines = markdown.split("\n")
  let inTable = false
  let headerSkipped = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("| Invariant |") || trimmed.startsWith("| **Invariant** |")) {
      inTable = true
      continue
    }
    if (!inTable) continue
    // Exit table on next section header or empty line after rows
    if (trimmed.startsWith("## ") || trimmed.startsWith("---")) {
      inTable = false
      continue
    }
    if (!trimmed.startsWith("|")) continue

    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean)
    if (cells.length < 3) continue
    const [invariant, testFile, coverage] = cells
    // Skip header row
    if (invariant === "Invariant" || invariant === "**Invariant**") continue
    rows.push({ invariant, testFile, coverage })
  }
  return rows
}

/** Check that a test file exists on disk. */
function verifyTestFile(testPath: string): { exists: boolean; resolvedPath: string } {
  const resolvedPath = join(repoRoot, testPath)
  return { exists: existsSync(resolvedPath), resolvedPath }
}

/** Check that key architecture terms exist in architecture.md. */
function verifyInvariantTerms(invariant: string, architectureMd: string): string[] {
  const warnings: string[] = []
  // Extract key terms (quoted text, backtick-wrapped names, or significant words)
  const terms = invariant.match(/`[^`]+`/g) ?? []
  for (const term of terms) {
    const unquoted = term.slice(1, -1)
    if (!architectureMd.includes(unquoted)) {
      warnings.push(`  ⚠ Term "${unquoted}" from invariant not found in architecture.md`)
    }
  }
  return warnings
}

async function main() {
  const matrixPath = join(repoRoot, "docs", "architecture-test-coverage-matrix.md")
  if (!existsSync(matrixPath)) {
    console.error("FAIL: architecture-test-coverage-matrix.md not found at", matrixPath)
    process.exit(1)
  }

  const matrixMd = readFileSync(matrixPath, "utf-8")
  const rows = parseCoverageMatrix(matrixMd)
  if (rows.length === 0) {
    console.error("FAIL: No coverage rows parsed from matrix document")
    process.exit(1)
  }

  const architectureMd = readFileSync(join(repoRoot, "docs", "architecture.md"), "utf-8")

  let failures = 0
  const warnings: string[] = []

  console.log(`Architecture Test Coverage Check\n${"─".repeat(40)}\nParsed ${rows.length} coverage rows.\n`)

  for (const row of rows) {
    const { exists, resolvedPath } = verifyTestFile(row.testFile)

    if (!exists) {
      console.error(`✗ ${row.testFile}`)
      console.error(`  Invariant: ${row.invariant.slice(0, 80)}...`)
      console.error(`  Path not found: ${resolvedPath}`)
      failures++
    } else {
      const termWarnings = verifyInvariantTerms(row.invariant, architectureMd)
      if (termWarnings.length > 0) {
        console.log(`⚠ ${row.testFile} — term mismatch`)
        warnings.push(...termWarnings)
      }
    }
  }

  for (const w of warnings) {
    console.warn(w)
  }

  if (failures > 0) {
    console.error(`\n${"─".repeat(40)}\nFAIL: ${failures} coverage row(s) have missing test files.`)
    process.exit(1)
  }

  console.log(`${"─".repeat(40)}\nPASS: All ${rows.length} coverage rows verified.`)

  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} term mismatch warning(s) — review manually.`)
  }
}

main()
```

- [ ] **Step 2: 将脚本注册到根 package.json 的 scripts 中**

在 `/Users/bytedance/self/convax/package.json` 的 `scripts` 中添加：

```json
"check:test-coverage": "bun scripts/architecture-test-coverage-check.ts"
```

- [ ] **Step 3: 运行脚本验证**

```bash
bun scripts/architecture-test-coverage-check.ts
```

预期：PASS（或在有警告时列出警告）

- [ ] **Step 4: 将 check:test-coverage 添加到根 package.json 的 `check` 脚本管道中（可选）**

如果希望纳入日常 CI，修改 `check` 脚本追加 `&& bun run check:test-coverage`。这一步需要确认再执行。

- [ ] **Step 5: Commit**

```bash
git add scripts/architecture-test-coverage-check.ts
git add package.json
git commit -m "feat: add architecture test coverage verification script"
```

---

### Task 5: 架构测试覆盖矩阵文档 — 链接到 AGENTS.md

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 现有 "Validation" 章节，路由表
- Produces: 更新后的验证章节，包含测试覆盖矩阵文档的引用

- [ ] **Step 1: 在 AGENTS.md 的验证要求中添加覆盖矩阵引用**

在 `AGENTS.md` 末尾的 Validation 部分：

```markdown
## Validation

- ...
- Architecture or test coverage changes: verify the test coverage matrix with
  `bun run check:test-coverage`.
```

同时在 "Route by module name" 表中，为 "Architecture coverage matrix" 添加一行：

```markdown
| Architecture coverage matrix, missing test evidence for invariant | [`docs/architecture-test-coverage-matrix.md`](docs/architecture-test-coverage-matrix.md), `scripts/architecture-test-coverage-check.ts` |
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: reference test coverage matrix in AGENTS.md validation"
```
