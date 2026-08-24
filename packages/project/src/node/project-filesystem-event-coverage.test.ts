import { describe, expect, test } from "bun:test"
import { NodeProjectFilesystemEventCoverage } from "./project-filesystem-event-coverage"

describe("NodeProjectFilesystemEventCoverage", () => {
  test("consumes one exact verified publication event", async () => {
    const coverage = new NodeProjectFilesystemEventCoverage()
    let verifications = 0
    coverage.cover({
      path: "Notes/Untitled-one.md",
      projectId: "project_one",
      async verifyCurrent() {
        verifications += 1
        return true
      },
    })

    await expect(
      coverage.consume({ path: "Notes/Untitled-one.md", projectId: "project_one" }),
    ).resolves.toBe(true)
    await expect(
      coverage.consume({ path: "Notes/Untitled-one.md", projectId: "project_one" }),
    ).resolves.toBe(false)
    await expect(
      coverage.consume({ path: "Notes/Untitled-one.md", projectId: "project_two" }),
    ).resolves.toBe(false)
    expect(verifications).toBe(1)
  })

  test("fails open when the published file no longer verifies", async () => {
    const coverage = new NodeProjectFilesystemEventCoverage()
    coverage.cover({
      path: "Notes/Untitled-one.md",
      projectId: "project_one",
      verifyCurrent: async () => false,
    })

    await expect(
      coverage.consume({ path: "Notes/Untitled-one.md", projectId: "project_one" }),
    ).resolves.toBe(false)
  })
})
