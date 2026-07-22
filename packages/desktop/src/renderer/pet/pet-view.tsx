import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react"

import type {
  PetActivitySummary,
  PetDragInput,
  PetOverlayClient,
  PetRendererSnapshot,
} from "../../pet-contracts"

export const petAnimations = {
  idle: { durations: [280, 110, 110, 140, 140, 320], row: 0 },
  "running-right": { durations: [120, 120, 120, 120, 120, 120, 120, 220], row: 1 },
  "running-left": { durations: [120, 120, 120, 120, 120, 120, 120, 220], row: 2 },
  waving: { durations: [140, 120, 120, 120, 120, 120, 160, 260], row: 3 },
  jumping: { durations: [90, 90, 90, 110, 110, 120, 140, 220], row: 4 },
  failed: { durations: [180, 180, 180, 180, 180, 180, 180, 300], row: 5 },
  waiting: { durations: [160, 160, 160, 160, 160, 160, 160, 260], row: 6 },
  running: { durations: [120, 120, 120, 120, 120, 120, 120, 220], row: 7 },
  review: { durations: [180, 180, 180, 180, 180, 180, 180, 300], row: 8 },
} as const

export type PetAnimation = keyof typeof petAnimations

export function frameFor(animation: PetAnimation, elapsed: number, reducedMotion: boolean) {
  const definition = petAnimations[animation]
  if (reducedMotion) return { column: 0, row: definition.row }
  const duration = definition.durations.reduce((total, frame) => total + frame, 0)
  let remainder = Math.max(0, elapsed) % duration
  for (let column = 0; column < definition.durations.length; column += 1) {
    const frameDuration = definition.durations[column]!
    if (remainder < frameDuration) return { column, row: definition.row }
    remainder -= frameDuration
  }
  return { column: 0, row: definition.row }
}

function animationForActivity(activity?: PetActivitySummary): PetAnimation {
  switch (activity?.state) {
    case "needs-input":
      return "waiting"
    case "blocked":
      return "failed"
    case "ready":
      return "review"
    case "running":
      return "running"
    default:
      return "idle"
  }
}

export function petStatusText(activity: PetActivitySummary) {
  switch (activity.state) {
    case "needs-input":
      return activity.input === "permission" ? "Needs permission" : "Needs an answer"
    case "blocked":
      return "Blocked"
    case "ready":
      return "Ready to review"
    case "running":
      return "Working"
  }
}

export function visiblePetActivities(activities: readonly PetActivitySummary[]) {
  return activities.slice(0, 4)
}

export function petKeyAction(key: string, expanded: boolean): "activate" | "collapse" | "none" {
  if (key === "Enter" || key === " ") return "activate"
  if (key === "Escape" && expanded) return "collapse"
  return "none"
}

interface PetActivationOptions {
  navigate(): Promise<unknown>
  onJump(): void
  wait(): Promise<unknown>
}

export async function activatePet(activityId: string, options: PetActivationOptions) {
  if (!activityId) return
  options.onJump()
  await options.wait()
  await options.navigate()
}

interface PetDragGesture {
  end(): boolean
  move(point: { x: number; y: number }): boolean
  start(point: { x: number; y: number }): void
}

export function createPetDragGesture(onDrag: (input: PetDragInput) => void): PetDragGesture {
  let active = false
  let dragged = false
  let last = { x: 0, y: 0 }
  let origin = { x: 0, y: 0 }
  return {
    end() {
      const completed = active && dragged
      if (completed) onDrag({ dx: 0, dy: 0, phase: "end" })
      active = false
      dragged = false
      return completed
    },
    move(point) {
      if (!active) return false
      if (!dragged && Math.hypot(point.x - origin.x, point.y - origin.y) < 4) return false
      const previous = dragged ? last : origin
      dragged = true
      onDrag({ dx: point.x - previous.x, dy: point.y - previous.y, phase: "move" })
      last = point
      return true
    },
    start(point) {
      active = true
      dragged = false
      last = point
      origin = point
    },
  }
}

function useAnimationFrame(enabled: boolean) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!enabled) {
      setElapsed(0)
      return
    }
    const startedAt = performance.now()
    let request = 0
    const tick = (now: number) => {
      setElapsed(now - startedAt)
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [enabled])
  return elapsed
}

function animationDuration(animation: PetAnimation) {
  return petAnimations[animation].durations.reduce((total, frame) => total + frame, 0)
}

function useResolvedAnimation(requested: PetAnimation, reducedMotion: boolean) {
  const [resolved, setResolved] = useState(requested)
  const startedAt = useRef(typeof performance === "undefined" ? 0 : performance.now())
  useEffect(() => {
    if (requested === resolved) return
    const urgent = requested === "waiting" || requested === "failed"
    if (urgent || reducedMotion) {
      startedAt.current = performance.now()
      setResolved(requested)
      return
    }
    const duration = animationDuration(resolved)
    const remaining = duration - ((performance.now() - startedAt.current) % duration)
    const timer = setTimeout(() => {
      startedAt.current = performance.now()
      setResolved(requested)
    }, remaining)
    return () => clearTimeout(timer)
  }, [reducedMotion, requested, resolved])
  return resolved
}

function spriteStyle(assetUrl: string, animation: PetAnimation, elapsed: number, reducedMotion: boolean) {
  const frame = frameFor(animation, elapsed, reducedMotion)
  return {
    backgroundImage: `url("${assetUrl.replaceAll('"', "%22")}")`,
    backgroundPosition: `${(frame.column / 7) * 100}% ${(frame.row / 8) * 100}%`,
  } satisfies CSSProperties
}

interface PetViewProps {
  client: PetOverlayClient
  expanded: boolean
  reducedMotion: boolean
  snapshot: PetRendererSnapshot
}

export function PetView({ client, expanded, reducedMotion, snapshot }: PetViewProps) {
  const activities = visiblePetActivities(snapshot.activity.activities)
  const primaryActivity = activities[0]
  const requestedAnimation = animationForActivity(primaryActivity)
  const [jumping, setJumping] = useState(false)
  const elapsed = useAnimationFrame(!reducedMotion)
  const resolvedAnimation = useResolvedAnimation(requestedAnimation, reducedMotion)
  const animation = jumping ? "jumping" : resolvedAnimation
  const gesture = useMemo(() => createPetDragGesture((input) => client.drag(input)), [client])
  const activating = useRef(false)

  const activate = useCallback(
    async (activity?: PetActivitySummary) => {
      if (!activity || activating.current) return
      activating.current = true
      try {
        await activatePet(activity.id, {
          navigate: () => client.navigate({ activityId: activity.id }),
          onJump: () => setJumping(true),
          wait: () => new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : 280)),
        })
      } finally {
        activating.current = false
        setJumping(false)
      }
    },
    [client, reducedMotion],
  )

  const finishPointer = (event: PointerEvent<HTMLButtonElement>, navigateWhenClicked: boolean) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const dragged = gesture.end()
    if (!dragged && navigateWhenClicked) void activate(primaryActivity)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const action = petKeyAction(event.key, expanded)
    if (action === "none") return
    event.preventDefault()
    if (action === "collapse") void client.setExpanded({ expanded: false })
    else void activate(primaryActivity)
  }

  return (
    <main className={expanded ? "pet-shell pet-shell--expanded" : "pet-shell"} data-state={primaryActivity?.state ?? "idle"}>
      {expanded ? (
        <section aria-label="Agent activity" className="pet-tray">
          <header className="pet-tray__header">
            <div>
              <p className="pet-eyebrow">Convax companion</p>
              <h1>{snapshot.pet.name}</h1>
            </div>
            <button
              aria-label="Close activity tray"
              className="pet-icon-button"
              onClick={() => void client.setExpanded({ expanded: false })}
              type="button"
            >
              ×
            </button>
          </header>
          <div className="pet-activity-list">
            {activities.length > 0 ? (
              activities.map((activity) => (
                <button className="pet-activity" key={activity.id} onClick={() => void activate(activity)} type="button">
                  <span aria-hidden="true" className={`pet-activity__dot pet-activity__dot--${activity.state}`} />
                  <span className="pet-activity__copy">
                    <strong>{activity.sessionName}</strong>
                    <span>{activity.projectName}</span>
                  </span>
                  <span className="pet-activity__status">{petStatusText(activity)}</span>
                </button>
              ))
            ) : (
              <p className="pet-empty">All caught up. Violet is keeping watch.</p>
            )}
          </div>
        </section>
      ) : null}

      <div className="pet-stage">
        <button
          aria-label={primaryActivity ? `${snapshot.pet.name}: ${petStatusText(primaryActivity)}` : snapshot.pet.alt}
          className="pet-sprite-button"
          onKeyDown={handleKeyDown}
          onPointerCancel={(event) => finishPointer(event, false)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId)
            gesture.start({ x: event.screenX, y: event.screenY })
          }}
          onPointerMove={(event) => gesture.move({ x: event.screenX, y: event.screenY })}
          onPointerUp={(event) => finishPointer(event, true)}
          title={primaryActivity ? petStatusText(primaryActivity) : snapshot.pet.description}
          type="button"
        >
          <span
            aria-hidden="true"
            className="pet-sprite"
            data-animation={animation}
            style={spriteStyle(snapshot.pet.assetUrl, animation, elapsed, reducedMotion)}
          />
        </button>
        <button
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse activity tray" : "Show agent activity"}
          className="pet-tray-toggle"
          onClick={() => void client.setExpanded({ expanded: !expanded })}
          type="button"
        >
          {activities.length > 0 ? activities.length : "·"}
        </button>
      </div>
    </main>
  )
}
