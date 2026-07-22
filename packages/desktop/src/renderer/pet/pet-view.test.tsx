import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { PetActivitySummary, PetRendererSnapshot } from "../../pet-contracts"
import {
  activatePet,
  animationForActivity,
  createPetDragGesture,
  frameFor,
  PetView,
  petKeyAction,
  petStatusText,
  visiblePetActivities,
} from "./pet-view"

const activity = (id: string, state: PetActivitySummary["state"]): PetActivitySummary => ({
  id,
  projectId: `project-${id}`,
  projectName: `Project ${id}`,
  sessionId: `session-${id}`,
  sessionName: `Session ${id}`,
  state,
  updatedAt: 100,
})

const snapshot: PetRendererSnapshot = {
  activity: {
    activities: [
      { ...activity("one", "needs-input"), input: "permission" },
      activity("two", "blocked"),
      activity("three", "ready"),
      activity("four", "running"),
      activity("five", "running"),
    ],
    revision: 3,
  },
  pet: {
    alt: "Violet, a pixel companion",
    assetUrl: "convax-pet-asset://pet/plugin%3Aviolet",
    description: "A violet pixel companion",
    id: "plugin:violet",
    name: "Violet",
    source: "plugin",
    spriteVersion: 2,
  },
}

describe("pet sprite animation", () => {
  test("selects frames from the idle and review atlas rows", () => {
    expect(frameFor("idle", 0, false)).toEqual({ column: 0, row: 0 })
    expect(frameFor("idle", 280, false)).toEqual({ column: 1, row: 0 })
    expect(frameFor("review", 0, false)).toEqual({ column: 0, row: 8 })
  })

  test("holds a stable frame when reduced motion is requested", () => {
    expect(frameFor("running", 10_000, true)).toEqual({ column: 0, row: 7 })
  })
})

describe("pet activity presentation", () => {
  test("uses the exact state animations and keeps additional tray rows scrollable", () => {
    expect(petStatusText(snapshot.activity.activities[0]!)).toBe("Needs permission")
    expect(petStatusText(snapshot.activity.activities[1]!)).toBe("Blocked")
    expect(animationForActivity(snapshot.activity.activities[0])).toBe("review")
    expect(animationForActivity({ ...snapshot.activity.activities[0]!, input: "question" })).toBe("waiting")
    expect(animationForActivity(snapshot.activity.activities[2])).toBe("waving")
    expect(visiblePetActivities(snapshot.activity.activities)).toHaveLength(5)

    const markup = renderToStaticMarkup(
      <PetView
        client={{
          drag: () => undefined,
          navigate: async () => undefined,
          onSnapshot: () => () => undefined,
          setExpanded: async () => undefined,
        }}
        expanded
        reducedMotion
        snapshot={snapshot}
      />,
    )
    expect(markup).toContain("Needs permission")
    expect(markup).toContain("Blocked")
    expect(markup).toContain("Session five")
  })

  test("keeps the collapsed sprite out of tab order and uses the selected pet name", () => {
    const empty = { ...snapshot, activity: { activities: [], revision: 4 }, pet: { ...snapshot.pet, name: "Comet" } }
    const collapsedMarkup = renderToStaticMarkup(
      <PetView
        client={{
          drag: () => undefined,
          navigate: async () => undefined,
          onSnapshot: () => () => undefined,
          setExpanded: async () => undefined,
        }}
        expanded={false}
        reducedMotion
        snapshot={empty}
      />,
    )
    const expandedMarkup = renderToStaticMarkup(
      <PetView
        client={{
          drag: () => undefined,
          navigate: async () => undefined,
          onSnapshot: () => () => undefined,
          setExpanded: async () => undefined,
        }}
        expanded
        reducedMotion
        snapshot={empty}
      />,
    )
    expect(collapsedMarkup).toContain('tabindex="-1"')
    expect(expandedMarkup).toContain("Comet is keeping watch")
    expect(expandedMarkup).not.toContain("Violet is keeping watch")
  })
})

describe("pet interaction", () => {
  test("starts dragging only after four pixels and completes an active drag", () => {
    const onDrag = mock(() => undefined)
    const gesture = createPetDragGesture(onDrag)
    gesture.start({ x: 10, y: 10 })
    expect(gesture.move({ x: 12, y: 12 })).toBe(false)
    expect(onDrag).not.toHaveBeenCalled()
    expect(gesture.move({ x: 14, y: 10 })).toBe(true)
    expect(onDrag).toHaveBeenCalledWith({ dx: 4, dy: 0, phase: "move" })
    expect(gesture.end()).toBe(true)
    expect(onDrag).toHaveBeenLastCalledWith({ dx: 0, dy: 0, phase: "end" })
  })

  test("plays the jump before requesting opaque navigation", async () => {
    const events: string[] = []
    await activatePet("activity-one", {
      navigate: async () => events.push("navigate"),
      onJump: () => events.push("jump"),
      wait: async () => events.push("wait"),
    })
    expect(events).toEqual(["jump", "wait", "navigate"])
  })

  test("supports keyboard activation and tray dismissal", () => {
    expect(petKeyAction("Enter", true)).toBe("activate")
    expect(petKeyAction(" ", true)).toBe("activate")
    expect(petKeyAction("Escape", true)).toBe("collapse")
    expect(petKeyAction("Escape", false)).toBe("none")
  })
})
