# V11 R1 Collaboration Kernel Annex

This annex is final for the generic V3 frame, authority and durability kernel.

## Closed wire

- envelope magic: `CVXCOLL3`;
- frame format: `convax.causal-edit-frame/3`;
- context format and digest domain: `convax.causal-context/3`;
- core format and digest domain: `convax.causal-edit-core/3`;
- frame digest domain: `convax.causal-edit-frame-digest/3`;
- signature domain: `convax.causal-edit-signature/3`;
- signer union digest domain: `convax.causal-signer-authority/3`;
- owner intent bytes: exact `convax.typed-intent/2` selected owner bytes;
- owner intent digest domain: `convax.typed-intent/3` over those exact bytes;
- Yjs codec: update-v1 from exact `yjs@13.6.31`.

The signer is the closed union `local-project-owner | team-replica`. Each variant has
an exact, sorted, duplicate-free dependency closure. A local-owner binding contains
no owner schema digest; its separate signed edit authorization binds the exact scope
and owner schema digest used by the frame. The local dependency closure is exactly
that binding plus that scope authorization. Caller-selected signer ids, wildcards,
unknown dependency kinds and alternate protocol digests are rejected.

The first actor frame requires exactly one signed promotion-bridge predecessor.
Every later frame requires the exact prior actor head. Admission reconstructs the
exact base, verifies the authority closure and signature, replays the owner intent in
an isolated candidate, and compares canonical state, actual-write evidence and Yjs
delta before durability.

Durability order is immutable object, replication outbox, journal, sole head, then
replica projection. A crash before the sole head cannot project; a retry of the same
operation returns the same bytes; alternate bytes for one operation or sequence are
equivocation. Incoming frames use the same barrier and never mutate a provisional
overlay.

V2 input is dispatched only to the already validated V10/R5 decoder. No V3 function
may reinterpret, normalize or sign V2 bytes.

Local ProjectIndex and Canvas genesis proofs are owner-specific inputs to the generic
kernel, not alternate document stores. Their domain-separated checkpoint core,
checkpoint object, checkpoint signature and proof digests are part of this V11
release. A Canvas genesis proof additionally binds the exact accepted ProjectIndex
route-stage frame digest; the generic kernel does not derive a route by scanning
Project files.
