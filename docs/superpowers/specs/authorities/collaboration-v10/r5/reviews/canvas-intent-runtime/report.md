# Collaboration v10 R5 Canvas intent/runtime authority review

- reviewerRole: `canvas-intent-runtime`
- reviewerTaskPath: `/root/canvas_intent_runtime`
- reviewed formatter delta SHA-256: `d688edd94590ef8b42d5b858a883f6557a79147993dd27ced906b5df1517757c`
- decision: `UNCONDITIONAL SIGN`
- ScoreBasisPoints: `980`

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

The seven-line manifest is strict raw-UTF-8 path sorted, contains exactly the seven
members above, uses two ASCII spaces as its separator, and matches every complete
file including its final LF. The deterministic release verifier reproduced the
installed bundle and manifest byte-for-byte.

The bundle is exact restricted-JCS plus one LF. Independent parse/re-encode checks
confirmed 127 unique raw-UTF-8-sorted digest domains, the exact five-entry
`typeNamespaces` tuple, complete-file artifact digests, and
`coreDigest === protocolDigest`. Main contains the signed section 23 relocation and
36-owner-row graph, section 24 promotion contract, section 24.1 L1 selector gate,
and section 24.2 release falsifiers. The Kernel contains the signed full-file
artifact and namespace contract in section 4. The active pointer is absent, so this
review signs an inactive release and does not activate it.

## Strongest three objections

1. Complete-file annex identity makes editorial Markdown changes protocol changes.
   Flaw type: ignored operational alternative. This is deliberately strict: it
   removes ambiguous normative spans and forces any changed authority byte through
   a new reviewed revision.
2. Task 1 intentionally closes the public collaboration runtime until Task 3.
   Flaw type: hidden integration assumption. The release forbids an independent
   product merge, gives Task 1 targeted gates, and requires the complete package
   test suite in Task 3 and final integration.
3. Git-tree T0 sealing and first-parent verification can reject shallow or
   incomplete CI history. Flaw type: availability tradeoff. Failing closed is the
   required behavior because unavailable ancestry cannot prove an activated
   authority remained immutable.

## Falsifiers

- Any manifest member, bundle byte, manifest byte, or digest differing from the
  values above invalidates this sign.
- A noncanonical bundle, a domain count other than 127, a duplicate/unsorted domain,
  a namespace-tuple change, a partial-file artifact digest, or
  `coreDigest !== protocolDigest` invalidates this sign.
- A pointer created before exact fresh 3/3 evidence, a legacy fallback, a
  caller-selected authority path, or any bypass of the L1 selector invalidates this
  sign.
- Any Task 1 write outside its closed scopes, any public runtime surface beyond the
  signed two-value/three-type closure, or failure of the phase-specific package
  gates invalidates this sign.

## Decision

`UNCONDITIONAL SIGN`
