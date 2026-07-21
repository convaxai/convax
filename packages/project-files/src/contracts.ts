export type ProjectEntryKind = "directory" | "file"

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
  contentRevision: string
  exists: boolean
  path: string
}

export interface ProjectTextPreviewContents {
  content: string
  path: string
  truncated: boolean
}

export interface ProjectChangeEvent {
  kind: "filesystem" | "mutation"
  path?: string
  projectId: string
}

export interface ProjectFilesClient {
  copyEntries(input: { destinationPath?: string; paths: string[]; projectId: string }): Promise<ProjectMutationResult>
  createEntry(input: {
    content?: string
    kind: ProjectEntryKind
    name: string
    parentPath?: string
    projectId: string
  }): Promise<ProjectMutationResult>
  createImportToken(file: File): string
  deleteEntries(input: { paths: string[]; projectId: string }): Promise<ProjectMutationResult>
  importEntries(input: {
    destinationPath?: string
    projectId: string
    sourceTokens: string[]
  }): Promise<ProjectMutationResult>
  listDirectory(input: { path?: string; projectId: string }): Promise<ProjectDirectoryListing>
  moveEntries(input: { destinationPath?: string; paths: string[]; projectId: string }): Promise<ProjectMutationResult>
  onDidChange(listener: (event: ProjectChangeEvent) => void): () => void
  openEntry(input: { path: string; projectId: string }): Promise<{ error?: string }>
  readFile(input: { path: string; projectId: string }): Promise<ProjectFileContents>
  readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo>
  readManagedImageFile(input: { path: string; projectId: string }): Promise<ProjectFileContents>
  readTextPreview(input: { path: string; projectId: string }): Promise<ProjectTextPreviewContents>
  readTextFile(input: { path: string; projectId: string }): Promise<ProjectTextFileContents>
  renameEntry(input: { name: string; path: string; projectId: string }): Promise<ProjectMutationResult>
  revealEntry(input: { path?: string; projectId: string }): Promise<void>
  writeTextFile(input: {
    content: string
    createParents?: boolean
    path: string
    projectId: string
  }): Promise<ProjectMutationResult>
}
