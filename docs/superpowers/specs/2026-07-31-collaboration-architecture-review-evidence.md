# Convax Collaboration Architecture v9 Review Evidence

Frozen review manifest:

- path: `docs/superpowers/specs/2026-07-31-collaboration-architecture-review.sha256`
- SHA-256: `55d763d2345c7bd08b0eadeb2fc3f34a6976116d27a3d5a04cd328d37f201c7a`

Pinned artifacts:

- global URI protocol:
  `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`
- collaboration architecture:
  `427284e11a4994dee73feba796c78bcd7635f305db7607d271735e99fae49dc7`
- collaboration Yjs schema:
  `58f02f97a0b6b4848042dd343b1f75c2e370a99c276e6c681ae42e89fdaa9827`

Independent final votes:

| Reviewer                      | Decision           | Scope                                                                  |
| ----------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `canvas_collaboration_review` | FINAL APPROVE v9   | package ownership, service/Peer protocol, lifecycle and invariants      |
| `canvas_undo_review`          | FINAL APPROVE v9   | Project tree, semantic history, checkpoint/recovery and permission race |
| `peer_blob_review_fast`       | FINAL APPROVE v9   | Peer wire, flow control, holder proof and blob partition/Merkle         |

Each reviewer independently recomputed the manifest digest and ran
`shasum -a 256 -c` successfully. Runtime implementation was prohibited until all
three approvals referred to the exact same manifest.

Any change to a pinned artifact invalidates these votes and requires a new manifest
plus three new independent final approvals before implementation can continue from
the changed architecture.
