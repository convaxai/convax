import type { ProjectController } from "@convax/project"
import { LoaderCircle } from "lucide-react"
import { ProjectHome } from "./project-home"

interface ProjectEmptyStateProps {
  controller: ProjectController
  initialized: boolean
}

/**
 * Compatibility adapter for the former empty-only workspace route.
 * New shell integration should mount ProjectHome directly and provide its
 * revision-safe Project/Canvas restoration callback.
 */
export function ProjectEmptyState({ controller, initialized }: ProjectEmptyStateProps) {
  if (!initialized) {
    return (
      <div className="grid size-full place-items-center bg-background" role="status">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading projects…
        </div>
      </div>
    )
  }

  return (
    <ProjectHome
      controller={controller}
      onEnterProject={async () => true}
    />
  )
}

export function ProjectLoadingState({ projectName }: { projectName: string }) {
  return (
    <div aria-live="polite" className="grid size-full place-items-center bg-background" role="status">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="grid size-10 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
        <p className="text-sm font-medium text-foreground">{`Opening ${projectName}…`}</p>
        <p className="text-xs text-muted-foreground">Loading canvases and project files</p>
      </div>
    </div>
  )
}
