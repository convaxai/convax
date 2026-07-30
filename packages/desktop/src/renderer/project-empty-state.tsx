import type { ProjectController } from "@convax/project"
import { Loading } from "@convax/ui"
import { ProjectHome } from "./project-home"

interface ProjectEmptyStateProps {
  controller: ProjectController
  initialized: boolean
  reducedMotion?: boolean
}

/**
 * Compatibility adapter for the former empty-only workspace route.
 * New shell integration should mount ProjectHome directly and provide its
 * revision-safe Project/Canvas restoration callback.
 */
export function ProjectEmptyState({ controller, initialized, reducedMotion }: ProjectEmptyStateProps) {
  if (!initialized) {
    return (
      <div className="grid size-full place-items-center bg-background">
        <Loading label="Loading projects…" reducedMotion={reducedMotion} />
      </div>
    )
  }

  return (
    <ProjectHome
      controller={controller}
      onEnterProject={async () => true}
      reducedMotion={reducedMotion}
    />
  )
}

export function ProjectLoadingState({
  projectName,
  reducedMotion,
}: {
  projectName: string
  reducedMotion?: boolean
}) {
  return (
    <div className="grid size-full place-items-center bg-background">
      <Loading
        description="Loading canvases and project files"
        label={`Opening ${projectName}…`}
        layout="surface"
        reducedMotion={reducedMotion}
        tone="brand"
      />
    </div>
  )
}
