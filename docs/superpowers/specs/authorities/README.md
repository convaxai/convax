# Collaboration authority archive (non-runtime)

Status: **non-runtime archive and review material only**.

Everything under `docs/superpowers/specs/authorities/**`, together with the sibling
active-authority pointer files
[`collaboration-v10-active-authority.json`](../collaboration-v10-active-authority.json)
and
[`collaboration-v11-active-authority.json`](../collaboration-v11-active-authority.json),
records a retired multi-release collaboration model. Production runtime, build
scripts, packaging, and package scripts must not read, stage, copy, or import these
bytes.

Convax now ships exactly one current collaboration protocol. The built current
protocol descriptor under `packages/collaboration/protocol/current.json` and its
exact `protocolDigest` are the only production protocol identity. Desktop packages
only the staged descriptor at `.packaging/collaboration-protocol/current.json`.

The sealed release trees below remain unchanged so reviewers can detect archive
tampering. Editing any archived byte is `activated-authority-mutation` and is
rejected as tampering. These trees are evidence only and never select runtime
behavior.

| Archive | Pointer | Release |
| ------- | ------- | ------- |
| collaboration-v10 / R5 | [`collaboration-v10-active-authority.json`](../collaboration-v10-active-authority.json) | [`collaboration-v10/r5/`](collaboration-v10/r5/) |
| collaboration-v11 / R1 | [`collaboration-v11-active-authority.json`](../collaboration-v11-active-authority.json) | [`collaboration-v11/r1/`](collaboration-v11/r1/) |

Canonical runtime contract: [`docs/architecture.md`](../../../architecture.md) and
root [`AGENTS.md`](../../../../AGENTS.md) § Single current collaboration protocol.
