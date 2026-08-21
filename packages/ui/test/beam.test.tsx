import { describe, expect, mock, test } from "bun:test"
import { createRef, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BeamButton, BeamSurface } from "../src/components/beam"
import {
  BeamButton as BeamButtonFromRoot,
  BeamSurface as BeamSurfaceFromRoot,
} from "../src/index"
import { installTestWindow } from "./test-window"

const stylesCss = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8")
const indexSource = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8")

describe("Beam public API", () => {
  test("re-exports both beam hosts from the package root", () => {
    expect(indexSource).toContain('from "./components/beam"')
    expect(BeamSurfaceFromRoot).toBe(BeamSurface)
    expect(BeamButtonFromRoot).toBe(BeamButton)
  })
})

describe("Beam DOM contract", () => {
  test("wraps an active surface with the upstream Large preset from npm", () => {
    const markup = renderToStaticMarkup(
      <BeamSurface
        beam="rotate"
        className="custom-surface"
        data-testid="composer"
        focusBeam
        tone="spectrum"
      >
        <textarea aria-label="Prompt" />
      </BeamSurface>,
    )

    expect(markup).toContain('data-beam="')
    expect(markup).toContain('data-active=""')
    expect(markup).toContain('data-beam-bloom="true"')
    expect(markup).toContain("overflow: hidden")
    expect(markup).toContain("beam-spin-")
    expect(markup).toContain("--beam-strength:0.7")
    expect(markup).not.toContain("inset: -30px")
    expect(markup).toContain('data-slot="beam-surface"')
    expect(markup).toContain('data-ui-beam="rotate"')
    expect(markup).toContain('data-ui-beam-tone="spectrum"')
    expect(markup).toContain('data-ui-beam-intensity="default"')
    expect(markup).toContain('data-ui-beam-focus=""')
    expect(markup).toContain('data-testid="composer"')
    expect(markup).toContain('class="custom-surface"')
    expect(markup).toContain('aria-label="Prompt"')
    expect(markup).not.toContain("data-ui-beam-layer")
  })

  test("maps the pulse alias on buttons to the contained upstream treatment", () => {
    const markup = renderToStaticMarkup(
      <BeamButton beam="pulse" intensity="subtle" size="icon-sm" tone="brand" type="submit" variant="outline">
        Stop
      </BeamButton>,
    )

    expect(markup).toContain('<button')
    expect(markup).toContain('type="submit"')
    expect(markup).toContain('data-slot="beam-button"')
    expect(markup).not.toContain('data-slot="button"')
    expect(markup).toContain('data-ui-interactive=""')
    expect(markup).toContain('data-ui-beam="pulse"')
    expect(markup).toContain('data-ui-beam-tone="brand"')
    expect(markup).toContain('data-ui-beam-intensity="subtle"')
    expect(markup).toContain('data-beam-bloom="true"')
    expect(markup).toContain("overflow: hidden")
    expect(markup).toContain("size-8")
    expect(markup).toContain("border-border")
  })

  test("uses stable defaults and explicit reduced-motion overrides", () => {
    const defaults = renderToStaticMarkup(<BeamSurface>Default</BeamSurface>)
    const reduced = renderToStaticMarkup(<BeamSurface beam="pulse-outside" reducedMotion />)
    const animated = renderToStaticMarkup(<BeamButton beam="pulse-inner" reducedMotion={false} />)

    expect(defaults).toContain('data-ui-beam="idle"')
    expect(defaults).toContain('data-ui-beam-tone="spectrum"')
    expect(defaults).toContain('data-ui-beam-intensity="default"')
    expect(defaults).not.toContain("data-ui-beam-motion")
    expect(defaults).not.toContain('data-active=""')
    expect(reduced).toContain('data-ui-beam-motion="reduce"')
    expect(reduced).not.toContain('data-active=""')
    expect(animated).toContain('data-ui-beam-motion="animate"')
    expect(animated).toContain('data-active=""')
  })

  test("activates the upstream Large preset while focus is within an idle surface", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <BeamSurface focusBeam>
            <textarea aria-label="Prompt" />
          </BeamSurface>,
        ),
      )
      expect(container.querySelector("[data-beam]")?.hasAttribute("data-active")).toBeFalse()

      await act(async () => container.querySelector("textarea")?.focus())
      await act(async () => undefined)
      const wrapper = container.querySelector("[data-beam]")
      expect(wrapper?.hasAttribute("data-active")).toBeTrue()
      const upstreamStyles = container.querySelector("style")?.textContent ?? ""
      expect(upstreamStyles).toContain("overflow: hidden")
      expect(upstreamStyles).toContain("beam-spin-")
      expect(upstreamStyles).not.toContain("inset: -30px")
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })

  test("forwards the surface ref plus ordinary DOM props", async () => {
    const testWindow = installTestWindow()
    const surfaceRef = createRef<HTMLDivElement>()
    let root: Root | undefined

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<BeamSurface id="beam-surface-ref" ref={surfaceRef} />))

      expect(surfaceRef.current).toBe(document.querySelector("#beam-surface-ref"))
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })

  test("preserves ordinary Button click and disabled behavior", async () => {
    const testWindow = installTestWindow()
    const onClick = mock(() => undefined)
    let root: Root | undefined

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<BeamButton onClick={onClick}>Run</BeamButton>))
      await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="beam-button"]')?.click())
      expect(onClick).toHaveBeenCalledTimes(1)

      await act(async () => root?.render(<BeamButton disabled onClick={onClick}>Run</BeamButton>))
      expect(document.querySelector<HTMLButtonElement>('[data-slot="beam-button"]')?.disabled).toBeTrue()
      await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="beam-button"]')?.click())
      expect(onClick).toHaveBeenCalledTimes(1)
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })
})

describe("Beam CSS contract", () => {
  test("leaves animation geometry and intensity to the npm presets", () => {
    expect(stylesCss).not.toContain("ui-beam-root--pulse-outside-tuned")
    expect(stylesCss).not.toContain("--sub-core-blur")
    expect(stylesCss).not.toContain("--sub-bloom-blur")
    expect(stylesCss).not.toContain("--sub-glow-opacity-mul")
    expect(stylesCss).not.toContain("--pulse-glow-boost")
    expect(stylesCss).not.toContain("@keyframes ui-beam-pulse")
  })

  test("supports explicit, root, and OS reduced-motion fallbacks", () => {
    expect(stylesCss).toContain(':root[data-reduced-motion="true"]')
    expect(stylesCss).toContain("@media (prefers-reduced-motion: reduce)")
    expect(stylesCss).toContain(':root:not([data-reduced-motion="false"])')
    expect(stylesCss).toContain("animation: none !important")
    expect(stylesCss).toContain("transition: none !important")
  })

  test("removes decorative layers while retaining the host edge in forced colors", () => {
    expect(stylesCss).toContain("@media (forced-colors: active)")
    expect(stylesCss).toContain("[data-beam-bloom]")
    expect(stylesCss).toContain("display: none !important")
    expect(stylesCss).toContain("border-color: CanvasText")
    expect(stylesCss).toContain("forced-color-adjust: none")
  })
})
