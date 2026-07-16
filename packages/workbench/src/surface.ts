import type {
  WorkbenchInput,
  WorkbenchSelection,
  WorkbenchSnapshot,
  WorkbenchSurface,
} from "./contracts"

export function sameWorkbenchInput(left: WorkbenchInput | null, right: WorkbenchInput | null) {
  if (left === right) return true
  if (!left || !right || left.kind !== right.kind || left.projectId !== right.projectId) return false
  return left.kind === "canvas" && right.kind === "canvas"
    ? left.canvasId === right.canvasId
    : left.kind === "file" && right.kind === "file"
      && (left.resourceId && right.resourceId ? left.resourceId === right.resourceId : left.path === right.path)
}

export function isSelectionCompatible(input: WorkbenchInput, selection: WorkbenchSelection) {
  return input.kind === "canvas" ? selection.kind === "canvas-nodes" : selection.kind === "file-range"
}

export function resolveWorkbenchSurface(
  source: Pick<WorkbenchSnapshot, "activeInput" | "projectId">,
): WorkbenchSurface {
  if (!source.projectId) return { kind: "empty", reason: "no-project" }
  if (!source.activeInput || source.activeInput.projectId !== source.projectId) {
    return { kind: "empty", reason: "no-input" }
  }
  return source.activeInput.kind === "canvas"
    ? { input: source.activeInput, kind: "canvas" }
    : { input: source.activeInput, kind: "file" }
}
