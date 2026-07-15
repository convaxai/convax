import type { ProjectController } from "@convax/project"
import { Button } from "@convax/ui"
import { FolderOpen, FolderPlus, Layers3, LoaderCircle, X } from "lucide-react"
import { useState } from "react"

interface ProjectEmptyWorkspaceProps {
  controller: ProjectController
  initialized: boolean
}

export function ProjectWorkspaceLoading({ projectName }: { projectName: string }) {
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

export function ProjectEmptyWorkspace({ controller, initialized }: ProjectEmptyWorkspaceProps) {
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [openingProject, setOpeningProject] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)

  const openProject = async () => {
    if (openingProject || creatingProject) return
    setOpeningProject(true)
    try {
      await controller.openProject()
    } finally {
      setOpeningProject(false)
    }
  }

  const createProject = async () => {
    const name = projectName.trim()
    if (!name || openingProject || creatingProject) return
    setCreatingProject(true)
    try {
      await controller.createProject(name)
      setCreateProjectOpen(false)
      setProjectName("")
    } finally {
      setCreatingProject(false)
    }
  }

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
    <>
      <div className="relative grid size-full place-items-center overflow-hidden bg-background px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_68%)]"
        />
        <section className="relative flex w-full max-w-xl flex-col items-center text-center">
          <div className="mb-5 grid size-14 place-items-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-sm">
            <Layers3 className="size-7" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Convax workspace</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Create or open a project</h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            Projects keep canvases and files together. Start a new workspace, or open an existing project folder to continue.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button className="h-10 px-5" disabled={openingProject} onClick={() => setCreateProjectOpen(true)}>
              <FolderPlus />
              Create project
            </Button>
            <Button className="h-10 px-5" disabled={openingProject || creatingProject} onClick={() => void openProject()} variant="outline">
              {openingProject ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
              Open project
            </Button>
          </div>
        </section>
      </div>

      {createProjectOpen ? (
        <div
          className="absolute inset-0 z-50 grid place-items-center bg-foreground/20 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !creatingProject) setCreateProjectOpen(false)
          }}
          role="presentation"
        >
          <section
            aria-labelledby="create-project-title"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl"
            role="dialog"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold" id="create-project-title">New project</h2>
              <Button
                aria-label="Close"
                disabled={creatingProject}
                onClick={() => setCreateProjectOpen(false)}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void createProject()
              }}
            >
              <label className="mb-1.5 block text-xs font-medium" htmlFor="workspace-project-name">Project name</label>
              <input
                autoFocus
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                disabled={creatingProject}
                id="workspace-project-name"
                onChange={(event) => setProjectName(event.currentTarget.value)}
                placeholder="My project"
                value={projectName}
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Choose the parent folder after naming the project.</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button disabled={creatingProject} onClick={() => setCreateProjectOpen(false)} size="sm" variant="ghost">Cancel</Button>
                <Button disabled={!projectName.trim() || creatingProject} size="sm" type="submit">
                  {creatingProject ? <LoaderCircle className="animate-spin" /> : null}
                  Create project
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  )
}
