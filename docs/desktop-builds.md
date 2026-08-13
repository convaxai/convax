# Desktop Releases and Client Updates

Convax Desktop releases are built by the `Manual desktop release` GitHub Actions
workflow. The workflow has only a `workflow_dispatch` trigger and accepts an exact
`prod`, `beta`, or `dev` channel, SemVer, release note, `main` commit SHA, and an
explicit publish choice. It remains restricted to the `fearclear` actor and re-run
actor. A version may be published once; a pre-existing GitHub Release tag fails the
workflow instead of replacing bytes behind an existing update identity.

The signed macOS arm64 and Windows x64 jobs must both pass before publication. The
macOS job verifies the application and DMG signatures, stapled notarization ticket,
Gatekeeper assessments, updater ZIP/metadata, provenance, and packaged startup. The
Windows job verifies Authenticode publisher identity, updater EXE/metadata,
provenance, and packaged startup. Unsigned Windows update artifacts are not admitted.

The private GitHub Release is immutable review/download evidence. Clients read a
public generic HTTPS update feed because a private GitHub provider would require a
GitHub token on every user machine. The publish job uploads versioned installers,
ZIPs, and blockmaps first with immutable caching, then uploads `latest.yml` and
`latest-mac.yml` last with a short cache lifetime. This prevents clients from seeing
metadata for an artifact that is not yet available.

## GitHub configuration

Secrets remain only in GitHub Actions. The public feed root, certificate publisher
name, Apple Team ID, and provenance policy are repository Variables. Never commit a
certificate, access key, password, Base64 credential, signed CDN URL, or secret-valued
query parameter.

| Kind     | Name                               | Purpose                                             |
| -------- | ---------------------------------- | --------------------------------------------------- |
| Secret   | `MAC_CSC_LINK`                     | Base64 Developer ID Application `.p12`              |
| Secret   | `MAC_CSC_KEY_PASSWORD`             | macOS certificate export password                   |
| Secret   | `APPLE_ID`                         | Apple notarization account                          |
| Secret   | `APPLE_APP_SPECIFIC_PASSWORD`      | Apple notarization app password                     |
| Secret   | `WIN_CSC_LINK`                     | Base64 Windows Authenticode `.pfx`                  |
| Secret   | `WIN_CSC_KEY_PASSWORD`             | Windows certificate export password                 |
| Secret   | `S3_ACCESS_KEY_ID`                 | R2/S3 update publisher access key                   |
| Secret   | `S3_SECRET_ACCESS_KEY`             | R2/S3 update publisher secret key                   |
| Secret   | `S3_BUCKET`                        | Update bucket                                       |
| Secret   | `S3_ENDPOINT`                      | R2/S3 API endpoint                                  |
| Secret   | `S3_REGION`                        | R2/S3 signing region                                |
| Secret   | `S3_PREFIX`                        | Optional private object prefix                      |
| Variable | `CONVAX_UPDATE_BASE_URL`           | Public HTTPS CDN root, without `/desktop/<channel>` |
| Variable | `WIN_CSC_PUBLISHER_NAME`           | Exact Authenticode certificate subject fragment     |
| Variable | `APPLE_TEAM_ID`                    | Ten-character Apple Developer Team ID               |
| Variable | `PACKAGED_PROVENANCE_DENYLIST_B64` | Base64 JSON array of prohibited artifact markers    |

GitHub never exposes an existing Secret value through its API. Values from another
repository must be re-entered by an authorized human or replaced with newly issued,
least-privilege credentials; do not add a workflow that exports them.

Configure values from hidden prompts or local certificate files:

```bash
base64 -i DeveloperIDApplication.p12 | gh secret set MAC_CSC_LINK --repo convaxai/convax
gh secret set MAC_CSC_KEY_PASSWORD --repo convaxai/convax
gh secret set APPLE_ID --repo convaxai/convax
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo convaxai/convax

base64 -i Authenticode.pfx | gh secret set WIN_CSC_LINK --repo convaxai/convax
gh secret set WIN_CSC_KEY_PASSWORD --repo convaxai/convax

gh secret set S3_ACCESS_KEY_ID --repo convaxai/convax
gh secret set S3_SECRET_ACCESS_KEY --repo convaxai/convax
gh secret set S3_BUCKET --repo convaxai/convax
gh secret set S3_ENDPOINT --repo convaxai/convax
gh secret set S3_REGION --repo convaxai/convax
gh secret set S3_PREFIX --repo convaxai/convax

gh variable set CONVAX_UPDATE_BASE_URL --repo convaxai/convax --body https://updates.example.com
gh variable set WIN_CSC_PUBLISHER_NAME --repo convaxai/convax --body "Example Publisher"
gh variable set APPLE_TEAM_ID --repo convaxai/convax
gh variable set PACKAGED_PROVENANCE_DENYLIST_B64 --repo convaxai/convax
```

Repository Secrets are exposed to the trust boundary of collaborators who can
modify an Actions workflow. The actor, branch, re-run actor, exact-SHA, signing, and
publish gates prevent accidental use, but they do not defend against an authorized
collaborator deliberately replacing the workflow. Use least-privilege R2 credentials
restricted to the configured prefix and rotate them after suspected workflow
compromise.

## Client behavior

The Main-owned update controller is active only in packaged macOS and Windows builds.
It performs a silent startup check and exposes `Check for Updates…` in the native app
menu on macOS and Help menu on Windows. It displays the version, bounded release
notes, and minimum-system compatibility metadata. Downloads use updater SHA-512 and
platform signature verification, expose progress, support cancellation, and may
resume verified cached bytes on retry.

`Restart and install` first crosses the existing shutdown barrier: pending Project
writes are flushed, accepted Agent/generation work is drained, authorization handoffs
finish, and collaboration runtimes close. Only then may `quitAndInstall` close the
windows. If preparation or installer startup fails, Convax relaunches the current
version. Project files, Plugin closures/configuration, and renderer preferences are
outside the replaceable application bundle and are not migrated by the updater.

## Run and verify

Run only a merged `main` revision. Omit `publish=true` for a signed review build;
publishing requires the complete cross-platform artifact set and every feed secret.

```bash
gh workflow run desktop-build.yml --repo convaxai/convax --ref main \
  -f channel=dev \
  -f version=0.1.0-dev.1 \
  -f confirm_commit=<40-character-main-sha> \
  -f release_notes='Updater test release' \
  -f publish=false
```

Before promoting `prod`, exercise two sequential versions on both supported
platforms and record evidence for: no update, update found/release notes, cancel and
retry, corrupted artifact checksum rejection, offline download failure and retry,
install/restart, current-version recovery after installer failure, and preservation
of a Project, installed Plugin configuration, and preferences. Unit and workflow
contract tests are necessary but do not substitute for this installed N→N+1 check.
