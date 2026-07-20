import { describe, expect, mock, test } from "bun:test"
import type { KeyboardEvent, MouseEvent, ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  SegmentedTabs,
  type SegmentedTabItem,
} from "../src/components/segmented-tabs"

const items = [
  { id: "image-tab", label: "Image", panelId: "image-panel", value: "image" },
  { disabled: true, label: "Video", value: "video" },
  { label: "Audio", value: "audio" },
] as const satisfies readonly SegmentedTabItem<string>[]

describe("SegmentedTabs", () => {
  test("renders a controlled tab list with panel relationships and roving tab stops", () => {
    const markup = renderToStaticMarkup(
      <SegmentedTabs aria-label="Media type" items={items} onValueChange={() => undefined} value="image" />,
    )

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-label="Media type"')
    expect(markup).toContain('aria-orientation="horizontal"')
    expect(markup).toMatch(/aria-controls="image-panel"[^>]*aria-selected="true"[^>]*id="image-tab"/)
    expect(markup).toMatch(/aria-selected="true"[^>]*tabindex="0"/)
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(2)
    expect(markup).toMatch(/disabled=""[^>]*role="tab"/)
  })

  test("keeps a disabled controlled value selected while moving the tab stop to an enabled item", () => {
    const markup = renderToStaticMarkup(
      <SegmentedTabs aria-label="Media type" items={items} onValueChange={() => undefined} value="video" />,
    )

    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(markup).toMatch(/aria-selected="true"[^>]*disabled=""[^>]*tabindex="-1"/)
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1)
    expect(markup).toMatch(/>Image<\/button>/)
  })

  test("reports only enabled controlled value changes", () => {
    const onValueChange = mock(() => undefined)
    const view = SegmentedTabs({
      "aria-label": "Media type",
      items,
      onValueChange,
      value: "image",
    })
    const tabs = view.props.children as ReactElement<{
      onClick(event: MouseEvent<HTMLButtonElement>): void
    }>[]

    tabs[0]!.props.onClick({} as MouseEvent<HTMLButtonElement>)
    tabs[1]!.props.onClick({} as MouseEvent<HTMLButtonElement>)
    tabs[2]!.props.onClick({} as MouseEvent<HTMLButtonElement>)

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith("audio")
  })

  test("uses arrow keys with wrapping and skips disabled tabs", () => {
    const changes: string[] = []
    const view = SegmentedTabs({
      "aria-label": "Media type",
      items,
      onValueChange: (value) => changes.push(value),
      value: "image",
    })
    const tabs = view.props.children as ReactElement<{
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void
    }>[]
    const focus = items.map(() => mock(() => undefined))
    const preventDefault = mock(() => undefined)
    const event = (key: string) => ({
      currentTarget: {
        parentElement: {
          children: {
            item: (index: number) => ({ focus: focus[index]! }),
          },
        },
      },
      key,
      preventDefault,
    }) as unknown as KeyboardEvent<HTMLButtonElement>

    tabs[0]!.props.onKeyDown(event("ArrowRight"))
    expect(focus[2]).toHaveBeenCalledTimes(1)
    expect(changes).toEqual(["audio"])

    tabs[0]!.props.onKeyDown(event("ArrowLeft"))
    expect(focus[2]).toHaveBeenCalledTimes(2)
    expect(changes).toEqual(["audio", "audio"])
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })

  test("supports vertical arrows plus Home and End", () => {
    const changes: string[] = []
    const view = SegmentedTabs({
      "aria-label": "Media type",
      items,
      onValueChange: (value) => changes.push(value),
      orientation: "vertical",
      value: "audio",
    })
    const tabs = view.props.children as ReactElement<{
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void
    }>[]
    const focus = items.map(() => mock(() => undefined))
    const event = (key: string) => ({
      currentTarget: {
        parentElement: {
          children: {
            item: (index: number) => ({ focus: focus[index]! }),
          },
        },
      },
      key,
      preventDefault: () => undefined,
    }) as unknown as KeyboardEvent<HTMLButtonElement>

    tabs[2]!.props.onKeyDown(event("ArrowUp"))
    tabs[2]!.props.onKeyDown(event("Home"))
    tabs[2]!.props.onKeyDown(event("End"))

    expect(focus[0]).toHaveBeenCalledTimes(2)
    expect(focus[2]).toHaveBeenCalledTimes(1)
    expect(changes).toEqual(["image", "image"])
  })
})
