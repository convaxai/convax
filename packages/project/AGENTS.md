# Project Package Contract

This package owns the durable Project aggregate and native Project adapters.

## Entry-point boundaries

- Root/browser entry: Project lifecycle contracts/controller and injected Project UI.
- `@convax/project/canvas`: Project Canvas catalog, relationships, drag protocol,
  resource references, and catalog controller only.
- `@convax/project/node`: native registry, root resolution, private storage,
  Project Files implementation, Canvas repositories, migrations, managed assets,
  delayed GC, and explicit unsupported-schema rejection.

## Invariants

- `ProjectController` contains lifecycle/activation only; it does not absorb file
  CRUD, Canvas catalog state, Canvas documents, or Workbench navigation.
- `ProjectCanvasController` never owns `activeCanvasId`. Legacy active selection may
  be exposed only as a transient migration hint for a user-side Workbench preference.
- Canvas document schema/commands remain in `@convax/canvas`; Project implements its
  repository ports rather than editing documents through Project APIs.
- `ProjectSidebar` composes injected controllers and owns only Project-specific UI,
  including its internal Canvases/Files vertical split.
- Browser-safe entry points never import Node modules. Native I/O stays under
  `src/node/**` and performs real-path/containment validation.
- Browser creation requests carry only a Project name. The host injects a trusted
  parent directory; the Node adapter creates the child root, initializes identity,
  and publishes the registry binding without adopting an existing directory.
- Files inside the Project are referenced directly. Only files admitted from outside
  the Project are copied to deterministic content-addressed paths below
  `.convax/assets/blobs/`; duplicate bytes share one blob.
- Managed-asset admission, reference admission and GC use one Desktop-composed
  `ProjectManagedAssetStore` and its Project-scoped in-process asset mutex. GC derives
  liveness from typed Canvas references, waits
  through one seven-day grace period, atomically persists timing state before deleting
  due blobs, and fails safe when it cannot scan every document. `gc.json` is
  rebuildable timing state, not a catalog.
- Publishing user-visible `Notes/` or `Generated/` files is file-first and no-clobber.
  If the later Canvas commit fails, retain the file and report partial success. Do not
  add a cross-file WAL or delete a user file to simulate atomicity.
- Project file moves and renames do not rewrite Canvas references in v1. Missing
  references remain visible until the user relinks them.
- `project.json` stores identity and the Canvas catalog stores no selection. Schema
  changes include versioned migration tests by default. An explicitly approved
  breaking cutover instead includes unsupported-version rejection tests and preserves
  the old bytes without opening, resetting, overwriting, deleting, or garbage-collecting
  them.

Run `bun typecheck && bun test`. Run root `bun run pack:check` for public/storage
changes and Desktop `bun run smoke:open-project` for creation, migration, or breaking
cutover changes.
