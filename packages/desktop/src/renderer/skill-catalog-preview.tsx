import { Button, cn } from "@convax/ui"
import {
  ChevronRight,
  Check,
  Copy,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  Play,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type {
  DesktopSkillCatalogItem,
  DesktopSkillDetails,
  DesktopSkillFilePreview,
  DesktopSkillShowcase,
  DesktopSkillShowcaseMedia,
} from "../skill-management-contracts"
import { appMessage, type AppLocale } from "./app-language"

interface SkillFileTreeNode {
  children: SkillFileTreeNode[]
  kind: "directory" | "file"
  name: string
  path: string
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

export function buildSkillFileTree(files: readonly DesktopSkillFilePreview[]) {
  const root: SkillFileTreeNode = { children: [], kind: "directory", name: "", path: "" }
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean)
    let parent = root
    for (const [index, segment] of segments.entries()) {
      const path = segments.slice(0, index + 1).join("/")
      const kind = index === segments.length - 1 ? "file" : "directory"
      let child = parent.children.find((candidate) => candidate.name === segment && candidate.kind === kind)
      if (!child) {
        child = { children: [], kind, name: segment, path }
        parent.children.push(child)
      }
      parent = child
    }
  }
  const sort = (nodes: SkillFileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
      if (left.name === "SKILL.md") return -1
      if (right.name === "SKILL.md") return 1
      return left.name.localeCompare(right.name)
    })
    for (const node of nodes) sort(node.children)
  }
  sort(root.children)
  return root.children
}

function ancestorDirectoryPaths(path?: string) {
  if (!path) return []
  const segments = path.split("/")
  return segments.slice(0, -1).map((_segment, index) => segments.slice(0, index + 1).join("/"))
}

function fileIcon(path: string) {
  if (/\.(md|mdx)$/i.test(path)) return <FileText aria-hidden="true" />
  if (/\.(json|ya?ml|toml|js|mjs|cjs|ts|tsx|py|sh)$/i.test(path)) return <FileCode2 aria-hidden="true" />
  return <File aria-hidden="true" />
}

function FileTree({
  expanded,
  nodes,
  onSelect,
  onToggle,
  selectedPath,
}: {
  expanded: ReadonlySet<string>
  nodes: readonly SkillFileTreeNode[]
  onSelect(path: string): void
  onToggle(path: string): void
  selectedPath?: string
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        if (node.kind === "directory") {
          const open = expanded.has(node.path)
          return (
            <li key={node.path}>
              <button
                aria-expanded={open}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => onToggle(node.path)}
                type="button"
              >
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                {open ? <FolderOpen className="size-4 text-primary" /> : <Folder className="size-4 text-primary" />}
                <span className="truncate">{node.name}</span>
              </button>
              {open ? (
                <div className="ml-3 border-l border-border pl-2">
                  <FileTree
                    expanded={expanded}
                    nodes={node.children}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    selectedPath={selectedPath}
                  />
                </div>
              ) : null}
            </li>
          )
        }
        return (
          <li key={node.path}>
            <button
              aria-pressed={selectedPath === node.path}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                selectedPath === node.path &&
                  "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary",
              )}
              onClick={() => onSelect(node.path)}
              type="button"
            >
              <span className="ml-5 [&>svg]:size-3.5">{fileIcon(node.path)}</span>
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return reduced
}

export function shouldAnimateSkillShowcase(inViewport: boolean, reducedMotion: boolean) {
  return inViewport && !reducedMotion
}

export function SkillShowcaseMedia({
  className,
  load,
  name,
}: {
  className?: string
  load(media: DesktopSkillShowcaseMedia): Promise<DesktopSkillShowcase | null>
  name: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [posterRequested, setPosterRequested] = useState(false)
  const [inViewport, setInViewport] = useState(false)
  const [animationRequested, setAnimationRequested] = useState(false)
  const [posterLoading, setPosterLoading] = useState(false)
  const [poster, setPoster] = useState<{ alt: string; source: string } | null>()
  const [animation, setAnimation] = useState<{
    alt: string
    mimeType: DesktopSkillShowcase["mimeType"]
    source: string
  } | null>()
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    const target = container.current
    if (!target) return undefined
    if (typeof IntersectionObserver === "undefined") {
      setPosterRequested(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPosterRequested(true)
          observer.disconnect()
        }
      },
      { rootMargin: "160px" },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const target = container.current
    if (!target) return undefined
    if (typeof IntersectionObserver === "undefined") {
      setInViewport(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((candidate) => candidate.target === target)
        setInViewport(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.1))
      },
      { threshold: [0, 0.1] },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (shouldAnimateSkillShowcase(inViewport, reducedMotion)) setAnimationRequested(true)
  }, [inViewport, reducedMotion])

  useEffect(() => {
    if (!posterRequested) return undefined
    let active = true
    let objectUrl: string | undefined
    setPoster(undefined)
    setPosterLoading(true)
    void load("poster")
      .then((result) => {
        if (!active || !result) {
          if (active) setPoster(null)
          return
        }
        const bytes = Uint8Array.from(result.bytes)
        objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.mimeType }))
        setPoster({ alt: result.altText || `${name} showcase`, source: objectUrl })
      })
      .catch(() => {
        if (active) setPoster(null)
      })
      .finally(() => {
        if (active) setPosterLoading(false)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [load, name, posterRequested])

  useEffect(() => {
    if (!animationRequested || reducedMotion) {
      setAnimation(undefined)
      return undefined
    }
    let active = true
    let objectUrl: string | undefined
    setAnimation(undefined)
    void load("animation")
      .then((result) => {
        if (!active || !result) {
          if (active) setAnimation(null)
          return
        }
        const bytes = Uint8Array.from(result.bytes)
        objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.mimeType }))
        setAnimation({ alt: result.altText || `${name} showcase`, mimeType: result.mimeType, source: objectUrl })
      })
      .catch(() => {
        if (active) setAnimation(null)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [animationRequested, load, name, reducedMotion])

  useEffect(() => {
    const player = video.current
    if (!player || !animation) return
    if (!shouldAnimateSkillShowcase(inViewport, reducedMotion)) {
      player.pause()
      return
    }
    void player.play().catch(() => undefined)
  }, [animation, inViewport, reducedMotion])

  const placeholder = (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.24),transparent_38%),linear-gradient(135deg,hsl(var(--muted)),hsl(var(--background)))]">
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="relative grid size-16 place-items-center rounded-2xl border border-primary/25 bg-background/75 text-primary shadow-xl backdrop-blur">
        {posterLoading ? <LoaderCircle className="size-5 animate-spin" /> : <Sparkles className="size-6" />}
      </div>
    </div>
  )

  return (
    <div className={cn("relative aspect-video overflow-hidden bg-muted", className)} ref={container}>
      {!poster ? (
        placeholder
      ) : (
        <img alt={poster.alt} className="absolute inset-0 size-full object-cover" src={poster.source} />
      )}
      {animation?.mimeType.startsWith("video/") ? (
        <video
          aria-label={animation.alt}
          autoPlay={shouldAnimateSkillShowcase(inViewport, reducedMotion)}
          className={cn(
            "absolute inset-0 size-full object-cover",
            !shouldAnimateSkillShowcase(inViewport, reducedMotion) && "invisible",
          )}
          loop
          muted
          playsInline
          poster={poster?.source}
          preload="metadata"
          ref={video}
          src={animation.source}
        />
      ) : null}
      {animation?.mimeType.startsWith("image/") && shouldAnimateSkillShowcase(inViewport, reducedMotion) ? (
        <img alt={animation.alt} className="absolute inset-0 size-full object-cover" src={animation.source} />
      ) : null}
      {animation && shouldAnimateSkillShowcase(inViewport, reducedMotion) ? (
        <span className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full border border-white/20 bg-black/45 text-white shadow-sm backdrop-blur">
          <Play className="size-3 fill-current" />
        </span>
      ) : null}
    </div>
  )
}

export interface SkillDetailDialogProps {
  busy: boolean
  details: DesktopSkillDetails | null
  error: string | null
  installed: boolean
  locale: AppLocale
  loading: boolean
  managedName?: string
  onClose(): void
  onInstall(): void
  onRetry(): void
  onUninstall(): void
  readOnly?: boolean
  skill: DesktopSkillCatalogItem
}

export function SkillDetailDialog({
  busy,
  details,
  error,
  installed,
  locale,
  loading,
  managedName,
  onClose,
  onInstall,
  onRetry,
  onUninstall,
  readOnly = false,
  skill,
}: SkillDetailDialogProps) {
  const tree = useMemo(() => buildSkillFileTree(details?.files ?? []), [details])
  const defaultPath = details?.files.find((file) => file.path === "SKILL.md")?.path ?? details?.files[0]?.path
  const [selectedPath, setSelectedPath] = useState(defaultPath)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(ancestorDirectoryPaths(defaultPath)))
  const [copiedPath, setCopiedPath] = useState<string>()
  const overlay = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    setSelectedPath(defaultPath)
    setExpanded(new Set(ancestorDirectoryPaths(defaultPath)))
  }, [defaultPath])

  useEffect(() => {
    const layer = overlay.current
    const surface = dialog.current
    if (!layer || !surface) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const siblings = Array.from(layer.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== layer,
    )
    const prior = siblings.map((element) => ({
      ariaHidden: element.getAttribute("aria-hidden"),
      element,
      inert: element.inert,
    }))
    for (const element of siblings) {
      element.inert = true
      element.setAttribute("aria-hidden", "true")
    }
    closeButton.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!busyRef.current) onClose()
        return
      }
      if (event.key !== "Tab") return
      const focusable = Array.from(
        surface.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true")
      if (!focusable.length) {
        event.preventDefault()
        surface.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable.at(-1)!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !surface.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !surface.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      for (const entry of prior) {
        entry.element.inert = entry.inert
        if (entry.ariaHidden === null) entry.element.removeAttribute("aria-hidden")
        else entry.element.setAttribute("aria-hidden", entry.ariaHidden)
      }
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])

  const selected = details?.files.find((file) => file.path === selectedPath)
  useEffect(() => setCopiedPath(undefined), [selectedPath])
  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const layer = (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-foreground/35 p-3 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose()
      }}
      ref={overlay}
      role="presentation"
    >
      <section
        aria-labelledby="skill-detail-title"
        aria-modal="true"
        className="flex h-[min(760px,calc(100vh-1.5rem))] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex items-start justify-between gap-5 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold" id="skill-detail-title">
                {skill.name}
              </h2>
              {details?.version ? (
                <span className="rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  v{details.version}
                </span>
              ) : null}
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {appMessage(locale, "capabilities.agentSkill")}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
              {details?.description ?? skill.description}
            </p>
          </div>
          <Button
            aria-label={appMessage(locale, "capabilities.closeSkillDetails")}
            disabled={busy}
            onClick={onClose}
            ref={closeButton}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </header>

        {loading ? (
          <div className="grid min-h-0 flex-1 place-items-center" role="status">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {appMessage(locale, "capabilities.loadingSkillDetails")}
            </div>
          </div>
        ) : error ? (
          <div className="grid min-h-0 flex-1 place-items-center p-6">
            <div
              className="max-w-lg rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              <p>{error}</p>
              <Button className="mt-3" onClick={onRetry} size="sm" variant="outline">
                {appMessage(locale, "capabilities.retry")}
              </Button>
            </div>
          </div>
        ) : details ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,0.28fr)_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-r border-border bg-muted/15 p-3">
              <h3 className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {appMessage(locale, "capabilities.skillFiles")}
              </h3>
              <FileTree
                expanded={expanded}
                nodes={tree}
                onSelect={setSelectedPath}
                onToggle={toggleDirectory}
                selectedPath={selectedPath}
              />
            </aside>
            <main className="flex min-h-0 min-w-0 flex-col bg-background/35">
              <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
                <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                  <span className="shrink-0 [&>svg]:size-3.5">{selected ? fileIcon(selected.path) : <File />}</span>
                  <span className="truncate">{selected?.path ?? appMessage(locale, "capabilities.skillPreview")}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {selected?.kind === "text" ? (
                    <Button
                      onClick={() => {
                        const clipboard = navigator.clipboard
                        if (!clipboard) return
                        void clipboard
                          .writeText(selected.content)
                          .then(() => setCopiedPath(selected.path))
                          .catch(() => undefined)
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {copiedPath === selected.path ? <Check /> : <Copy />}
                      {appMessage(locale, copiedPath === selected.path ? "capabilities.copied" : "capabilities.copy")}
                    </Button>
                  ) : null}
                  {selected ? (
                    <span className="text-[11px] text-muted-foreground">{formatBytes(selected.size)}</span>
                  ) : null}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                {selected?.kind === "text" ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground selection:bg-primary/20">
                    {selected.content}
                  </pre>
                ) : (
                  <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/20 px-5 text-center text-sm text-muted-foreground">
                    {appMessage(locale, "capabilities.noTextPreview")}
                  </div>
                )}
              </div>
            </main>
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
          <p className="text-xs text-muted-foreground">{skill.id}</p>
          {readOnly ? (
            <span className="rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {appMessage(locale, "capabilities.globalReadOnly")}
            </span>
          ) : managedName ? (
            <Button disabled={busy} onClick={onUninstall} size="sm" variant="ghost">
              <Trash2 />
              {appMessage(locale, "capabilities.uninstall")}
            </Button>
          ) : (
            <Button disabled={busy || installed} onClick={onInstall} size="sm" variant="outline">
              {installed ? <Sparkles /> : <Play />}
              {appMessage(locale, installed ? "capabilities.installed" : "capabilities.installSkill")}
            </Button>
          )}
        </footer>
      </section>
    </div>
  )
  return typeof document === "undefined" ? layer : createPortal(layer, document.body)
}
