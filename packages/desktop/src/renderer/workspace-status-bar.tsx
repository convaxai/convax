import { Cpu, MemoryStick } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import type {
  WorkspaceSystemStatusClient,
  WorkspaceSystemStatusSnapshot,
} from "../workspace-system-status-contracts"
import type { AppLocale } from "./app-language"

const statusRefreshIntervalMs = 2_000

export function formatWorkspaceMemory(bytes: number) {
  const megabytes = Math.max(0, bytes) / (1024 * 1024)
  if (megabytes < 1024) return `${Math.round(megabytes)} MB`
  return `${(megabytes / 1024).toFixed(megabytes < 10 * 1024 ? 1 : 0)} GB`
}

export function WorkspaceStatusBar({
  client,
  initialSnapshot,
  locale,
  taskIndicator,
}: {
  client: WorkspaceSystemStatusClient
  initialSnapshot?: WorkspaceSystemStatusSnapshot
  locale: AppLocale
  taskIndicator?: ReactNode
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceSystemStatusSnapshot | undefined>(initialSnapshot)
  const [metricsUnavailable, setMetricsUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    let requestInFlight = false
    const refresh = async () => {
      if (requestInFlight) return
      requestInFlight = true
      try {
        const next = await client.getSnapshot()
        if (!active) return
        setSnapshot(next)
        setMetricsUnavailable(false)
      } catch {
        if (active) setMetricsUnavailable(true)
      } finally {
        requestInFlight = false
      }
    }
    void refresh()
    const interval = window.setInterval(refresh, statusRefreshIntervalMs)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [client])

  const cpu = snapshot ? `${Math.round(snapshot.appCpuPercent)}%` : "—"
  const memory = snapshot ? formatWorkspaceMemory(snapshot.appMemoryBytes) : "—"
  const metricsLabel = metricsUnavailable
    ? locale === "zh-CN"
      ? "Convax 性能指标暂不可用"
      : "Convax performance metrics unavailable"
    : `Convax CPU ${cpu}, RAM ${memory}`

  return (
    <footer
      aria-label={locale === "zh-CN" ? "工作区状态" : "Workspace status"}
      className="flex h-[26px] shrink-0 items-center justify-between border-t border-border/70 bg-background/95 px-3 font-mono text-[10px] text-muted-foreground"
      data-workspace-status-bar="true"
    >
      <div>{taskIndicator}</div>
      <div aria-label={metricsLabel} className="flex items-center gap-3 tabular-nums">
        <span
          className="flex items-center gap-1.5"
          title={locale === "zh-CN" ? "Convax 进程 CPU 占用" : "CPU used by Convax processes"}
        >
          <Cpu aria-hidden="true" className="size-3" />
          <span>CPU&nbsp; {cpu}</span>
        </span>
        <span
          className="flex items-center gap-1.5"
          title={locale === "zh-CN" ? "Convax 进程内存占用" : "Memory used by Convax processes"}
        >
          <MemoryStick aria-hidden="true" className="size-3" />
          <span>RAM&nbsp; {memory}</span>
        </span>
      </div>
    </footer>
  )
}
