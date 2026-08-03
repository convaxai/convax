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
  /** Derived openability only; never persisted as a second Project authority. */
  recovery?: ProjectRecoveryStatusV1
}

export interface ProjectSelectionResult {
  canceled: boolean
  project?: ProjectRecord
  projects: ProjectRecord[]
}

export type ProjectResetConfirmationTokenV1 = `reset-host-${string}`

export interface ProjectResetDeletePreviewEntryV1 {
  kind: "directory" | "file"
  path: string
}

export interface ProjectResetPreviewV1 {
  format: "convax.project-reset-preview/1"
  ordinaryProjectFilesPreserved: true
  privateDeletionSetDigest: string
  preview: readonly ProjectResetDeletePreviewEntryV1[]
  projectId: string
  token: ProjectResetConfirmationTokenV1
  unsupportedInventoryDigest: string
}

export type ProjectRecoveryStatusV1 =
  | { status: "current" }
  | { legacyPaths: readonly string[]; status: "unsupported-portable-project-version" }
  | { status: "recovery-required" }

export type ProjectResetOutcomeV1 =
  | { projectId: string; status: "published" }
  | { reason: "team-service-unavailable" | "cancelled"; status: "staged" }

export interface ProjectCollaborationRecoveryClient {
  confirmReset(input: {
    projectId: string
    signal?: AbortSignal
    token: ProjectResetConfirmationTokenV1
  }): Promise<ProjectResetOutcomeV1>
  inspectProject(projectId: string): Promise<ProjectRecoveryStatusV1>
  previewReset(projectId: string): Promise<ProjectResetPreviewV1>
}

export interface ProjectLifecycleClient {
  createProject(input: { name: string }): Promise<ProjectSelectionResult>
  forgetProject(input: { projectId: string }): Promise<{ projects: ProjectRecord[]; removed: boolean }>
  listProjects(): Promise<{ projects: ProjectRecord[] }>
  openProject(): Promise<ProjectSelectionResult>
  renameProject(input: {
    name: string
    projectId: string
  }): Promise<{ project: ProjectRecord; projects: ProjectRecord[] }>
  touchProject(input: { projectId: string }): Promise<{ project: ProjectRecord; projects: ProjectRecord[] }>
}

/** @deprecated Inject ProjectLifecycleClient and ProjectFilesClient as separate capabilities. */
export interface ProjectClient extends ProjectFilesClient, ProjectLifecycleClient {}
