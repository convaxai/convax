# Collaboration v10 R5 collaboration/control-protocol authority review

- reviewerRole: `collaboration-control-protocol`
- reviewerTaskPath: `/root/collaboration_api`
- reviewed formatter delta SHA-256: `d688edd94590ef8b42d5b858a883f6557a79147993dd27ced906b5df1517757c`
- decision: `UNCONDITIONAL SIGN`
- ScoreBasisPoints: `960`

## Exact seven-member release

| Manifest member | Ordinary whole-file SHA-256 |
| --- | --- |
| `docs/superpowers/specs/2026-07-31-global-uri-protocol.md` | `9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38` |
| `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md` | `2afb080ef3ba3aed259d1d7501b73552fe02a6e826d3a28cafc746caa314eb19` |
| `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md` | `cf262f8780b47a0d7b85c0773beebcb6cf97e059ebaa21d8c7439e3afc5c693a` |
| `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md` | `30f02414b8d4e7f4645584e845eecf67e04e89d895397a26fe543b5cab64cc63` |
| `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md` | `5fa9ab986f8f191e595bd7c516014414962eb9d2f57a8a800e0ab0b816def654` |
| `docs/superpowers/specs/authorities/collaboration-v10/r5/main.md` | `4a2da5450c3b3a7d7130255a7aabe971788a09382aefbd8fa77d25c1c0931f72` |
| `docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json` | `163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786` |

- manifestPath: `docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256`
- manifestSha256: `2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed`
- protocolBundlePath: `docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json`
- protocolBundleSha256: `163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786`
- protocolDigest: `de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5`

## Mechanical verification

`bun scripts/collaboration-authority/generate.ts --check` exited successfully and
reproduced the installed manifest and protocol bundle byte-for-byte. The manifest
has exactly seven raw-UTF-8 path-sorted members, two ASCII spaces per separator,
and whole-file hashes that include each member's final LF.

The bundle is restricted-JCS on one line plus one LF. Parse/re-encode verification
confirmed 127 unique raw-UTF-8-sorted domains, the exact five-entry namespace
tuple, 73 bounded fields, four channel policies, complete-file artifact digests,
and `coreDigest === protocolDigest`. Main contains the signed section 23 task
relocation, the complete 36-owner-row graph, section 24 promotion/CAS contract,
section 24.1 closed L1 selector surface and phase gates, and section 24.2 release
falsifiers. Kernel section 4 is byte-identical to the signed replacement. The
active pointer is absent, so this review does not activate the release.

## Strongest three objections

1. Promotion correctness could be circular if the manifest attempted to hash
   itself or if a sentinel replaced an authority member. Flaw types: logical cycle
   and hidden assumption. The signed construction avoids both: the manifest is an
   external commitment to seven complete files, while the bundle commits the
   protocol artifacts and namespaces without a self-referential manifest member.
2. A selector might silently reopen legacy or caller-chosen authority paths during
   bootstrap or a failed compare-and-swap. Flaw types: open codec/path ambiguity
   and ignored alternative path. Section 24 closes pointer codecs and derived
   paths, requires create-only initial CAS and T0 sealing, and classifies legacy
   bytes as evidence that runtime selection must never open.
3. The Task 1 export closure could be either too permissive, leaking unfinished
   runtime semantics, or too narrow to verify independently. Flaw types: public API
   leakage and hidden integration assumption. Section 24.1 permits exactly two
   runtime values and three types, limits legacy exceptions to import declarations,
   and supplies targeted typecheck, selector-test, and pack gates while reserving
   the full package suite for Task 3 and final integration.

## Falsifiers

- Any mismatch in a seven-member hash, `manifestSha256`,
  `protocolBundleSha256`, or `protocolDigest` invalidates this sign.
- Any bundle that is not exact restricted-JCS plus LF, has a domain count other
  than 127, changes or reorders the namespace tuple, uses partial-file artifact
  digests, or has `coreDigest !== protocolDigest` invalidates this sign.
- Any noncanonical pointer or snapshot path, legacy fallback, caller-selected
  authority, create-CAS bypass, pre-evidence activation, or ancestry/T0 validation
  that fails open invalidates this sign.
- Any Task 1 public export beyond the signed two-value/three-type closure, any
  legacy exception outside import declarations, or any failure of the signed
  phase-specific gates invalidates this sign.

## Decision

`UNCONDITIONAL SIGN`
