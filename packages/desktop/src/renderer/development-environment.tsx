export interface RendererDevelopmentIdentity {
  id: string
  label: string
}

const rendererDevelopmentIdentityEdgeWhitespacePattern =
  /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$/u

export function rendererDevelopmentIdentity(urlValue: string): RendererDevelopmentIdentity | undefined {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    return undefined
  }
  const ids = url.searchParams.getAll("convax-solo-task-id")
  const labels = url.searchParams.getAll("convax-solo-task-label")
  if (ids.length === 0 && labels.length === 0) return undefined
  if (ids.length !== 1 || labels.length !== 1) return undefined
  const id = ids[0]!
  const label = labels[0]!
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) return undefined
  if (
    !label ||
    [...label].length > 24 ||
    rendererDevelopmentIdentityEdgeWhitespacePattern.test(label) ||
    /[\u0000-\u001f\u007f]/u.test(label)
  ) {
    return undefined
  }
  return Object.freeze({ id, label })
}

export function developmentApplicationTitle(identity?: RendererDevelopmentIdentity) {
  return identity ? `Convax [${identity.label}]` : "Convax"
}

export function DevelopmentEnvironmentBadge({ identity }: { identity?: RendererDevelopmentIdentity }) {
  if (!identity) return null
  return (
    <aside
      aria-label={`Solo task environment ${identity.label}`}
      className="pointer-events-none fixed bottom-3 right-3 z-[200] flex max-w-[min(22rem,calc(100vw-1.5rem))] items-center gap-2 rounded-full border border-amber-600/30 bg-amber-100/95 px-2.5 py-1.5 text-amber-950 shadow-lg backdrop-blur dark:border-amber-300/30 dark:bg-amber-950/90 dark:text-amber-100"
      data-development-environment-badge={identity.id}
    >
      <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-white">
        SOLO
      </span>
      <span className="truncate text-xs font-semibold" title={identity.label}>
        {identity.label}
      </span>
    </aside>
  )
}
