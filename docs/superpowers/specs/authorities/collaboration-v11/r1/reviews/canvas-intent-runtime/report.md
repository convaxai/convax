# Collaboration v11 R1 Canvas intent/runtime authority review

- reviewerRole: `canvas-intent-runtime`
- reviewerTaskPath: `/root/review_canvas_v11`
- frozenCandidateCommit: `7f425fd0794e5a049ddc9462f9a0843f3e8b1825`
- decision: `UNCONDITIONAL SIGN`
- scoreBasisPoints: `930`

## Exact reviewed authority

- manifestPath: `docs/superpowers/specs/authorities/collaboration-v11/r1/authority.sha256`
- manifestSha256: `351634036ae88bbe843430bb11b3e9d46e6b9bcd865df4aaf55e50fe55dfb1b4`
- protocolBundlePath: `docs/superpowers/specs/authorities/collaboration-v11/r1/protocol-schema-bundle-v3.json`
- protocolBundleSha256: `180199f3e77e5f4daa9c914f97b8e9a08293ba70e201656efe3bd0c10af70d6c`
- protocolDigest: `5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f`

All eight manifest members match their complete-file SHA-256 values and are regular
non-symlink Git blobs with mode `100644` at the named freeze commit. The installed
bundle is restricted JCS plus one LF, uses `CVXCOLL3`, protocol major 3, the V3 frame
and signature domains, and the exact historical V10/R5 protocol pin.

## Canvas and ProjectIndex review

R1 preserves the Canvas and ProjectIndex owner language as exact
`convax.typed-intent/2` bytes. `convax.typed-intent/3` is only the enclosing V3
frame's domain-separated digest of those bytes; it does not introduce a second
Canvas reducer, schema, or intent ABI. Canvas mutation remains isolated-candidate
validation followed by exact actual-write evidence, Yjs delta and canonical-state
comparison before the final V3 frame crosses durability.

The active R1 scope is deliberately narrow: only a fully verified pristine,
unshared V10/R5 ProjectIndex may promote, and it receives exactly one deterministic
default Canvas. Project derives the claim, `stageOperationId`, Canvas id, shard epoch
and schema from the fixed Project/epoch/ProjectIndex/legacy-actor tuple. The private
claim-bound bootstrap runtime publishes the ProjectIndex stage frame and returns its
exact frame digest and accepted frontier; the same in-memory result is passed to the
Canvas checkpoint and route activation before that runtime is disposed. The Canvas
checkpoint/proof binds the exact scope, Canvas schema, local-owner authorization,
successor protocol and returned stage-frame digest. Activation follows only after
durable proof publication and binds the stage record and Canvas checkpoint object.

No Project owner binding contains a Canvas id, wildcard, prefix, directory, or
future-Canvas set. The one Canvas authorization is signed only after the stage has
committed and is exact-scope. Selected active-local composition supplies a
ProjectIndex genesis port whose Canvas preflight/staging result is `pending`, so a
second or arbitrary Canvas cannot use the bootstrap path. Direct-new V3, active
runtime Canvas creation, sharing and team-replica activation are explicitly outside
R1 and fail closed. V10 Canvas bytes remain historical inputs and are never
re-encoded or re-signed.

## Strongest three objections

1. The ProjectIndex activation record does not independently reconstruct the stage
   frame from its digest. Flaw type: hidden trust-boundary assumption. A broad
   Canvas-creation protocol would be rejected for this. R1 avoids that authority by
   restricting creation to one private claim-bound bootstrap call that carries the
   just-committed stage result directly through genesis and activation, then disposes
   the writer; no network, Renderer or selected-runtime caller supplies the digest.
2. Preserving `/2` typed intents inside a `/3` frame can be mistaken for mixed
   protocol decoding. Flaw type: version-axis conflation. The bundle distinguishes
   the payload format from the `/3` intent-digest domain, while the selected Canvas
   reducer still parses only the exact frozen `/2` owner bytes.
3. A supposedly narrow promotion could accidentally expose the existing route-create
   application operation after activation. Flaw type: ignored capability-routing
   alternative. R1 requires active-runtime Canvas genesis to remain unavailable;
   the selected local composition's genesis preflight is fail-closed, so the
   bootstrap-only authority cannot be reused for a future Canvas.

## Falsifiers

- Any manifest member, bundle byte, protocol digest, Git kind or mode differing from
  the identities above invalidates this sign.
- Any accepted V3 Canvas or ProjectIndex frame whose owner-intent payload is not the
  exact selected `convax.typed-intent/2` bytes invalidates this sign.
- Any bootstrap in which Canvas id or shard epoch differs across retry, the Canvas
  proof does not bind the exact stage result, activation precedes durable proof, or
  a second writer becomes active invalidates this sign.
- Any public, Renderer, network or selected-runtime caller that can supply the stage
  frame/frontier, mint another Canvas authorization, or activate an additional
  Canvas under R1 invalidates this sign.
- Any direct-new V3 Project, V3 sharing/Team path, wildcard authorization, future
  Canvas authorization, or rewritten V10 Canvas byte admitted by R1 invalidates this
  sign.

## Decision

`UNCONDITIONAL SIGN`
