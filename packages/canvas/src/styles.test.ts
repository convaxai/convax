import { describe, expect, test } from "bun:test"

function cssRule(styles: string, selector: string) {
  const start = styles.indexOf(`${selector} {`)
  if (start < 0) return ""
  const end = styles.indexOf("}", start)
  return end < 0 ? "" : styles.slice(start, end + 1)
}

describe("Canvas file-card assistant sizing", () => {
  test("leaves visual chrome to one wider host-rendered composer surface", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const assistantRule = styles.match(/\.convax-canvas \.convax-node-assistant \{[^}]+\}/s)?.[0] ?? ""

    expect(assistantRule).toContain("width: min(720px")
    expect(assistantRule).toContain("height: auto")
    expect(assistantRule).toContain("border: 0")
    expect(assistantRule).toContain("background: transparent")
    expect(assistantRule).toContain("box-shadow: none")
    expect(assistantRule).not.toContain("height: min(380px")
  })

  test("uses aligned borderless chrome for bounded image and video cards", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const mediaSurfaceRule = styles.match(/\.convax-canvas \.convax-node__surface--media \{[^}]+\}/s)?.[0] ?? ""

    expect(mediaSurfaceRule).toContain("border-width: 0")
    expect(mediaSurfaceRule).toContain("border-radius: 24px")
    expect(mediaSurfaceRule).toContain("background: transparent")
  })

  test("gives the text editor a borderless side-drawer document surface", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const drawerEditorRule =
      styles.match(/\.convax-canvas \.convax-text-editor--drawer \.convax-text-editor__prosemirror \{[^}]+\}/s)?.[0] ??
      ""

    expect(drawerEditorRule).toContain("width: 100%")
    expect(drawerEditorRule).toContain("min-height: 100%")
    expect(drawerEditorRule).toContain("padding: 32px 48px 96px")
    expect(drawerEditorRule).toContain("font-size: 15px")
    expect(drawerEditorRule).not.toContain("box-shadow")
    expect(styles).not.toContain(".convax-text-editor-drawer__toolbar")
    expect(styles).toContain(".convax-text-block-handle-anchor")
    expect(styles).toContain(".convax-text-inline-menu")
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.convax-text-inline-menu \{\s*animation: none;/,
    )
  })
})

describe("Canvas-first visual hierarchy", () => {
  test("uses semantic appearance variables for the canvas and node surface", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const canvasRule = styles.match(/\.convax-canvas \{[^}]+\}/s)?.[0] ?? ""
    const nodeRule = styles.match(/\.convax-canvas \.convax-node__surface \{[^}]+\}/s)?.[0] ?? ""

    expect(canvasRule).toContain("background: var(--canvas-background)")
    expect(styles).toMatch(
      /\.convax-node__connection-icon[\s\S]*?background:\s*var\(--canvas-accent\);[\s\S]*?color:\s*var\(--canvas-accent-foreground\)/,
    )
    expect(nodeRule).toContain("background: var(--canvas-node-background)")
    expect(nodeRule).toContain("border-radius: var(--canvas-node-radius)")
    expect(styles).toMatch(/\.convax-text-editor\s*\{[^}]*color:\s*var\(--canvas-text\)/s)
    expect(styles).toMatch(/\.convax-text-editor__prosemirror h1,[\s\S]*?color:\s*var\(--canvas-text\)/)
    expect(styles).toMatch(
      /\.convax-text-editor__prosemirror th\s*\{[^}]*background:\s*color-mix\(in oklab, var\(--canvas-text\)/s,
    )
    expect(styles).toMatch(/\.convax-pending-connection__source\s*\{[^}]*fill:\s*var\(--canvas-accent(?:,[^)]+)?\)/s)
    expect(styles).toMatch(/\.convax-edge__meteor-glow,[\s\S]*?stroke:\s*var\(--canvas-edge-flow\)/)
    expect(styles).toMatch(/\.convax-connection__flow\s*\{[^}]*stroke:\s*var\(--canvas-accent\)/s)
    expect(styles).not.toContain("fill: #8f63ff")
  })

  test("keeps the dot grid visible without competing with canvas content", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const backgroundRule = styles.match(/\.convax-canvas \.react-flow__background \{[^}]+\}/s)?.[0] ?? ""

    expect(backgroundRule).toContain("opacity: 0.78")
  })

  test("anchors creation at bottom center and moves viewport tools above it on narrow screens", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const creationRule = styles.match(/\.convax-canvas \.convax-creation-toolbar \{[^}]+\}/s)?.[0] ?? ""
    expect(creationRule).toContain("min-height: 42px")
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.convax-canvas \.convax-viewport-toolbar \{\s*bottom: 64px;/,
    )
  })

  test("keeps the node-search glyph clear of its input text across host stylesheet order", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const searchInputRule =
      styles.match(/\.convax-canvas \.convax-node-search__input \{[^}]+\}/s)?.[0] ?? ""

    expect(searchInputRule).toContain("padding-inline-start: 2.25rem")
  })

  test("makes node search a canvas-wide modal layer without pointer-event passthrough", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const searchLayerRule = styles.match(/\.convax-canvas \.convax-node-search__layer \{[^}]+\}/s)?.[0] ?? ""
    const searchBackdropRule =
      styles.match(/\.convax-canvas \.convax-node-search__backdrop \{[^}]+\}/s)?.[0] ?? ""

    expect(searchLayerRule).toContain("inset: 0")
    expect(searchLayerRule).toContain("z-index: 60")
    expect(searchBackdropRule).toContain("background:")
  })

  test("keeps outline rows compact with a visible keyboard focus state", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const outlineRule = styles.match(/\.convax-canvas-outline__item \{[^}]+\}/s)?.[0] ?? ""

    expect(outlineRule).toContain("min-height: 36px")
    expect(styles).toMatch(
      /\.convax-canvas-outline__item:focus-visible \{\s*outline: 2px solid var\(--canvas-accent,\s*var\(--ui-focus-ring\)\)/,
    )
  })
})

describe("Canvas theme closure", () => {
  test("inherits host theme materials instead of pinning light defaults on the canvas element", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const defaultsRule = cssRule(styles, ":root")
    const canvasRule = cssRule(styles, ".convax-canvas")

    expect(defaultsRule).toContain("--canvas-background: var(--ui-surface-canvas)")
    expect(defaultsRule).toContain("--canvas-node-background: var(--ui-surface-raised)")
    expect(defaultsRule).toContain("--canvas-text: var(--ui-text-primary)")
    expect(canvasRule).not.toContain("--canvas-background:")
    expect(canvasRule).not.toContain("--canvas-node-background:")
    expect(canvasRule).not.toContain("--canvas-text:")
  })

  test("uses one semantic material contract for menus and floating tool surfaces", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const selectors = [
      ":is(.convax-canvas, .convax-pending-connection) .convax-connect-menu",
      ".convax-canvas .convax-canvas-more-menu",
      ".convax-canvas .convax-arrange-menu",
      ".convax-canvas .convax-zoom-menu",
      ".convax-canvas .convax-tool-surface,\n.convax-canvas .convax-floating-panel",
      ".convax-canvas .convax-node-toolbar__surface",
    ]
    const menuRules = selectors.map((selector) => cssRule(styles, selector)).join("\n")

    expect(menuRules).toContain("var(--canvas-surface")
    expect(menuRules).toContain("var(--canvas-text")
    expect(menuRules).toContain("var(--canvas-floating-shadow")
    expect(menuRules).not.toMatch(
      /#[\da-f]{3,8}\b|rgb\(|(?:background|color|fill|stroke):\s*(?:white|black)\b/i,
    )
    expect(styles).toMatch(
      /\.convax-arrange-menu__action:hover,[\s\S]*?background:\s*var\(--canvas-interactive-hover,\s*var\(--ui-interactive-hover\)\)/,
    )
    expect(styles).toMatch(
      /\.convax-zoom-menu__item:active\s*\{[^}]*background:\s*var\(--canvas-interactive-pressed,\s*var\(--ui-interactive-pressed\)\)/s,
    )
    expect(styles).toMatch(
      /\.convax-canvas-more-menu > button:hover,[\s\S]*?background:\s*var\(--canvas-interactive-hover,\s*var\(--ui-interactive-hover\)\)/,
    )
  })

  test("themes connection controls and edge labels without light-only literals", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const connectionRule = cssRule(styles, ".convax-canvas .convax-node__connection-icon")
    const edgeLabelRule = cssRule(styles, ".convax-canvas .convax-edge__label")
    const endpointRule = cssRule(styles, ".convax-canvas .convax-edge__endpoint")
    const connectionTargetRule = cssRule(styles, ".convax-canvas .convax-connection__target")
    const rules = [connectionRule, edgeLabelRule, endpointRule, connectionTargetRule].join("\n")

    expect(connectionRule).toContain("var(--canvas-interactive-hover")
    expect(edgeLabelRule).toContain("var(--canvas-surface)")
    expect(edgeLabelRule).toContain("var(--canvas-text-muted)")
    expect(endpointRule).toContain("fill: var(--canvas-background)")
    expect(connectionTargetRule).toContain("fill: var(--canvas-background)")
    expect(rules).not.toMatch(
      /#[\da-f]{3,8}\b|rgb\(|(?:background|color|fill|stroke):\s*(?:white|black)\b/i,
    )
  })

  test("themes media and outline empty states while keeping selected rows accent-aware", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const mediaEmptyRule = cssRule(styles, ".convax-canvas .convax-media-empty")
    const mediaContentRule = cssRule(styles, ".convax-canvas .convax-media-empty__content")
    const mediaIconRule = cssRule(styles, ".convax-canvas .convax-media-empty__icon")
    const mediaHintRule = cssRule(styles, ".convax-canvas .convax-media-empty__hint")
    const outlineEmptyRule = cssRule(styles, ".convax-canvas-outline__empty")

    expect(mediaEmptyRule).toContain("var(--canvas-node-background)")
    expect(mediaContentRule).toContain("color: var(--canvas-text)")
    expect(mediaIconRule).toContain("background: var(--canvas-node-background)")
    expect(mediaHintRule).toContain("color: var(--canvas-text-muted)")
    expect(outlineEmptyRule).toContain("var(--canvas-text-muted")
    expect(styles).toMatch(
      /\.convax-canvas-outline__item\[aria-current="location"\]\s*\{[^}]*background:\s*var\(--canvas-interactive-selected,\s*var\(--ui-interactive-selected\)\)/s,
    )
  })

  test("preserves media-specific dark playback controls as an intentional exception", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const mediaRule = cssRule(styles, ".convax-canvas .convax-video__media")
    const controlRule = cssRule(styles, ".convax-canvas .convax-video__control")

    expect(mediaRule).toContain("background: #050506")
    expect(controlRule).toContain("color: white")
    expect(controlRule).toContain("rgb(18 19 22 / 76%)")
  })
})
