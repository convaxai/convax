import { describe, expect, mock, test } from "bun:test"
import { WorkbenchLayoutController, WorkbenchLayoutParts } from "./layout"

function options(overrides: Record<string, object> = {}) {
  return {
    parts: {
      [WorkbenchLayoutParts.PrimarySidebar]: {
        initialSize: 280,
        initialVisible: true,
        maxSize: 520,
        minSize: 180,
        ...overrides[WorkbenchLayoutParts.PrimarySidebar],
      },
      [WorkbenchLayoutParts.SecondarySidebar]: {
        collapseThreshold: 120,
        initialSize: 360,
        initialVisible: true,
        maxSize: 640,
        minSize: 200,
        ...overrides[WorkbenchLayoutParts.SecondarySidebar],
      },
    },
  }
}

describe("WorkbenchLayoutController", () => {
  test("uses host-provided initial size and visibility and publishes snapshots", () => {
    const controller = new WorkbenchLayoutController(options({
      [WorkbenchLayoutParts.SecondarySidebar]: { initialSize: 410, initialVisible: false },
    }))
    const listener = mock(() => undefined)
    const unsubscribe = controller.subscribe(listener)

    expect(controller.getSnapshot()).toEqual({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { size: 280, visible: true },
        [WorkbenchLayoutParts.SecondarySidebar]: { size: 410, visible: false },
      },
      resize: null,
    })
    expect(controller.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)).toBe(true)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]).toEqual({
      size: 410,
      visible: true,
    })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    controller.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test("resizes from one baseline and clamps to host constraints", () => {
    const controller = new WorkbenchLayoutController(options())
    expect(controller.beginResize(WorkbenchLayoutParts.PrimarySidebar)).toBe(true)
    expect(controller.getSnapshot().resize).toEqual({ partId: WorkbenchLayoutParts.PrimarySidebar })

    expect(controller.updateResize(-1_000)).toBe(true)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.PrimarySidebar]?.size).toBe(180)
    expect(controller.updateResize(1_000)).toBe(true)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.PrimarySidebar]?.size).toBe(520)
    expect(controller.endResize()).toBe(true)
    expect(controller.getSnapshot().resize).toBeNull()
  })

  test("collapses the secondary sidebar at its injected threshold and retains its expanded size", () => {
    const controller = new WorkbenchLayoutController(options())
    controller.beginResize(WorkbenchLayoutParts.SecondarySidebar)
    controller.updateResize(-240)

    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]).toEqual({
      size: 360,
      visible: false,
    })
    controller.endResize()
    controller.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]).toEqual({
      size: 360,
      visible: true,
    })
  })

  test("retains the latest committed expanded size across a later collapse", () => {
    const controller = new WorkbenchLayoutController(options())
    controller.beginResize(WorkbenchLayoutParts.SecondarySidebar)
    controller.updateResize(-80)
    controller.endResize()
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]?.size).toBe(280)

    controller.beginResize(WorkbenchLayoutParts.SecondarySidebar)
    controller.updateResize(-200)
    controller.endResize()
    controller.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]?.size).toBe(280)
  })

  test("can drag back above the collapse threshold before committing", () => {
    const controller = new WorkbenchLayoutController(options())
    controller.beginResize(WorkbenchLayoutParts.SecondarySidebar)
    controller.updateResize(-300)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]?.visible).toBe(false)

    controller.updateResize(-100)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]).toEqual({
      size: 260,
      visible: true,
    })
    controller.endResize()
  })

  test("cancelResize restores both size and visibility", () => {
    const controller = new WorkbenchLayoutController(options())
    const before = controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]
    controller.beginResize(WorkbenchLayoutParts.SecondarySidebar)
    controller.updateResize(-300)

    expect(controller.cancelResize()).toBe(true)
    expect(controller.getSnapshot().parts[WorkbenchLayoutParts.SecondarySidebar]).toEqual(before)
    expect(controller.getSnapshot().resize).toBeNull()
    expect(controller.cancelResize()).toBe(false)
  })

  test("supports additional host-defined parts without encoding their dimensions", () => {
    const controller = new WorkbenchLayoutController({
      parts: {
        ...options().parts,
        panel: { initialSize: 190, initialVisible: false, maxSize: 700, minSize: 90 },
      },
    })

    controller.setPartVisible("panel", true)
    controller.beginResize("panel")
    controller.updateResize(50)
    controller.endResize()
    expect(controller.getSnapshot().parts.panel).toEqual({ size: 240, visible: true })
  })

  test("guards invalid resize transactions", () => {
    const controller = new WorkbenchLayoutController(options({
      [WorkbenchLayoutParts.SecondarySidebar]: { initialVisible: false },
    }))
    expect(controller.beginResize(WorkbenchLayoutParts.SecondarySidebar)).toBe(false)
    expect(() => controller.updateResize(1)).toThrow("No Workbench resize")
    expect(controller.beginResize(WorkbenchLayoutParts.PrimarySidebar)).toBe(true)
    expect(() => controller.beginResize(WorkbenchLayoutParts.PrimarySidebar)).toThrow("already active")
    expect(() => controller.updateResize(Number.NaN)).toThrow("must be finite")
    expect(() => controller.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)).toThrow("during a resize")
    expect(() => controller.togglePartVisibility("unknown")).toThrow("Unknown Workbench layout part")
  })

  test("rejects incomplete and contradictory host configuration", () => {
    expect(() => new WorkbenchLayoutController({
      parts: { [WorkbenchLayoutParts.PrimarySidebar]: options().parts[WorkbenchLayoutParts.PrimarySidebar] },
    } as never)).toThrow("secondary-sidebar")
    expect(() => new WorkbenchLayoutController(options({
      [WorkbenchLayoutParts.PrimarySidebar]: { initialSize: 100 },
    }))).toThrow("outside its constraints")
    expect(() => new WorkbenchLayoutController(options({
      [WorkbenchLayoutParts.SecondarySidebar]: { collapseThreshold: 360 },
    }))).toThrow("collapse threshold")
    expect(() => new WorkbenchLayoutController(options({
      [WorkbenchLayoutParts.SecondarySidebar]: { collapseThreshold: Number.NaN },
    }))).toThrow("must be finite")
  })
})
