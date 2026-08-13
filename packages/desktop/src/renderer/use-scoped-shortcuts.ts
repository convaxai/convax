import { useCallback, useEffect, useRef, type RefCallback } from "react"

import {
  type ShortcutFeatureRegistration,
  type ShortcutScopeKind,
  ScopedShortcutService,
} from "./scoped-shortcut-service"

export function useShortcutScope(
  service: ScopedShortcutService,
  input: { readonly enabled?: boolean; readonly id: string; readonly kind?: ShortcutScopeKind },
): RefCallback<HTMLElement> {
  const disposeRef = useRef<(() => void) | null>(null)
  const elementRef = useRef<HTMLElement | null>(null)

  const register = useCallback(
    (element: HTMLElement | null) => {
      disposeRef.current?.()
      disposeRef.current = null
      elementRef.current = element
      if (!element || input.enabled === false) return
      const handle = service.registerScope({ element, id: input.id, kind: input.kind })
      disposeRef.current = () => handle.dispose()
    },
    [input.enabled, input.id, input.kind, service],
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
      onTrigger: (event) => registrationRef.current?.onTrigger(event),
    })
    return () => handle.dispose()
  }, [service, signature])
}
