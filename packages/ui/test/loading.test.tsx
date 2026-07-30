import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import {
  Loading,
  LoadingSkeleton,
  LoadingSpinner,
} from "../src/components/loading"
import {
  Loading as LoadingFromRoot,
  LoadingSkeleton as LoadingSkeletonFromRoot,
  LoadingSpinner as LoadingSpinnerFromRoot,
} from "../src/index"

const stylesCss = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8")
const indexSource = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8")

describe("Loading public API", () => {
  test("re-exports loading primitives from the package root", () => {
    expect(indexSource).toContain('from "./components/loading"')
    expect(LoadingFromRoot).toBe(Loading)
    expect(LoadingSpinnerFromRoot).toBe(LoadingSpinner)
    expect(LoadingSkeletonFromRoot).toBe(LoadingSkeleton)
  })
})

describe("Loading status semantics", () => {
  test("inline layout announces one polite status with a required label", () => {
    const markup = renderToStaticMarkup(<Loading label="Loading projects…" />)

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('data-slot="loading"')
    expect(markup).toContain('data-ui-loading-layout="inline"')
    expect(markup).toContain("Loading projects…")
    expect(markup).toContain('data-slot="loading-spinner"')
    expect(markup).toContain('aria-hidden="true"')
  })

  test("surface layout keeps a single status region and optional description", () => {
    const markup = renderToStaticMarkup(
      <Loading description="Preparing workspace" label="Opening project…" layout="surface" />,
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('data-ui-loading-layout="surface"')
    expect(markup).toContain("Opening project…")
    expect(markup).toContain("Preparing workspace")
    expect(markup).toContain('data-slot="loading-glyph-well"')
    expect(markup.match(/role="status"/g)?.length).toBe(1)
  })

  test("decorative spinner and skeleton never own status semantics", () => {
    const spinner = renderToStaticMarkup(<LoadingSpinner />)
    const skeleton = renderToStaticMarkup(<LoadingSkeleton className="h-3 w-24" />)

    expect(spinner).toContain('aria-hidden="true"')
    expect(spinner).not.toContain('role="status"')
    expect(skeleton).toContain('aria-hidden="true"')
    expect(skeleton).not.toContain('role="status"')
    expect(skeleton).toContain('data-ui-loading-skeleton=""')
  })

  test("keeps fixed status ARIA even when callers attempt to override role or live region", () => {
    const untrustedOverrides: Record<string, string> = {
      "aria-live": "assertive",
      role: "alert",
    }
    const markup = renderToStaticMarkup(
      <Loading {...untrustedOverrides} label="Busy" />,
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain('aria-live="assertive"')
    expect(markup.match(/role="status"/g)?.length).toBe(1)
  })

  test("honors explicit reducedMotion overrides via data attributes", () => {
    const reduced = renderToStaticMarkup(<Loading label="Busy" reducedMotion />)
    const animate = renderToStaticMarkup(<LoadingSpinner reducedMotion={false} />)
    const skeleton = renderToStaticMarkup(<LoadingSkeleton reducedMotion />)

    expect(reduced).toContain('data-ui-loading-motion="reduce"')
    expect(animate).toContain('data-ui-loading-motion="animate"')
    expect(skeleton).toContain('data-ui-loading-motion="reduce"')
  })
})

describe("Loading style contract", () => {
  test("declares spin and pulse keyframes without a motion library", () => {
    expect(stylesCss).toContain("@keyframes ui-loading-spin")
    expect(stylesCss).toContain("@keyframes ui-loading-pulse")
    expect(stylesCss).toContain(":where([data-ui-loading-spinner])")
    expect(stylesCss).toContain(":where([data-ui-loading-skeleton])")
    expect(stylesCss).not.toContain("framer-motion")
    expect(stylesCss).not.toContain("@keyframes spin {")
  })

  test("provides reduced-motion static busy fallbacks for spinner and skeleton", () => {
    expect(stylesCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(stylesCss).toContain('[data-ui-loading-motion="reduce"][data-ui-loading-spinner]')
    expect(stylesCss).toContain("animation: none")
    expect(stylesCss).toContain("border-right-color: currentColor")
    expect(stylesCss).toContain('[data-ui-loading-motion="reduce"][data-ui-loading-skeleton]')
    expect(stylesCss).toContain('opacity: 0.7')
    expect(stylesCss).toContain('[data-ui-loading-motion="animate"][data-ui-loading-spinner]')
  })

  test("keeps forced-colors readable borders and skeleton fills", () => {
    expect(stylesCss).toContain("@media (forced-colors: active)")
    expect(stylesCss).toContain("border-top-color: CanvasText")
    expect(stylesCss).toContain("border-color: GrayText")
    expect(stylesCss).toContain("background-color: GrayText")
    expect(stylesCss).toContain("forced-color-adjust: none")
  })
})
