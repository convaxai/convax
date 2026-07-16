import { checkDesktopProtocol, type DesktopProtocolCompatibility } from "../desktop-protocol"
import { useEffect, useState, type ReactNode } from "react"

export function DesktopProtocolGate({ children }: { children: ReactNode }) {
  const [compatibility, setCompatibility] = useState<DesktopProtocolCompatibility | null>(null)

  useEffect(() => {
    let current = true
    void checkDesktopProtocol(window.convax?.protocol).then((result) => {
      if (current) setCompatibility(result)
    })
    return () => {
      current = false
    }
  }, [])

  if (!compatibility) {
    return (
      <main className="grid size-full place-items-center bg-background text-foreground" role="status">
        <p className="text-sm text-muted-foreground">Checking desktop compatibility…</p>
      </main>
    )
  }
  if (compatibility.status !== "compatible") return <DesktopRestartRequired compatibility={compatibility} />
  return children
}

export function DesktopRestartRequired({
  compatibility,
}: {
  compatibility: Exclude<DesktopProtocolCompatibility, { status: "compatible" }>
}) {
  const detail = compatibility.status === "mismatch"
    ? `Renderer expects ${compatibility.expectedVersion}, but the ${compatibility.component} component reports ${compatibility.actualVersion}.`
    : "The desktop protocol bridge is unavailable."

  return (
    <main className="grid size-full place-items-center bg-background px-6 text-foreground" role="alert">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-destructive">Restart required</p>
        <h1 className="mt-2 text-xl font-semibold">Convax components are out of sync</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Quit every running Convax window, then start Convax again. Reloading this window is not enough.
        </p>
      </section>
    </main>
  )
}
