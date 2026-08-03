# Route B Canvas annex disposition ledger

Status: regenerated non-authoritative audit evidence for the inactive five-file
candidate. This ledger cannot fill a protocol field or substitute for the exact
authority artifacts.

- original untrusted audit input SHA-256:
  `76ef34483383707a3d646839f6eb4e375a946843a1987f6e20c293fcd96e06ca`
- superseded Canvas candidate SHA-256:
  `ff4c79315a002a4cdaa768beaa3aef1529064a8147d7572113997b73980980f0`
- frozen Kernel ABI SHA-256:
  `cd9dcd59724eeb77cb47f729446d442a72d56cd093caa1efe0a787758d95bffa`
  (96,450 bytes; 2,363 lines)
- repaired Canvas annex SHA-256:
  `2afb080ef3ba3aed259d1d7501b73552fe02a6e826d3a28cafc746caa314eb19`
  (156,514 bytes; 3,386 lines)

The superseded ledger's positive ABI-closure conclusions are void. This is a fresh
audit against the exact frozen Kernel artifact above, not an incremental amendment.

## Lifecycle D non-author rejection

The supplied 3/3 architecture decision is Lifecycle D. Canvas now admits exactly
this trace:

```text
latest replicaDoc
-> validate exact branded base
-> isolated candidateDoc apply and post validation
-> final replica-signed frame
-> immutable object
-> replication outbox
-> binary causal-frame journal
-> sole durable head
-> apply exact frame to replicaDoc
-> projection invalidation
```

For local semantic undo/redo, the cursor moves only after that final signed frame is
durable and applied. Missing facts discard the entire attempt; retry validates the
then-latest `replicaDoc`, re-peeks the cursor and creates a new branded base. Remote
ACK is replication status only. There is no second long-lived document, provisional
business-command journal, command replay, frame replacement or remote promotion
step.

| Lifecycle obligation | Canvas disposition | Falsifier |
| --- | --- | --- |
| sole local authority | `replicaDoc` only | renderer or another Y.Doc is a mutation/checkpoint base |
| isolated validation | one `candidateDoc` per attempt | candidate survives pending/rejection or replaces replica |
| local commit | final replica-signed frame before durable barrier | reconnect reruns intent, reallocates id or re-signs |
| undo base | exact latest branded validated base | history closure captures or later observes mutable document |
| history retry | discard root/base/resolver/permit/materialized bytes | retry reuses any pre-pending process value |
| cursor | advance after durable head and replica application | peek mutates or cursor advances on failed durability |
| replication | same durable frame bytes; ACK is metadata | peer ACK grants local authority or changes undo state |

## Exact owner ABI closure

Canvas imports the frozen Kernel declarations directly from `@convax/collaboration`
and specializes generic owner parameters only as `"canvas"`.

| Boundary | Exact disposition | Rejected alternative |
| --- | --- | --- |
| artifact entry | unbranded `SelectedDocumentOwnerArtifactDefinitionV2<"canvas">` | Canvas-stamped Kernel factory/runtime/port brand |
| loader | Kernel-owned `SelectedDocumentOwnerArtifactFactoryV2<"canvas">` admits the raw definition | structural runtime returned directly by Canvas |
| runtime | `DocumentOwnerRuntimeV2<"canvas">` with object-identical protocol port seam | Canvas-private runtime aggregate |
| protocol | raw `DocumentOwnerProtocolDefinitionV2<"canvas">`, loader-wrapped port | copied generic protocol interface |
| closure/history | raw definitions, loader-wrapped branded ports | owner-minted port brand or mutable-doc capture |
| process values | loader factory alone wraps validated state/apply result | cast, serialized token or cross-artifact value |
| history base | same `OwnerValidatedStateV2<"canvas">` identity for discovery/materialization | omitted base, later base or different object |
| dependencies | exact `OwnerIntentDependenciesV2<"canvas">` equality across discovery and consumption | bare/cross-owner dependency set, Plugin-only ledger or hidden owner fact |
| external facts | `OwnerExternalFactPortFactoryV2<"canvas">` receives only Canvas dependencies/resolver and returns `CreateOwnerExternalFactAttemptPortResultV2<"canvas">` | caller-selected owner, host-minted Canvas permit or I/O inside attempt port |
| fact-port admission | only `created` exposes a fresh `OwnerExternalFactPortV2<"canvas">`; every `rejected` code terminates first | rejected result reaches resolution/candidate mutation or constructs a ProjectIndex port |
| retry | fresh preloaded resolver and branded attempt port | retained resolver, permit, fact value or consumption set |

The Canvas artifact's runtime entry exports raw definitions only. The Kernel loader
alone wraps and registers runtime, protocol, closure, history, process-value and
external-fact brands. Exact import-to-Kernel declaration set difference is empty.

## External fact and cap closure

Canvas owns four fact kinds: `current-resources`, `retained-resources`,
`generation-begin` and `generation-recovery`. Resource proof arrays are strict
sorted and duplicate-free by complete restricted-JCS proof bytes, then partitioned
into deterministic greedy chunks within the imported Kernel limits. Each chunk has
`factDigest == request.sha256` and resolves all-or-nothing. Batching is attempt-local
and cannot widen the 512 KiB complete typed-intent cap.

Plugin validation uses the validation-artifact channel, never an inferred format:
`PluginRequirementV2` carries the complete imported Plugin artifact ref. Project or
Desktop returns only unbranded Canvas result values. Canvas validates exact
kind/request-hash/fact-digest equality and alone mints process-local permits.

## Selected-artifact Canvas genesis verifier closure

Canvas owns the exact `CVXCGP02` bytes, parser, validation result and one branded
process-local callable. Its private factory is bound to the loader-selected Canvas
artifact digest and the object identity of the exact
`DocumentOwnerRuntimeV2<"canvas">`; only `created` exposes the callable. Structural,
cross-artifact, disposed or restarted runtimes reject. This is a Canvas capability,
not a Kernel brand or a second owner runtime.

Project may capture only `CanvasGenesisProofCarrierVerifierV2` and its
`canvasArtifactDigest`. It cannot capture the generic Canvas runtime, construct the
factory or reproduce Canvas validation. Each invocation defensively copies the
exact bytes and returns one closed fresh immutable result:
`validated | pending | rejected`. Only `validated` contains
`ValidatedCanvasGenesisIdentityV2`; the other branches expose no partial identity.
The byte hash, callable artifact digest and privately bound runtime artifact digest
must agree. The callable is synchronous and performs no I/O, discovery, network or
persistence.

## Domain-registry closure

Canvas contributes exactly 29 strict UTF-8-sorted, duplicate-free digest domains.
`convax.canvas-derived-id/2` is included. The `CVXCGP02` carrier format and
`convax.canvas-canonicalizer/2` are not digest-domain contributions. Regeneration,
clean-consumer tests and duplicate/order negatives must prove that exact list.

## Shared-owner declaration disposition

| Former Canvas restatement | Final disposition | Owner |
| --- | --- | --- |
| primitive scalar aliases | exact `import type`, no local declaration | Kernel |
| `DocumentScopeV2` fields and digest formula | deleted; Canvas consumes verified scope/digest | Kernel |
| generic operation context shape | deleted; exact construction/dependency/validation contexts imported | Kernel |
| `PortableStampV2` fields and comparator | deleted; exact imported stamp/order consumed | Kernel |
| shared actual-write wrapper fields/domain | deleted; Canvas derives imported wrapper through exact protocol port | Kernel |
| `BeginAuthorizationEpochCoreV2` fields/domain | deleted; Canvas consumes opaque verified authorization-instance digest | Control |
| checkpoint core structure | deleted; Canvas consumes externally verified checkpoint material | Control |
| generic runtime/closure/history/fact declarations | deleted; only raw Canvas specialization remains | Kernel |

Direct Canvas declaration-name overlap with Kernel, Control and Project annexes is
zero. Cross-owner facts enter only through exact imports, opaque digests or the
Canvas-owned request/result codec.

## Final section disposition and coverage

| Final section | Disposition/source | Owner/seam | Falsifier |
| --- | --- | --- | --- |
| 1 | replace; package owner and D lifecycle boundary | Canvas / Kernel ports | Canvas owns persistence, PeerJS or second document |
| 2, 2.1 | replace; exact imports and non-self-referential artifact | Kernel/URI imports | local scalar/scope/domain copy or embedded self hash |
| 3 | replace; imported operation context and base-bound scope id | Kernel context | UI/Agent/Plugin selects identity/context |
| 4 | replace; URI seam plus batched public fact codec | Canvas codec / URI / host resolver | URI resolution, inferred Plugin format or host permit |
| 5-6 | retain with fresh proof; one root, eleven maps, closed records | Canvas | unknown root/field or Plugin down-write accepted |
| 7 | retain; deterministic containment and creation-group liveness | Canvas | business edge treated as containment or orphan survives |
| 8 | replace fact seam only; generation precedence unchanged | Canvas / Control result | late terminal revives delete or mixed output/proof pair |
| 9 | retain; bounded acyclic semantic history | Canvas | receipt/evidence hash cycle or physical-id history template |
| 10-12 | retain with exact imported validation context | Canvas / Kernel attempt port | generic save/version CAS or partial Plugin group commit |
| 13 | replace lifecycle wording; session semantic undo only | Canvas / Kernel coordinator | cursor before durable frame or remote frame enters stack |
| 14 | replace wrapper seam; Canvas evidence remains closed | Canvas / imported shared wrapper | copied shared DTO or hidden write omitted |
| 15 | retain; deterministic effective projection | Canvas | delivery order changes closed projection |
| 16 | retain; React Flow and gestures transient | Canvas | React Flow event writes Yjs or persists document |
| 17 | retain; Canvas equations plus imported outer caps | Canvas / Kernel caps | first over-limit mutates candidate |
| 18 | replace; adds loader/fact/base/cap, wrong-owner compile-negative, CGP callable and domain-29 conformance | Canvas tests | missing negative identity/retry/chunk/factory fixture |
| 19.1-19.4 | replace seams, retain Canvas canonical/digest/evidence ownership | Canvas / Kernel descriptor | external prose fills recipe or shared wrapper is copied |
| 19.5-19.6 | retain algorithms, replace base/fact inputs | Canvas / exact branded base | mutable doc capture or provisional write escapes failure |
| 19.7-19.8 | retain vectors, extend raw-definition/fact/domain-29 acceptance | Canvas generator/tests | generator emits a Kernel brand, dependencies diverge or domain set differs |
| 20.1 | replace entirely against frozen exact ABI | Kernel import / Canvas K-bound `"canvas"` specialization | guessed symbol, bare owner generic or private aggregate appears |
| 20.2 | replace history/fact trace | Kernel queue / Canvas history definition | base identity, dependency or consumption mismatch |
| 20.3 | replace falsifiers | Canvas conformance | wrong-owner port, rejected-result continuation, host permit or async attempt-port I/O |
| 20.4 | retain; Canvas genesis identity and opaque predecessor witness | Canvas / Project proof | Canvas decodes route intent or mutates Project |
| 21.1-21.3 | retain carrier grammar/index | Canvas / imported exact refs | gap, overlap, alias or inferred external shape |
| 21.4-21.6 | selected-artifact-bound exact-byte callable and predecessor-result boundary | Canvas callable captured by Project | generic runtime capture, structural verifier, partial identity or carrier authority |

## Mechanical audit record

| Check | Result |
| --- | --- |
| clean-consumer schema resolution | 40 imported `*V2` names; 0 missing, 0 unresolved references |
| Canvas imported `*V2` names missing from frozen Kernel declarations | 0 |
| Canvas referenced `*V2` names without local declaration or exact import | 0 |
| direct Canvas declaration overlap with Kernel/Control/Project | 0 |
| legacy three-document role identifiers in Canvas annex | 0 |
| guessed `CanvasReplicaOperationContextV2` or private Canvas runtime identifier | 0 |
| local `DocumentScopeV2`, `PortableStampV2` or Control-core field/domain declaration | 0 |
| wrong-owner external-fact port construction surface | 0 |
| wrong-owner TypeScript compile-negative | specified by section 18.22; implementation execution remains a gate |
| `CanvasGenesisProofCarrierVerifierV2` callable/factory declarations | 1 / 1 |
| Canvas digest-domain contribution | 29, UTF-8 sorted, unique |
| unresolved numeric section reference | 0 |
| Markdown backtick fences | 76, even |
| Markdown tilde fences | 48, even |
| trailing whitespace | 0 |
| final LF | present |

## Remaining implementation gates

The specification is still falsified if generated code does not independently prove
the raw-definition admission boundary, same-base object identity, fact
discovery/consumption equality, greedy batching caps, every arrival permutation,
and every durability/cursor crash point. This ledger records protocol closure only;
it is not evidence that those implementation and property tests already exist.
