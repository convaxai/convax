export interface ProjectPrivateTextFileRef {
  namespace: string
  path: string
  projectId: string
}

export interface ProjectPrivateTextFileSnapshot {
  content: string
  exists: boolean
  version: string | null
}

export interface ProjectPrivateTextFileWrite extends ProjectPrivateTextFileRef {
  content: string
  createParents?: boolean
  expectedVersion?: string | null
}

export interface ProjectPrivateStorage {
  readPrivateTextFile(input: ProjectPrivateTextFileRef): Promise<ProjectPrivateTextFileSnapshot>
  writePrivateTextFile(input: ProjectPrivateTextFileWrite): Promise<{ version: string }>
}

export class ProjectPrivateStorageConflictError extends Error {
  readonly actualVersion: string | null
  readonly expectedVersion: string | null

  constructor(expectedVersion: string | null, actualVersion: string | null) {
    super("Project private file changed since it was loaded")
    this.name = "ProjectPrivateStorageConflictError"
    this.expectedVersion = expectedVersion
    this.actualVersion = actualVersion
  }
}
