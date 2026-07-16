# Workbench Package Contract

Workbench is a DOM-free window coordination model, not a Project/Workspace aggregate.

## Owns

- One active serializable Input and its derived Surface.
- Input-scoped Selection and guarded open/close/reveal transitions.
- Generic layout-part size, visibility, collapse threshold, and resize transactions.
- Failure/cancel behavior that preserves the previous canonical state.

## Does not own

- Project/Canvas catalogs or documents, file trees, Agent sessions, native I/O, React,
  DOM events, Electron, CSS, concrete product pixels, or localStorage.
- Cross-domain create/delete/fallback workflows; Desktop coordinators compose those.

Workbench is the sole active Canvas/file source. Do not mirror active input into
Project Canvas state. A host may persist a recovery preference, but it injects that as
an initial choice and Workbench remains canonical.

For layout, this package owns begin/update/end/cancel and collapse/restore semantics.
Desktop owns pointer/keyboard wiring, viewport budgets, animation and persistence.

Run `bun typecheck && bun test`.
