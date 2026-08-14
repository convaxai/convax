import { useCallback, useEffect, useRef, type RefCallback } from "react"
import { flushSync } from "react-dom"

import { type ShortcutRegistration, type ShortcutScopeKind, ScopedShortcutService } from "./scoped-shortcut-service"

function shortcutSignature(registration: ShortcutRegistration) {
  return {
    allowInEditable: registration.allowInEditable ?? false,
    chords: registration.chords,
    id: registration.id,
    kind: registration.kind,
    priority: registration.priority ?? 0,
    releaseOnAnyOtherKey: registration.kind === "command" ? false : (registration.releaseOnAnyOtherKey ?? false),
    scopeId: registration.scopeId,
  }
}

function bindShortcutRegistration(
  registration: ShortcutRegistration,
  current: () => ShortcutRegistration | null | undefined,
): ShortcutRegistration {
  const common = {
    ...registration,
    isEnabled: (event: KeyboardEvent) => current()?.isEnabled?.(event) ?? true,
  }
  switch (registration.kind) {
    case "command":
      return {
        ...common,
        kind: "command",
        onTrigger: (event) => {
          const latest = current()
          if (latest?.kind === "command") latest.onTrigger(event)
        },
      }
    case "hold":
      return {
        ...common,
        kind: "hold",
        onHold: (event) => {
          const latest = current()
          if (latest?.kind === "hold") flushSync(() => latest.onHold(event))
        },
        onRelease: () => {
          const latest = current()
          if (latest?.kind === "hold") latest.onRelease()
          else registration.onRelease()
        },
      }
    case "gesture-modifier":
      return {
        ...common,
        kind: "gesture-modifier",
        onActivate: (event) => {
          const latest = current()
          if (latest?.kind === "gesture-modifier") flushSync(() => latest.onActivate(event))
        },
        onRelease: () => {
          const latest = current()
          if (latest?.kind === "gesture-modifier") latest.onRelease()
          else registration.onRelease()
        },
      }
  }
}

export function useShortcutScope(
  service: ScopedShortcutService,
  input: {
    readonly enabled?: boolean
    readonly id: string
    readonly kind?: ShortcutScopeKind
    readonly matchesTarget?: (target: Element) => boolean
    readonly priority?: number
  },
): RefCallback<HTMLElement> {
  const disposeRef = useRef<(() => void) | null>(null)
  const elementRef = useRef<HTMLElement | null>(null)

  const register = useCallback(
    (element: HTMLElement | null) => {
      disposeRef.current?.()
      disposeRef.current = null
      elementRef.current = element
      if (!element || input.enabled === false) return
      const handle = service.registerScope({
        element,
        id: input.id,
        kind: input.kind,
        matchesTarget: input.matchesTarget,
        priority: input.priority,
      })
      disposeRef.current = () => handle.dispose()
    },
    [input.enabled, input.id, input.kind, input.matchesTarget, input.priority, service],
  )

  useEffect(
    () => () => {
      disposeRef.current?.()
      disposeRef.current = null
      elementRef.current = null
    },
    [],
  )

  return register
}

export function useShortcutFeature(service: ScopedShortcutService, registration: ShortcutRegistration | null): void {
  const registrationRef = useRef(registration)
  registrationRef.current = registration
  const signature = registration ? JSON.stringify(shortcutSignature(registration)) : null

  useEffect(() => {
    if (!registrationRef.current) return
    const current = registrationRef.current
    const handle = service.registerFeature(bindShortcutRegistration(current, () => registrationRef.current))
    return () => handle.dispose()
  }, [service, signature])
}

export function useShortcutFeatures(
  service: ScopedShortcutService,
  registrations: readonly ShortcutRegistration[],
): void {
  const registrationsRef = useRef(registrations)
  registrationsRef.current = registrations
  const signature = JSON.stringify(registrations.map(shortcutSignature))

  useEffect(() => {
    const registrationsByKey = () =>
      new Map(
        registrationsRef.current.map((registration) => [
          `${registration.scopeId}\u0000${registration.id}`,
          registration,
        ]),
      )
    const handles = registrations.map((registration) => {
      const key = `${registration.scopeId}\u0000${registration.id}`
      return service.registerFeature(bindShortcutRegistration(registration, () => registrationsByKey().get(key)))
    })
    return () => {
      for (const handle of handles) handle.dispose()
    }
  }, [service, signature])
}
