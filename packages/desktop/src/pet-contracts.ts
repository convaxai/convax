export type PetVisibleActivityState = "needs-input" | "blocked" | "ready" | "running"

export interface PetActivitySummary {
  id: string
  input?: "permission" | "question"
  projectId: string
  projectName: string
  sessionId: string
  sessionName: string
  state: PetVisibleActivityState
  updatedAt: number
}

export interface PetActivitySnapshot {
  activities: PetActivitySummary[]
  revision: number
}

/** Main-only target. It is deliberately absent from renderer snapshots. */
export interface PetActivityTarget {
  projectId: string
  sessionId: string
}
