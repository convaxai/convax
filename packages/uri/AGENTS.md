# URI Package Contract

This file extends the repository-level `AGENTS.md` for `packages/uri`.

## Owns

- Pure `UriComponents` and `ConvaxUri` parsing, serialization, canonicalization,
  and comparison.
- Static, immutable Convax scheme grammar metadata.
- The frozen `convax-project` URI component grammar and explicit comparison modes.
- Stateless lexical validation for Project entry ids used inside a URI.

## Must not own

- URI resolution, filesystem or network I/O, authentication, authorization,
  current-Project state, caches, or a mutable scheme/handler registry.
- Project entry identity allocation or the canonical `ProjectFileId`,
  `ProjectDirectoryId`, and `ProjectEntryId` types; those belong to
  `@convax/project-files`.
- Node, Electron, React, browser storage, or imports from another `@convax/*`
  package.

## Validation

- Run `bun --cwd packages/uri typecheck` and `bun --cwd packages/uri test`.
- Run `bun --cwd packages/uri build` before publishing.
- Run repository boundary and pack checks when the package is admitted into the
  root package graph.
