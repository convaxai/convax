# P2P collaboration v10 final G2 revision-4 service sign-off

Date: 2026-08-02

Reviewer identity: `/root/collaboration_api`

Reviewer lane: G2 service/control-plane, exact protocol identity, reset-verifier ABI,
cross-owner authority and interoperability red-team review.

Review mode: exact-byte pin-only. I modified neither the canonical main, any of the
four annexes, the global URI specification nor implementation. I rewrote only this
detached review receipt after completing the checks below.

## Decision

**SIGN REVISION 4.**

Score: **8.8 / 10**.

This signature is valid only for the exact indivisible authority and portable bundle
identities below. Any authority-byte change revokes it and requires a fresh 3/3
review.

## Exact reviewed authority

| File | Bytes | Ordinary whole-file SHA-256 |
| --- | ---: | --- |
| canonical main | 89,240 | `5f6a69af82cf71e0f2a2aa609c75e2054e73f556ac72a2aa9154aaa8c1c2165f` |
| Canvas annex | 132,568 | `4a1d7b2362349826ab7df488af7be4d66ed48f49df3aa39f07552235a2fcd530` |
| collaboration-kernel annex | 72,591 | `fc40e646aae952b731450c4b60d2213219be130b4bd90115223afbb74f421691` |
| control-plane annex | 165,057 | `1506c4834295d9d1dfeffc07c0dd2666661af74a659d9271b77b43e5214ecca4` |
| Project persistence annex | 144,701 | `6c29fefdf52b63f97199e44fb8f7328b85d98be9f15e884c1aff5727bc34d0b6` |

All five files end in LF. I regenerated the strict UTF-8 path-sorted four-entry
restricted-JCS annex-set preimage from these files rather than trusting the main
summary. Its ordinary SHA-256 is:

```text
8c3eca5c411ef729d53899aa9dc7e83df7b1e650638c6f7e82178ebd55b2dc55
```

The independently versioned global URI specification is 15,102 bytes, ends in LF
and hashes to:

```text
298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949
```

The main file pins those exact values, makes the owner annexes final for their
closed DTO/state surfaces and explicitly forbids a main summary, historical review,
implementation or persisted legacy bytes from completing or reinterpreting them.
Its revision-4 change log summarizes `F13-ABI-CLOSED-SNAPSHOT/1` without copying its
declaration or algorithm.

## Portable bundle independent recomputation

The kernel no-self-reference sentinel occurs exactly once at byte 50,828. The
excluded prefix ends in LF and independently recomputes to ordinary SHA-256:

```text
1863419be46f0e0839a85245b70e6374e3e1df322a47df2b6c305c3b8af5678f
```

Applying
`SHA-256(UTF8("convax.protocol-schema-artifact/2") || 0x00 || artifactBytes)`
independently produced:

| Artifact | Domain-separated artifact digest |
| --- | --- |
| `canvas-schema` | `8270e6fe017ceb27d324b6c71247c993f643edda13d2135987857a01c009944e` |
| `collaboration-kernel` prefix | `7702eb4ee348948c6f9633f4128cade52ea32c76c9501729db40d7dee00d8534` |
| `control-plane` | `e96148c5fdf5a24eb0d4b0d9c1c3e3dc314018319b3ec2d2f3828600c5d3efcf` |
| `project-persistence` | `cb417657f0c6818115cda43a59354111692e58aad22bf87a89e565a86e24a8db` |

The five embedded JSON blocks each parse and reproduce byte-identically under an
independent restricted-JCS encoder. The four-ref manifest equals the independently
hashed artifact spans. The limit object has 66 named limits plus `format`; the
channel object has four policies. Their recomputed values are:

```text
limitsDigest          = 2ac48434013d2669447511a16f9aa706612e97638718fa4c572374579bae19c0
channelContractDigest = 0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242
```

The domain registry contains exactly 123 distinct entries in strict raw-UTF-8 order.
It contains neither retired `convax.project-index-canonical-state/2` nor forbidden
`convax.canvas-canonicalizer/2`. The F13 callable additions introduce no portable
record or digest domain. The wrapper repeats the exact core and both independently
recompute to:

```text
ProtocolSchemaBundleV2.coreDigest = 6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4
protocolDigest                     = 6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4
```

## `F13-ABI-CLOSED-SNAPSHOT/1` closure audit

I extracted the public declaration in two independent ways: one selected the unique
TypeScript fence by callable symbol; the other rendered the expected declaration
from independently enumerated aliases, interfaces, fields, union alternatives and
function signature. Both emitted the same 4,310 bytes with SHA-256:

```text
0dc97526f5983c26f9c06871d0f35b13195c39db020307d91688a29ff62fa244
```

Mechanical declaration results:

| Contract | Required field count | Recomputed field count |
| --- | ---: | ---: |
| `VerifyDocumentShardResetAuthorityInputV2` | 10 | 10 |
| `DocumentShardResetAuthorityDependencyBytesV2` | 11 | 11 |
| `DocumentShardResetCandidateBindingV2` | 11 | 11 |
| `DocumentShardResetCandidateFactsV2` | 5 | 5 |
| `DocumentShardResetCurrentReplicaDocHeadV2` | 4 | 4 |
| `DocumentShardResetCurrentRouteFactsV2` | 11 | 11 |

There is exactly one `export declare function
verifyDocumentShardResetAuthorityV2(input)` across all Control TypeScript fences.
It has one required argument and the closed synchronous result union. The input has
no `format`; the function has no overload, generic, callback, port, ambient lookup,
phase, resume token, `Promise` or async return. All interfaces and fields are
exported/readonly as specified. The five business objects, eleven nullable
dependency slots and canonical candidate binding are exact JCS bytes; candidate and
head full updates use pinned Yjs update-v1 bytes and their state vectors use the
dedicated state-vector byte alias. The contract requires defensive copies before
inspection, so TypeScript `Readonly` is not treated as runtime immutability.

The sole Control first-failure algorithm has exactly the consecutive steps 1 through
13, and the input-consumption matrix also has exactly rows 1 through 13. Step 2 is
byte-identical to the prior accepted Control source and consumes only confirmation,
claim, approval, route-CAS and reset-commit wrapper/core identities. It does not read
typed intent, candidate facts, current head or current route facts. Typed intent is
bounded/decoded in step 1 but first participates semantically in step 12; candidate,
current durable head, route/predecessor and staged-genesis facts also first
participate semantically in step 12. No F9, final-currentness, phase/resume or cached
prefix callable exists.

Project does not copy the thirteen-step algorithm or declare a second callable. Its
module-private coordinator is the sole mutation-authorizing consumer. Its exact
critical-section sequence has steps 1 through 10. The initial F13 call constructs a
fresh ten-field input, five candidate facts, four durable-head facts and eleven route
facts. After permit claim and A3, the final call constructs a different fresh
ten-field object, recopies and redecodes the five business plus eleven dependency
byte values, recanonicalizes binding, and rebuilds all `5/4/11` candidate/head/route
facts while holding the writer lock and witness. Reuse of the initial top-level
input, decoded dependencies or current snapshots is explicitly forbidden. Both
calls run the same complete Control verifier from step 1 through step 13; only the
Project-private witness/permit plus no-gap reducer entry grants mutation authority.

## Boundary and precedence result

`bun run package:boundaries` stops at the known pre-freeze Revision-3 hardcoded
manifest/sign-off constants with exactly:

```text
docs/superpowers/specs/2026-08-01-p2p-v10-authority.sha256: exact frozen manifest entries/order changed
```

This is the expected integration-phase failure for the newly reviewed Revision-4
authority; it is not evidence against the candidate. No other failure was observed
before that deliberate hard stop. Updating the frozen manifest, sign-off identities,
review evidence and governance constants belongs after all three exact receipts
exist; doing it inside this independent receipt would be circular.

## Strongest three objections

1. **Two complete synchronous Yjs reconstructions under the Project writer lock may
   exceed the product latency budget.** The maximum admitted candidate and current
   head can approach the existing large binary/working-set ceilings, and the final
   gate deliberately repeats decode, apply, full-update encode, state-vector encode
   and owner canonicalization. Replacing it with an async or suffix verifier would
   weaken the no-gap authority proof, so this remains a real throughput and UI-stall
   risk that implementation benchmarks must settle.
2. **The ABI's apparent readonly byte safety exists only if every implementation
   performs the mandated defensive copies.** `Readonly<Uint8Array>` does not freeze
   its backing buffer. A generated validator that retains a caller view, decodes
   lazily or allocates before enforcing caps can admit a time-of-check/time-of-use
   mutation or memory denial of service even while type-checking against the exact
   declaration.
3. **A public diagnostic named `verified` is easy to misuse as a portable permit.**
   The architecture correctly gives mutation authority only to the Project-private
   witness/permit coordinator, but an API, Desktop adapter or future Plugin bridge
   could incorrectly cache or forward `{status:"verified"}`. Conformance tests and
   export documentation must prove that no public caller can route this diagnostic
   into the reducer.

## Flaw types checked

- **Fact error:** no mismatched hash, count, field name, Yjs codec or owner was found
  in the pinned set.
- **Hidden assumption:** the design assumes the twice-complete synchronous verifier
  fits the reset critical-section latency and memory budget; this remains the main
  unproven implementation assumption.
- **Logic jump:** no authority jump was found in the specification because verified
  status is diagnostic and Project's private one-shot permit owns reducer admission;
  an implementation that treats the diagnostic as authority would reintroduce one.
- **Sample bias:** exact declaration generation and document-level vectors do not
  substitute for adversarial runtime tests against mutable buffers, oversized Yjs
  updates, crashes and re-entrancy.
- **Ignored alternative:** a final-only suffix verifier, async callback/port or
  digest-only candidate assertion would reduce cost but was intentionally rejected
  because each creates a second or stale authority path.

Additional checks covered duplicate authority, dangling normative import, stale
digest, signature-domain ambiguity, registry drift, hidden ambient lookup,
first-failure reordering, current-head substitution, decoded-object reuse,
time-of-check/time-of-use mutation, diagnostic replay, permit copying, re-entrancy,
crash recovery and main-summary reinterpretation.

## Falsifiable revocation conditions

This signature is revoked if any independent implementation or test can:

1. recompute a different authority, URI, annex-set, artifact, prefix, limits,
   channel, core or protocol digest stated above;
2. emit a different `.d.ts`, find a second callable/overload, or obtain field counts
   other than `10/11/11/5/4/11` for input/dependencies/binding/candidate/head/route;
3. accept a missing/additional/accessor/symbol key, noncanonical JCS, mutable aliased
   byte view, oversized value, non-v1 Yjs update, or mismatched reconstructed state
   vector/canonical state;
4. let step 2 consume candidate/current facts, let typed intent or current facts
   affect a semantic failure before step 12, reorder a first-failure code, or let
   either initial/final invocation skip any of steps 1 through 13;
5. reuse the initial verifier input, decoded dependency object or current snapshot
   at the final gate, or pass final verification after any wrapper, authority head,
   route, candidate or backing byte buffer changes;
6. enter the reset reducer using public `{status:"verified"}` without the exact
   Project-private witness, one-shot permit, A1-A4 assertions and no-gap transition;
7. generate a registry other than the exact sorted unique 123-domain array, add an
   F13 digest domain, restore the retired Project domain or admit the Canvas-private
   canonicalizer domain;
8. find a `package:boundaries` failure unrelated to the explicitly stale Revision-3
   frozen manifest/sign-off/review markers after substituting the final three
   Revision-4 receipts.

## Score rationale

The 1.2-point deduction is for the unbenchmarked synchronous double-rebuild cost,
the runtime gap between readonly TypeScript and mutable byte buffers, and the public
diagnostic misuse surface. These are not fatal to this architecture because the
protocol sets hard byte/working limits, fails closed, requires defensive copies and
fresh reconstruction, preserves one complete first-failure algorithm, and keeps the
only mutation capability private and one-shot. A failed performance benchmark can
force smaller caps or a new reviewed protocol; it cannot silently justify a weaker
verifier.

Reviewer: `/root/collaboration_api` — G2 service/control-plane red-team lane.
