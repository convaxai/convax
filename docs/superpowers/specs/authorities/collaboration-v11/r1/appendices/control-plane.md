# V11 R1 Control-Plane Exclusion Annex

Local-owner editing has no control-plane dependency. The production composition does
not construct a V11 Team manager, API client, rendezvous session or PeerJS transport
for a selected local Project.

V11 sharing submit/recover and team-replica activation are not part of R1. Their
implementation candidates are not selected authority or callable production
capabilities. An explicit V3 share request fails closed without changing owner state.
Existing shared V10 Projects continue to use the sealed V10/R5 protocol.
