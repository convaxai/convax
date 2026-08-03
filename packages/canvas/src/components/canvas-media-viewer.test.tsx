import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CanvasMediaViewer } from "./canvas-media-viewer"

describe("CanvasMediaViewer", () => {
  test("renders an image as contained media in a full-screen dialog", () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaViewer
        height={1200}
        kind="image"
        label="Portrait"
        onOpenChange={() => undefined}
        open
        url="asset://portrait"
        width={800}
      />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('data-canvas-media-viewer="image"')
    expect(markup).toContain('src="asset://portrait"')
    expect(markup).toContain('class="max-h-full max-w-full object-contain"')
    expect(markup).toContain('aria-label="Close full-screen viewer"')
    expect(markup).not.toContain("object-cover")
  })

  test("renders a video with native playback controls and its poster", () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaViewer
        kind="video"
        label="Launch clip"
        onOpenChange={() => undefined}
        open
        posterUrl="asset://launch-poster"
        url="asset://launch"
      />,
    )

    expect(markup).toContain('data-canvas-media-viewer="video"')
    expect(markup).toContain('aria-label="Launch clip"')
    expect(markup).toContain('poster="asset://launch-poster"')
    expect(markup).toContain('src="asset://launch"')
    expect(markup).toContain("controls")
    expect(markup).toContain("object-contain")
    expect(markup).not.toContain("object-cover")
  })

  test("renders no overlay while closed", () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaViewer
        kind="image"
        label="Portrait"
        onOpenChange={() => undefined}
        open={false}
        url="asset://portrait"
      />,
    )

    expect(markup).toBe("")
  })
})
