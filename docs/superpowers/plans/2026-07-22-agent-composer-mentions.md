# Agent Composer `@` References and `$` Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cursor-aware `@` Project/Canvas references and `$` Skill selection to the Convax Agent composer using inline structured capsules and the existing `AgentResource` boundary.

**Architecture:** Keep product composition and DOM interaction in `@convax/desktop` renderer. Model the draft and picker navigation with pure functions, build lazy Project/Canvas presentation trees from existing public clients, and submit only existing `AgentResource` values. Main continues to revalidate every resource and extends group-node snapshots with direct children.

**Tech Stack:** TypeScript, React 19, Bun test, Electron renderer IPC clients, Tailwind CSS 4, Lucide React, Convax `AgentResource`, Project Files, Canvas application contracts.

---

## File map

- Modify `packages/desktop/src/renderer/agent-composer-state.ts`: structured draft, query, popup, filtering, navigation, and request-generation primitives.
- Modify `packages/desktop/src/renderer/agent-composer-state.test.ts`: pure draft/query/popup tests.
- Create `packages/desktop/src/renderer/agent-composer-tree.ts`: Project and Canvas tree projections.
- Create `packages/desktop/src/renderer/agent-composer-tree.test.ts`: deterministic tree and keyboard-navigation tests.
- Create `packages/desktop/src/renderer/agent-composer-dom.ts`: resource codec, capsule presentation, DOM draft read/write, selection, query-range, insertion, replacement, and removal helpers.
- Create `packages/desktop/src/renderer/agent-composer-dom.test.ts`: pure codec and capsule-presentation tests.
- Create `packages/desktop/src/renderer/agent-composer-picker.tsx`: positioned reference tree and Skill listbox presentation.
- Create `packages/desktop/src/renderer/agent-composer-picker.test.tsx`: static semantic and Convax-theme markup tests.
- Modify `packages/desktop/src/renderer/agent-panel.tsx`: integrate triggers, structured draft, async inventories, popup state, keyboard behavior, drag/imperative insertion, and prompt submission.
- Modify `packages/desktop/src/renderer/agent-panel.test.tsx`: integration-source and public-rendering assertions for the composer contract.
- Modify `packages/desktop/src/main/agent-resource-preparation.ts`: include direct children in selected group snapshots.
- Modify `packages/desktop/src/main/agent-resource-preparation.test.ts`: group and ordinary-node snapshot validation.
- Modify `docs/superpowers/specs/2026-07-22-agent-composer-mentions-design.md` only if implementation reveals a genuine contract correction.

## Task 1: Shared query, suggestion, and stale-request state

**Files:**

- Modify: `packages/desktop/src/renderer/agent-composer-state.ts`
- Test: `packages/desktop/src/renderer/agent-composer-state.test.ts`

- [ ] **Step 1: Extend the existing state tests without cutting over the draft yet**

Keep the existing Skill-segment tests green and add imports/tests for dual-trigger
queries, popup movement, and stale requests. The structured draft cutover happens
atomically with its DOM and panel consumers in Task 5, so every intermediate commit
continues to typecheck:

```ts
import {
  AgentComposerRequestTracker,
  closeAgentComposerSuggestion,
  findAgentComposerQuery,
  moveAgentComposerSuggestion,
  openAgentComposerSuggestion,
  reconcileAgentComposerSuggestionOptions,
} from "./agent-composer-state"

test("recognizes only @ and $ queries at command boundaries", () => {
  expect(findAgentComposerQuery("@rea", 4)).toEqual({ end: 4, query: "rea", start: 0, trigger: "reference" })
  expect(findAgentComposerQuery("请用 $飞书", 6)).toEqual({ end: 6, query: "飞书", start: 3, trigger: "skill" })
  expect(findAgentComposerQuery("email@example.com", 17)).toBeUndefined()
  expect(findAgentComposerQuery("/review", 7)).toBeUndefined()
})

test("reconciles suggestion rows by stable id and wraps keyboard movement", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }]
  const opened = openAgentComposerSuggestion("reference", rows, { kind: "caret" })
  const moved = moveAgentComposerSuggestion(opened, 1)
  expect(moved.activeId).toBe("b")
  expect(moveAgentComposerSuggestion({ ...moved, activeId: "c" }, 1).activeId).toBe("a")
  expect(reconcileAgentComposerSuggestionOptions(moved, [{ id: "b" }]).activeId).toBe("b")
  expect(closeAgentComposerSuggestion()).toEqual({ open: false })
})

test("rejects stale inventory requests independently by key and scope", () => {
  const tracker = new AgentComposerRequestTracker()
  const firstRoot = tracker.begin("project-a", "project:")
  const canvas = tracker.begin("project-a", "canvas:one")
  const secondRoot = tracker.begin("project-a", "project:")
  expect(firstRoot()).toBeFalse()
  expect(secondRoot()).toBeTrue()
  expect(canvas()).toBeTrue()
  tracker.invalidate()
  expect(secondRoot()).toBeFalse()
  expect(canvas()).toBeFalse()
})
```

- [ ] **Step 2: Run the focused test and verify the expected failures**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-state.test.ts
```

Expected: FAIL because the new query, suggestion, and request-tracker exports do
not exist.

- [ ] **Step 3: Implement query and suggestion primitives alongside the current draft**

Keep `AgentComposerSegment`, `normalizeAgentComposerDraft`, `agentComposerText`,
`agentComposerSkills`, and the existing picker helpers unchanged in this task. Add:

```ts
export type AgentComposerQueryTrigger = "reference" | "skill"

export interface AgentComposerQuery {
  end: number
  query: string
  start: number
  trigger: AgentComposerQueryTrigger
}

export interface AgentComposerSuggestionOptionLike {
  id: string
}

export type AgentComposerSuggestionAnchor =
  | { kind: "caret" }
  | { kind: "token"; tokenId: string }

export type AgentComposerSuggestionState =
  | { open: false }
  | {
      activeId?: string
      anchor: AgentComposerSuggestionAnchor
      hoveredId?: string
      mode: "edit" | "query"
      open: true
      trigger: AgentComposerQueryTrigger
    }

export function findAgentComposerQuery(text: string, caret: number): AgentComposerQuery | undefined {
  if (!Number.isSafeInteger(caret) || caret < 0 || caret > text.length) return undefined
  const match = /(?:^|\s)([@$])([\p{L}\p{N}._-]*)$/u.exec(text.slice(0, caret))
  if (!match) return undefined
  const query = match[2] ?? ""
  return {
    end: caret,
    query,
    start: caret - query.length - 1,
    trigger: match[1] === "@" ? "reference" : "skill",
  }
}
```

Do not remove `findAgentSkillSlashQuery` yet because the existing panel still calls
it; Task 5 removes it in the same commit that updates the panel. Implement
`openAgentComposerSuggestion`, `moveAgentComposerSuggestion`,
`reconcileAgentComposerSuggestionOptions`, `setAgentComposerSuggestionHover`, and
`closeAgentComposerSuggestion` as immutable pure functions keyed by option id.
Implement `AgentComposerRequestTracker` with a per-`scope + key` generation map and
an `invalidate()` method that clears all generations.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the shared state change**

```sh
git add packages/desktop/src/renderer/agent-composer-state.ts packages/desktop/src/renderer/agent-composer-state.test.ts
git commit -m "feat(agent): add composer suggestion state"
```

## Task 2: Lazy Project and Canvas tree projection

**Files:**

- Create: `packages/desktop/src/renderer/agent-composer-tree.ts`
- Create: `packages/desktop/src/renderer/agent-composer-tree.test.ts`

- [ ] **Step 1: Write failing tree-projection tests**

Create fixtures for loaded directory listings, one Canvas with a nested group, and
one unloaded Canvas:

```ts
import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createGroupNode, createTextNode } from "@convax/canvas/core"
import {
  buildAgentCanvasReferenceTree,
  buildAgentProjectReferenceTree,
  filterAgentReferenceTree,
  moveAgentReferenceTreeActive,
} from "./agent-composer-tree"

describe("Agent composer reference trees", () => {
  test("projects only loaded directory descendants and preserves portable paths", () => {
    const rows = buildAgentProjectReferenceTree({
      expandedPaths: new Set(["Assets"]),
      listings: new Map([
        ["", [entry("Assets", "directory", "")]],
        ["Assets", [entry("Assets/cover.png", "file", "Assets")]],
      ]),
    })
    expect(rows.map(({ depth, id, resource }) => ({ depth, id, resource }))).toEqual([
      { depth: 0, id: "project:directory:Assets", resource: { kind: "directory", name: "Assets", path: "Assets" } },
      { depth: 1, id: "project:file:Assets/cover.png", resource: { kind: "file", name: "cover.png", path: "Assets/cover.png" } },
    ])
  })

  test("builds Canvas group hierarchy from parentId without changing active Canvas", () => {
    const group = createGroupNode({ height: 300, id: "group", label: "Story", position: { x: 0, y: 0 }, width: 400 })
    const child = { ...createTextNode({ id: "child", label: "Title", position: { x: 10, y: 10 } }), parentId: group.id }
    const document = createCanvasDocument({ id: "canvas-a", nodes: [group, child] })
    const rows = buildAgentCanvasReferenceTree({
      canvases: [{ createdAt: 1, id: "canvas-a", name: "A", updatedAt: 1 }],
      documents: new Map([["canvas-a", document]]),
      expandedIds: new Set(["canvas:canvas-a", "canvas-node:canvas-a:group"]),
    })
    expect(rows.map(({ depth, id }) => ({ depth, id }))).toEqual([
      { depth: 0, id: "canvas:canvas-a" },
      { depth: 1, id: "canvas-node:canvas-a:group" },
      { depth: 2, id: "canvas-node:canvas-a:child" },
    ])
  })

  test("search keeps loaded ancestors and keyboard movement uses visible rows", () => {
    const rows = projectRows()
    const filtered = filterAgentReferenceTree(rows, "cover")
    expect(filtered.map((row) => row.id)).toEqual(["project:directory:Assets", "project:file:Assets/cover.png"])
    expect(moveAgentReferenceTreeActive(filtered, filtered[0]!.id, "down")).toBe(filtered[1]!.id)
    expect(moveAgentReferenceTreeActive(filtered, filtered[1]!.id, "down")).toBe(filtered[0]!.id)
  })
})
```

Define the local `entry()` and `projectRows()` helpers in the test with complete
`ProjectEntry` fields.

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-tree.test.ts
```

Expected: FAIL because `agent-composer-tree.ts` does not exist.

- [ ] **Step 3: Implement focused tree projection functions**

Create the row contract and builders:

```ts
import type { AgentResource } from "@convax/agent-runtime"
import type { CanvasDocument } from "@convax/canvas"
import type { ProjectEntry } from "@convax/project-files"
import type { ProjectCanvas } from "@convax/project/canvas"
import { createAgentCanvasNodeResource } from "../agent-canvas-context"
import { canvasAgentResource } from "./agent-panel-state"

export type AgentReferenceTreeSection = "canvas" | "project"

export interface AgentReferenceTreeRow {
  active?: boolean
  depth: number
  description?: string
  expandable: boolean
  expanded: boolean
  id: string
  kind: "canvas" | "directory" | "file" | "group" | "node"
  label: string
  parentId?: string
  resource: AgentResource
  section: AgentReferenceTreeSection
}

export function buildAgentProjectReferenceTree(input: {
  expandedPaths: ReadonlySet<string>
  listings: ReadonlyMap<string, readonly ProjectEntry[]>
}): AgentReferenceTreeRow[] {
  const rows: AgentReferenceTreeRow[] = []
  const visit = (directoryPath: string, depth: number, parentId?: string) => {
    for (const entry of input.listings.get(directoryPath) ?? []) {
      const id = `project:${entry.kind}:${entry.path}`
      const expanded = entry.kind === "directory" && input.expandedPaths.has(entry.path)
      rows.push({
        depth,
        description: entry.path === entry.name ? undefined : entry.path,
        expandable: entry.kind === "directory",
        expanded,
        id,
        kind: entry.kind,
        label: entry.name,
        ...(parentId ? { parentId } : {}),
        resource: { kind: entry.kind, name: entry.name, path: entry.path },
        section: "project",
      })
      if (expanded) visit(entry.path, depth + 1, id)
    }
  }
  visit("", 0)
  return rows
}
```

Implement `buildAgentCanvasReferenceTree` by ordering catalog roots as received,
building `childrenByParentId` from public `CanvasNode.parentId`, and recursively
rendering loaded children. Unloaded Canvas roots remain expandable. Use Canvas/node
stable ids exactly as asserted in the test.

Implement `filterAgentReferenceTree` by matching lower-cased label, description,
and resource identity, then adding every loaded ancestor through `parentId`.
Implement `moveAgentReferenceTreeActive` for `up`, `down`, `parent`, and `child`
without modifying tree expansion.

- [ ] **Step 4: Run tree tests and Desktop typecheck**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-tree.test.ts
bun --cwd packages/desktop typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit the tree projection**

```sh
git add packages/desktop/src/renderer/agent-composer-tree.ts packages/desktop/src/renderer/agent-composer-tree.test.ts
git commit -m "feat(agent): build composer reference trees"
```

## Task 3: Contenteditable codec and atomic capsules

**Files:**

- Create: `packages/desktop/src/renderer/agent-composer-dom.ts`
- Create: `packages/desktop/src/renderer/agent-composer-dom.test.ts`

- [ ] **Step 1: Write failing pure codec and presentation tests**

Create:

```ts
import { describe, expect, test } from "bun:test"
import {
  agentComposerTokenPresentation,
  parseAgentComposerResource,
  serializeAgentComposerResource,
} from "./agent-composer-dom"

describe("Agent composer DOM resource codec", () => {
  test("round trips every AgentResource family through a versioned attribute", () => {
    const resources = [
      { kind: "file" as const, name: "Readme", path: "README.md" },
      { kind: "directory" as const, path: "src" },
      { kind: "resource" as const, name: "Canvas", uri: "convax://canvas/main" },
      { kind: "skill" as const, name: "review" },
    ]
    expect(resources.map((resource) => parseAgentComposerResource(serializeAgentComposerResource(resource)))).toEqual(resources)
  })

  test("rejects malformed or unsupported serialized resources", () => {
    expect(parseAgentComposerResource("not-json")).toBeNull()
    expect(parseAgentComposerResource(JSON.stringify({ resource: { kind: "file", path: "a" }, version: 2 }))).toBeNull()
  })

  test("uses distinct Convax capsule families and accessible labels", () => {
    expect(agentComposerTokenPresentation({ kind: "skill", name: "review" })).toMatchObject({
      editLabel: "Change Skill: review",
      family: "skill",
      prefix: "$",
      removeLabel: "Remove Skill: review",
    })
    expect(agentComposerTokenPresentation({ kind: "resource", name: "Main", uri: "convax://canvas/main" })).toMatchObject({
      family: "canvas",
      prefix: "@",
    })
  })
})
```

- [ ] **Step 2: Run the codec test and verify it fails**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-dom.test.ts
```

Expected: FAIL because the DOM helper module does not exist.

- [ ] **Step 3: Implement the pure codec and presentation contract**

Create the following constants and functions first:

```ts
import type { AgentResource } from "@convax/agent-runtime"
export const agentComposerResourceAttribute = "data-agent-composer-resource"
export const agentComposerTokenAttribute = "data-agent-composer-token"
export const agentComposerTokenActionAttribute = "data-agent-composer-token-action"

export function serializeAgentComposerResource(resource: AgentResource) {
  return JSON.stringify({ resource, version: 1 })
}

export function parseAgentComposerResource(value: string): AgentResource | null {
  try {
    const parsed = JSON.parse(value) as { resource?: AgentResource; version?: number }
    if (parsed.version !== 1 || !parsed.resource) return null
    const resource = parsed.resource
    if (resource.kind === "skill") return resource.name?.trim() ? { kind: "skill", name: resource.name.trim() } : null
    if (resource.kind === "resource") return resource.uri?.trim() ? { kind: "resource", name: resource.name, uri: resource.uri } : null
    if (resource.kind === "file" || resource.kind === "directory") {
      return resource.path?.trim() ? { kind: resource.kind, name: resource.name, path: resource.path } : null
    }
    return null
  } catch {
    return null
  }
}
```

Implement `agentComposerTokenPresentation` with `family`, `prefix`, `label`,
`title`, `editLabel`, and `removeLabel`, using `convax://canvas/` to distinguish
Canvas resources from Project paths.

- [ ] **Step 4: Implement the reusable atomic token factory**

Add `createAgentComposerToken(resource, disabled)` without changing the panel yet.
It creates a `contenteditable=false` span containing an edit button and close
button. Assign only existing Convax theme utility classes:

```ts
token.className = cn(
  "mx-0.5 inline-flex max-w-56 select-none items-center overflow-hidden rounded-md border align-baseline text-xs font-medium",
  family === "skill"
    ? "border-primary/25 bg-primary/12 text-primary"
    : family === "canvas"
      ? "border-primary/20 bg-accent text-accent-foreground"
      : "border-border bg-muted/70 text-foreground",
)
```

The edit button receives `data-agent-composer-token-action="edit"`; the close
button receives `"remove"`. This module does not register global listeners and
does not import Electron or React. Task 5 adds draft read/write and selection
helpers when it performs the structured-draft cutover with all consumers.

- [ ] **Step 5: Run codec tests and Desktop typecheck**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-dom.test.ts packages/desktop/src/renderer/agent-composer-state.test.ts
bun --cwd packages/desktop typecheck
```

Expected: PASS. The existing panel is unchanged and continues using its old
Skill-only DOM until Task 5.

- [ ] **Step 6: Commit the capsule factory**

```sh
git add packages/desktop/src/renderer/agent-composer-dom.ts packages/desktop/src/renderer/agent-composer-dom.test.ts
git commit -m "feat(agent): add composer capsule factory"
```

## Task 4: Convax-styled positioned picker surface

**Files:**

- Create: `packages/desktop/src/renderer/agent-composer-picker.tsx`
- Create: `packages/desktop/src/renderer/agent-composer-picker.test.tsx`

- [ ] **Step 1: Write failing semantic rendering tests**

Use `renderToStaticMarkup` to assert the two reference tabs, tree semantics, Skill
listbox semantics, active row, loading, error, and theme-token classes:

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentComposerPicker } from "./agent-composer-picker"

test("renders reference tabs and an accessible Convax tree", () => {
  const markup = renderToStaticMarkup(
    <AgentComposerPicker
      activeId="project:file:README.md"
      anchor={{ left: 40, top: 120 }}
      onActiveChange={() => undefined}
      onClose={() => undefined}
      onReferenceTabChange={() => undefined}
      onSelect={() => undefined}
      onToggle={() => undefined}
      options={[referenceRow()]}
      referenceTab="project"
      trigger="reference"
    />,
  )
  expect(markup).toContain('role="tablist"')
  expect(markup).toContain('role="tree"')
  expect(markup).toContain('role="treeitem"')
  expect(markup).toContain("Project")
  expect(markup).toContain("Canvas")
  expect(markup).toContain("bg-popover")
  expect(markup).toContain("border-border")
})

test("renders Skills as a listbox with dollar identities", () => {
  const markup = renderToStaticMarkup(
    <AgentComposerPicker
      activeId="skill:review"
      anchor={{ left: 40, top: 120 }}
      onActiveChange={() => undefined}
      onClose={() => undefined}
      onReferenceTabChange={() => undefined}
      onSelect={() => undefined}
      onToggle={() => undefined}
      options={[skillOption()]}
      referenceTab="project"
      trigger="skill"
    />,
  )
  expect(markup).toContain('role="listbox"')
  expect(markup).toContain('role="option"')
  expect(markup).toContain("$review")
})
```

- [ ] **Step 2: Run the picker test and verify it fails**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-picker.test.tsx
```

Expected: FAIL because the picker component does not exist.

- [ ] **Step 3: Implement the picker component**

Export these contracts:

```ts
export interface AgentComposerPickerAnchor {
  left: number
  top: number
}

export type AgentComposerPickerOption =
  | (AgentReferenceTreeRow & { optionType: "reference" })
  | {
      description?: string
      id: string
      label: string
      optionType: "skill"
      resource: Extract<AgentResource, { kind: "skill" }>
    }
```

Render one fixed, opaque popup with:

```tsx
<div
  className="fixed z-50 max-h-80 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
  data-agent-composer-picker
  style={{ left: props.anchor.left, top: props.anchor.top }}
>
```

Use `Folder`, `FileText`, `PanelsTopLeft`, `Layers3`, node-kind icons, `Sparkles`,
`ChevronRight`, `LoaderCircle`, and `RotateCcw` from Lucide. Pointer-down on popup
controls prevents editor focus loss. Pointer hover calls only `onHoverChange`; row
click calls `onSelect` directly.

Keep the component presentation-only: it receives current rows, loading keys,
errors, tab, anchor, and callbacks. It does not call `window.convax`.

- [ ] **Step 4: Run picker tests and typecheck**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-picker.test.tsx
bun --cwd packages/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the picker surface**

```sh
git add packages/desktop/src/renderer/agent-composer-picker.tsx packages/desktop/src/renderer/agent-composer-picker.test.tsx
git commit -m "feat(agent): add composer suggestion surface"
```

## Task 5: Integrate `$` Skills and structured submission

**Files:**

- Modify: `packages/desktop/src/renderer/agent-composer-state.ts`
- Modify: `packages/desktop/src/renderer/agent-composer-state.test.ts`
- Modify: `packages/desktop/src/renderer/agent-composer-dom.ts`
- Modify: `packages/desktop/src/renderer/agent-panel.tsx`
- Modify: `packages/desktop/src/renderer/agent-panel.test.tsx`

- [ ] **Step 1: Add failing structured-draft and panel-contract assertions**

Replace the old Skill-segment state tests with the structured-resource assertions:

```ts
test("keeps resources at their sentence position and projects prompt inputs", () => {
  const draft = {
    segments: [
      { text: "Compare ", type: "text" as const },
      { resource: { kind: "file" as const, name: "A", path: "a.md" }, type: "resource" as const },
      { text: " with ", type: "text" as const },
      { resource: { kind: "skill" as const, name: "review" }, type: "resource" as const },
    ],
  }
  expect(agentComposerText(draft)).toBe("Compare  with ")
  expect(agentComposerResources(draft)).toEqual([
    { kind: "file", name: "A", path: "a.md" },
    { kind: "skill", name: "review" },
  ])
})

test("keeps multiple Skills visible and lets submission deduplicate later", () => {
  const draft = normalizeAgentComposerDraft({
    segments: [
      { resource: { kind: "skill", name: "review" }, type: "resource" },
      { resource: { kind: "skill", name: "review" }, type: "resource" },
      { resource: { kind: "skill", name: "docs" }, type: "resource" },
    ],
  })
  expect(draft.segments).toHaveLength(3)
  expect(agentComposerResources(draft)).toHaveLength(3)
})
```

Add a test that reads the component source and verifies the old Slash state and
combined `+` label are gone while both trigger buttons and structured projection
are present:

```ts
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

test("uses dedicated @ and $ composer triggers and structured resources", () => {
  const source = readFileSync(fileURLToPath(new URL("./agent-panel.tsx", import.meta.url)), "utf8")
  expect(source).toContain('aria-label="Reference Project or Canvas content"')
  expect(source).toContain('aria-label="Use a Skill"')
  expect(source).toContain("agentComposerResources(submittedDraft)")
  expect(source).not.toContain("findAgentSkillSlashQuery")
  expect(source).not.toContain('aria-label="Add context or Skill"')
})
```

- [ ] **Step 2: Run the panel test and verify it fails**

Run:

```sh
bun test packages/desktop/src/renderer/agent-panel.test.tsx
```

Expected: FAIL because the draft still has a Skill-only segment and the old
combined picker and Slash command are still present.

- [ ] **Step 3: Cut the state and DOM helpers over to structured resources**

Replace the draft model in `agent-composer-state.ts`:

```ts
export type AgentComposerSegment =
  | { type: "text"; text: string }
  | { type: "resource"; resource: AgentResource }

export function agentComposerResources(draft: AgentComposerDraft) {
  return normalizeAgentComposerDraft(draft).segments.flatMap((segment) =>
    segment.type === "resource" ? [segment.resource] : [],
  )
}
```

Normalize resource names/paths/URIs without deduplicating. Remove
`AgentSkillSlashQuery`, `findAgentSkillSlashQuery`, and `agentComposerSkills` only
after their panel call sites are removed in this task.

Add the DOM draft and selection helpers to `agent-composer-dom.ts`:

```ts
export interface AgentComposerQueryRange {
  end: number
  node: Text
  start: number
  trigger: "reference" | "skill"
}

export function readAgentComposerDraft(root: HTMLElement): AgentComposerDraft
export function writeAgentComposerDraft(root: HTMLElement, draft: AgentComposerDraft): void
export function findAgentComposerQueryRange(root: HTMLElement): (AgentComposerQueryRange & { query: string }) | undefined
export function insertAgentComposerTrigger(root: HTMLElement, trigger: "@" | "$", bookmark?: Range): void
export function insertAgentComposerResources(root: HTMLElement, resources: readonly AgentResource[], range?: Range): void
export function replaceAgentComposerQuery(root: HTMLElement, query: AgentComposerQueryRange, resource: AgentResource): void
export function replaceAgentComposerToken(root: HTMLElement, token: HTMLElement, resource: AgentResource): void
export function removeAgentComposerToken(root: HTMLElement, token: HTMLElement): void
export function captureAgentComposerSelection(root: HTMLElement): Range | undefined
export function focusAgentComposerAtEnd(root: HTMLElement): void
```

Read resource attributes as resource segments, write them through
`createAgentComposerToken`, and use `findAgentComposerQuery` on only the current
text node before a collapsed caret.

- [ ] **Step 4: Replace attachments and Slash state with structured suggestion state**

Remove user `attachments` state and refs. Add:

```ts
const [suggestion, setSuggestion] = useState<AgentComposerSuggestionState>({ open: false })
const [suggestionQuery, setSuggestionQuery] = useState("")
const [referenceTab, setReferenceTab] = useState<"project" | "canvas">("project")
const [suggestionAnchor, setSuggestionAnchor] = useState<AgentComposerPickerAnchor>()
const composerQueryRangeRef = useRef<AgentComposerQueryRange>()
const editingTokenRef = useRef<HTMLElement>()
const composerSelectionRef = useRef<Range>()
```

Update submission:

```ts
const submittedDraft = composerDraftRef.current
const text = agentComposerText(submittedDraft).trim()
const submittedResources = mergeAgentResources(contextResources, agentComposerResources(submittedDraft))
if (!props.projectId || interactionDisabled || (!text && submittedResources.length === 0)) return
```

Optimistic clearing, failed-submission restore, send-button enablement, and
`AgentPanelHandle.addResources()` must operate on the structured draft. Locked
`contextResources` remain rendered by `ResourceChip`; remove callbacks must never
be offered for them. Delete the old inline Skill DOM helpers from
`agent-panel.tsx` and import the new focused helpers.

- [ ] **Step 5: Add `$` query and edit behavior**

`onInput`, caret navigation, and `selectionchange` call a shared
`updateComposerQuery()` that uses `findAgentComposerQueryRange`. When the trigger
is `$`, load capabilities and pass only Skill options to `AgentComposerPicker`.

Add delegated capsule handling:

```ts
const handleComposerClick = (event: React.MouseEvent<HTMLDivElement>) => {
  const action = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>(`[${agentComposerTokenActionAttribute}]`)
    : null
  const token = action?.closest<HTMLElement>(`[${agentComposerTokenAttribute}]`)
  if (!action || !token) {
    updateComposerQuery()
    return
  }
  event.preventDefault()
  if (action.getAttribute(agentComposerTokenActionAttribute) === "remove") {
    removeAgentComposerToken(event.currentTarget, token)
    closeComposerSuggestion()
    syncComposerDraft()
    return
  }
  const resource = parseAgentComposerResource(token.getAttribute(agentComposerResourceAttribute) ?? "")
  if (!resource) return
  editingTokenRef.current = token
  openComposerEditSuggestion(resource.kind === "skill" ? "skill" : "reference", resource, token)
}
```

Selecting a Skill replaces the active `$query` or edited capsule; otherwise it
inserts at the live selection. Multiple Skills remain allowed.

- [ ] **Step 6: Replace the footer `+` button with Convax-styled trigger buttons**

Use `AtSign` and `Sparkles` with pointer-down focus preservation:

```tsx
<Tooltip content="Reference Project or Canvas content">
  <Button
    aria-controls="agent-composer-reference-picker"
    aria-expanded={suggestion.open && suggestion.trigger === "reference"}
    aria-label="Reference Project or Canvas content"
    disabled={!props.projectId || interactionDisabled}
    onPointerDown={(event) => event.preventDefault()}
    onClick={() => insertComposerTrigger("@")}
    size="icon-sm"
    variant={suggestion.open && suggestion.trigger === "reference" ? "secondary" : "ghost"}
  >
    <AtSign />
  </Button>
</Tooltip>
<Tooltip content="Use a Skill">
  <Button
    aria-controls="agent-composer-skill-picker"
    aria-expanded={suggestion.open && suggestion.trigger === "skill"}
    aria-label="Use a Skill"
    disabled={!props.projectId || interactionDisabled}
    onPointerDown={(event) => event.preventDefault()}
    onClick={() => insertComposerTrigger("$")}
    size="icon-sm"
    variant={suggestion.open && suggestion.trigger === "skill" ? "secondary" : "ghost"}
  >
    <Sparkles />
  </Button>
</Tooltip>
```

Keep the Models control and all generation behavior unchanged.

- [ ] **Step 7: Add keyboard and dismissal behavior for Skills**

While a suggestion is open:

- ArrowUp/ArrowDown update stable active id and prevent default;
- Enter selects the current row and never sends when there is no row;
- Escape closes without deleting the literal query;
- IME composition returns before suggestion or send handling;
- outside pointer closes; popup and both trigger buttons remain inside
  `composerSurfaceRef`;
- token edit/remove is disabled when `interactionDisabled`.

Update `role=combobox`, `aria-autocomplete=list`, `aria-controls`, and
`aria-activedescendant` on the editable surface only while a picker is open.

- [ ] **Step 8: Run focused tests and Desktop typecheck**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-state.test.ts packages/desktop/src/renderer/agent-composer-dom.test.ts packages/desktop/src/renderer/agent-composer-picker.test.tsx packages/desktop/src/renderer/agent-panel.test.tsx
bun --cwd packages/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit structured Skill integration**

```sh
git add packages/desktop/src/renderer/agent-composer-state.ts packages/desktop/src/renderer/agent-composer-state.test.ts packages/desktop/src/renderer/agent-composer-dom.ts packages/desktop/src/renderer/agent-panel.tsx packages/desktop/src/renderer/agent-panel.test.tsx
git commit -m "feat(agent): add structured skill composer input"
```

## Task 6: Integrate lazy `@` Project and Canvas inventories

**Files:**

- Modify: `packages/desktop/src/renderer/agent-panel.tsx`
- Modify: `packages/desktop/src/renderer/agent-panel.test.tsx`
- Modify: `packages/desktop/src/renderer/agent-composer-state.test.ts`

- [ ] **Step 1: Add failing source and request-generation tests**

Extend the panel source-contract test:

```ts
expect(source).toContain("window.convax.projectFiles.listDirectory")
expect(source).toContain("window.convax.canvas.documents.load")
expect(source).toContain("buildAgentProjectReferenceTree")
expect(source).toContain("buildAgentCanvasReferenceTree")
expect(source).toContain("await props.beforePrompt?.()")
expect(source).toContain("requestTrackerRef.current.begin")
```

Extend the request tracker test to start requests for two directories, invalidate
only a repeated path, and invalidate all requests after a Project scope change.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```sh
bun test packages/desktop/src/renderer/agent-panel.test.tsx packages/desktop/src/renderer/agent-composer-state.test.ts
```

Expected: FAIL because lazy Canvas inventory and scoped branch loading are not yet
integrated.

- [ ] **Step 3: Add scoped inventory state**

Add maps and sets keyed by portable identities:

```ts
const [projectListings, setProjectListings] = useState<Map<string, readonly ProjectEntry[]>>(() => new Map())
const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(() => new Set())
const [loadedCanvasDocuments, setLoadedCanvasDocuments] = useState<Map<string, CanvasDocument>>(() => new Map())
const [expandedCanvasIds, setExpandedCanvasIds] = useState<Set<string>>(() => new Set())
const [inventoryLoadingKeys, setInventoryLoadingKeys] = useState<Set<string>>(() => new Set())
const [inventoryErrors, setInventoryErrors] = useState<Map<string, string>>(() => new Map())
const requestTrackerRef = useRef(new AgentComposerRequestTracker())
```

When `props.projectId` or `conversationScope` changes, invalidate the tracker,
clear all user draft/popup inventory state using the existing scope reset effect,
and keep host-provided context derived from current props.

- [ ] **Step 4: Implement lazy Project directory loading**

Use the exact Project id captured at request start:

```ts
const loadProjectDirectory = useCallback(async (path: string) => {
  const scopeId = props.projectId
  if (!scopeId) return
  const key = `project:${path}`
  const isLatest = requestTrackerRef.current.begin(scopeId, key)
  setLoadingKey(key, true)
  clearInventoryError(key)
  try {
    const listing = await window.convax.projectFiles.listDirectory({ path, projectId: scopeId })
    if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return
    setProjectListings((current) => new Map(current).set(path, listing.entries))
  } catch (cause) {
    if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) setInventoryError(key, errorMessage(cause))
  } finally {
    if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) setLoadingKey(key, false)
  }
}, [props.projectId])
```

Opening a reference query loads `""` when absent. Expanding a directory toggles
its portable path and loads it when absent or when retrying an errored branch.

- [ ] **Step 5: Implement lazy Canvas document loading**

For a Canvas root:

```ts
const loadCanvasDocument = useCallback(async (canvasId: string) => {
  const scopeId = props.projectId
  if (!scopeId || !props.canvases.some((canvas) => canvas.id === canvasId)) return
  const key = `canvas:${canvasId}`
  const isLatest = requestTrackerRef.current.begin(scopeId, key)
  setLoadingKey(key, true)
  clearInventoryError(key)
  try {
    if (canvasId === props.activeCanvas?.id) await props.beforePrompt?.()
    const snapshot = await window.convax.canvas.documents.load({ canvasId, scopeId })
    if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return
    if (!snapshot.document) throw new Error(`Canvas document was not found: ${canvasId}`)
    setLoadedCanvasDocuments((current) => new Map(current).set(canvasId, snapshot.document!))
  } catch (cause) {
    if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) setInventoryError(key, errorMessage(cause))
  } finally {
    if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) setLoadingKey(key, false)
  }
}, [props.activeCanvas?.id, props.beforePrompt, props.canvases, props.projectId])
```

Expanding an already loaded group only toggles its stable tree id. Expanding an
unloaded Canvas invokes this loader. It never changes Workbench active input.

- [ ] **Step 6: Derive visible options and finish `@` keyboard navigation**

Use `buildAgentProjectReferenceTree` or `buildAgentCanvasReferenceTree` according
to the active tab, then `filterAgentReferenceTree`. Feed the same visible list to
the picker and keyboard handler.

Implement:

- Tab/Shift+Tab to switch Project/Canvas tabs;
- ArrowRight to expand or move to the first child;
- ArrowLeft to collapse or move to the parent;
- ArrowUp/ArrowDown to wrap through visible selectable rows;
- Enter to insert the latest row by stable id;
- retry buttons to re-run the exact failed branch request.

Refresh popup coordinates after expansion, query changes, selection changes,
capturing scroll, and window resize. Clamp `left` and `top` to an 8px viewport inset
and place above the anchor when at least 240px is available.

- [ ] **Step 7: Route drag and imperative resources through capsules**

Replace `addResources` attachment behavior with:

```ts
const addResources = useCallback((resources: readonly AgentResource[]) => {
  if (!composerRef.current || resources.length === 0) return
  insertAgentComposerResources(composerRef.current, resources, composerSelectionRef.current)
  closeComposerSuggestion()
  syncComposerDraft()
}, [closeComposerSuggestion, syncComposerDraft])
```

Project-entry drag, Project-Canvas drag, internal resource drag, and
`AgentPanelHandle.addResources()` all call this function. Host `contextResources`
never pass through it.

- [ ] **Step 8: Run renderer tests, typecheck, and build**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-state.test.ts packages/desktop/src/renderer/agent-composer-tree.test.ts packages/desktop/src/renderer/agent-composer-dom.test.ts packages/desktop/src/renderer/agent-composer-picker.test.tsx packages/desktop/src/renderer/agent-panel.test.tsx packages/desktop/src/renderer/agent-panel-state.test.ts
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop build
```

Expected: all PASS and the Electron renderer bundle builds.

- [ ] **Step 9: Commit full reference integration**

```sh
git add packages/desktop/src/renderer/agent-panel.tsx packages/desktop/src/renderer/agent-panel.test.tsx packages/desktop/src/renderer/agent-composer-state.test.ts
git commit -m "feat(agent): add project and canvas references"
```

## Task 7: Prepare group resources with direct children

**Files:**

- Modify: `packages/desktop/src/main/agent-resource-preparation.ts`
- Modify: `packages/desktop/src/main/agent-resource-preparation.test.ts`

- [ ] **Step 1: Write failing group and ordinary-node snapshot tests**

Add a Canvas document containing one group, two direct children, one nested child,
and one unrelated node. Prepare the group URI and assert parsed resource content:

```ts
test("prepares a selected group with only its direct children", async () => {
  const prepared = await prepareAgentResources(
    manager,
    canvasSnapshots(documentWithNestedGroup()),
    "project-one",
    [{ kind: "resource", uri: "convax://canvas/canvas-1/node/group-1" }],
  )
  const content = JSON.parse((prepared[0] as Extract<AgentRuntimeResource, { kind: "resource" }>).content)
  expect(content.node.id).toBe("group-1")
  expect(content.children.map((node: { id: string }) => node.id)).toEqual(["child-a", "child-b"])
  expect(content.children.map((node: { id: string }) => node.id)).not.toContain("nested-child")
  expect(content.children.map((node: { id: string }) => node.id)).not.toContain("unrelated")
})

test("does not attach child collections to an ordinary node snapshot", async () => {
  const prepared = await prepareNode("child-a")
  const content = JSON.parse(prepared.content)
  expect(content).not.toHaveProperty("children")
})
```

- [ ] **Step 2: Run the preparation test and verify it fails**

Run:

```sh
bun test packages/desktop/src/main/agent-resource-preparation.test.ts
```

Expected: the group test FAILS because prepared node resources do not contain
`children`; existing tests remain green.

- [ ] **Step 3: Extend only the group-node resource projection**

In `prepareStructuredResource` derive direct children and the bounded related edge
set:

```ts
const children = node?.data.kind === "group"
  ? document.nodes.filter((candidate) => candidate.parentId === node.id)
  : undefined
const includedNodeIds = new Set([node?.id, ...(children ?? []).map((child) => child.id)].filter(Boolean))
const edges = node
  ? document.edges.filter((edge) => includedNodeIds.has(edge.source) || includedNodeIds.has(edge.target))
  : undefined
```

Add `children` to `content` only when it is defined. Preserve the existing Canvas
identity, revision, selected node, name resolution, canonical URI, MIME, and
ordinary-node behavior.

- [ ] **Step 4: Run main preparation and related Agent tests**

Run:

```sh
bun test packages/desktop/src/main/agent-resource-preparation.test.ts packages/desktop/src/main/open-project-ipc.test.ts packages/desktop/src/agent-canvas-context.test.ts
bun --cwd packages/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit group snapshot behavior**

```sh
git add packages/desktop/src/main/agent-resource-preparation.ts packages/desktop/src/main/agent-resource-preparation.test.ts
git commit -m "feat(agent): include group children in references"
```

## Task 8: Accessibility, failure recovery, and final verification

**Files:**

- Modify: `packages/desktop/src/renderer/agent-panel.test.tsx`
- Modify: `packages/desktop/src/renderer/agent-composer-state.test.ts`
- Modify: `packages/desktop/src/renderer/agent-composer-picker.test.tsx`
- Modify: `packages/desktop/src/renderer/agent-panel.tsx` only for failures exposed by these tests.

- [ ] **Step 1: Add explicit acceptance-regression assertions**

Add tests/assertions for:

```ts
expect(source).toContain('event.nativeEvent.isComposing')
expect(source).toContain('event.key === "Escape"')
expect(source).toContain('event.key === "Tab"')
expect(source).toContain('aria-autocomplete="list"')
expect(source).toContain("aria-activedescendant")
expect(source).toContain("captureAgentComposerSelection")
expect(source).toContain("replaceAgentComposerDraft(submittedDraft)")
expect(source).toContain("requestTrackerRef.current.invalidate()")
```

Extend the picker markup tests to assert `aria-selected`, `aria-expanded`,
`aria-level`, stable row ids, retry labels, and absence of `mpga-pc` CSS variables.
Extend state tests so empty visible options cause Enter to be consumed without
returning a resource and refreshed options fall back to the first stable id.

- [ ] **Step 2: Run focused renderer tests and fix only exposed contract gaps**

Run:

```sh
bun test packages/desktop/src/renderer/agent-composer-state.test.ts packages/desktop/src/renderer/agent-composer-tree.test.ts packages/desktop/src/renderer/agent-composer-dom.test.ts packages/desktop/src/renderer/agent-composer-picker.test.tsx packages/desktop/src/renderer/agent-panel.test.tsx
```

Expected: PASS after correcting any missing accessibility or recovery wiring.

- [ ] **Step 3: Run the complete Desktop package verification**

Run:

```sh
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
bun --cwd packages/desktop build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run repository boundary and full checks**

Run:

```sh
bun run package:boundaries
bun check
```

Expected: package boundaries, lint, all package typechecks/tests, pack smoke, and
Desktop open-project smoke exit 0.

- [ ] **Step 5: Inspect the final diff for accidental scope or generated files**

Run:

```sh
git status --short
git diff --check convax-next...HEAD
git diff --stat convax-next...HEAD
git log --oneline convax-next..HEAD
```

Expected: only the design/plan, focused Desktop renderer files, and bounded Main
resource-preparation files are changed; no root `.convax`, build output, or external
`mpga-pc` file is present.

- [ ] **Step 6: Commit final acceptance polish if the working tree changed**

When Step 2 produced a tracked correction, run:

```sh
git add packages/desktop/src/renderer/agent-panel.tsx packages/desktop/src/renderer/agent-panel.test.tsx packages/desktop/src/renderer/agent-composer-state.test.ts packages/desktop/src/renderer/agent-composer-picker.test.tsx
git commit -m "test(agent): cover composer mention interactions"
```

When Step 2 required no correction, keep the working tree clean and do not create
an empty commit.
