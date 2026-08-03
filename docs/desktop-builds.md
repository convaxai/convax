# Manual Desktop Installers

Convax Desktop installers are built by the `Manual desktop installers` GitHub
Actions workflow. The workflow has only a `workflow_dispatch` trigger and accepts
an explicit `prod`, `beta`, or `dev` channel. It is intentionally restricted to
the `convax-next` branch, the `fearclear` actor, and a manually confirmed exact
commit SHA.

The macOS job runs on an arm64 GitHub-hosted runner and always fails closed unless
it can sign with a Developer ID Application certificate and notarize with Apple.
It uploads the resulting DMG, ZIP, and blockmaps only after verifying the app and
DMG signatures, stapled notarization ticket, Gatekeeper assessments, and packaged
application startup. A provenance gate also rejects the configured prohibited
associations from packaged application bytes. The separately bundled OpenCode
runtime is the only explicit exception to that scan.

The Windows job currently produces an explicitly unsigned x64 NSIS installer. It
asserts that the installer is unsigned, runs the same packaged startup smoke, and
then uploads the EXE. Add Windows signing as a separate credential and policy
change; do not overload the macOS release secrets.

## GitHub configuration

Store signing and notarization credentials as repository Actions Secrets. Store
the two non-sensitive policy values as repository Variables:

| Kind     | Name                               | Value                                            |
| -------- | ---------------------------------- | ------------------------------------------------ |
| Secret   | `MAC_CSC_LINK`                     | Base64-encoded Developer ID Application `.p12`   |
| Secret   | `MAC_CSC_KEY_PASSWORD`             | Password used when exporting the `.p12`          |
| Secret   | `APPLE_ID`                         | Apple account used for notarization              |
| Secret   | `APPLE_APP_SPECIFIC_PASSWORD`      | Apple app-specific password                      |
| Variable | `APPLE_TEAM_ID`                    | Ten-character Apple Developer Team ID            |
| Variable | `PACKAGED_PROVENANCE_DENYLIST_B64` | Base64 JSON array of prohibited artifact markers |

The P12 and both passwords are secrets, not Actions Variables. Never commit the
P12, paste its Base64 into workflow YAML, or upload it as an Actions artifact.

This private repository's current GitHub plan does not provide Environment
Secrets, deployment branch policies, or branch protection. Repository Secrets are
therefore exposed to the trust boundary of every collaborator who can modify an
Actions workflow. The actor, branch, re-run actor, and exact-SHA guards prevent
accidental use but cannot defend against a collaborator deliberately replacing the
workflow. Upload the Developer ID P12 only when that collaborator trust boundary
is explicitly accepted.

The provenance denylist stays in repository settings so prohibited association
values do not become source or artifact metadata. Matching is ASCII
case-insensitive, the workflow fails when the Variable is absent, and logs expose
only the affected packaged file plus a marker number. The OpenCode runtime remains
the sole explicit exception.

To send a P12 to GitHub without writing its Base64 form to another file:

```bash
base64 -i DeveloperIDApplication.p12 | gh secret set MAC_CSC_LINK \
  --repo microvoid/convax
```

Set the other secrets from a hidden prompt:

```bash
gh secret set MAC_CSC_KEY_PASSWORD --repo microvoid/convax
gh secret set APPLE_ID --repo microvoid/convax
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo microvoid/convax
gh variable set APPLE_TEAM_ID --repo microvoid/convax
gh variable set PACKAGED_PROVENANCE_DENYLIST_B64 --repo microvoid/convax
```

## Run and download

Run only a merged `convax-next` revision:

```bash
gh workflow run desktop-build.yml --repo microvoid/convax --ref convax-next \
  -f channel=prod -f confirm_commit=<40-character-convax-next-sha>
```

Download the completed run's artifacts from its GitHub Actions page. Artifact
names contain the channel, platform, architecture, signing state, and exact commit
SHA. GitHub retains them for 14 days; this workflow does not create a Release or
publish an update automatically.
