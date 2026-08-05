# V11 R1 Project Persistence Annex

Project/node is the sole owner of native V3 protocol state. The closed records are:

- retry-stable promotion claim;
- Main-private owner key reference and owner binding, which contains no owner schema
  digest;
- one signed edit authorization per exact ProjectIndex or Canvas scope, each carrying
  that owner's exact schema digest;
- immutable protocol-promotion bridge;
- exact ProjectIndex authorization and accepted route-derived Canvas authorization
  closure;
- device Project-protocol high-water record outside the movable Project directory;
- create-only active protocol pointer;
- external sharing tombstone used to reject already-shared promotion state.

R1 publication starts only from a pristine unshared V10 ProjectIndex: claim, key,
binding, ProjectIndex authorization and signed bridge journal, default-Canvas route stage,
Canvas authorization, Canvas genesis and signed bridge, route activation, device
high-water, then active pointer. It preserves all V10 objects and
heads, writes an immutable bridge for every verified V10 document, advances device
high-water, and only then publishes the pointer. Every directory barrier is durable
and every retry must reproduce the same bytes.

For a verified empty V10 Project, Project derives the default-Canvas claim from the
exact Project id, epoch, ProjectIndex scope and verified R5 owner actor. The claim
deterministically fixes `stageOperationId`, Canvas id, shard epoch and Canvas schema
digest. The ProjectIndex bridge journal is installed before the claim-bound V3
ProjectIndex writer stages that operation. Only after the stage frame is accepted may
Project append the exact Canvas authorization. The Canvas checkpoint binds the
stage frame as `projectIndexRouteDependencyFrameDigest`; activation then binds the
stage record, that frame, the staged frontier and the Canvas checkpoint object.
Restart repeats the same operation and bytes or fails closed; it never derives a
second default Canvas.

The persisted protocol state is the only runtime selector. Network state, Team
reachability and directory heuristics are not evidence of unshared status. If the
Project directory is restored behind the external device high-water or tombstone,
opening fails closed; it never signs with the restored owner key.

R1 does not install sharing journals, a Team closure or a team-replica writer. It also
does not expose active-runtime Canvas creation beyond the bootstrap default Canvas.
