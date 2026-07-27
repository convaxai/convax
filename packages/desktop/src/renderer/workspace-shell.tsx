import type { ReactNode } from "react"

export function WorkspaceShell({
  blocked,
  children,
  resizing = false,
  statusBar,
  utilityMode = "closed",
}: {
  blocked: boolean
  children: ReactNode
  resizing?: boolean
  statusBar?: ReactNode
  utilityMode?: "agent" | "closed" | "generate" | "inspector"
}) {
  return (
    <main
      aria-hidden={blocked || undefined}
      className={`relative flex size-full flex-col overflow-hidden bg-background${resizing ? " cursor-col-resize select-none" : ""}`}
      data-workspace-utility-mode={utilityMode}
      data-workspace-shell="true"
      inert={blocked || undefined}
    >
      <div className="relative flex min-h-0 flex-1 overflow-hidden">{children}</div>
      {statusBar}
    </main>
  )
}
