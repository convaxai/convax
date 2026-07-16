import type { ProjectFilesClient } from "@convax/project-files"

export type {
  ProjectChangeEvent,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectEntryKind,
  ProjectFileContents,
  ProjectFileInfo,
  ProjectFilesClient,
  ProjectMutationOperation,
  ProjectMutationResult,
  ProjectTextFileContents,
  ProjectTextPreviewContents,
} from "@convax/project-files"

export interface ProjectRecord {
  createdAt: number
  id: string
  lastOpenedAt: number
  missing?: boolean
  name: string
  rootPath: string
}

export interface ProjectSelectionResult {
  canceled: boolean
  project?: ProjectRecord
  projects: ProjectRecord[]
}

export interface ProjectLifecycleClient {
  createProject(input: { name: string }): Promise<ProjectSelectionResult>
  forgetProject(input: { projectId: string }): Promise<{ projects: ProjectRecord[]; removed: boolean }>
  listProjects(): Promise<{ projects: ProjectRecord[] }>
  openProject(): Promise<ProjectSelectionResult>
  renameProject(input: { name: string; projectId: string }): Promise<{ project: ProjectRecord; projects: ProjectRecord[] }>
}

/** @deprecated Inject ProjectLifecycleClient and ProjectFilesClient as separate capabilities. */
export interface ProjectClient extends ProjectFilesClient, ProjectLifecycleClient {}
