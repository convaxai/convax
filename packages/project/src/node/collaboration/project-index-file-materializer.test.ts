import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { DigestV2, ProjectIdV2 } from "@convax/collaboration"
import type {
  ProjectIndexFileMaterializationPlanV2,
  ProjectIndexFileMaterializationProjectionPortV2,
} from "../../canvas/project-index-file-application"
import type { ProjectResourceReferenceV2 } from "../../collaboration/project-index"
import { ProjectIndexFileMaterializerV2 } from "./project-index-file-materializer"

const projectId = `project_${"1".repeat(32)}` as ProjectIdV2
const projectEpoch = "2".repeat(32) as ProjectResourceReferenceV2["projectEpoch"]
const encoder = new TextEncoder()
let temporaryRoot: string
let projectRoot: string

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-files-materializer-"))
  projectRoot = path.join(temporaryRoot, "project")
  await fs.mkdir(projectRoot)
})

afterEach(async () => { await fs.rm(temporaryRoot, { recursive: true, force: true }) })

describe("ProjectIndexFileMaterializerV2", () => {
  test("materializes simultaneous peer Markdown heads as primary plus deterministic conflict copy", async () => {
    const primary = encoder.encode("peer A\n")
    const conflict = encoder.encode("peer B\n")
    const state = projection(plan([
      directory("Notes", 1),
      file("Notes/notes.md", primary, 2),
      file(`.convax-conflicts/${fileId(3)}/content`, conflict, 3),
    ]))
    const materializer = await ProjectIndexFileMaterializerV2.open({
      projectId,
      projectRoot,
      projection: state.port,
      blobs: blobPort(new Map([[digest(primary), primary], [digest(conflict), conflict]])),
    })

    expect((await materializer.reconcile()).pendingPaths).toEqual([])
    expect(await fs.readFile(path.join(projectRoot, "Notes", "notes.md"), "utf8")).toBe("peer A\n")
    expect(await fs.readFile(path.join(projectRoot, ".convax-conflicts", fileId(3), "content"), "utf8")).toBe("peer B\n")
  })

  test("does not silently replace unsubmitted native edits when a remote winner arrives", async () => {
    const initial = encoder.encode("initial\n")
    const remote = encoder.encode("remote\n")
    const state = projection(plan([file("notes.md", initial, 1)]))
    const bytes = new Map([[digest(initial), initial], [digest(remote), remote]])
    const materializer = await ProjectIndexFileMaterializerV2.open({ projectId, projectRoot, projection: state.port, blobs: blobPort(bytes) })
    await materializer.reconcile()
    await fs.writeFile(path.join(projectRoot, "notes.md"), "local unsaved\n")
    state.set(plan([file("notes.md", remote, 1)]))

    expect((await materializer.reconcile()).pendingPaths).toEqual([
      { path: "notes.md", code: "native-path-conflict" },
    ])
    expect(await fs.readFile(path.join(projectRoot, "notes.md"), "utf8")).toBe("local unsaved\n")
  })

  test("materializes relocation by stable entry id and removes a matching tombstoned file", async () => {
    const bytes = encoder.encode("stable\n")
    const state = projection(plan([directory("A", 1), file("A/notes.md", bytes, 2)]))
    const materializer = await ProjectIndexFileMaterializerV2.open({
      projectId,
      projectRoot,
      projection: state.port,
      blobs: blobPort(new Map([[digest(bytes), bytes]])),
    })
    await materializer.reconcile()
    state.set(plan([directory("B", 1), file("B/renamed.md", bytes, 2)]))
    await materializer.reconcile()
    expect(await exists(path.join(projectRoot, "A", "notes.md"))).toBeFalse()
    expect(await fs.readFile(path.join(projectRoot, "B", "renamed.md"), "utf8")).toBe("stable\n")

    state.set(plan([]))
    expect((await materializer.reconcile()).removedPaths).toContain("B/renamed.md")
    expect(await exists(path.join(projectRoot, "B", "renamed.md"))).toBeFalse()
  })

  test("waits for a missing blob and succeeds after durable publication", async () => {
    const bytes = encoder.encode("later\n")
    const available = new Map<DigestV2, Uint8Array>()
    const state = projection(plan([file("later.md", bytes, 1)]))
    const materializer = await ProjectIndexFileMaterializerV2.open({ projectId, projectRoot, projection: state.port, blobs: blobPort(available) })
    expect((await materializer.reconcile()).pendingPaths).toEqual([{ path: "later.md", code: "blob-unavailable" }])
    available.set(digest(bytes), bytes)
    expect((await materializer.reconcile()).pendingPaths).toEqual([])
    expect(await fs.readFile(path.join(projectRoot, "later.md"), "utf8")).toBe("later\n")
  })
})

function projection(initial: ProjectIndexFileMaterializationPlanV2) {
  let current = initial
  return {
    port: {
      async queryFileMaterializationPlan() { return current },
    } satisfies ProjectIndexFileMaterializationProjectionPortV2,
    set(next: ProjectIndexFileMaterializationPlanV2) { current = next },
  }
}

function plan(entries: ProjectIndexFileMaterializationPlanV2["entries"]): ProjectIndexFileMaterializationPlanV2 {
  return Object.freeze({ projectId, entries: Object.freeze(entries) })
}

function directory(portablePath: string, id: number) {
  return Object.freeze({ entryId: directoryId(id), kind: "directory" as const, path: portablePath, reference: null })
}

function file(portablePath: string, bytes: Uint8Array, id: number) {
  return Object.freeze({ entryId: fileId(id), kind: "file" as const, path: portablePath, reference: reference(bytes, id) })
}

function reference(bytes: Uint8Array, id: number): ProjectResourceReferenceV2 {
  const blobDigest = digest(bytes)
  const entryFileId = fileId(id)
  return {
    format: "convax.project-resource-reference/2",
    projectId,
    projectEpoch,
    entryFileId,
    familyPrimaryFileId: entryFileId,
    versionId: `pv_${"4".repeat(64)}`,
    canonicalUri: "convax-project://placeholder",
    blob: { format: "convax.blob-ref/2", algorithm: "sha256", digest: blobDigest, byteLength: String(bytes.byteLength) as never, mime: "text/markdown" },
    versionRecordDigest: "5".repeat(64) as DigestV2,
  }
}

function blobPort(available: Map<DigestV2, Uint8Array>) {
  return {
    async copyVerifiedBytesTo(reference: ProjectResourceReferenceV2, stagingPath: string) {
      const bytes = available.get(reference.blob.digest)
      if (!bytes) throw new Error("Project blob is not locally durable")
      await fs.writeFile(stagingPath, bytes, { flag: "wx" })
    },
  }
}

function digest(bytes: Uint8Array): DigestV2 { return createHash("sha256").update(bytes).digest("hex") as DigestV2 }
function fileId(id: number) { return `pf_${id.toString(16).padStart(64, "0")}` as const }
function directoryId(id: number) { return `pd_${id.toString(16).padStart(64, "0")}` as const }
async function exists(target: string) { return fs.lstat(target).then(() => true, () => false) }
