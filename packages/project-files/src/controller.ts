import type {
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectEntryKind,
  ProjectFilesClient,
  ProjectTextPreviewContents,
} from "./contracts"

export interface ProjectFilesSelectionIntent {
  range: boolean
  toggle: boolean
}

export interface ProjectFilesControllerSnapshot {
  error: string | null
  expandedPaths: string[]
  listings: Record<string, ProjectDirectoryListing>
  loadingPaths: string[]
  projectId: string | null
  selectedPaths: string[]
}

const initialSnapshot: ProjectFilesControllerSnapshot = {
  error: null,
  expandedPaths: [],
  listings: {},
  loadingPaths: [],
  projectId: null,
  selectedPaths: [],
}

export class ProjectFilesController {
  private snapshot = initialSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly directoryRequests = new Map<string, number>()
  private nextDirectoryRequestId = 0
  private generation = 0
  private changeTimer: ReturnType<typeof setTimeout> | undefined
  private pendingDirectoryRefresh = false
  private readonly stopChanges: () => void

  constructor(private readonly client: ProjectFilesClient) {
    this.stopChanges = client.onDidChange((event) => {
      if (event.projectId !== this.snapshot.projectId) return
      this.pendingDirectoryRefresh = true
      if (this.changeTimer) clearTimeout(this.changeTimer)
      this.changeTimer = setTimeout(() => {
        this.changeTimer = undefined
        const refreshDirectories = this.pendingDirectoryRefresh
        this.pendingDirectoryRefresh = false
        if (refreshDirectories) void this.refreshVisibleDirectories()
      }, 120)
    })
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async setProject(projectId: string | null) {
    if (projectId === this.snapshot.projectId) return
    const generation = ++this.generation
    this.directoryRequests.clear()
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.changeTimer = undefined
    this.pendingDirectoryRefresh = false
    this.update({
      error: null,
      expandedPaths: [],
      listings: {},
      loadingPaths: [],
      projectId,
      selectedPaths: [],
    })
    if (projectId) await this.loadDirectory("", generation)
  }

  async readTextPreview(path: string): Promise<ProjectTextPreviewContents | undefined> {
    const projectId = this.snapshot.projectId
    if (!projectId) return
    const generation = this.generation
    try {
      const preview = await this.client.readTextPreview({ path, projectId })
      return this.isActive(projectId, generation) ? preview : undefined
    } catch {
      return
    }
  }

  async loadDirectory(path = "", expectedGeneration = this.generation) {
    if (expectedGeneration !== this.generation) return
    const projectId = this.snapshot.projectId
    if (!projectId) return
    const requestId = ++this.nextDirectoryRequestId
    this.directoryRequests.set(path, requestId)
    this.update({ loadingPaths: addUnique(this.snapshot.loadingPaths, path) })
    try {
      const listing = await this.client.listDirectory({ path, projectId })
      if (!this.isCurrentDirectoryRequest(projectId, path, requestId, expectedGeneration)) return
      const previousListing = this.snapshot.listings[path]
      const nextDirectories = new Set(
        listing.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
      )
      const vanishedDirectories = (previousListing?.entries ?? [])
        .filter((entry) => entry.kind === "directory" && !nextDirectories.has(entry.path))
        .map((entry) => entry.path)
      this.update({
        error: null,
        listings: { ...this.snapshot.listings, [path]: listing },
      })
      if (vanishedDirectories.length > 0) this.pruneSubtrees(vanishedDirectories)
    } catch (error) {
      if (this.isCurrentDirectoryRequest(projectId, path, requestId, expectedGeneration)) {
        this.update({ error: errorMessage(error) })
      }
    } finally {
      if (this.isCurrentDirectoryRequest(projectId, path, requestId, expectedGeneration)) {
        this.update({ loadingPaths: this.snapshot.loadingPaths.filter((candidate) => candidate !== path) })
      }
    }
  }

  async toggleDirectory(path: string) {
    if (this.snapshot.expandedPaths.includes(path)) {
      this.update({ expandedPaths: this.snapshot.expandedPaths.filter((candidate) => candidate !== path) })
      return
    }
    this.update({ expandedPaths: [...this.snapshot.expandedPaths, path] })
    await this.loadDirectory(path)
  }

  async refreshVisibleDirectories() {
    if (!this.snapshot.projectId) return
    const paths = ["", ...this.snapshot.expandedPaths.filter((path) => this.snapshot.listings[path])]
    await Promise.all(paths.map((path) => this.loadDirectory(path)))
  }

  selectEntry(path: string, intent: ProjectFilesSelectionIntent) {
    const visiblePaths = this.getVisibleEntries().map((entry) => entry.path)
    if (intent.range && this.snapshot.selectedPaths.length > 0) {
      const anchorIndex = visiblePaths.indexOf(this.snapshot.selectedPaths[0])
      const targetIndex = visiblePaths.indexOf(path)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        this.update({ selectedPaths: visiblePaths.slice(start, end + 1) })
        return
      }
    }
    if (intent.toggle) {
      const selected = new Set(this.snapshot.selectedPaths)
      if (selected.has(path)) selected.delete(path)
      else selected.add(path)
      this.update({ selectedPaths: visiblePaths.filter((candidate) => selected.has(candidate)) })
      return
    }
    this.update({ selectedPaths: [path] })
  }

  clearSelection() {
    this.update({ selectedPaths: [] })
  }

  clearError() {
    this.update({ error: null })
  }

  async createEntry(input: { content?: string; kind: ProjectEntryKind; name: string; parentPath?: string }) {
    const projectId = this.snapshot.projectId
    if (!projectId) return
    const generation = this.generation
    try {
      const result = await this.client.createEntry({ ...input, parentPath: input.parentPath ?? "", projectId })
      if (!this.isActive(projectId, generation)) return
      await this.loadDirectory(input.parentPath ?? "", generation)
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths?.slice(-1) ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async renameEntry(path: string, name: string) {
    const projectId = this.snapshot.projectId
    if (!projectId || !name.trim()) return
    const generation = this.generation
    try {
      const result = await this.client.renameEntry({ name: name.trim(), path, projectId })
      if (!this.isActive(projectId, generation)) return
      const parentPath = parentOf(path)
      this.pruneSubtrees([path])
      await this.loadDirectory(parentPath, generation)
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths?.slice(-1) ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async moveEntries(paths: string[], destinationPath = "") {
    const projectId = this.snapshot.projectId
    const roots = normalizeSelectionRoots(paths)
    if (!projectId || roots.length === 0) return
    const generation = this.generation
    try {
      const result = await this.client.moveEntries({ destinationPath, paths: roots, projectId })
      if (!this.isActive(projectId, generation)) return
      const parents = new Set([destinationPath, ...roots.map(parentOf)])
      this.pruneSubtrees(roots)
      await Promise.all([...parents].map((path) => this.loadDirectory(path, generation)))
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async deleteEntries(paths: string[]) {
    const projectId = this.snapshot.projectId
    const roots = normalizeSelectionRoots(paths)
    if (!projectId || roots.length === 0) return
    const generation = this.generation
    try {
      await this.client.deleteEntries({ paths: roots, projectId })
      if (!this.isActive(projectId, generation)) return
      const parents = new Set(roots.map(parentOf))
      this.pruneSubtrees(roots)
      await Promise.all([...parents].map((path) => this.loadDirectory(path, generation)))
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async importEntries(sourceTokens: string[], destinationPath = "") {
    const projectId = this.snapshot.projectId
    const tokens = [...new Set(sourceTokens.filter(Boolean))]
    if (!projectId || tokens.length === 0) return
    const generation = this.generation
    try {
      const result = await this.client.importEntries({ destinationPath, projectId, sourceTokens: tokens })
      if (!this.isActive(projectId, generation)) return
      await this.loadDirectory(destinationPath, generation)
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async importDroppedFiles(files: readonly File[], destinationPath = "") {
    await this.importEntries(files.map((file) => this.client.createImportToken(file)).filter(Boolean), destinationPath)
  }

  async revealEntry(path?: string) {
    const projectId = this.snapshot.projectId
    if (!projectId) return
    const generation = this.generation
    try {
      await this.client.revealEntry({ path, projectId })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async openEntry(path: string) {
    const projectId = this.snapshot.projectId
    if (!projectId) return
    const generation = this.generation
    try {
      const result = await this.client.openEntry({ path, projectId })
      if (result.error && this.isActive(projectId, generation)) this.update({ error: result.error })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  dispose() {
    this.generation += 1
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.pendingDirectoryRefresh = false
    this.stopChanges()
    this.listeners.clear()
  }

  private isCurrentDirectoryRequest(projectId: string, path: string, requestId: number, generation: number) {
    return generation === this.generation
      && projectId === this.snapshot.projectId
      && this.directoryRequests.get(path) === requestId
  }

  private getVisibleEntries() {
    const entries: ProjectEntry[] = []
    const visit = (path: string) => {
      for (const entry of this.snapshot.listings[path]?.entries ?? []) {
        entries.push(entry)
        if (entry.kind === "directory" && this.snapshot.expandedPaths.includes(entry.path)) visit(entry.path)
      }
    }
    visit("")
    return entries
  }

  private isActive(projectId: string, generation: number) {
    return projectId === this.snapshot.projectId && generation === this.generation
  }

  private pruneSubtrees(paths: string[]) {
    const isPruned = (candidate: string) => paths.some((path) => candidate === path || candidate.startsWith(`${path}/`))
    for (const path of this.directoryRequests.keys()) {
      if (isPruned(path)) this.directoryRequests.delete(path)
    }
    this.update({
      expandedPaths: this.snapshot.expandedPaths.filter((path) => !isPruned(path)),
      listings: Object.fromEntries(Object.entries(this.snapshot.listings).filter(([path]) => !isPruned(path))),
      loadingPaths: this.snapshot.loadingPaths.filter((path) => !isPruned(path)),
      selectedPaths: this.snapshot.selectedPaths.filter((path) => !isPruned(path)),
    })
  }

  private update(patch: Partial<ProjectFilesControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function addUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value]
}

function parentOf(path: string) {
  const index = path.lastIndexOf("/")
  return index < 0 ? "" : path.slice(0, index)
}

function normalizeSelectionRoots(paths: readonly string[]) {
  const selected = new Set(paths)
  return [...selected].filter((path) => {
    const segments = path.split("/")
    return !segments.slice(0, -1).some((_, index) => selected.has(segments.slice(0, index + 1).join("/")))
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
