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
  /** Exact native operation correspondence; consumers must never recover it by basename. */
  relocations?: readonly Readonly<{ sourcePath: string; targetPath: string }>[]
  collaboration?: ProjectMutationCollaborationResult
}

export type ProjectMutationCollaborationResult =
  | Readonly<{ status: "committed"; paths: readonly string[] }>
  | Readonly<{
      status: "partial-success"
      paths: readonly string[]
      failedPaths: readonly Readonly<{ path: string; code: string }>[]
    }>

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

export interface ProjectFilePreviewLease {
  leaseId: string
  url: string
}

export type ProjectFilePreviewPurpose = "preview" | "thumbnail"

export interface ProjectFileThumbnail {
  dataUrl: string | null
  /** Intrinsic source height, not the bounded thumbnail height. */
  intrinsicHeight?: number | null
  /** Intrinsic source width, not the bounded thumbnail width. */
  intrinsicWidth?: number | null
}

export interface ProjectTextFileCompareAndReplaceInput {
  content: string
  expectedRevision: string
  path: string
  projectId: string
}

export interface ProjectTextFileCompareAndReplaceResult {
  contentRevision: string
}

export interface ProjectTextFileCompareAndReplacePort {
  compareAndReplaceTextFile(
    input: ProjectTextFileCompareAndReplaceInput,
  ): Promise<ProjectTextFileCompareAndReplaceResult>
}

export class ProjectTextFileConflictError extends Error {
  constructor(
    readonly expectedRevision: string,
    readonly actualRevision: string | null,
  ) {
    super("Project text file changed outside Convax")
    this.name = "ProjectTextFileConflictError"
  }
}

export interface ProjectChangeEvent {
  kind: "filesystem" | "mutation"
  path?: string
  projectId: string
}

export interface ProjectFilesClient {
  closeFilePreview(input: { leaseId: string }): Promise<boolean>
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
  openFilePreview(input: {
    path: string
    projectId: string
    purpose?: ProjectFilePreviewPurpose
  }): Promise<ProjectFilePreviewLease>
  readFile(input: { path: string; projectId: string }): Promise<ProjectFileContents>
  readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo>
  readFileThumbnail(input: { path: string; projectId: string }): Promise<ProjectFileThumbnail>
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
