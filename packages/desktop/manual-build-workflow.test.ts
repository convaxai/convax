import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"

const workflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/desktop-build.yml", import.meta.url)),
  "utf8",
)

describe("manual Desktop release workflow", () => {
  test("keeps release authority manual, commit-bound, and channel/version explicit", () => {
    expect(workflow).toContain("  workflow_dispatch:")
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule):/m)
    expect(workflow).toContain("          - prod\n          - beta\n          - dev")
    expect(workflow).toContain("version:")
    expect(workflow).toContain("confirm_commit:")
    expect(workflow).toContain("publish:")
    expect(workflow.match(/github\.ref == 'refs\/heads\/main'/g)).toHaveLength(2)
    expect(workflow.match(/github\.actor == 'fearclear'/g)).toHaveLength(2)
    expect(workflow.match(/github\.triggering_actor == 'fearclear'/g)).toHaveLength(2)
    expect(workflow.match(/inputs\.confirm_commit == github\.sha/g)).toHaveLength(2)
  })

  test("fails closed unless both supported platforms are signed and macOS is notarized", () => {
    expect(workflow).toContain('CONVAX_RELEASE: "true"')
    expect(workflow).toContain("CSC_LINK: ${{ secrets.MAC_CSC_LINK }}")
    expect(workflow).toContain("CSC_LINK: ${{ secrets.WIN_CSC_LINK }}")
    expect(workflow).toContain("APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}")
    expect(workflow).toContain("CONVAX_WINDOWS_PUBLISHER_NAME: ${{ vars.WIN_CSC_PUBLISHER_NAME }}")
    expect(workflow).toContain('xcrun stapler validate "${apps[0]}"')
    expect(workflow).toContain('$signature.Status -ne "Valid"')
    expect(workflow).not.toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"')
  })

  test("publishes a complete generic feed only after checksums and signatures pass", () => {
    expect(workflow).toContain("latest.yml")
    expect(workflow).toContain("latest-mac.yml")
    expect(workflow).toContain("sha512:")
    expect(workflow).toContain("Publish artifacts first and update metadata last")
    expect(workflow).toContain('--exclude "*.yml"')
    expect(workflow).toContain("release-assets/latest.yml release-assets/latest-mac.yml")
    expect(workflow).toContain("S3_SECRET_ACCESS_KEY: ${{ secrets.S3_SECRET_ACCESS_KEY }}")
    expect(workflow).toContain('[[ "$S3_ENDPOINT" == https://* ]]')
    expect(workflow).toContain("if: inputs.publish == true")
    expect(workflow).toContain("permissions:\n      contents: write")
    expect(workflow).toContain("version reuse is forbidden")
    expect(workflow).toContain("RELEASE_NOTES: ${{ inputs.release_notes }}")
    expect(workflow).not.toContain("printf '%s\\n' \"${{ inputs.release_notes }}\"")
    expect(workflow).not.toContain("python -m pip install")
  })

  test("pins every third-party action to an immutable commit", () => {
    const uses = [...workflow.matchAll(/^\s*- uses: (\S+)(?:\s+#.*)?$/gm)].map((match) => match[1]!)
    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/)
  })
})
