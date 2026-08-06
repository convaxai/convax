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
  recovery?: ProjectRecoveryStatus
}

export interface ProjectSelectionResult {
  canceled: boolean
  project?: ProjectRecord
  projects: ProjectRecord[]
}

export type ProjectResetConfirmationToken = `reset-host-${string}`

export interface ProjectResetDeletePreviewEntry {
  kind: "directory" | "file"
  path: string
}

export interface ProjectResetPreview {
  format: "convax.project-reset-preview/1"
  ordinaryProjectFilesPreserved: true
  privateDeletionSetDigest: string
  preview: readonly ProjectResetDeletePreviewEntry[]
  projectId: string
  token: ProjectResetConfirmationToken
  unsupportedInventoryDigest: string
}

/** The resolver has exactly these outcomes; there is no legacy, successor, or promoted state. */
export type ProjectRecoveryStatus =
  | { status: "current" }
  | { unsupportedPaths: readonly string[]; status: "unsupported-project-data" }
  | { status: "recovery-required" }

export type ProjectResetOutcome =
  | { projectId: string; status: "published" }
  | { reason: "team-service-unavailable" | "cancelled"; status: "staged" }

export interface ProjectCollaborationRecoveryClient {
  confirmReset(input: {
    projectId: string
    signal?: AbortSignal
    token: ProjectResetConfirmationToken
  }): Promise<ProjectResetOutcome>
  inspectProject(projectId: string): Promise<ProjectRecoveryStatus>
  previewReset(projectId: string): Promise<ProjectResetPreview>
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
