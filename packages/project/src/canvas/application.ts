import {
  parseCanvasId,
  parseDigest,
  parseId128,
  type CanvasId,
  type Digest,
  type Id128,
  type ProjectId,
} from "@convax/collaboration"

export type ProjectCanvasRouteStateV2 = "staged" | "live" | "tombstoned"

export interface ProjectCanvasRouteViewV2 {
  readonly canvasId: CanvasId
  readonly state: ProjectCanvasRouteStateV2
  readonly title: string | null
  readonly shardEpoch: Id128 | null
  readonly activationDigest: Digest | null
  readonly routeProjectionDigest: Digest
}

/** Authoritative ProjectIndex route projection; visibleCanvases is derived. */
export interface ProjectCanvasCatalogProjectionV2 {
  readonly format: "convax.project-canvas-catalog-projection/2"
  readonly creationAvailability: "available" | "local-authority-unavailable" | "read-only-recovery-required"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly routes: readonly ProjectCanvasRouteViewV2[]
  readonly visibleCanvases: readonly ProjectCanvasRouteViewV2[]
}

export type ProjectCanvasRouteCommandV2 =
  | Readonly<{
      format: "convax.project-canvas-route-command/2"
      kind: "project.canvas.route.create/2"
      title: string
    }>
  | Readonly<{
      format: "convax.project-canvas-route-command/2"
      kind: "project.canvas.route.rename/2"
      canvasId: CanvasId
      title: string
    }>
  | Readonly<{
      format: "convax.project-canvas-route-command/2"
      kind: "project.canvas.route.tombstone/2"
      canvasId: CanvasId
    }>

export type ProjectCanvasRouteCommandResultV2 =
  | Readonly<{ status: "committed"; catalog: ProjectCanvasCatalogProjectionV2; canvasId: CanvasId }>
  | Readonly<{
      status: "rejected"
      code:
        | "canvas-not-found"
        | "route-tombstoned"
        | "dependency-pending"
        | "cancelled"
        | "read-only-recovery-required"
    }>

export interface ProjectIndexCanvasApplicationPortV2 {
  queryCatalog(input: { readonly projectId: ProjectId }): Promise<ProjectCanvasCatalogProjectionV2>
  submitRouteCommand(input: {
    readonly projectId: ProjectId
    readonly command: ProjectCanvasRouteCommandV2
    readonly signal?: AbortSignal
  }): Promise<ProjectCanvasRouteCommandResultV2>
}

export function parseProjectCanvasCatalogProjectionV2(
  value: ProjectCanvasCatalogProjectionV2,
  projectId: ProjectId,
): ProjectCanvasCatalogProjectionV2 {
  if (
    !hasExactKeys(value, ["format", "creationAvailability", "projectId", "projectEpoch", "routes", "visibleCanvases"]) ||
    value.format !== "convax.project-canvas-catalog-projection/2" ||
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
        validateProjectCanvasTitleV2(route.title)
      } else if (route.state === "staged") {
        parseId128(route.shardEpoch)
        if (route.activationDigest !== null) throw new TypeError("Staged Canvas route cannot have an activation")
        validateProjectCanvasTitleV2(route.title)
      } else if (route.shardEpoch !== null || route.activationDigest !== null || route.title !== null) {
        throw new TypeError("Tombstoned Canvas route must suppress its live projection")
      }
      return Object.freeze({ ...route, canvasId })
    })
    .sort((left, right) => left.canvasId.localeCompare(right.canvasId))
  const visible = routes.filter((route) => route.state === "live")
  if (
    value.visibleCanvases.length !== visible.length ||
    value.visibleCanvases.some((route, index) => !sameProjectCanvasRouteViewV2(route, visible[index]))
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

function sameProjectCanvasRouteViewV2(
  left: ProjectCanvasRouteViewV2,
  right: ProjectCanvasRouteViewV2 | undefined,
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

export function validateProjectCanvasTitleV2(value: unknown): string {
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
