export type ProjectEntryKind = "directory" | "file"

export interface ProjectRecord {
  createdAt: number
  id: string
  lastOpenedAt: number
  missing?: boolean
  name: string
  rootPath: string
}

export interface ProjectCanvas {
  createdAt: number
  id: string
  name: string
  updatedAt: number
}

export interface ProjectWorkspace {
  activeCanvasId: string
  canvases: ProjectCanvas[]
  projectId: string
}

export interface ProjectEntry {
  kind: ProjectEntryKind
  modifiedAt: number
  name: string
  parentPath: string
  path: string
  size?: number
}

export interface ProjectDirectoryListing {
  entries: ProjectEntry[]
  path: string
  projectId: string
}

export type ProjectMutationOperation = "copy" | "create" | "delete" | "import" | "move" | "rename" | "write"

export interface ProjectMutationResult {
  affectedPaths: string[]
  operation: ProjectMutationOperation
  projectId: string
  sourcePaths?: string[]
  targetPaths?: string[]
}

export interface ProjectFileInfo {
  mimeType: string
  name: string
  path: string
  size: number
}

export interface ProjectFileContents extends ProjectFileInfo {
  dataUrl: string
}

export interface ProjectTextFileContents {
  content: string
  exists: boolean
  path: string
}

export interface ProjectTextPreviewContents {
  content: string
  path: string
  truncated: boolean
}

export interface ProjectChangeEvent {
  kind: "filesystem" | "mutation" | "workspace"
  path?: string
  projectId: string
}

export interface ProjectSelectionResult {
  canceled: boolean
  project?: ProjectRecord
  projects: ProjectRecord[]
}

export interface ProjectClient {
  activateCanvas(input: { canvasId: string; projectId: string }): Promise<ProjectWorkspace>
  copyEntries(input: {
    destinationPath?: string
    paths: string[]
    projectId: string
  }): Promise<ProjectMutationResult>
  createEntry(input: {
    content?: string
    kind: ProjectEntryKind
    name: string
    parentPath?: string
    projectId: string
  }): Promise<ProjectMutationResult>
  createCanvas(input: { name?: string; projectId: string }): Promise<{ canvas: ProjectCanvas; workspace: ProjectWorkspace }>
  createProject(input: { name: string }): Promise<ProjectSelectionResult>
  createImportToken(file: File): string
  deleteEntries(input: { paths: string[]; projectId: string }): Promise<ProjectMutationResult>
  deleteCanvas(input: { canvasId: string; projectId: string }): Promise<{ deleted: boolean; workspace: ProjectWorkspace }>
  forgetProject(input: { projectId: string }): Promise<{ projects: ProjectRecord[]; removed: boolean }>
  importEntries(input: {
    destinationPath?: string
    projectId: string
    sourceTokens: string[]
  }): Promise<ProjectMutationResult>
  getWorkspace(input: { projectId: string }): Promise<ProjectWorkspace>
  listDirectory(input: { path?: string; projectId: string }): Promise<ProjectDirectoryListing>
  listProjects(): Promise<{ projects: ProjectRecord[] }>
  moveEntries(input: {
    destinationPath?: string
    paths: string[]
    projectId: string
  }): Promise<ProjectMutationResult>
  onDidChange(listener: (event: ProjectChangeEvent) => void): () => void
  openEntry(input: { path: string; projectId: string }): Promise<{ error?: string }>
  openProject(): Promise<ProjectSelectionResult>
  readFile(input: { path: string; projectId: string }): Promise<ProjectFileContents>
  readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo>
  readTextPreview(input: { path: string; projectId: string }): Promise<ProjectTextPreviewContents>
  readTextFile(input: { path: string; projectId: string }): Promise<ProjectTextFileContents>
  renameEntry(input: { name: string; path: string; projectId: string }): Promise<ProjectMutationResult>
  renameCanvas(input: { canvasId: string; name: string; projectId: string }): Promise<{ canvas: ProjectCanvas; workspace: ProjectWorkspace }>
  renameProject(input: { name: string; projectId: string }): Promise<{ project: ProjectRecord; projects: ProjectRecord[] }>
  revealEntry(input: { path?: string; projectId: string }): Promise<void>
  writeTextFile(input: {
    content: string
    createParents?: boolean
    path: string
    projectId: string
  }): Promise<ProjectMutationResult>
}
