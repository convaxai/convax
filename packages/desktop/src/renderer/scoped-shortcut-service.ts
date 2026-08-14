export type ShortcutScopeKind = "application" | "focus"

export interface ShortcutChord {
  readonly alt?: boolean
  readonly code?: string
  readonly ctrl?: boolean
  readonly key?: string
  readonly meta?: boolean
  readonly shift?: boolean
}

export interface ShortcutFeatureRegistration {
  readonly allowInEditable?: boolean
  readonly chords: readonly ShortcutChord[]
  /** Observe the winning shortcut without suppressing its native/browser handling. */
  readonly consume?: boolean
  readonly id: string
  /** Recheck transient feature availability immediately before conflict arbitration. */
  readonly isEnabled?: (event: KeyboardEvent) => boolean
  readonly onRelease?: () => void
  readonly onTrigger: (event: KeyboardEvent) => void
  readonly priority?: number
  readonly releaseOnAnyOtherKey?: boolean
  readonly scopeId: string
  readonly trigger?: "hold" | "press"
}

export interface ShortcutScopeRegistration {
  readonly element: HTMLElement
  readonly id: string
  readonly kind?: ShortcutScopeKind
  /** Restrict a nested logical scope without requiring a wrapper around every matching descendant. */
  readonly matchesTarget?: (target: Element) => boolean
  readonly priority?: number
}

export interface ShortcutRegistrationHandle {
  dispose(): void
}

interface RegisteredScope extends ShortcutScopeRegistration {
  readonly sequence: number
}

interface RegisteredFeature extends ShortcutFeatureRegistration {
  readonly sequence: number
}

const editableSelector = "input, textarea, select, [contenteditable]:not([contenteditable='false'])"

function normalizedKey(key: string) {
  return key.length === 1 ? key.toLocaleLowerCase() : key
}

function matchesModifiers(chord: ShortcutChord, event: KeyboardEvent) {
  return (
    event.altKey === (chord.alt ?? false) &&
    event.ctrlKey === (chord.ctrl ?? false) &&
    event.metaKey === (chord.meta ?? false) &&
    event.shiftKey === (chord.shift ?? false)
  )
}

function matchesChord(chord: ShortcutChord, event: KeyboardEvent) {
  const physicalKeyMatches = chord.code !== undefined && event.code === chord.code
  const logicalKeyMatches = chord.key !== undefined && normalizedKey(event.key) === normalizedKey(chord.key)
  return (physicalKeyMatches || logicalKeyMatches) && matchesModifiers(chord, event)
}

function scopeMatchesTarget(scope: RegisteredScope, target: Element) {
  if (!scope.matchesTarget) return true
  try {
    return scope.matchesTarget(target)
  } catch {
    return false
  }
}

function featureIsEnabled(feature: RegisteredFeature, event: KeyboardEvent) {
  try {
    return feature.isEnabled?.(event) !== false
  } catch {
    return false
  }
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(editableSelector))
}

/**
 * Renderer-owned focus router for keyboard shortcuts.
 *
 * Exactly one deepest focus scope is active. Application scopes are fallback
 * scopes for commands that intentionally remain available throughout the app.
 */
export class ScopedShortcutService {
  readonly #document: Document
  readonly #features = new Map<number, RegisteredFeature>()
  readonly #heldFeatures = new Set<number>()
  readonly #scopes = new Map<number, RegisteredScope>()
  readonly #window: Window
  #activeFocusScopeId: string | null = null
  #disposed = false
  #focusWithinRegisteredRoot = false
  #pendingFocusExitFrame: number | null = null
  #sequence = 0

  constructor(input: { readonly document: Document; readonly window: Window }) {
    this.#document = input.document
    this.#window = input.window
    this.#window.addEventListener("keydown", this.#onKeyDown, true)
    this.#window.addEventListener("keyup", this.#onKeyUp, true)
    // Descendant blur events traverse Window during capture. Listen only for
    // Window's own non-bubbling blur so Canvas-internal focus changes cannot
    // masquerade as application focus loss.
    this.#window.addEventListener("blur", this.#onWindowBlur)
    this.#window.addEventListener("focus", this.#onWindowFocus, true)
    this.#window.addEventListener("focusin", this.#onFocusChange, true)
    this.#document.addEventListener("focusin", this.#onFocusChange, true)
    this.#document.addEventListener("focusout", this.#onFocusChange, true)
    this.#document.addEventListener("visibilitychange", this.#onVisibilityChange)
  }

  registerScope(registration: ShortcutScopeRegistration): ShortcutRegistrationHandle {
    this.#assertLive()
    const sequence = ++this.#sequence
    this.#scopes.set(sequence, { ...registration, kind: registration.kind ?? "focus", sequence })
    this.#refreshActiveScope()
    return {
      dispose: () => {
        if (!this.#scopes.delete(sequence)) return
        this.#refreshActiveScope()
      },
    }
  }

  registerFeature(registration: ShortcutFeatureRegistration): ShortcutRegistrationHandle {
    this.#assertLive()
    if (registration.chords.length === 0) throw new Error("A shortcut feature requires at least one chord")
    if (registration.chords.some((chord) => chord.key === undefined && chord.code === undefined)) {
      throw new Error("A shortcut chord requires a key or code")
    }
    const sequence = ++this.#sequence
    this.#features.set(sequence, { ...registration, priority: registration.priority ?? 0, sequence })
    return {
      dispose: () => {
        if (!this.#features.has(sequence)) return
        this.#releaseFeature(sequence)
        this.#features.delete(sequence)
      },
    }
  }

  releaseAll(): void {
    for (const sequence of this.#heldFeatures) this.#releaseFeature(sequence)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#cancelPendingFocusExit()
    this.releaseAll()
    this.#window.removeEventListener("keydown", this.#onKeyDown, true)
    this.#window.removeEventListener("keyup", this.#onKeyUp, true)
    this.#window.removeEventListener("blur", this.#onWindowBlur)
    this.#window.removeEventListener("focus", this.#onWindowFocus, true)
    this.#window.removeEventListener("focusin", this.#onFocusChange, true)
    this.#document.removeEventListener("focusin", this.#onFocusChange, true)
    this.#document.removeEventListener("focusout", this.#onFocusChange, true)
    this.#document.removeEventListener("visibilitychange", this.#onVisibilityChange)
    this.#features.clear()
    this.#scopes.clear()
    this.#activeFocusScopeId = null
    this.#focusWithinRegisteredRoot = false
  }

  #assertLive() {
    if (this.#disposed) throw new Error("ScopedShortcutService is disposed")
  }

  #resolveActiveFocusScope(target: Element | null): RegisteredScope | null {
    if (!target) return null
    const candidates = [...this.#scopes.values()].filter(
      (scope) =>
        scope.kind === "focus" &&
        scope.element.isConnected &&
        scope.element.contains(target) &&
        scopeMatchesTarget(scope, target),
    )
    candidates.sort((left, right) => {
      if (left.element !== right.element && left.element.contains(right.element)) return 1
      if (left.element !== right.element && right.element.contains(left.element)) return -1
      if ((left.priority ?? 0) !== (right.priority ?? 0)) return (right.priority ?? 0) - (left.priority ?? 0)
      return left.sequence - right.sequence
    })
    return candidates[0] ?? null
  }

  #cancelPendingFocusExit() {
    if (this.#pendingFocusExitFrame === null) return
    this.#window.cancelAnimationFrame(this.#pendingFocusExitFrame)
    this.#pendingFocusExitFrame = null
  }

  #scheduleFocusExitRecheck() {
    if (this.#pendingFocusExitFrame !== null) return
    this.#pendingFocusExitFrame = this.#window.requestAnimationFrame(() => {
      this.#pendingFocusExitFrame = null
      if (!this.#disposed) this.#refreshActiveScope()
    })
  }

  #refreshActiveScope(deferAmbiguousExit = false) {
    const activeElement = this.#document.activeElement instanceof Element ? this.#document.activeElement : null
    const ambiguousDocumentFocus =
      activeElement === this.#document.body || activeElement === this.#document.documentElement
    const next = this.#document.hidden ? null : (this.#resolveActiveFocusScope(activeElement)?.id ?? null)
    const nextWithinRegisteredRoot = Boolean(
      !this.#document.hidden &&
        !ambiguousDocumentFocus &&
        activeElement &&
        [...this.#scopes.values()].some((scope) => scope.element.isConnected && scope.element.contains(activeElement)),
    )
    if (deferAmbiguousExit && !this.#document.hidden && !nextWithinRegisteredRoot && this.#focusWithinRegisteredRoot) {
      // A pointer press on a non-focusable Canvas node can briefly move
      // document.activeElement to body before Canvas restores its focus root.
      // Recheck that ambiguous gap on the next frame. Explicit transitions to
      // another registered scope, Window blur, and visibility loss still
      // release synchronously.
      this.#scheduleFocusExitRecheck()
      return
    }
    this.#cancelPendingFocusExit()
    if (next === this.#activeFocusScopeId && nextWithinRegisteredRoot === this.#focusWithinRegisteredRoot) return
    this.releaseAll()
    this.#activeFocusScopeId = next
    this.#focusWithinRegisteredRoot = nextWithinRegisteredRoot
  }

  #candidateScopeIds() {
    const result: string[] = []
    if (this.#activeFocusScopeId) result.push(this.#activeFocusScopeId)
    const applicationScopes = [...this.#scopes.values()]
      .filter((scope) => scope.kind === "application" && scope.element.isConnected)
      .sort((left, right) => left.sequence - right.sequence)
    for (const scope of applicationScopes) {
      if (!result.includes(scope.id)) result.push(scope.id)
    }
    return result
  }

  #winningFeature(event: KeyboardEvent): RegisteredFeature | null {
    const editable = isEditableShortcutTarget(event.target)
    for (const scopeId of this.#candidateScopeIds()) {
      const candidates = [...this.#features.values()].filter(
        (feature) =>
          feature.scopeId === scopeId &&
          (!editable || feature.allowInEditable === true) &&
          featureIsEnabled(feature, event) &&
          feature.chords.some((chord) => matchesChord(chord, event)),
      )
      candidates.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.sequence - right.sequence)
      if (candidates[0]) return candidates[0]
    }
    return null
  }

  #releaseFeature(sequence: number) {
    if (!this.#heldFeatures.delete(sequence)) return
    try {
      this.#features.get(sequence)?.onRelease?.()
    } catch {
      // A feature release cannot retain the service's physical held state.
    }
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (this.#disposed || event.defaultPrevented || event.isComposing || this.#document.hidden) return
    this.#refreshActiveScope()
    if (!this.#focusWithinRegisteredRoot) return
    for (const sequence of this.#heldFeatures) {
      const held = this.#features.get(sequence)
      if (
        held?.releaseOnAnyOtherKey &&
        !held.chords.some(
          (chord) =>
            (chord.key !== undefined && normalizedKey(chord.key) === normalizedKey(event.key)) ||
            (chord.code !== undefined && chord.code === event.code),
        )
      ) {
        this.#releaseFeature(sequence)
      }
    }
    const feature = this.#winningFeature(event)
    if (!feature) return
    if (feature.trigger === "hold" && this.#heldFeatures.has(feature.sequence)) {
      if (event.repeat) return
      // Native macOS drag loops can swallow the keyup that ended the previous
      // physical hold. A fresh, non-repeat keydown proves a new hold started;
      // release the stale logical hold before routing this one.
      this.#releaseFeature(feature.sequence)
    }
    if (feature.consume !== false) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    if (feature.trigger === "hold") this.#heldFeatures.add(feature.sequence)
    try {
      feature.onTrigger(event)
    } catch (error) {
      if (feature.trigger === "hold") this.#releaseFeature(feature.sequence)
      throw error
    }
  }

  #onKeyUp = (event: KeyboardEvent) => {
    if (this.#disposed) return
    for (const sequence of this.#heldFeatures) {
      const feature = this.#features.get(sequence)
      const releasedTriggerKey = feature?.chords.some(
        (chord) =>
          (chord.key !== undefined && normalizedKey(chord.key) === normalizedKey(event.key)) ||
          (chord.code !== undefined && chord.code === event.code),
      )
      if (!feature || releasedTriggerKey || !feature.chords.some((chord) => matchesModifiers(chord, event))) {
        this.#releaseFeature(sequence)
      }
    }
  }

  #onWindowBlur = () => {
    this.#cancelPendingFocusExit()
    this.releaseAll()
    this.#activeFocusScopeId = null
    this.#focusWithinRegisteredRoot = false
  }

  #onWindowFocus = () => {
    // Window observes descendant focus during capture before Chromium has
    // necessarily published the new document.activeElement. Recheck after
    // the focus dispatch so a focus move into a contenteditable/portal scope
    // cannot retain a held Canvas feature.
    this.#window.queueMicrotask(() => {
      if (!this.#disposed) this.#refreshActiveScope()
    })
  }

  #onFocusChange = () => this.#window.queueMicrotask(() => this.#refreshActiveScope(true))

  #onVisibilityChange = () => {
    if (this.#document.hidden) {
      this.#cancelPendingFocusExit()
      this.releaseAll()
      this.#activeFocusScopeId = null
      this.#focusWithinRegisteredRoot = false
      return
    }
    this.#refreshActiveScope()
  }
}
