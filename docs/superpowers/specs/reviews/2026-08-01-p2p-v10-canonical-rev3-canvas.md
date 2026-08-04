# P2P collaboration v10 canonical revision 3 Canvas G2 red-team review

Date: 2026-08-01

This review independently evaluates only the exact five-file authority set below.
No implementation, prior draft, review conclusion or repository code was used as a
fallback decoder, and no authority file was modified.

## Decision

**REJECT** the exact revision-3 authority set.

The four annexes close the revision-2 architecture blockers and the detached bundle
identity is reproducible. The main file nevertheless reintroduces the old raw
`beginAuthorizationEpoch` identity in a normative exact tuple, while both owning
annexes require `beginAuthorizationEpochDigest` and expressly forbid substituting a
raw epoch. The main file's own precedence rule classifies this as
`canonical-authority-conflict`, so this exact main digest cannot receive a G2
signature.

Score: **6.9 / 10** for this exact authority set. The architecture underneath the
one conflict is substantially stronger than revision 2, but an indivisible
authority set that orders implementations to stop on its own contradiction cannot
score 7 or enter implementation.

## Exact identity verification

All five UTF-8 files have a final LF, no CRLF/NUL bytes and balanced Markdown
fences. Detached whole-file values independently recompute as follows:

| Authority file | Lines | Bytes | Independently computed SHA-256 | Result |
| --- | ---: | ---: | --- | --- |
| main revision 3 | 1,561 | 86,558 | `de24e72edd8a7114932b1c4b86ed2491b41d52f241ad7ed66f4752dc2aca0e05` | PASS |
| Canvas annex | 1,559 | 70,938 | `f258bbab3d85ad54cd2f023ef4e1f135deb2a87c3b473725ca6ab5bf7641b099` | PASS |
| collaboration-kernel annex | 1,019 | 55,278 | `313800d1905f8a4a88463a4c91ca16a43b9d847f93867170efae011b2e20c604` | PASS |
| control-plane annex | 2,711 | 104,940 | `33a23c1f089394a010987b179741d45a37f8380ba2051cc94809c5711277faad` | PASS |
| Project persistence annex | 1,643 | 78,346 | `33d925f80e28615271cbd59b518779f47ded5494050d119c0cda04dc7e9ff857` | PASS |

The four sorted `{path,sha256}` objects produce the exact 706-byte restricted-JCS
preimage printed in main section 1.1. Ordinary SHA-256 over those bytes is:

```text
ecdf0018a643bac3e4a45458dfd3e957fe8e4e188ee1965450fd137f4dc1b6b3
```

That matches the declared revision-3 annex-set digest. It is correctly distinct
from the portable protocol digest.

## Portable bundle recomputation

The kernel bundle sentinel occurs exactly once. Its excluded normative prefix is
37,469 bytes, ends in LF and has ordinary SHA-256:

```text
695571c8a77719cd8330406159f026dbfa77dde2e79cf260888936573dd661f0
```

Independent `SHA-256("convax.protocol-schema-artifact/2\0" || artifactBytes)`
calculation gives:

| Artifact | Independently computed artifact digest | Result |
| --- | --- | --- |
| Canvas schema | `81d5422976f490f973979937a6ac49e7854b6725cfdf03ca2f521dab6d5f582e` | PASS |
| kernel prefix | `7b20604e909e16adeb14ad0f2409f245edeb215701117cbbd7e1dcaaccc361d7` | PASS |
| control plane | `0999a444e562ae5ab7e258813c63b1720a2b2426986ee04ca67778ba8bbef5e0` | PASS |
| Project persistence | `fed8324163a39e3c683ab30798acddfcd28eb44a23679a8a40aa59566130fca8` | PASS |

All five embedded JSON instances parse with duplicate-key rejection and are already
restricted-JCS canonical. The artifact list is byte-identical to `core.artifacts`;
the namespace tuple/imports and 88 domains are strictly UTF-8 sorted and
duplicate-free. The 61 named limits and four-channel contract recompute to:

```text
limitsDigest  = c01f518d76b916b8f97990101aaced33792bd66404d9db4f790e7a629b8d179f
channelDigest = 0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242
```

The complete core JCS independently produces:

```text
ProtocolSchemaBundleV2.coreDigest = 3cb032469da372773d912c27c0e16918bd6379a3c956af83c448013b112ee437
protocolDigest                     = 3cb032469da372773d912c27c0e16918bd6379a3c956af83c448013b112ee437
```

The wrapper repeats the core byte-for-byte and both digest fields match. Bundle
construction, self-reference exclusion and control constants therefore pass.

## Blocking finding G2-C1 — the main summary revives the raw authorization epoch

Severity: **P0**. Flaw types: **normative merge drift**, **closed-field conflict**
and **stale incorporated-source summary**.

Main lines 733-735 normatively require a canonical first-loss receipt for the exact
tuple:

```text
{projectId,projectEpoch,beginActorId,beginAuthorizationEpoch}
```

That is not the revision-3 owner schema:

- Canvas lines 510-516 store
  `GenerationBeginV2.beginAuthorizationEpochDigest: DigestV2`;
- Canvas lines 562-590 define it as the purpose-separated digest of the complete
  eleven-field `BeginAuthorizationEpochCoreV2` and forbid raw authorization epoch
  ids at this boundary;
- control lines 515-534 define that exact core/wrapper;
- control lines 2388-2415 put the byte-identical
  `beginAuthorizationEpochDigest: DigestV2` in the signed first-loss receipt and
  state that raw authorization epochs are not interchangeable.

This distinction is semantic, not a spelling alias. The digest binds membership
snapshot, member and replica authorization epochs, actor identity, the exact edit
authorization core and protocol digest. A raw epoch id cannot replace that compound
authorization-instance identity.

Main lines 102-107 say that a main summary MUST NOT reinterpret an annex's closed
DTO and that a genuine contradiction is `canonical-authority-conflict`, requiring
implementation to stop. Main lines 678-681 additionally say this Canvas section is
cross-owner policy and cannot substitute for the Canvas schema. Those rules do not
erase the conflict: the main used braces and the word “exact” to define a different
cross-owner receipt key.

The likely source is round-3 revision 4, which used the old raw field. That source
still hashes correctly but is evidence only under revision-3 precedence and cannot
override the annex repair.

### Minimum repair and exact re-review boundary

Replace only the stale tuple member in main line 734 with
`beginAuthorizationEpochDigest`, then recompute the detached main whole-file hash
and repeat 3/3 review against that new hash. If no annex byte changes, the annex-set
digest and bundle core digest should remain unchanged, but no prior main-file
signature transfers to the new bytes.

### Falsifiable test

Create two generation begins for the same actor across authorization replacement,
keeping at least one raw epoch component equal while changing another component of
`BeginAuthorizationEpochCoreV2`. Each begin must accept only the first-loss receipt
whose `beginAuthorizationEpochDigest` equals its exact reconstructed core digest.
If a clean implementer asks whether main line 734 means a raw `Id128V2`, hashes a
locally selected subset, or accepts a receipt from the other authorization
instance, the exact set is not interoperable. The present bytes permit precisely
that question, so the blocker is already demonstrated.

## Revision-2 rejection audit

| Revision-2 blocker | Revision-3 result | Independent conclusion |
| --- | --- | --- |
| R2-C1 / S2: no instantiated protocol bundle or generic causal frame | **PASS** | Kernel owns one closed frame/context/frontier/evidence language, exact four-artifact manifest and the recomputed `3cb032...` protocol digest. |
| R2-C2 / S3: missing shard/Project reset confirmation, approval and epoch-rollover authority | **PASS** | Control defines the closed confirmation/approval/challenge/proof/attestation/receipt objects; Project imports them and binds exact cores into its crash-safe reset manifests. |
| R2-C3: generation begin and first-loss authorization identity disagree | **FAIL for the five-file set** | Both owner annexes now agree on the purpose-separated digest, but main line 734 reintroduces the rejected raw field. |
| R2-C4: Canvas write closure arithmetic contradicts caps | **PASS** | All 22 intents have exact formulas; resource/Plugin creation uses `6*N+3*E+2<=512`, pending generation uses `3*E+9<=512`, and exact/+1 plus 256 KiB evidence fixtures are mandatory. |
| S1: incompatible Canvas id/scope/stamp codecs | **PASS** | Kernel is the sole definition owner for `cv_<64hex>`, `DocumentScopeV2` and `PortableStampV2`; Canvas and Project import those identities and control consumes them without redeclaration. |
| S4: lagging registry decides the pending editor's required floor | **PASS** | Main, control and Project all define the required set as ProjectIndex scope union the content-certified current live-route manifest; registry fields are anti-rollback/advisory only. |
| S5: reconnect inventory cannot discover exact missing objects | **PASS** | Paged inventory binds frontier, actor-head-set and state-vector digests; the closed request union names those object kinds, and bounded blob-have query/response is separate. |
| S6: undefined atomic Project bulk import | **PASS** | No bulk intent exists; multi-file import commits independent file-create frames and reports the exact partial subset. |
| React Flow/document authority drift | **PASS** | React Flow is Canvas-owned projection/gesture semantics with transient state only; Desktop owns shell/adapters and cannot own a document store or reducer. |

Every revision-2 blocker other than the main-file regression is closed without
inventing a document-wide version, central edit sequencer, second Project route
catalog or renderer document authority.

## Shared codec and pending-editor floor 3/3 audit

The three owner surfaces agree byte-semantically:

1. **Canvas** imports kernel `CanvasIdV2`, `DocumentScopeV2` and
   `PortableStampV2`; a Canvas identity and scope use the same `cv_<64hex>` id.
2. **Project** imports those same types and derives the Canvas id/route rather than
   introducing `Id128V2` or `docEpoch` alternatives.
3. **Control** imports the kernel codecs by exact exported identity for
   registration, Peer inventory, reset and floor objects.

For pending-editor coverage, the three normative statements also agree:

```text
RequiredProjectFloorScopeSet =
  { current ProjectIndex scope }
  union current content-certified ProjectIndexLiveScopeManifest live scopes
```

The manifest contains only live, non-tombstoned routes. Registry absence, candidate,
abandoned, dual-validated or registry-only stale state neither adds nor removes a
required scope, grants editing nor blocks activation. Activation revalidates the
current manifest and membership; a route change yields
`pending-editor-floor-stale`. This closes the revision-2 hidden second-authority
path.

## Stale-summary scan

A scan of main-file backticked `*V2` identifiers found no type name absent from the
annex set. Negative references to `docEpoch`, `certifiedTeamDoc`, `workingDoc`, raw
Yjs updates, document-wide revision/version and Project bulk intent are explicit
removal rules, not fallback semantics. Main summaries for the 512 owner write cap,
ProjectIndex floor, independent multi-file import, React Flow transience, reset
ownership and four Peer channels match their owning annexes.

The sole positive stale field found is `beginAuthorizationEpoch` on main line 734.
It occurs nowhere else in the revision-3 exact set; every owner occurrence uses
`beginAuthorizationEpochDigest`. Therefore “no stale summaries” fails on exactly
one identified cross-owner statement rather than a broad unresolved merge.

## URI and revision-4 audit

The independently versioned global URI source is 249 lines / 15,102 bytes and
recomputes to:

```text
298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949
```

The bundle binds that exact digest. Five-component VS Code-compatible grammar,
static scheme governance, opaque case-sensitive Project authority, stable
ProjectFileId, mutable path hint, optional immutable blob pin, explicit comparison
mode and owner-side resolution remain intact. Collaboration v10 overrides only the
old URI reset text involving `docEpoch` or central per-edit admission; it preserves
stable `projectId`, ordinary Project files and authenticated team rollover.

The historical round-3 revision-4 candidate is 384 lines / 20,808 bytes and hashes
to:

```text
ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b
```

Its checkpoint dual gate, Project-owned shard reset, non-authoritative registry and
generation dismissal/recovery model are incorporated. Its old raw generation epoch
wording is not normative and is exactly the stale merge fragment identified in
G2-C1.

## Ownership and package-boundary audit

The runtime graph remains consistent with the repository contract:

```text
collaboration -> external yjs only
canvas        -> collaboration, uri, ui
project       -> canvas, collaboration, project-files, uri, ui
api           -> collaboration + public project/collaboration-protocol only
desktop       -> composition and native/PeerJS adapters
```

Portable namespace imports in the bundle are explicitly schema references rather
than runtime dependency edges. Canvas receives Project/control facts only through
Canvas-owned branded headless permits; it does not import membership or Project
runtime code. Project owns routes, resource proofs and composite validation;
`@convax/project/node` is the only private native writer. PeerJS remains Desktop
transport, the API stores control metadata rather than Yjs/blob payload, and UI,
Agent and Plugin all submit the same closed typed intents.

This result is conditional on generated/runtime code preserving that separation.
A generated Canvas validator that imports `@convax/project` or control service code,
or a collaboration package that imports `@convax/uri` at runtime instead of using
the frozen schema scalar/owner validation boundary, would invalidate this PASS.

## Strongest three objections

1. **The exact set contains a self-declared canonical conflict.** This is the fatal
   objection: first-loss authorization identity has two normative spellings with
   different information content, and the precedence rule requires rejection.
2. **Hashing whole Markdown artifacts creates a large protocol-identity blast
   radius.** Editorial provenance and formatting share the artifact byte span with
   wire schema, so harmless annex edits rotate `protocolDigest`, credentials and
   interoperability identity. The sentinel solves self-reference, not this
   operational coupling.
3. **Dual-gated pruning couples availability to every editor and a shared validator
   implementation.** One long-offline editor blocks pruning; explicit revocation can
   strand honest unreplicated work, while an attester and all editors sharing one
   deterministic validator defect weakens the claimed independent trust domains.

Objection 1 is fatal for these bytes. Objections 2 and 3 are not additional signing
blockers under the stated v1 contract because artifact rotation is explicit and
fail-closed, and the privacy/offline path retains full history and user bytes rather
than pruning without proof. They remain product and operations costs that must not
be hidden in implementation.

## Falsifiable architecture gates

The repaired set is wrong if any of these results occurs:

1. authorization replacement lets a first-loss receipt validate against any begin
   whose reconstructed `BeginAuthorizationEpochCoreV2.coreDigest` differs;
2. Bun, Chromium and the public verifier produce different Canvas id/scope/stamp,
   artifact, limits/channel or bundle digests from the same exact bytes;
3. a ProjectIndex-live Canvas absent from registry is omitted from a pending
   editor's floor, or a registry-only scope blocks/grants editing;
4. a clean packaged Canvas runtime imports Project/control implementation, Desktop
   owns a React Flow document reducer, or API imports private Canvas/Project source;
5. any rev2 reset replay, stale approval, changed genesis/deletion set, reconnect
   discovery, write-cap boundary or bulk-import partial-success fixture regresses;
6. an offline/holderless/attestation-unavailable path fabricates synchronized state,
   prunes without the dual certificate, loses user bytes or calls local durability
   “team saved”.

## Reviewer signature

Decision: **REJECT**

Score: **6.9 / 10**

Reviewer: `/root/canvas_intent_runtime`

Reviewed detached main SHA-256:
`de24e72edd8a7114932b1c4b86ed2491b41d52f241ad7ed66f4752dc2aca0e05`

Reviewed annex-set SHA-256:
`ecdf0018a643bac3e4a45458dfd3e957fe8e4e188ee1965450fd137f4dc1b6b3`

Reviewed `ProtocolSchemaBundleV2.coreDigest` / `protocolDigest`:
`3cb032469da372773d912c27c0e16918bd6379a3c956af83c448013b112ee437`

No implementation lane may start from this exact set. Apply the one normative main
repair, compute a new detached main digest, and obtain three reviews of the same new
five-file authority identity.
