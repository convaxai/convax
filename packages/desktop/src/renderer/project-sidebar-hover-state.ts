export type ProjectSidebarHoverState = "idle" | "revealed" | "suppressed"

export type ProjectSidebarHoverEvent =
  | "dismiss"
  | "entry-enter"
  | "entry-leave"
  | "pin"
  | "unpin-inside-entry"
  | "unpin-outside-entry"

/**
 * Desktop-only transient pointer presentation for the Project sidebar.
 *
 * Workbench remains the canonical owner of pinned visibility. This machine
 * deliberately models only hover preview and the suppression needed to avoid
 * reopening from the same pointer gesture that collapsed a pinned sidebar.
 */
export function transitionProjectSidebarHover(
  state: ProjectSidebarHoverState,
  event: ProjectSidebarHoverEvent,
): ProjectSidebarHoverState {
  switch (event) {
    case "entry-enter":
      return state === "suppressed" ? state : "revealed"
    case "entry-leave":
    case "dismiss":
    case "pin":
    case "unpin-outside-entry":
      return "idle"
    case "unpin-inside-entry":
      return "suppressed"
  }
}
