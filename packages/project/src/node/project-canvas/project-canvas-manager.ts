import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { ProjectCanvas, ProjectCanvasCatalog } from "../../canvas/contracts"
import type { ProjectPrivatePathResolver, ProjectPrivateStorage } from "../project-private-storage"
import type { ProjectCanvasCatalogStore } from "./project-canvas-document-repository"

interface ProjectCanvasCatalogFile {
  canvases: ProjectCanvas[]
  schemaVersion: "convax.project-canvases/2"
}

interface ProjectCanvasCatalogSnapshot {
  catalog: ProjectCanvasCatalogFile
  storageVersion: string | null
}

export interface NodeProjectCanvasManagerOptions {
  now?: () => number
}

export class NodeProjectCanvasManager implements ProjectCanvasCatalogStore {
  private readonly now: () => number
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly storage: ProjectPrivateStorage,
    private readonly privatePaths: ProjectPrivatePathResolver,
    options: NodeProjectCanvasManagerOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  getCanvasCatalog(input: { projectId: string }): Promise<ProjectCanvasCatalog> {
    return this.queue(input.projectId, async () => {
      const current = await this.ensureCatalog(input.projectId)
      return toCatalog(input.projectId, current.catalog)
    })
  }

  runCurrentCatalogMaintenance<T>(
    input: { projectId: string },
    operation: (catalog: ProjectCanvasCatalogFile) => Promise<T>,
  ): Promise<T> {
    return this.queue(input.projectId, async () => {
      const stored = await this.storage.readPrivateTextFile(catalogRef(input.projectId))
      if (!stored.exists) throw new Error("Current Canvas catalog is missing")
      return operation(parseStrictCurrentCatalog(JSON.parse(stored.content)))
    })
  }

  createCanvas(input: {
    name?: string
    projectId: string
  }): Promise<{ canvas: ProjectCanvas; catalog: ProjectCanvasCatalog }> {
    return this.queue(input.projectId, async () => {
      const current = await this.ensureCatalog(input.projectId)
      const timestamp = this.now()
      let id = createCanvasId()
      while (current.catalog.canvases.some((canvas) => canvas.id === id)) id = createCanvasId()
      const canvas = {
        createdAt: timestamp,
        id,
        name: validateCanvasName(input.name ?? `Canvas ${current.catalog.canvases.length + 1}`),
        updatedAt: timestamp,
      }
      const directory = await this.privatePaths.resolvePrivatePath({
        path: canvasStoragePath(canvas.id),
        projectId: input.projectId,
      })
      await fs.mkdir(directory, { recursive: false })
      const next = { ...current.catalog, canvases: [...current.catalog.canvases, canvas] }
      try {
        await this.writeCatalog(input.projectId, next, current.storageVersion)
      } catch (error) {
        await this.privatePaths
          .resolvePrivatePath({ path: canvasStoragePath(canvas.id), projectId: input.projectId })
          .then((safeDirectory) => fs.rm(safeDirectory, { force: true, recursive: true }))
          .catch(() => undefined)
        throw error
      }
      return { canvas, catalog: toCatalog(input.projectId, next) }
    })
  }

  renameCanvas(input: {
    canvasId: string
    name: string
    projectId: string
  }): Promise<{ canvas: ProjectCanvas; catalog: ProjectCanvasCatalog }> {
    return this.queue(input.projectId, async () => {
      const current = await this.ensureCatalog(input.projectId)
      const canvasId = requireCanvasId(input.canvasId)
      const existing = current.catalog.canvases.find((canvas) => canvas.id === canvasId)
      if (!existing) throw new Error(`Canvas was not found: ${input.canvasId}`)
      const canvas = { ...existing, name: validateCanvasName(input.name), updatedAt: this.now() }
      const next = {
        ...current.catalog,
        canvases: current.catalog.canvases.map((candidate) => (candidate.id === canvasId ? canvas : candidate)),
      }
      await this.writeCatalog(input.projectId, next, current.storageVersion)
      return { canvas, catalog: toCatalog(input.projectId, next) }
    })
  }

  touchCanvas(input: { canvasId: string; projectId: string }): Promise<ProjectCanvas> {
    return this.queue(input.projectId, async () => {
      const current = await this.ensureCatalog(input.projectId)
      const canvasId = requireCanvasId(input.canvasId)
      const existing = current.catalog.canvases.find((canvas) => canvas.id === canvasId)
      if (!existing) throw new Error(`Canvas was not found: ${input.canvasId}`)
      const canvas = { ...existing, updatedAt: this.now() }
      await this.writeCatalog(
        input.projectId,
        {
          ...current.catalog,
          canvases: current.catalog.canvases.map((candidate) => (candidate.id === canvasId ? canvas : candidate)),
        },
        current.storageVersion,
      )
      return canvas
    })
  }

  deleteCanvas(input: {
    canvasId: string
    projectId: string
  }): Promise<{ deleted: boolean; catalog: ProjectCanvasCatalog }> {
    return this.queue(input.projectId, async () => {
      const current = await this.ensureCatalog(input.projectId)
      const canvasId = requireCanvasId(input.canvasId)
      if (!current.catalog.canvases.some((canvas) => canvas.id === canvasId)) {
        return {
          deleted: false,
          catalog: toCatalog(input.projectId, current.catalog),
        }
      }
      if (current.catalog.canvases.length === 1) throw new Error("The last canvas in a project cannot be deleted")
      const canvases = current.catalog.canvases.filter((canvas) => canvas.id !== canvasId)
      const next = {
        ...current.catalog,
        canvases,
      }
      const source = await this.privatePaths.resolvePrivatePath({
        path: canvasStoragePath(canvasId),
        projectId: input.projectId,
      })
      const tombstoneName = `${canvasId}-${randomUUID()}`
      const tombstone = await this.privatePaths.resolvePrivatePath({
        path: `deleted-canvases/${tombstoneName}`,
        projectId: input.projectId,
      })
      const tombstoneRoot = path.dirname(tombstone)
      let moved = false
      const stat = await fs.lstat(source).catch((error: unknown) => {
        if (isNodeError(error) && error.code === "ENOENT") return null
        throw error
      })
      if (stat) {
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error(`Canvas storage is not a directory: ${canvasId}`)
        await fs.mkdir(tombstoneRoot, { recursive: true })
        await fs.rename(source, tombstone)
        moved = true
      }
      try {
        await this.writeCatalog(input.projectId, next, current.storageVersion)
      } catch (error) {
        if (moved) {
          await Promise.all([
            this.privatePaths.resolvePrivatePath({
              path: `deleted-canvases/${tombstoneName}`,
              projectId: input.projectId,
            }),
            this.privatePaths.resolvePrivatePath({ path: canvasStoragePath(canvasId), projectId: input.projectId }),
          ])
            .then(([safeTombstone, safeSource]) => fs.rename(safeTombstone, safeSource))
            .catch(() => undefined)
        }
        throw error
      }
      if (moved) {
        await this.privatePaths
          .resolvePrivatePath({ path: `deleted-canvases/${tombstoneName}`, projectId: input.projectId })
          .then((safeTombstone) => fs.rm(safeTombstone, { force: true, recursive: true }))
          .catch(() => undefined)
      }
      return { deleted: true, catalog: toCatalog(input.projectId, next) }
    })
  }

  private async ensureCatalog(projectId: string): Promise<ProjectCanvasCatalogSnapshot> {
    const stored = await this.storage.readPrivateTextFile(catalogRef(projectId))
    if (stored.exists) {
      return { catalog: parseStrictCurrentCatalog(JSON.parse(stored.content)), storageVersion: stored.version }
    }
    return this.createCatalog(projectId)
  }

  private async createCatalog(projectId: string): Promise<ProjectCanvasCatalogSnapshot> {
    const timestamp = this.now()
    const canvases = [{ createdAt: timestamp, id: "canvas-main", name: "Canvas 1", updatedAt: timestamp }]
    const catalog: ProjectCanvasCatalogFile = {
      canvases,
      schemaVersion: "convax.project-canvases/2",
    }
    const directory = await this.privatePaths.resolvePrivatePath({ path: canvasStoragePath("canvas-main"), projectId })
    await fs.mkdir(directory, { recursive: true })
    const result = await this.writeCatalog(projectId, catalog, null)
    return { catalog, storageVersion: result.version }
  }

  private writeCatalog(projectId: string, catalog: ProjectCanvasCatalogFile, expectedVersion: string | null) {
    return this.storage.writePrivateTextFile({
      ...catalogRef(projectId),
      content: `${JSON.stringify(catalog, null, 2)}\n`,
      expectedVersion,
    })
  }

  private async queue<T>(projectId: string, operation: () => Promise<T>) {
    const previous = this.queues.get(projectId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.queues.set(projectId, settled)
    try {
      return await result
    } finally {
      if (this.queues.get(projectId) === settled) this.queues.delete(projectId)
    }
  }
}

function catalogRef(projectId: string) {
  return { namespace: "canvases", path: "catalog.json", projectId }
}

function toCatalog(projectId: string, catalog: ProjectCanvasCatalogFile): ProjectCanvasCatalog {
  return { canvases: catalog.canvases, projectId }
}

function canvasStoragePath(canvasId: string) {
  return `canvases/${requireCanvasId(canvasId)}`
}

function createCanvasId() {
  return `canvas_${randomUUID().replaceAll("-", "")}`
}

function requireCanvasId(value: unknown) {
  if (typeof value !== "string" || !/^canvas[-_][a-z0-9][a-z0-9_-]{0,79}$/.test(value)) {
    throw new Error(`Invalid canvas id: ${String(value)}`)
  }
  return value
}

function validateCanvasName(value: string) {
  const name = value.trim()
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error(`Invalid canvas name: ${value}`)
  return name
}

function parseStrictCurrentCatalog(value: unknown): ProjectCanvasCatalogFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Current Canvas catalog is invalid")
  }
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== "canvases" || keys[1] !== "schemaVersion") {
    throw new Error("Current Canvas catalog contains unsupported fields")
  }
  const input = value as { canvases?: unknown; schemaVersion?: unknown }
  if (input.schemaVersion !== "convax.project-canvases/2" || !Array.isArray(input.canvases)) {
    throw new Error("Current Canvas catalog schema is not supported")
  }
  for (const candidate of input.canvases) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Current Canvas catalog contains an invalid canvas")
    }
    const canvasKeys = Object.keys(candidate).sort()
    if (
      canvasKeys.length !== 4 ||
      canvasKeys[0] !== "createdAt" ||
      canvasKeys[1] !== "id" ||
      canvasKeys[2] !== "name" ||
      canvasKeys[3] !== "updatedAt"
    ) {
      throw new Error("Current Canvas catalog contains unsupported Canvas fields")
    }
  }
  const canvases = parseCanvases(input.canvases)
  if (canvases.length === 0) throw new Error("Canvas catalog must contain at least one canvas")
  return { canvases, schemaVersion: "convax.project-canvases/2" }
}

function parseCanvases(values: unknown[]): ProjectCanvas[] {
  const ids = new Set<string>()
  return values.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Canvas catalog contains an invalid canvas")
    const canvas = value as Partial<ProjectCanvas>
    const id = requireCanvasId(canvas.id)
    if (ids.has(id)) throw new Error(`Canvas catalog contains a duplicate canvas: ${id}`)
    ids.add(id)
    if (
      typeof canvas.createdAt !== "number" ||
      !Number.isFinite(canvas.createdAt) ||
      typeof canvas.updatedAt !== "number" ||
      !Number.isFinite(canvas.updatedAt) ||
      typeof canvas.name !== "string"
    )
      throw new Error(`Canvas catalog contains an invalid canvas: ${id}`)
    return { createdAt: canvas.createdAt, id, name: validateCanvasName(canvas.name), updatedAt: canvas.updatedAt }
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
