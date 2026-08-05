import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const indexSource = readFileSync(fileURLToPath(new URL("./index.tsx", import.meta.url)), "utf8")
const projectHomeSource = readFileSync(fileURLToPath(new URL("./project-home.tsx", import.meta.url)), "utf8")
const mainSource = readFileSync(fileURLToPath(new URL("../main/index.ts", import.meta.url)), "utf8")
const sharingActivationSource = readFileSync(
  fileURLToPath(new URL("../main/project-sharing-activation.ts", import.meta.url)),
  "utf8",
)
const packagedSmokeSource = readFileSync(
  fileURLToPath(new URL("../../scripts/desktop-packaged-smoke.ts", import.meta.url)),
  "utf8",
)

describe("Desktop Project startup wiring", () => {
  test("Desktop owns registry initialization and gates first-run onboarding", () => {
    expect(indexSource).toContain("void projectController.initialize()")
    expect(indexSource).toContain("resolveProjectBootstrapView")
    expect(indexSource).toContain('projectBootstrapView.kind === "onboarding"')
    expect(indexSource).toContain('projectBootstrapView.kind === "recovery"')
    expect(indexSource).toContain("<ProjectRegistryLoadingState")
    expect(indexSource).toContain("<ProjectRecoveryState")
    expect(indexSource).toContain("<ProjectHome")
    expect(projectHomeSource).not.toContain("controller.initialize()")
  })

  test("restores an available Project through the existing workspace coordinator", () => {
    expect(indexSource).toContain('desktopSurface.kind !== "home"')
    expect(indexSource).toContain("workspaceEntryCoordinator")
    expect(indexSource).toContain(".enter({ projectId: startupProjectId")
    expect(indexSource).toContain("setStartupEntryFailure")
    expect(indexSource).not.toContain('id: "navigation.home"')
    expect(indexSource).not.toContain("openDesktopHome")
  })

  test("packaged smoke seeds a Project without bypassing collaboration authority", () => {
    expect(packagedSmokeSource).toContain("the packaged local Project authority recovery surface")
    expect(packagedSmokeSource).toContain("OS-backed replica signing vault is unavailable")
    expect(packagedSmokeSource).toContain("The packaged Desktop exposed a Canvas without admitted local authority")
    expect(packagedSmokeSource).toContain("showed first-run onboarding despite having a seeded Project")
    expect(packagedSmokeSource).not.toContain(
      'await waitFor(() => document.querySelector(".convax-canvas"), "the packaged Canvas")',
    )
    expect(packagedSmokeSource).not.toContain("the packaged Home or Canvas")
    expect(packagedSmokeSource).not.toContain("the seeded Project entry")
  })

  test("keeps Team collaboration lazy and exposes sharing as an explicit Project action", () => {
    expect(mainSource).toContain("activateProjectSharingFromDurableBindingV2")
    expect(sharingActivationSource).toContain('binding === "missing"')
    expect(sharingActivationSource).toContain("input.service.activateLocalProject(projectId)")
    expect(indexSource).toContain('data-project-share=""')
    expect(indexSource).toContain("ProjectCollaborationPendingState")
  })
})
