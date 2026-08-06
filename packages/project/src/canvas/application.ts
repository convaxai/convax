import {
  parseCanvasId,
  parseDigest,
  parseId128,
  type CanvasId,
  type Digest,
  type Id128,
  type ProjectId,
} from "@convax/collaboration"

export type ProjectCanvasRouteState = "staged" | "live" | "tombstoned"

export interface ProjectCanvasRouteView {
  readonly canvasId: CanvasId
  readonly state: ProjectCanvasRouteState
  readonly title: string | null
  readonly shardEpoch: Id128 | null
  readonly activationDigest: Digest | null
  readonly routeProjectionDigest: Digest
}

/** Authoritative ProjectIndex route projection; visibleCanvases is derived. */
export interface ProjectCanvasCatalogProjection {
  readonly format: "convax.project-canvas-catalog-projection"
  readonly creationAvailability: "available" | "local-authority-unavailable" | "read-only-recovery-required"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly routes: readonly ProjectCanvasRouteView[]
  readonly visibleCanvases: readonly ProjectCanvasRouteView[]
}

export type ProjectCanvasRouteCommand =
  | Readonly<{
      format: "convax.project-canvas-route-command"
      kind: "project.canvas.route.create"
      title: string
    }>
  | Readonly<{
      format: "convax.project-canvas-route-command"
      kind: "project.canvas.route.rename"
      canvasId: CanvasId
      title: string
    }>
  | Readonly<{
      format: "convax.project-canvas-route-command"
      kind: "project.canvas.route.tombstone"
      canvasId: CanvasId
    }>

export type ProjectCanvasRouteCommandResult =
  | Readonly<{ status: "committed"; catalog: ProjectCanvasCatalogProjection; canvasId: CanvasId }>
  | Readonly<{
      status: "rejected"
      code:
        | "canvas-not-found"
        | "route-tombstoned"
        | "dependency-pending"
        | "cancelled"
        | "read-only-recovery-required"
    }>

export interface ProjectIndexCanvasApplicationPort {
  queryCatalog(input: { readonly projectId: ProjectId }): Promise<ProjectCanvasCatalogProjection>
  submitRouteCommand(input: {
    readonly projectId: ProjectId
    readonly command: ProjectCanvasRouteCommand
    readonly signal?: AbortSignal
  }): Promise<ProjectCanvasRouteCommandResult>
}

export function parseProjectCanvasCatalogProjection(
  value: ProjectCanvasCatalogProjection,
  projectId: ProjectId,
): ProjectCanvasCatalogProjection {
  if (
    !hasExactKeys(value, ["format", "creationAvailability", "projectId", "projectEpoch", "routes", "visibleCanvases"]) ||
    value.format !== "convax.project-canvas-catalog-projection" ||
    value.projectId !== projectId ||
    parseId128(value.projectEpoch) !== value.projectEpoch ||
    !Array.isArray(value.routes) ||
    !Array.isArray(value.visibleCanvases) ||
    (value.creationAvailability !== "available" && value.creationAvailability !== "local-authority-unavailable" &&
      value.creationAvailability !== "read-only-recovery-required")
  ) {
    throw new TypeError("ProjectIndex Canvas catalog projection is invalid")
  }
  const ids = new Set<string>()
  const routes = value.routes
    .map((route) => {
      if (!hasExactKeys(route, [
        "canvasId", "state", "title", "shardEpoch", "activationDigest", "routeProjectionDigest",
      ])) throw new TypeError("ProjectIndex Canvas route projection contains unknown fields")
      const canvasId = parseCanvasId(route.canvasId)
      if (ids.has(canvasId)) throw new TypeError("ProjectIndex Canvas catalog contains a duplicate route")
      ids.add(canvasId)
      if (route.state !== "staged" && route.state !== "live" && route.state !== "tombstoned") {
        throw new TypeError("ProjectIndex Canvas route state is invalid")
      }
      parseDigest(route.routeProjectionDigest)
      if (route.state === "live") {
        parseId128(route.shardEpoch)
        parseDigest(route.activationDigest)
        validateProjectCanvasTitle(route.title)
      } else if (route.state === "staged") {
        parseId128(route.shardEpoch)
        if (route.activationDigest !== null) throw new TypeError("Staged Canvas route cannot have an activation")
        validateProjectCanvasTitle(route.title)
      } else if (route.shardEpoch !== null || route.activationDigest !== null || route.title !== null) {
        throw new TypeError("Tombstoned Canvas route must suppress its live projection")
      }
      return Object.freeze({ ...route, canvasId })
    })
    .sort((left, right) => left.canvasId.localeCompare(right.canvasId))
  const visible = routes.filter((route) => route.state === "live")
  if (
    value.visibleCanvases.length !== visible.length ||
    value.visibleCanvases.some((route, index) => !sameProjectCanvasRouteView(route, visible[index]))
  ) {
    throw new TypeError("Visible Canvas catalog is not the exact live-route projection")
  }
  return Object.freeze({
    format: value.format,
    creationAvailability: value.creationAvailability,
    projectId,
    projectEpoch: value.projectEpoch,
    routes: Object.freeze(routes),
    visibleCanvases: Object.freeze(visible),
  })
}

function sameProjectCanvasRouteView(
  left: ProjectCanvasRouteView,
  right: ProjectCanvasRouteView | undefined,
): boolean {
  return right !== undefined && left.canvasId === right.canvasId && left.state === right.state &&
    left.title === right.title && left.shardEpoch === right.shardEpoch &&
    left.activationDigest === right.activationDigest &&
    left.routeProjectionDigest === right.routeProjectionDigest
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

export function validateProjectCanvasTitle(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.normalize("NFC") !== value ||
    value.length < 1 ||
    new TextEncoder().encode(value).byteLength > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError("Project Canvas title is invalid")
  }
  return value
}
