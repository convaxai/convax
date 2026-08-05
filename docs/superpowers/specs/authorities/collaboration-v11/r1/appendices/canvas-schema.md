# V11 R1 Canvas Authority Annex

Canvas retains the frozen V10/R5 Canvas state and `convax.typed-intent/2` intent
language. V11 changes the enclosing causal authority, not Canvas semantics.

R1 creates exactly one deterministic default Canvas during pristine V10 promotion.
The private claim-bound bootstrap writer returns the stage frame and frontier; that
same result is passed directly into Canvas genesis and route activation before the
writer is disposed. No public or active-runtime caller supplies those values.
Additional Canvas creation is unavailable in R1. The authorization binds the exact
Canvas scope and schema digest; the Project owner binding contains no Canvas scope,
wildcard, prefix, directory or future Canvas list.

For a verified empty V10 Project, Project deterministically derives the default
Canvas claim and `stageOperationId` from the exact Project id, epoch, ProjectIndex
scope and verified R5 owner actor. That operation deterministically derives the
Canvas id and shard epoch. Desktop cannot supply a path, Canvas id, nonce, schema or
authority choice.

After route staging, the local-owner Canvas checkpoint core binds the exact
`projectIndexRouteDependencyFrameDigest`. Its signed checkpoint and proof bind the
exact Canvas scope, owner schema, protocol, owner authorization and staged route
dependency. Only the same claim-bound bootstrap operation may activate the route
after that proof is durably published. Stage, Canvas genesis and activation are
three ordered publications; none is inferred from directory presence.

Canvas mutation still executes the selected Canvas reducer and canonicalizer inside
an isolated candidate. The exact V2 owner intent bytes, actual-write evidence and
Yjs delta are bound into the V3 frame. React Flow projection, selection, viewport,
measurements and gesture previews remain transient and never become authority.

V10 Canvas history is immutable. Promotion installs a bridge to each verified V10
Canvas head; it does not rewrite Canvas roots, intents, updates or signatures. An
empty V10 Project has no Canvas history to bridge: its one deterministic default
Canvas uses a new-project genesis bridge after the V10 ProjectIndex bridge and route
stage have been durably accepted.
