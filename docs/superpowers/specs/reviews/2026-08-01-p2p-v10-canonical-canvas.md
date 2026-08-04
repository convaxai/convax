# P2P v10 canonical Canvas red-team review

Date: 2026-08-01

Reviewed exact file:
`docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md`

Declared SHA-256:
`0a45c13f5023890fe759da8fdf66557818580ebc4d3f6361d94b5fffb96abc77`

Independently computed SHA-256:
`0a45c13f5023890fe759da8fdf66557818580ebc4d3f6361d94b5fffb96abc77`

Digest verification passed before review. This review covers the complete 1,347-line
byte sequence. I also verified the incorporated URI and round-3 source digests:

- global URI: `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`;
- round-3 revision 4: `ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`.

## Exact-digest decision

**REJECT** exact digest
`0a45c13f5023890fe759da8fdf66557818580ebc4d3f6361d94b5fffb96abc77`.

The architecture direction is mostly coherent, but the file declares itself the
sole semantic source while omitting enough closed wire/Yjs schema to permit mutually
incompatible implementations. It also drops two signed round-3 requirements and
moves React Flow/editor ownership without a reviewed ownership decision.

Score: **6.6/10**. The deduction is not for the disclosed P2P complexity alone. A
canonical distributed protocol that cannot determine unique bytes, reset recovery,
or bounded registry admission is below the implementation gate regardless of how
strong its high-level invariants are.

## Review method and precedence audit

I read the canonical file completely and checked it against:

- the complete global URI specification and its exact digest;
- the round-1 unanimous direction and all three round-2 frozen-choice sets;
- the complete round-3 revision-4 candidate and both exact-digest signatures;
- root `AGENTS.md`, `docs/architecture.md`, and the affected URI, collaboration,
  Project, Project Files, Canvas, Plugin API/SDK, Agent Runtime, Workbench, Desktop,
  and API local contracts;
- the detailed Canvas schema draft where the canonical file claims to replace older
  draft detail rather than retain it as normative text.

The round-2 `replicaDoc` replacement is intentional, not accidental drift. Current
`certifiedTeamDoc/workingDoc/localForkJournal` architecture prose must change only
after a canonical digest is approved, as section 23 already requires. I therefore do
not reject this digest merely because the live v9 contract still describes that old
runtime.

## Requested-scope coverage matrix

| Surface | Result | Evidence-based conclusion |
| --- | --- | --- |
| Global URI governance | **PASS** | The exact URI digest is named; five-component grammar, closed schemes, ProjectFileId/path/blob separation, comparison modes, atomic Yjs reference and reset override are preserved. |
| First-round unanimous direction | **PASS** | Final offline-signed frame, peerId non-identity, exact-base validation, authorization cutoff, active-writer floor, separate blob ACK, v2 reset, semantic Undo and no-holder wait are all present. |
| Round-3 revision 4 | **FAIL** | Dual checkpoint gate, no-docEpoch direction, closed cutoff target/full pages and generation semantics survive, but shard-reset state/claim and registry quotas/failure states are missing. |
| Canvas/ProjectIndex Yjs schema | **FAIL** | Root names and projection prose exist, but exact record/value/guard/body/history codecs and several value/write caps do not. |
| React Flow transient state | **PARTIAL** | Transient behavior is correct; package ownership is moved from Canvas to Desktop without an accepted decision. |
| Undo/redo | **PASS** | Session coordinator selects durable local roots; inverse/forward are new semantic intents; raw UndoManager updates never become authority; restart clears stacks. |
| ProjectIndex/per-Canvas sharding | **PARTIAL** | ProjectIndex remains sole route authority and staged create/activate is present; the signed shard-reset recovery state machine is absent. |
| PeerJS/offline reconnect/blob channel | **PASS with schema blocker** | Identity, transcript, four-channel isolation, reconnect without replay, fresh-device wait and separate structure/blob durability are correct; exact DTO omission still affects interoperability. |
| Plugin schema/creation group/invariants | **PASS with schema blocker** | Exact Plugin artifact tuple, pending/read-only behavior, source-delete whole-group invalidation, delete-wins and generation projection are retained; closed intent and record layouts are not frozen. |
| Breaking Project reset | **PASS** | Explicit two-step reset, old-byte preservation before confirmation, stable projectId, new projectEpoch, atomic tree publication and ordinary-file preservation are present. |
| Legacy version/admission removal | **PASS** | Document-wide version/save/CAS UI, central per-edit admission/MMR and legacy JSON authority are explicitly deleted without fallback. |
| Tests and ownership gates | **PARTIAL** | Golden/property/crash/security/package suites are strong, but tests cannot recover a schema that the normative file never defines, and one ownership row conflicts with the current owner. |

## Blocking finding C1 — the “closed v2 protocol” has no closed schema

Severity: **P0**. Flaw type: **fact/protocol omission** and **hidden implementation
assumption**.

Sections 1 and 5 say this file is the sole semantic source and that collaboration v2
is a closed major. However:

- section 5 lists format tokens and defines the outer binary envelope, but does not
  define the exact JCS header/DTO fields for causal edit core/frame, checkpoint,
  content certificate, stable set, floor ACK, prunable certificate, durable ACK,
  membership/session/handshake, transfer manifest, or cutoff page;
- section 10 lists ProjectIndex root maps but not the exact closed entry, location,
  tombstone, content-family, promotion, reservation, route and operation value
  schemas;
- section 11 lists Canvas root maps but not the exact node, edge, metadata register,
  containment value, generation begin/terminal/dismissal/recovery, semantic-history,
  operation-receipt, data envelope or Plugin envelope schemas;
- section 12 lists intent names but not their exact closed guard/body unions,
  resource-proof modes, identity/write ordinal rules, command-to-intent mapping, or
  semantic-history operation union;
- the hard-cap table omits the detailed Canvas value and logical-write caps, including
  node data, Plugin state, prompt/public-message and logical changed-path limits.

The older Canvas draft contains examples of these definitions, but section 1 makes
older drafts non-normative and the old tokens are `/1`. An implementer cannot infer a
v2 schema from that file without making a new semantic decision. Two conforming teams
can choose different Y.Map nesting, optional keys, intent guards and header fields,
then produce different state vectors, canonical hashes, signatures and write evidence.

### Minimum semantic patch

Freeze one exact, reviewed `ProtocolSchemaBundleV2` as part of the canonical digest.
It may be an appendix or a separately hashed normative artifact, but it MUST define:

1. every portable DTO and binary-envelope header by closed field/type/optionality;
2. exact ProjectIndex and Canvas root/record/value schemas and allowed Yjs shared-type
   topology;
3. the complete typed-intent guard/body and semantic-history operation unions;
4. resource-admission versus retained-history proof unions and exact write paths;
5. per-value/depth/count/write-set caps and operation-derived ordinal allocation;
6. the unique command-to-intent mapping and forbidden aliases.

Generated TypeScript/validators may derive from that bundle; prose or legacy `/1`
drafts may not be the missing decoder. The canonical file and bundle must be reviewed
as one digest set.

### Falsifiable test

Give the canonical artifacts, but no repository source or old drafts, to two
independent implementations. They must generate byte-identical schemas, accept/reject
the same hostile values, and produce identical causal-frame, ProjectIndex and Canvas
hashes for every intent. Any field-shape question that requires asking the author
falsifies closure.

## Blocking finding C2 — signed shard-reset semantics were compressed away

Severity: **P0**. Flaw type: **normative merge drift** and **lifecycle omission**.

Round-3 revision 4 retained the R3-2 state machine and exact
`DocumentShardResetClaimV2`: old/new scope, closed reason, schema/protocol digests,
staged genesis, ProjectIndex operation, actor/admin identity, confirmation receipt and
64 KiB cap. It also froze:

```text
shard-reset-staged
shard-reset-awaiting-route-cas
shard-reset-recovery-required
unsupported-old-shard
project-reset-required
```

Before route CAS the old shard is sole live route; after CAS the new shard is sole
live route; recovery resumes the same claim; only pre-CAS staging may be abandoned.

Canonical sections 10.2 and 16 retain no-docEpoch and Project-owned shardEpoch, but
reduce reset to a staged route sentence. `DocumentShardResetClaimV2`, its cap,
failure states, same-claim recovery and pre-CAS-only abandonment are absent. Section
19 specifies whole-Project reset, which cannot substitute a per-Canvas shard reset.

### Minimum semantic patch

Restore the exact revision-4 claim ownership, fields, 64 KiB cap, closed reset reasons,
five failure states, before/after-CAS route authority and same-claim crash recovery.
State explicitly that actor sequence exhaustion rotates actorId and ordinary forks
quarantine/revoke; only incompatible schema, document-wide Lamport exhaustion, or
corruption/equivocation unrecoverable from every trusted checkpoint may reset a
Canvas shard.

### Falsifiable test

Crash before staged genesis, before route CAS, and after CAS. Reopen must expose
exactly one live shard, preserve old bytes, resume the same claim after CAS, and allow
abandonment only before CAS. A retry with a newly invented claim after CAS must fail.

## Blocking finding C3 — revision-4 registry admission bounds were dropped

Severity: **P1**. Flaw type: **boundedness drift** and **threat-model regression**.

The canonical hard-cap table keeps only `4096 / 64 MiB`, and section 16 says
abandonment releases an outstanding slot without defining that slot's bound. Signed
revision 4 requires all of:

```text
claim JCS <= 64 KiB
outstanding candidates <= 4 per active replica
retained entries <= 1,024 per member
retained entries <= 4,096 per Project
all retained claim payload <= 64 MiB
```

Every retained revision counts; promotion or abandonment releases only the
outstanding slot. The canonical failure contract also omits `scope-capacity-exceeded`,
`scope-reset-claim-required`, `registry-rollback-quarantine`, and the rule that
capacity cannot block seeded-peer sync outside service discovery. Without the
per-replica/member limits, one authorized editor can consume the whole Project quota,
which is strictly weaker than the signed threat-model bound.

### Minimum semantic patch

Restore the exact revision-4 quotas, accounting and failure states. Define checks
before claim allocation/signature-side effects, preserve retained audit bytes, and
keep capacity failure scoped to service discovery rather than ProjectIndex route or
seeded P2P validity.

### Falsifiable test

The fifth outstanding candidate from one active replica and member entry 1,025 must
fail before allocation while another member can still register. Abandonment must
free the outstanding slot without reducing retained-entry/byte accounting.

## Blocking finding C4 — React Flow/editor ownership moved without consensus

Severity: **P1**. Flaw type: **package-ownership drift**.

Section 3 says `@convax/canvas` MUST NOT own React Flow and assigns “React Flow
projection wiring” to Desktop; section 23 repeats “Desktop React Flow.” That is not a
mere restatement of transient-state rules. The current package contract assigns
Canvas the editor, host-neutral view layer, React rendering and React Flow gesture
semantics; Desktop owns Electron/React shell composition and host adapters. The
canonical architecture likewise assigns Canvas its editor and view commands.

No round-1, round-2 or round-3 consensus authorizes moving the rendering adapter and
view-command semantics into Desktop. Doing so encourages Desktop-local gesture,
projection and stale-incarnation logic, contradicting the rule that reusable Canvas
semantics remain in the owner package.

### Minimum semantic patch

Keep `@convax/canvas` as owner of the host-neutral editor/view contracts, React Flow
projection adapter and transient gesture-to-intent semantics. Desktop owns renderer
shell composition, IPC, safe-viewport/window adapters and product presentation only.
If the intended design is instead to move React Flow into Desktop, that must be an
explicit package-boundary proposal updating `docs/architecture.md`, both local
contracts, the dependency policy and tests; it cannot enter through canonical
normalization.

### Falsifiable test

An import/ownership scan must show that drag/resize incarnation resolution,
gesture-end intent materialization and Canvas view-command rules have one Canvas-owned
implementation. If Desktop can produce a different gesture intent or view result,
ownership is split.

## Non-blocking observations

1. Calling `@convax/api` “future” in sections 3 and 23 is stale: the private app and
   its first membership/session/rendezvous slice already exist. Replace “future API”
   with the current owner while keeping unimplemented endpoints fail closed. This is
   factual drift but does not by itself fork collaboration state.
2. The current root architecture still describes the v9 accepted/working/local-fork
   model. That is expected before this candidate is approved, but implementation MUST
   update architecture, local contracts, Mermaid, boundary policy and persistence map
   atomically; otherwise the eventual change is unmergeable.
3. Peer/blob, checkpoint and cutoff prose is semantically strong, but it remains
   covered by C1 until its exact DTOs and codecs are frozen.

## Strongest three rebuttals to the proposed architecture

1. **It is not yet an executable protocol.** “Closed” names without closed field and
   Yjs schemas shift consensus decisions into implementation, where different
   runtimes will sign different bytes.
2. **Its ownership story is internally unstable.** The same document requires domain
   logic to stay in owner packages while silently moving React Flow/editor semantics
   to Desktop, the composition root most likely to accumulate duplicated rules.
3. **Even after repair, the system keeps its disclosed distributed-database costs.**
   The attester sees content, all active editors can block pruning, no-holder
   bootstrap waits, and revoke can strand honest offline work.

The first two are current digest defects. The third is an explicit product/threat-
model tradeoff and remains acceptable only under the stated requirements.

## Required re-review gate

Produce one new digest containing only the minimum patches above. Before requesting
signature:

1. generate complete schema/codec golden artifacts from the normative v2 bundle in
   Bun, Chromium and attester and compare every byte;
2. run the Canvas intent/Yjs hostile-schema and permutation matrix without consulting
   a legacy draft;
3. run the shard-reset crash matrix and registry quota/accounting fixtures;
4. run package-boundary checks proving Canvas/React Flow/Desktop ownership has one
   implementation path;
5. independently recompute the new whole-file and schema-bundle digests.

Only after those results and a new exact byte sequence should this review be repeated.
