# P2P collaboration v10 final Canvas G2 revision-4 architecture sign-off

Date: 2026-08-02

Reviewer identity: `/root/canvas_intent_runtime`

This is an independent red-team signature over one exact five-file authority set.
It approves neither later bytes nor an implementation that diverges from the pinned
artifacts. I did not edit the main specification or any of the four annexes while
performing this review.

## Decision

**SIGN REVISION 4.**

Score: **9.2 / 10**.

The prior P0 rejection is closed. Control now defines exactly one complete callable
contract for `verifyDocumentShardResetAuthorityV2`; Project imports that contract,
constructs fresh initial/final inputs and retains sole ownership of its private
witness, permit and no-gap reducer entry. I found no remaining second document
authority, undefined reset input, arrival-order winner, document-wide version path,
portable self-reference or unregistered digest domain in the exact bytes below.

## Exact signed identities

### Main, four annexes and global URI

| Authority | Independently recomputed whole-file SHA-256 | Result |
| --- | --- | --- |
| `docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md` | `5f6a69af82cf71e0f2a2aa609c75e2054e73f556ac72a2aa9154aaa8c1c2165f` | PASS |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md` | `4a1d7b2362349826ab7df488af7be4d66ed48f49df3aa39f07552235a2fcd530` | PASS |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-collaboration-kernel-appendix.md` | `fc40e646aae952b731450c4b60d2213219be130b4bd90115223afbb74f421691` | PASS |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md` | `1506c4834295d9d1dfeffc07c0dd2666661af74a659d9271b77b43e5214ecca4` | PASS |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md` | `6c29fefdf52b63f97199e44fb8f7328b85d98be9f15e884c1aff5727bc34d0b6` | PASS |
| `docs/superpowers/specs/2026-07-31-global-uri-protocol.md` | `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949` | PASS |

Every file ends in one final LF and has balanced Markdown fences. The main's exact
four-object restricted-JCS value is byte-equal to the current annex paths and hashes
and recomputes to:

```text
annex-set = 8c3eca5c411ef729d53899aa9dc7e83df7b1e650638c6f7e82178ebd55b2dc55
```

### Artifact spans and bundle

The kernel no-self-reference sentinel occurs exactly once. The kernel artifact
prefix remains exactly 50,828 bytes with ordinary SHA-256:

```text
1863419be46f0e0839a85245b70e6374e3e1df322a47df2b6c305c3b8af5678f
```

I independently recomputed
`SHA-256("convax.protocol-schema-artifact/2\0" || exact artifact bytes)`:

| Artifact | Exact domain-separated digest | Result |
| --- | --- | --- |
| `canvas-schema` | `8270e6fe017ceb27d324b6c71247c993f643edda13d2135987857a01c009944e` | PASS |
| `collaboration-kernel` prefix | `7702eb4ee348948c6f9633f4128cade52ea32c76c9501729db40d7dee00d8534` | PASS |
| `control-plane` | `e96148c5fdf5a24eb0d4b0d9c1c3e3dc314018319b3ec2d2f3828600c5d3efcf` | PASS |
| `project-persistence` | `cb417657f0c6818115cda43a59354111692e58aad22bf87a89e565a86e24a8db` | PASS |

The embedded four-ref manifest is restricted-JCS canonical and byte-equal to those
refs. `ProtocolLimitsV2` contains 66 named limits plus `format`; the channel contract
contains four policies. Their independently recomputed digests are:

```text
limitsDigest          = 2ac48434013d2669447511a16f9aa706612e97638718fa4c572374579bae19c0
channelContractDigest = 0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242
```

The embedded bundle core and wrapper both round-trip byte-for-byte through an
independent restricted canonical encoder. Artifact, limits, channel and URI
bindings all match. The wrapper repeats the core exactly and recomputes:

```text
ProtocolSchemaBundleV2.coreDigest = 6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4
protocolDigest                     = 6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4
```

The registry contains exactly 123 strictly raw-UTF-8-sorted, duplicate-free
domains. It contains all approved Canvas and Project/owner additions and contains
neither `convax.project-index-canonical-state/2` as a digest domain nor
`convax.canvas-canonicalizer/2`. The F13 call envelope, candidate/head helpers and
route facts add no domain; they are local nondigestible call values. The namespace
tuple and each import tuple are sorted and duplicate-free.

## R5 callable closure

### Exact public declaration

The Control declaration block is 4,310 bytes with detached audit SHA-256:

```text
0dc97526f5983c26f9c06871d0f35b13195c39db020307d91688a29ff62fa244
```

Two independent extraction paths emitted byte-identical declaration bytes. A
TypeScript compiler AST parser and an independent line/field parser then agreed on:

| Declaration surface | Exact result |
| --- | --- |
| exported callable declarations | 1 |
| `VerifyDocumentShardResetAuthorityInputV2` fields | 10 |
| dependency fields | 11 |
| candidate-binding fields | 11 |
| candidate facts | 5 |
| current-head facts | 4 |
| current-route facts | 11 |

The callable is exactly one exported, declared, synchronous, non-generic,
one-parameter function. Every interface field and every result-union field is
`readonly`; the input has no `format`, optional key or extension point. There is no
overload, callback, port, ambient lookup, phase/resume token, `Promise`, brand-based
alternate decoder or second verifier.

The ten input fields are exactly `claim`, `confirmation`, `approval`, `routeCas`,
`resetCommit`, `dependencies`, `candidateBinding`, `candidateFacts`,
`currentReplicaDocHead` and `currentRouteFacts`. The declaration uses the three
dedicated unbranded input-byte aliases, the six exact-JCS semantic aliases and the
single `DocumentShardResetAuthorityDependencyBytesV2` container. TypeScript
`Readonly<Uint8Array>` is not treated as runtime immutability: every byte field is
copied before decode and no caller alias survives an invocation.

The eleven current-route fields are exactly:

```text
currentProjectIndexStateVectorDigest
currentProjectIndexCanonicalStateDigest
projectIndexScope
predecessorActivationDigest
currentOldRouteActivationDigest
currentOldShardEpoch
currentNewRouteState
currentStagedGenesisState
currentStagedGenesisCheckpointDigest
currentStagedGenesisFullUpdateDigest
currentStagedGenesisStateVectorDigest
```

No duplicate `oldScope`/`newScope` fact is needed: exact route/claim bytes supply
them, while Project scope, Canvas id and current shard reconstruct and cross-check
the live route.

### F13 step preservation

The original thirteen-step first-failure algorithm and all failure codes remain
unchanged. The input-consumption matrix does not move semantic checks:

- Step 1 bounds and strictly decodes every field.
- Step 2 consumes only the five business objects: claim, confirmation, approval,
  route-CAS and reset-commit.
- `typedIntentExactJcs` first participates semantically in Step 12, after Step 1
  structural decoding; it is not a Step-2 identity input.
- Candidate, current-head and current-route facts first participate semantically in
  Step 12.
- Step 12 reconstructs candidate and current `replicaDoc` independently from raw
  update-v1 bytes, reproduces full update/state-vector/canonical-state bytes,
  recomputes all eleven binding fields, then derives the current route and proves
  exact predecessor, old live shard, new-route absence and staged-genesis inertness.
- Step 13 reads no new input and returns only the closed diagnostic result.

Every declared field has one consuming step and every step input is declared. A
caller-supplied digest mirror cannot replace either reconstructed Y.Doc.

### Project freshness and ownership

Control solely owns the callable, input/result declarations and thirteen-step
diagnostic algorithm. The sole implementation/public symbol is exported from
`@convax/project/collaboration-protocol`, the package that can legally combine the
Project schema with the collaboration kernel. Project does not duplicate the
declaration or F13 order.

The Project application-service module-private coordinator is the only caller whose
result may admit mutation. Project Node supplies persistence, Desktop supplies typed
composition/witness adapters, and API/attester use is diagnostic only. None can
receive or consume the private witness/permit.

Initial and final calls use different fresh top-level and nested objects. The final
call occurs after A3, copies and freshly decodes the Permit-owned five business and
eleven dependency byte values, freshly canonicalizes candidate binding, and freshly
rebuilds all five candidate, four head and eleven route facts while the writer lock
and witness remain held. A4 follows the second complete F13 result; reducer entry is
in the same synchronous frame. Reusing initial snapshots or decoded dependency
objects is explicitly forbidden. The verifier itself has no I/O, callback, lookup,
mutation or durable effect.

## Cross-owner architecture audit

1. **Authority precedence:** Main section 1 makes the five files indivisible,
   delegates closed owner schema to each annex and explicitly forbids the main from
   narrowing, extending or reinterpreting an annex. The main's R5 text is summary
   only and introduces no fallback decoder.
2. **Canonical state:** Kernel owns the only
   `OwnerCanonicalizerDescriptorV2`, descriptor digest and
   `convax.canonical-state/2` formula. Canvas and Project supply exact owner bytes;
   Control/attester select the bundled owner port and copy no owner root topology.
3. **Canvas invariants:** Canvas closes eleven roots, 28 domains, actual-write
   evidence, fourteen undoable intent families and deterministic nested Plugin
   creation-group scheduling. Business edges remain source-to-target relations,
   never containment parents. Endpoint deletion hides incident edges, deleting a
   Plugin source removes its complete creation group, and delete wins over a late
   generation result.
4. **Project/URI/blob:** Project closes nine roots, stable entry/file ids,
   independently governed Convax URIs, content hashes, ordinary-text conflict
   copies, deterministic binary current version, route tombstones and reset
   durability. Paths are locations, not identity. Blob transfer uses a separate
   bounded channel and ACKs only after length/hash verification and durable storage.
5. **Peer and offline model:** PeerJS is transport, never identity or ordering.
   Existing durable replicas edit offline; fresh replicas without a holder wait
   rather than fabricate state. Control/update/blob/awareness have separate queues,
   caps and cancellation.
6. **Undo and renderer:** Semantic session undo is reconstructed as typed intents;
   raw `Y.UndoManager` updates and cross-restart undo are excluded. React Flow is a
   transient projection. UI, Agent and Plugin use the same typed application
   services and cannot submit a whole document, raw update or document-wide version.
7. **Cutover:** Legacy document-wide revision/version and parallel JSON authorities
   are unsupported portable bytes. Explicit destructive reset preserves the stated
   user-confirmation boundary; no compatibility fallback silently revives them.
8. **No unresolved identity:** Main excludes itself from annex-set identity, kernel
   excludes the unique suffix after its sentinel, owner annexes use symbolic bundle
   identity, and this receipt is detached. Protocol dependency-pending states are
   bounded runtime outcomes, not unresolved schema placeholders.

No major architecture defect remains under these exact conditions. This conclusion
fails if an implementation weakens any owner boundary, reconstruction, freshness or
fail-closed rule above.

## Package-boundary gate

`bun run package:boundaries` stops at the permitted revision-3 hardcode/signoff
manifest mismatch:

```text
docs/superpowers/specs/2026-08-01-p2p-v10-authority.sha256:
exact frozen manifest entries/order changed
```

The manifest file itself contains the exact five revision-4 hashes signed here.
`scripts/package-boundary-check.ts` still hardcodes the prior revision-3 main,
annex-set, protocol and detached signoff hashes, so the runner stops before later
checks. No other package-boundary failure was observed. Updating that implementation
gate remains post-sign implementation work and is not silently treated as passing.

## Strongest three objections

1. **Double full-state reconstruction is expensive.** F13 applies and re-encodes
   candidate/current update, vector and canonical state twice while holding the
   Project writer lock. A maximum-size hostile-but-admitted reset can create latency
   and denial-of-service pressure. This is a hidden scaling assumption that must be
   measured before implementation acceptance.
2. **Writer-lock and witness adapters are a common-mode boundary.** The byte ABI
   closes Control inputs, but a defective adapter that publishes a replacement head
   through the asserted lease can defeat the freshness proof. This is a common-mode
   synchronization risk requiring race/model testing, not another verifier.
3. **Whole-Markdown artifacts have broad rotation cost.** A normative clarification
   changes owner artifacts, bundle identity, main pins and all review receipts. This
   is an ignored-alternative cost; a future generated semantic source span could
   reduce editorial coupling without weakening exact identity.

These objections account for the 0.8-point deduction. They are not fatal because
the reset is rare and explicitly bounded, every freshness edge is synchronous and
fail closed, and exact artifact rotation is expensive but deterministic rather than
ambiguous.

## Flaw types

No unresolved blocking flaw was found. Residual classes are **hidden scaling
assumption** for twice-reconstructed maximum inputs, **common-mode synchronization
risk** for the writer-lock/witness adapter, and **ignored alternative** for
whole-Markdown rather than generated semantic artifact identity. A future shortcut
that replaces raw reconstruction with caller digests, weakens A1..A4 or treats
diagnostic `verified` as a permit converts these disclosed risks into P0 defects.

## Falsifiable revoke conditions

This signature is revoked if any of the following occurs:

1. Any signed whole-file, annex-set, artifact, prefix, URI, limits, channel, core or
   protocol digest differs from the exact value above.
2. Two clean-room declaration generators do not emit the same exported callable,
   aliases, readonly result and exact 10/11/11/5/4/11 field structure.
3. A duplicate/unknown key, accessor, noncanonical JCS value, oversized input,
   mutable byte alias, overload, generic, callback, port, ambient lookup, phase,
   resume token or async result is admitted.
4. Step 2 consumes typed intent or current facts, any semantic current-fact check
   moves before Step 12, or initial/final calls use different F13 entry points.
5. A digest-only candidate mirror passes without reconstructing both update-v1
   documents and reproducing their update, vector and canonical bytes.
6. Final verification reuses the initial top-level object, decoded dependencies,
   candidate snapshot, current head or route facts instead of rebuilding them after
   A3 under the same writer lock and witness.
7. A replacement authority/document head can publish between a successful A4 and
   reducer entry, or a copied/replayed diagnostic result admits mutation.
8. Two delivery permutations of the same valid frame set produce different Canvas
   or Project canonical state, route, edge, containment, creation-group, generation
   or history projection.
9. Plugin-source deletion leaves a group result reachable, endpoint deletion leaves
   a business edge reachable, or a late generation result revives deleted content.
10. React Flow, renderer, Agent or Plugin can write Y.Doc directly or supply raw
    update, whole document or document-wide version as mutation authority.
11. PeerJS identity/order or service arrival order changes business projection, or
    blob transfer blocks control/update and can ACK before durable hash validation.
12. The ABI creates a new digest domain, changes the registry from 123, enters a
    frame/journal/store/IPC value or becomes a second persisted authority.
13. Unsupported legacy bytes are silently hydrated, overwritten or garbage-
    collected before explicit destructive confirmation.
14. Maximum admitted initial-plus-final verification misses the accepted synchronous
    reset budget; the architecture must then revisit caps/protocol rather than add a
    suffix verifier or cached authority result.

## Reviewer signature

Decision: **SIGN REVISION 4**

Score: **9.2 / 10**
