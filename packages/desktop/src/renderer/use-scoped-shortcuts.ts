import { useCallback, useEffect, useRef, type RefCallback } from "react"

import {
  type ShortcutFeatureRegistration,
  type ShortcutScopeKind,
  ScopedShortcutService,
} from "./scoped-shortcut-service"

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

export function useShortcutFeature(
  service: ScopedShortcutService,
  registration: ShortcutFeatureRegistration | null,
): void {
  const registrationRef = useRef(registration)
  registrationRef.current = registration
  const signature = registration
    ? JSON.stringify({
        allowInEditable: registration.allowInEditable ?? false,
        chords: registration.chords,
        consume: registration.consume ?? true,
        id: registration.id,
        priority: registration.priority ?? 0,
        releaseOnAnyOtherKey: registration.releaseOnAnyOtherKey ?? false,
        scopeId: registration.scopeId,
        trigger: registration.trigger ?? "press",
      })
    : null

  useEffect(() => {
    if (!registrationRef.current) return
    const current = registrationRef.current
    const handle = service.registerFeature({
      ...current,
      onRelease: () => registrationRef.current?.onRelease?.(),
      isEnabled: (event) => registrationRef.current?.isEnabled?.(event) ?? true,
      onTrigger: (event) => registrationRef.current?.onTrigger(event),
    })
    return () => handle.dispose()
  }, [service, signature])
}

export function useShortcutFeatures(
  service: ScopedShortcutService,
  registrations: readonly ShortcutFeatureRegistration[],
): void {
  const registrationsRef = useRef(registrations)
  registrationsRef.current = registrations
  const signature = JSON.stringify(
    registrations.map((registration) => ({
      allowInEditable: registration.allowInEditable ?? false,
      chords: registration.chords,
      consume: registration.consume ?? true,
      id: registration.id,
      priority: registration.priority ?? 0,
      releaseOnAnyOtherKey: registration.releaseOnAnyOtherKey ?? false,
      scopeId: registration.scopeId,
      trigger: registration.trigger ?? "press",
    })),
  )

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
      return service.registerFeature({
        ...registration,
        isEnabled: (event) => registrationsByKey().get(key)?.isEnabled?.(event) ?? true,
        onRelease: () => registrationsByKey().get(key)?.onRelease?.(),
        onTrigger: (event) => registrationsByKey().get(key)?.onTrigger(event),
      })
    })
    return () => {
      for (const handle of handles) handle.dispose()
    }
  }, [service, signature])
}
