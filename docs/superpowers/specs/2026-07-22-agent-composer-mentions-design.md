# Agent Composer `@` References and `$` Skills Design

## Status

Approved for implementation on 2026-07-22.

## Context

The Convax Agent composer currently has two separate ways to add non-text prompt
input:

- the `+` picker adds Project files, directories, Canvases, and Skills;
- a `/name` query inserts an inline Skill mention.

Project and Canvas resources selected through the picker are rendered above the
editable message as attachments. Skills are rendered inline, but their trigger,
selection, and visual behavior differ from other resources.

The `mpga-pc` composer provides a useful interaction reference: `@` selects local
resources, `$` selects Skills, both support manual typing and toolbar insertion,
and selected objects are represented by inline atomic capsules. Convax must not
copy the reference implementation's TipTap integration, local Skill discovery,
preload-part protocol, product data sources, or styling. This design adapts the
interaction to Convax's existing `contenteditable` composer, package ownership,
`AgentResource` contract, and theme.

## Goals

- Replace the combined `+` entry point with dedicated `@` reference and `$` Skill
  entry points.
- Make manual `@query` and `$query` input equivalent to clicking the toolbar
  entry points.
- Represent user-selected files, directories, Canvases, Canvas groups, Canvas
  nodes, and Skills as inline atomic capsules at the selection position.
- Provide lazy Project-file and Canvas-content trees without mirroring domain
  state or reading private Project metadata.
- Keep the existing Agent prompt boundary: composer state becomes text plus
  `AgentResource[]`, and Main remains responsible for preparing and validating
  resources.
- Preserve Convax's visual language and accessibility conventions.
- Preserve stale-request, Project-scope, and failure-recovery guarantees.

## Non-goals

- Do not add cloud assets, characters, products, or other `mpga-pc` data sources.
- Do not introduce TipTap or another editor framework into Desktop.
- Do not scan Project-local `.agents`, `.claude`, or `.opencode` directories.
- Do not change Skill installation, discovery, ownership, or execution.
- Do not persist composer drafts to Project or browser storage.
- Do not add a new package, dependency edge, service locator, or global store.
- Do not change Workbench selection or active-Canvas ownership.
- Do not expose native paths or private `.convax` JSON to the renderer.

## Ownership and package boundaries

### Desktop renderer owns composition and interaction

`@convax/desktop` renderer owns the feature because the composer combines four
existing public capabilities:

- `ProjectFilesClient` supplies Project-relative file and directory listings;
- `ProjectCanvasClient` supplies the Project's Canvas catalog;
- `CanvasDocumentClient` supplies read-only Canvas documents for tree expansion;
- `AgentClient` supplies discovered Skills and accepts prompt resources.

Desktop also owns the React surface, DOM selection, popup positioning, keyboard
interaction, and product-specific composition of these capabilities.

### Existing packages retain their domains

- `@convax/project-files` continues to own file contracts and safe scoped
  directory listing.
- `@convax/project/canvas` continues to own the Canvas catalog.
- `@convax/canvas` continues to own Canvas document structure. Desktop may build
  a read-only presentation tree from public `CanvasDocument` data but may not
  mutate the document or recreate Canvas commands.
- `@convax/agent-runtime` continues to own generic Skill discovery and the
  `AgentResource` prompt contract. It does not learn about composer UI or Convax
  Project policy.
- Workbench remains the only source of the active Canvas. The composer receives
  the active Canvas projection from Desktop composition and does not store or
  select an active Canvas itself.

No dependency-graph or public-package contract change is required.

## Adapted product semantics

The interaction is based on `mpga-pc`, but Convax semantics take precedence:

- Convax already supports multiple Skill resources in a prompt, so the composer
  may contain multiple distinct Skill capsules. Submission deduplicates them by
  the existing `agentResourceKey` identity.
- Skills come only from `AgentClient.listCapabilities()`; Project-local ambient
  Skill discovery remains forbidden.
- File and Canvas references are submitted as existing `AgentResource` values,
  not serialized text tokens.
- Host-provided `contextResources` are not inserted into the editable draft.
  They remain locked chips above the editor because they describe authoritative
  embedding context rather than user-authored references.
- User-selected and user-dropped resources become inline draft segments so the
  editable document is the single truth source for user-authored prompt context.

## Composer data model

Extend the renderer-owned draft model to include a resource segment:

```ts
type AgentComposerSegment =
  | { type: "text"; text: string }
  | { type: "resource"; resource: AgentResource }
```

Skills use `{ kind: "skill", name }` inside the resource segment instead of a
separate segment type. The current Skill-only representation is migrated in code
as an intentional internal cutover; there is no durable draft schema to migrate.

Normalization:

- drops empty text and invalid resource identities;
- coalesces adjacent text segments;
- preserves resource position relative to text;
- preserves duplicate capsules in the visible draft so editing is unsurprising;
- deduplicates resources only at submission through `mergeAgentResources`.

Derived values:

- visible prompt text is the concatenation of text segments, converting NBSP
  spacers to normal spaces;
- user resources are all resource segments in document order;
- the composer is non-empty when it has non-whitespace text or at least one valid
  user resource.

Failed submission recovery stores and restores the complete structured draft.
The separate user `attachments` state is removed. Locked `contextResources` stay
outside the draft and are merged first at submission.

## DOM representation

The existing `contenteditable` remains the editor host. Each resource segment is
rendered as a `contenteditable=false` atomic span with:

- a stable serialized `AgentResource` attribute using the existing versioned
  renderer serialization helper;
- a primary button that opens the corresponding picker in edit mode;
- a close button that removes only that capsule;
- a type icon and safe display label;
- accessible edit and remove labels.

DOM reads reconstruct text and resource segments. DOM writes recreate text nodes
and capsules from the normalized draft. No selection or submission logic relies
on React state left behind by a previous picker click.

Capsule families:

- Project files and directories: neutral low-emphasis reference styling;
- Canvas, groups, and nodes: accent-tinted reference styling;
- Skills: stronger primary styling with `$` and Sparkles semantics.

All colors, radii, shadows, and focus rings use existing Convax Tailwind/theme
tokens such as `background`, `popover`, `muted`, `accent`, `primary`, `border`,
and `ring`. No `mpga-pc` CSS variables or hard-coded light-theme colors are
introduced.

## Trigger and query behavior

### Trigger recognition

A query is active only immediately before a collapsed caret in one text node:

- `@query` opens the reference picker;
- `$query` opens the Skill picker;
- the trigger must begin at the start of the text node or after whitespace;
- the query accepts Unicode letters and numbers plus `.`, `_`, and `-`;
- whitespace, another trigger, an atomic capsule, or moving the caret outside the
  range ends the query;
- `/` no longer opens the Skill picker.

IME composition is ignored until composition finishes.

### Toolbar insertion

The composer footer replaces the combined `+` button with two icon buttons:

- AtSign button: "Reference Project or Canvas content";
- Sparkles button: "Use a Skill".

Pointer-down prevents the button from taking focus. If the current selection is
inside the composer, the trigger replaces that selection. Otherwise the composer
is focused and the trigger is appended at the end. The same query state machine
handles toolbar and manually typed triggers.

### Selection and editing

Choosing an option replaces the complete active trigger range with one capsule
and a trailing NBSP spacer, then places the caret after the spacer.

Clicking a capsule's primary action opens its picker in edit mode, anchored to the
capsule. Choosing another option replaces that exact DOM capsule in place. Clicking
close removes it atomically and restores focus beside the removed capsule.

Existing imperative and drag flows use the same insertion helper. A multi-resource
insert creates ordered capsules at the current composer selection, or at the end
when there is no valid selection.

## Popup state and positioning

Only one suggestion popup may be open. Its renderer-owned state contains:

- trigger kind: `reference` or `skill`;
- mode: `query` or `edit`;
- query text;
- anchor: live caret range or capsule element;
- keyboard-active stable option id;
- hovered option id;
- reference tab and tree expansion state;
- a Project-scope generation used to reject stale async results.

The popup is non-modal and keeps the editor as the keyboard focus host. It is
positioned from the caret range or capsule rectangle, prefers the space above the
anchor, and clamps to the Agent panel/composer viewport. Selection change, panel
scroll, window scroll, and resize schedule a position refresh.

The popup closes on:

- Escape;
- successful selection;
- clicking outside the composer, trigger buttons, capsules, and popup;
- moving the caret away from an active query;
- deleting the edited capsule;
- switching trigger types;
- interaction becoming disabled;
- Project or conversation scope change;
- component unmount.

Closing a query leaves its literal `@query` or `$query` text unchanged.

## Reference picker

The `@` picker has two tabs and opens on Project content by default.

### Project tab

- Roots are loaded with `ProjectFilesClient.listDirectory({ path: "" })`.
- Directories expand lazily through the same method with their Project-relative
  path.
- Files and directories are both selectable and become existing `file` or
  `directory` Agent resources.
- Search filters loaded rows and preserves loaded ancestors of matching rows. It
  does not recursively scan the whole Project.
- `.convax` remains excluded and protected by Project Files.

### Canvas tab

- Roots come from the already scoped `ProjectCanvasController` catalog passed to
  the Agent panel.
- Expanding a Canvas loads its document through `CanvasDocumentClient.load()`.
- Before loading the mounted active Canvas, Desktop flushes its editor using the
  existing `beforePrompt` barrier so candidates reflect the authoritative saved
  document without creating a second document state source.
- Each Canvas root, group, and node is selectable.
- `parentId` builds the group hierarchy; no hierarchy is inferred from position.
- Canvas roots use `canvasAgentResource`; groups and nodes use
  `createAgentCanvasNodeResource`.
- Node rows use the existing public `data.kind` and label for icons and display.

Selecting a group is one group-node resource, not a set of child capsules. During
Main resource preparation a group snapshot includes its direct children in
addition to the group node and relevant edges, so the read-only resource preserves
the user's selected granularity. This remains Desktop preparation behavior and
does not change Canvas mutation semantics.

### Tree keyboard behavior

- Tab and Shift+Tab switch reference tabs while keeping editor focus;
- ArrowDown and ArrowUp wrap through visible selectable rows;
- ArrowRight expands a branch or enters its first visible child;
- ArrowLeft collapses a branch or moves to its parent;
- Enter inserts the active row;
- pointer hover changes only hover styling; pointer click selects or expands.

The tree uses `role=tree` and rows use `role=treeitem` with level and expansion
metadata.

## Skill picker

The `$` picker loads from `AgentClient.listCapabilities()` and searches Skill name
and description case-insensitively. It does not combine Skill rows with Project or
Canvas rows.

Each row shows the Convax Skill icon, name, `$name`, and description. The existing
open-Skill action remains available as a secondary action; selecting the row inserts
or replaces a capsule.

The popup uses `role=listbox` and options use `role=option`. The composer exposes
the active option through `aria-activedescendant` while the popup is open.

## Submission and validation flow

```text
contenteditable DOM
  -> AgentComposerDraft(text + AgentResource segments)
  -> text projection + user resource projection
  -> merge locked context resources before user resources
  -> flush active Canvas when any Canvas context may be involved
  -> window.convax.agent.prompt
  -> Desktop Main prepareAgentResources
  -> validate Project-relative paths and Canvas/node identities
  -> @convax/agent-runtime prompt
```

The renderer never embeds native paths or Canvas JSON into the draft. Main reloads
and validates resources at the trust boundary. A deleted file, Canvas, group, or
node therefore fails closed even if it was still visible in a stale popup.

On successful prompt acceptance, the structured draft and popup are cleared. On
failure after optimistic clearing, the exact draft is restored if the active
composer is still empty; otherwise it is retained in the existing failed-submission
queue.

## Async loading and error handling

All Project-file, Canvas-document, and Skill requests capture the active Project id
and a monotonically increasing request generation. Results are committed only when
both still match. Project change and unmount invalidate every request.

Loading and errors are local to their section or branch:

- an unloaded directory or Canvas shows a bounded loading row;
- a failed branch remains expandable for retry and does not close the popup;
- a capability load failure leaves the Skill popup open with an error/retry state;
- refreshed options preserve keyboard active selection by stable id, falling back
  to the first visible option without auto-selecting it;
- empty Enter is consumed while a popup is open and never sends the message.

## Accessibility

- Trigger buttons are real buttons with tooltip, `aria-label`, `aria-expanded`,
  `aria-controls`, and visible focus treatment.
- The editable surface uses combobox metadata while a suggestion popup is open.
- The popup and rows use listbox/tree roles appropriate to their content.
- Capsules provide independent edit and remove buttons with object-specific labels.
- Keyboard interaction never depends on pointer hover.
- Motion and transitions respect existing reduced-motion conventions.

## Testing strategy

### Pure renderer state tests

- recognize `@` and `$` at valid Unicode command boundaries;
- reject URLs, mid-word triggers, `/` Skill syntax, invalid carets, and text across
  capsule boundaries;
- normalize structured drafts and derive text/resources in document order;
- filter references and Skills case-insensitively;
- reconcile popup options by stable id;
- wrap active movement and navigate parent/child tree rows;
- build Project and Canvas presentation trees deterministically;
- preserve multiple distinct Skills and deduplicate only at prompt projection.

### DOM interaction tests

- toolbar triggers preserve or restore the selection;
- query selection replaces only the trigger range;
- edit mode replaces the exact clicked capsule;
- close removes one atomic capsule and restores focus;
- Backspace/Delete treats a capsule as one unit;
- IME composition does not open or submit suggestions early;
- Enter selects an option and does not send while the popup is open;
- Escape and outside pointer behavior preserve literal query text;
- drag and imperative resource insertion use structured capsules;
- failed submission restores the complete draft.

### Async and scope tests

- stale file, Canvas, and Skill results from a previous Project are ignored;
- active-Canvas expansion flushes before document loading;
- inactive Canvas expansion loads without changing Workbench active input;
- branch load errors are retryable and isolated;
- a removed Canvas/node fails resource preparation at submission.

### Main preparation tests

- file/directory validation remains Project-relative and protected;
- Canvas and node URIs remain canonical and scoped;
- selecting a group prepares the group plus its direct children;
- ordinary node snapshots do not gain unrelated Canvas content.

### Verification

Run:

```sh
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
bun --cwd packages/desktop build
bun check
```

The full `bun check` is required because the change affects Desktop composition,
Agent resource preparation, and Canvas resource behavior even though no package
dependency boundary changes.

## Acceptance criteria

1. The composer footer shows dedicated `@` and `$` buttons using Convax styling;
   the Models control is unchanged.
2. Toolbar and manual trigger entry share the same query behavior at the current
   caret or selection.
3. `@` exposes lazy Project and Canvas trees containing files, directories,
   Canvases, groups, and nodes.
4. `$` exposes only Agent Runtime-discovered Skills, and `/` no longer triggers the
   Skill picker.
5. User-selected resources and Skills render as inline, removable, editable atomic
   capsules at their sentence position.
6. Host-locked embedded context remains outside the editable draft.
7. Keyboard navigation, mouse selection, popup dismissal, and focus restoration are
   complete and accessible.
8. Multiple Skill capsules are supported and submitted through existing Convax
   resource semantics.
9. Project changes and stale async results cannot populate the current picker.
10. Main revalidates all submitted resources; stale or deleted references fail
    closed without silently changing identity.
11. Group references remain one capsule and their prepared snapshot contains direct
    children.
12. Tests, typecheck, build, and repository checks pass.
