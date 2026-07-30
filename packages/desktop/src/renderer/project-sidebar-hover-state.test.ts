import { describe, expect, test } from "bun:test"
import { transitionProjectSidebarHover, type ProjectSidebarHoverEvent } from "./project-sidebar-hover-state"

function reduce(events: ProjectSidebarHoverEvent[]) {
  return events.reduce(transitionProjectSidebarHover, "idle")
}

describe("Project sidebar hover state", () => {
  test("reveals on pointer entry and closes on leave or explicit dismissal", () => {
    expect(reduce(["entry-enter"])).toBe("revealed")
    expect(reduce(["entry-enter", "entry-leave"])).toBe("idle")
    expect(reduce(["entry-enter", "dismiss"])).toBe("idle")
  })

  test("clears transient hover when the sidebar becomes pinned", () => {
    expect(reduce(["entry-enter", "pin"])).toBe("idle")
  })

  test("suppresses hover after collapsing beneath the pointer until it leaves", () => {
    expect(reduce(["unpin-inside-entry", "entry-enter"])).toBe("suppressed")
    expect(reduce(["unpin-inside-entry", "entry-enter", "entry-leave", "entry-enter"])).toBe("revealed")
  })

  test("allows the next hover immediately when collapse happened away from the entry", () => {
    expect(reduce(["unpin-outside-entry", "entry-enter"])).toBe("revealed")
  })
})
