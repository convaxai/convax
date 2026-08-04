import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "bun:test"

const workflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/desktop-build.yml", import.meta.url)),
  "utf8",
)

describe("manual Desktop installer workflow", () => {
  test("has no automatic trigger and accepts only explicit application channels", () => {
    expect(workflow).toContain("  workflow_dispatch:")
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule):/m)
    expect(workflow).toContain("          - prod\n          - beta\n          - dev")
    expect(workflow).toContain("confirm_commit:")
    expect(workflow.match(/github\.ref == 'refs\/heads\/main'/g)).toHaveLength(2)
    expect(workflow.match(/github\.actor == 'fearclear'/g)).toHaveLength(2)
    expect(workflow.match(/github\.triggering_actor == 'fearclear'/g)).toHaveLength(2)
    expect(workflow.match(/inputs\.confirm_commit == github\.sha/g)).toHaveLength(2)
  })

  test("keeps macOS signing and notarization fail closed behind repository Secrets", () => {
    expect(workflow).not.toContain("environment:")
    expect(workflow).toContain('CONVAX_RELEASE: "true"')
    expect(workflow).toContain("CSC_LINK: ${{ secrets.MAC_CSC_LINK }}")
    expect(workflow).toContain("CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}")
    expect(workflow).toContain("APPLE_ID: ${{ secrets.APPLE_ID }}")
    expect(workflow).toContain("APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}")
    expect(workflow).toContain("APPLE_TEAM_ID: ${{ vars.APPLE_TEAM_ID }}")
    expect(workflow).toContain("CONVAX_PACKAGED_PROVENANCE_DENYLIST_B64: ${{ vars.PACKAGED_PROVENANCE_DENYLIST_B64 }}")
    expect(workflow).toContain('test -n "$CSC_LINK"')
    expect(workflow).toContain('xcrun stapler validate "${apps[0]}"')
    expect(workflow).toContain('spctl --assess --type execute --verbose=4 "${apps[0]}"')
    expect(workflow).toContain('codesign --verify --verbose=2 "${dmgs[0]}"')
    expect(workflow).toContain(
      'spctl --assess --type open --context context:primary-signature --verbose=4 "${dmgs[0]}"',
    )
    expect(workflow).toContain('desktop-packaged-provenance.ts "${apps[0]}"')
  })

  test("makes the temporary Windows unsigned policy explicit", () => {
    const windowsJob = workflow.slice(workflow.indexOf("  windows:"))
    expect(windowsJob).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"')
    expect(windowsJob).not.toContain("CONVAX_RELEASE")
    expect(windowsJob).not.toContain("MAC_CSC_LINK")
    expect(windowsJob).toContain("PACKAGED_PROVENANCE_DENYLIST_B64")
    expect(windowsJob).toContain('$signature.Status -ne "NotSigned"')
    expect(windowsJob).toContain("desktop-packaged-provenance.ts packages/desktop/dist/win-unpacked")
    expect(windowsJob).toContain("packages/desktop/dist/*.exe")
  })

  test("pins every third-party action to an immutable commit", () => {
    const uses = [...workflow.matchAll(/^\s*- uses: (\S+)(?:\s+#.*)?$/gm)].map((match) => match[1]!)
    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/)
  })
})
