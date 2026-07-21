import type {
  WorkbenchInput,
  WorkbenchOpenOptions,
  WorkbenchRevealOptions,
  WorkbenchRevealRequest,
  WorkbenchSelection,
  WorkbenchSnapshot,
} from "./contracts"
import { isSelectionCompatible, resolveWorkbenchSurface, sameWorkbenchInput } from "./surface"

const initialSnapshot: WorkbenchSnapshot = {
  activeInput: null,
  changingInput: false,
  error: null,
  inputMode: "pinned",
  projectId: null,
  selection: null,
  surface: { kind: "empty", reason: "no-project" },
}

export interface WorkbenchControllerOptions {
  beforeInputChange?: (
    currentInput: WorkbenchInput | null,
    nextInput: WorkbenchInput | null,
  ) => Promise<boolean | void> | boolean | void
  onInputChangeCanceled?: () => void
}

export class WorkbenchController {
  private readonly listeners = new Set<() => void>()
  private readonly revealListeners = new Set<(request: WorkbenchRevealRequest) => void>()
  private snapshot = initialSnapshot
  private transitionRequest = 0

  constructor(private readonly options: WorkbenchControllerOptions = {}) {}

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onDidRequestReveal(listener: (request: WorkbenchRevealRequest) => void) {
    this.revealListeners.add(listener)
    return () => this.revealListeners.delete(listener)
  }

  setProject(projectId: string | null, initialInput: WorkbenchInput | null = null) {
    if (initialInput && initialInput.projectId !== projectId) {
      throw new Error("Workbench input does not belong to the active project.")
    }
    const activeInput = initialInput ?? (this.snapshot.activeInput?.projectId === projectId ? this.snapshot.activeInput : null)
    const selection = activeInput && sameWorkbenchInput(activeInput, this.snapshot.selection?.input ?? null)
      ? this.snapshot.selection
      : null
    this.transitionRequest += 1
    this.update({
      activeInput,
      changingInput: false,
      error: null,
      inputMode: "pinned",
      projectId,
      selection,
    })
  }

  async open(input: WorkbenchInput, options: WorkbenchOpenOptions = {}) {
    this.requireActiveProject(input)
    if (this.snapshot.changingInput) return false
    if (sameWorkbenchInput(this.snapshot.activeInput, input)) {
      this.update({
        activeInput: input,
        error: null,
        inputMode: options.preview ? "preview" : "pinned",
        selection: this.snapshot.selection ? { ...this.snapshot.selection, input } : null,
      })
      return true
    }
    return this.changeInput(input, options.preview ? "preview" : "pinned")
  }

  async close(input?: WorkbenchInput) {
    if (this.snapshot.changingInput) return false
    if (input && !sameWorkbenchInput(input, this.snapshot.activeInput)) return false
    if (!this.snapshot.activeInput) return false
    return this.changeInput(null, "pinned")
  }

  setSelection(input: WorkbenchInput, selection: WorkbenchSelection | null) {
    this.requireActiveInput(input)
    if (selection && !isSelectionCompatible(input, selection)) {
      throw new Error("Workbench selection is not compatible with its input.")
    }
    this.update({ selection: selection ? { input, selection } : null })
  }

  async revealSelection(input: WorkbenchInput, selection: WorkbenchSelection, options: WorkbenchRevealOptions = {}) {
    if (!isSelectionCompatible(input, selection)) {
      throw new Error("Workbench selection is not compatible with its input.")
    }
    const opened = await this.open(input, options)
    if (!opened) return
    this.setSelection(input, selection)
    const request: WorkbenchRevealRequest = {
      input,
      options: { fitView: options.fitView ?? false, focus: options.focus ?? true },
      selection,
    }
    for (const listener of this.revealListeners) listener(request)
    return request
  }

  clearError() {
    this.update({ error: null })
  }

  dispose() {
    this.transitionRequest += 1
    this.listeners.clear()
    this.revealListeners.clear()
  }

  private async changeInput(nextInput: WorkbenchInput | null, inputMode: WorkbenchSnapshot["inputMode"]) {
    const currentInput = this.snapshot.activeInput
    const request = ++this.transitionRequest
    this.update({ changingInput: true, error: null })
    try {
      const proceed = await this.options.beforeInputChange?.(currentInput, nextInput)
      if (request !== this.transitionRequest) return false
      if (proceed === false) {
        this.update({ changingInput: false, error: null })
        this.options.onInputChangeCanceled?.()
        return false
      }
      this.update({
        activeInput: nextInput,
        changingInput: false,
        error: null,
        inputMode,
        selection: null,
      })
      return true
    } catch (error) {
      if (request !== this.transitionRequest) return false
      this.update({ changingInput: false, error: errorMessage(error) })
      this.options.onInputChangeCanceled?.()
      return false
    }
  }

  private requireActiveProject(input: WorkbenchInput) {
    if (!this.snapshot.projectId || input.projectId !== this.snapshot.projectId) {
      throw new Error("Workbench input does not belong to the active project.")
    }
  }

  private requireActiveInput(input: WorkbenchInput) {
    this.requireActiveProject(input)
    if (!sameWorkbenchInput(input, this.snapshot.activeInput)) {
      throw new Error("Workbench selection target is not the active input.")
    }
  }

  private update(patch: Partial<Omit<WorkbenchSnapshot, "surface">>) {
    const source = { ...this.snapshot, ...patch }
    this.snapshot = { ...source, surface: resolveWorkbenchSurface(source) }
    for (const listener of this.listeners) listener()
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
