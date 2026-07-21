# Project Package Contract

This package owns the durable Project aggregate and native Project adapters.

## Entry-point boundaries

- Root/browser entry: Project lifecycle contracts/controller and injected Project UI.
- `@convax/project/canvas`: Project Canvas catalog, relationships, drag protocol,
  resource references, and catalog controller only.
- `@convax/project/node`: native registry, root resolution, private storage,
  Project Files implementation, Canvas repositories, migrations, and explicit
  unsupported-schema rejection.

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
- In-process queues and coordinators provide ordering only. Cross-file Project
  mutations such as file/directory moves, Canvas catalog create/delete and managed
  asset delete require a durable WAL, exact-identity/no-clobber recovery, and must
  resolve before editing or GC. GC must quarantine a candidate, revalidate its exact
  identity/digest there, and delete only within a fresh OS-private transaction through
  platform-specific parent-handle/no-follow primitives, never a previously validated
  blob path. A platform without the required no-replace/private-dir/anchored-delete
  guarantees is mark-only. Do not claim protection from hostile same-UID tampering of
  private `.convax` transaction state without a different-principal helper.
- Publishing user-visible `Notes/` or `Generated/` files requires a same-filesystem
  temporary file plus native atomic no-replace. Existing files, directories, symlinks,
  case-folded equivalents and concurrent winners are preserved; adapters without that
  primitive fail before publication. Generated publication has a durable transaction;
  recovery may delete only exact unpublished transaction staging and must retain every
  output that reached the user-visible namespace.
- `project.json` stores identity and the Canvas catalog stores no selection. Schema
  changes include versioned migration tests by default. An explicitly approved
  breaking cutover instead includes unsupported-version rejection tests and preserves
  the old bytes without opening, resetting, overwriting, deleting, or garbage-collecting
  them.

Run `bun typecheck && bun test`. Run root `bun run pack:check` for public/storage
changes and Desktop `bun run smoke:open-project` for creation, migration, or breaking
cutover changes.
