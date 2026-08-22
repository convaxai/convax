import { describe, expect, test } from "bun:test"

function cssRule(styles: string, selector: string) {
  const start = styles.indexOf(`${selector} {`)
  if (start < 0) return ""
  const end = styles.indexOf("}", start)
  return end < 0 ? "" : styles.slice(start, end + 1)
}

describe("Canvas file-card assistant sizing", () => {
  test("anchors the host-rendered composer to the Canvas viewport overlay", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const overlayRule = cssRule(styles, ".convax-canvas .convax-canvas-composer-overlay")
    const assistantRule = styles.match(/\.convax-canvas \.convax-node-assistant \{[^}]+\}/s)?.[0] ?? ""
    const assistantContentRule = cssRule(styles, ".convax-canvas .convax-node-assistant > div")

    expect(overlayRule).toContain("position: absolute")
    expect(overlayRule).toContain("--canvas-safe-bottom")
    expect(overlayRule).toContain("--canvas-safe-left")
    expect(overlayRule).toContain("--canvas-safe-right")
    expect(overlayRule).toContain("right: calc(")
    expect(overlayRule).toContain("left: calc(")
    expect(overlayRule).toContain("display: flex")
    expect(overlayRule).toContain("justify-content: center")
    expect(overlayRule).toContain("z-index: 50")
    expect(overlayRule).toContain("pointer-events: none")
    expect(styles).toMatch(
      /\.convax-canvas \.convax-canvas-composer-overlay > \* \{[^}]*width: min\(600px, 100%\)[^}]*pointer-events: auto/s,
    )
    expect(assistantContentRule).toContain("width: 100%")
    expect(assistantContentRule).toContain("min-width: min(480px, calc(100vw - 32px))")
    expect(assistantContentRule).toContain("max-width: min(780px, calc(100vw - 32px))")
    expect(assistantRule).toContain("height: auto")
    expect(assistantRule).toContain("border: 0")
    expect(assistantRule).toContain("background: transparent")
    expect(assistantRule).toContain("box-shadow: none")
    expect(assistantRule).not.toContain("height: min(380px")
  })

  test("aligns media chrome and gives hover and focus the same two-pixel ring and gap", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const mediaSurfaceRule = styles.match(/\.convax-canvas \.convax-node__surface--media \{[^}]+\}/s)?.[0] ?? ""
    const imageSurfaceRule = cssRule(styles, ".convax-canvas .convax-node__surface--image")
    const videoSurfaceRule = cssRule(styles, ".convax-canvas .convax-node__surface--video")
    const mediaOverlayRule = cssRule(styles, ".convax-canvas .convax-generation-status-overlay--media")
    const videoOverlayRule = cssRule(styles, ".convax-canvas .convax-generation-status-overlay--video")
    const interactiveMediaRule =
      styles.match(/\.convax-canvas \.convax-node:hover \.convax-node__surface--media,[\s\S]*?\{[^}]+\}/)?.[0] ?? ""

    expect(styles).toContain("--canvas-media-radius: 24px")
    expect(mediaSurfaceRule).toContain("border-width: 0")
    expect(mediaSurfaceRule).toContain("border-radius: var(--canvas-media-radius)")
    expect(mediaSurfaceRule).toContain("background: var(--canvas-node-background)")
    expect(imageSurfaceRule).toContain("border: 1px solid rgba(255, 255, 255, 0.04)")
    expect(imageSurfaceRule).toContain("background: rgba(38, 38, 38, 0.7)")
    expect(imageSurfaceRule).toContain("box-shadow: none")
    expect(imageSurfaceRule).toContain("backdrop-filter: blur(40px)")
    expect(imageSurfaceRule).toContain("contain: paint")
    expect(imageSurfaceRule).not.toContain("conic-gradient")
    expect(videoSurfaceRule).toContain("border: 2px dashed var(--canvas-node-border)")
    expect(mediaOverlayRule).toContain("border-radius: var(--canvas-media-radius)")
    expect(videoOverlayRule).toContain("inset: 2px")
    expect(videoOverlayRule).toContain("border-radius: calc(var(--canvas-media-radius) - 2px)")
    expect(interactiveMediaRule).toContain(".convax-node.is-selected .convax-node__surface--media")
    expect(interactiveMediaRule).toContain(".react-flow__node.selected .convax-node__surface--media")
    expect(interactiveMediaRule).toContain("0 0 0 2px var(--canvas-background)")
    expect(interactiveMediaRule).toContain("0 0 0 4px var(--canvas-edge-active)")
    expect(interactiveMediaRule).not.toContain("0 0 0 5px")
    expect(interactiveMediaRule).not.toContain("0 0 0 8px")
  })

  test("applies focused node chrome immediately across optimistic-authority handoff", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const nodeSurfaceRule = cssRule(styles, ".convax-canvas .convax-node__surface")
    const focusedConnectionRule =
      styles.match(/\.convax-canvas \.convax-node\.is-selected > \.convax-node__connection,[\s\S]*?\{[^}]+\}/)?.[0] ??
      ""

    expect(nodeSurfaceRule).toContain("transition: opacity var(--canvas-motion-feedback)")
    expect(nodeSurfaceRule).not.toContain("border-color var(--canvas-motion-feedback)")
    expect(nodeSurfaceRule).not.toContain("box-shadow var(--canvas-motion-feedback)")
    expect(focusedConnectionRule).toContain(".react-flow__node.selected")
    expect(focusedConnectionRule).toContain("transition: none")
  })

  test("gives the expanded editor a calm global paper surface without fixed toolbar chrome", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const expandedEditorRule =
      styles.match(
        /\.convax-canvas \.convax-text-editor--expanded \.convax-text-editor__prosemirror \{[^}]+\}/s,
      )?.[0] ?? ""

    expect(expandedEditorRule).toContain("width: min(920px, 100%)")
    expect(expandedEditorRule).toContain("min-height: 100%")
    expect(expandedEditorRule).toContain("margin: 0 auto")
    expect(expandedEditorRule).toContain("padding: 16px 0 120px")
    expect(expandedEditorRule).toContain("font-size: 16px")
    expect(expandedEditorRule).not.toContain("box-shadow")
    expect(styles).toContain(".convax-text-editor-modal::backdrop")
    expect(styles).toContain(".convax-canvas .convax-text-editor-dialog__title")
    expect(styles).toContain(".convax-text-mention-suggestions")
    expect(styles).toContain(".convax-text-mention-suggestions__thumbnail")
    expect(styles).toMatch(
      /@media \(max-width: 600px\) \{[\s\S]*\.convax-canvas \.convax-text-editor-dialog \{[\s\S]*height: 100dvh;/,
    )
    expect(styles).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*\.convax-canvas \.convax-text-editor-dialog,[\s\S]*border: 1px solid CanvasText;/,
    )
    expect(styles).toContain(".convax-text-block-handle-anchor")
    expect(styles).toContain(".convax-text-inline-menu")
    expect(styles).toMatch(
      /\.convax-canvas\[data-canvas-reduced-motion="true"\] \.convax-text-inline-menu,[\s\S]*animation: none;/,
    )
  })
})

describe("Canvas-first visual hierarchy", () => {
  test("renders folded Groups as layered folders with paper overflow and a bounded appearance picker", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const folderRule = cssRule(styles, ".convax-canvas .convax-group-folder")
    const frontRule = cssRule(styles, ".convax-canvas .convax-group-folder__front")
    const pickerRule = cssRule(styles, ".convax-canvas .convax-group-appearance-picker")
    const colorRule = cssRule(styles, ".convax-canvas .convax-group-appearance-picker__color")
    const emojiGridRule = cssRule(styles, ".convax-canvas .convax-group-appearance-picker__emojis")
    const titleRule = cssRule(styles, ".convax-canvas .convax-group-folder__title")

    expect(folderRule).toContain("--canvas-group-color")
    expect(frontRule).toContain("background: var(--canvas-group-front)")
    expect(frontRule).toContain("inset 0 -13px 22px")
    expect(styles).toContain('.convax-group-folder__paper[data-paper-index="2"]')
    expect(styles).toContain(".convax-group-folder__overflow")
    expect(styles).not.toContain(".convax-group-folder__preview-item")
    expect(pickerRule).toContain("width: min(328px, calc(100% - 24px))")
    expect(pickerRule).toContain("overscroll-behavior: contain")
    expect(colorRule).not.toContain("--canvas-group-color")
    expect(folderRule).toContain("--canvas-group-color: oklch(0.74 0.035 82)")
    expect(styles).toMatch(/data-canvas-group-color="green"[^}]+--canvas-group-color: oklch\(0\.74 0\.115 146\)/)
    expect(emojiGridRule).toContain("max-height: 220px")
    expect(emojiGridRule).toContain("overflow-y: auto")
    expect(emojiGridRule).toContain("scrollbar-width: thin")
    expect(styles).toContain(".convax-group-appearance-picker__emojis::-webkit-scrollbar-thumb")
    expect(styles).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))")
    expect(styles).toContain('.convax-group-folder:hover .convax-group-folder__paper[data-paper-index="0"]')
    expect(styles).toContain('.convax-group-folder:hover .convax-group-folder__paper[data-paper-index="1"]')
    expect(cssRule(styles, ".convax-canvas .convax-group-folder__emoji")).toContain("font-size: 16px")
    expect(titleRule).toContain("text-overflow: ellipsis")
    expect(titleRule).toContain("line-height: 22px")
    expect(cssRule(styles, ".convax-canvas .convax-group-folder__title:focus-visible")).toContain("box-shadow: none")
    expect(styles).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*\.convax-canvas \.convax-group-folder__back,[\s\S]*border: 1px solid CanvasText;/,
    )
  })

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

  test("does not apply a second opacity pass to the dot grid", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()

    expect(styles).not.toMatch(/\.convax-canvas \.react-flow__background \{[^}]*opacity:/s)
  })

  test("renders dashed alignment guides above the viewport without intercepting drag input", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const guidesRule = cssRule(styles, ".convax-canvas .convax-snap-guides")
    const guideRule = cssRule(styles, ".convax-canvas .convax-snap-guide")

    expect(guidesRule).toContain("position: absolute")
    expect(guidesRule).toContain("pointer-events: none")
    expect(guideRule).toContain("background: transparent")
    expect(cssRule(styles, ".convax-canvas .convax-snap-guide.is-vertical")).toContain(
      "border-left: 1px dashed var(--canvas-accent)",
    )
    expect(cssRule(styles, ".convax-canvas .convax-snap-guide.is-horizontal")).toContain(
      "border-top: 1px dashed var(--canvas-accent)",
    )
  })

  test("keeps Canvas-owned node chrome available as a drag target", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const titleRule = cssRule(styles, ".convax-canvas .convax-node__title")

    expect(titleRule).toContain("pointer-events: auto")
    expect(titleRule).toContain("touch-action: none")
    expect(titleRule).toContain("user-select: none")
  })

  test("keeps free and proportional resize handles visually unobtrusive", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const handleRule = cssRule(styles, ".convax-canvas .react-flow__resize-control.convax-node-resizer__handle::after")

    expect(handleRule).toContain("display: none")
    expect(handleRule).toContain("content: none")
    expect(handleRule).not.toContain("border-radius")
    expect(styles).not.toContain("convax-node-resizer__handle--proportional")
  })

  test("uses opacity and shadow without scaling the node surface while dragging", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const draggingSurfaceRule = cssRule(styles, ".convax-canvas .react-flow__node.dragging .convax-node__surface")

    expect(draggingSurfaceRule).toContain("box-shadow: none")
    expect(draggingSurfaceRule).toContain("opacity: 0.94")
    expect(draggingSurfaceRule).not.toContain("transform:")
    expect(draggingSurfaceRule).toContain("--canvas-motion-ease-standard")
  })

  test("keeps the drag marquee dashed without drawing a second frame around selected nodes", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const marqueeRule = cssRule(styles, ".convax-canvas .react-flow__selection")
    const selectedBoundsRule = cssRule(styles, ".convax-canvas .react-flow__nodesselection-rect")

    expect(marqueeRule).toContain("border: 1px dashed")
    expect(selectedBoundsRule).toContain("border: 0")
    expect(selectedBoundsRule).toContain("background: transparent")
    expect(selectedBoundsRule).toContain("animation: none")
  })

  test("uses one motion hierarchy for nodes, ports, selection, edges, menus, and panels", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const defaults = cssRule(styles, ":root")
    const nodeRule = cssRule(
      styles,
      '.convax-canvas .convax-node[data-canvas-node-entering="true"] > .convax-node__entry-shell',
    )
    const portRule = cssRule(styles, ".convax-canvas .convax-node__connection-icon")
    const pendingConnectionRule = cssRule(styles, ".convax-pending-connection__line")
    const liveConnectionRule = cssRule(styles, ".convax-canvas .convax-connection__line")
    const selectedEdgeRule = cssRule(styles, ".convax-canvas .react-flow__edge.selected .convax-edge__line")
    const referenceEdgeRule = cssRule(styles, ".convax-canvas .react-flow__edge.animated .convax-edge__line")
    const menuRule = cssRule(styles, ".convax-motion-menu")
    const generationRule = cssRule(styles, ".convax-canvas .convax-generation-surface")
    const generationEnterRule = cssRule(
      styles,
      '.convax-canvas .convax-canvas-composer-overlay[data-canvas-presence="enter"]',
    )
    const generationExitRule = cssRule(
      styles,
      '.convax-canvas .convax-canvas-composer-overlay[data-canvas-presence="exit"]',
    )
    const generationKeyframes = styles.slice(
      styles.indexOf("@keyframes convax-generation-panel-enter"),
      styles.indexOf("@keyframes convax-selection-toolbar-enter"),
    )

    expect(defaults).toContain("--canvas-motion-edge-loop: 500ms")
    expect(defaults).toContain("--canvas-motion-node-enter: 220ms")
    expect(defaults).toContain("--canvas-motion-port: 156ms")
    expect(defaults).toContain("--canvas-motion-menu: 100ms")
    expect(defaults).toContain("--canvas-motion-generation-panel: 200ms")
    expect(defaults).toContain("--canvas-motion-selection-toolbar: 150ms")
    expect(defaults).toContain("--canvas-motion-viewport: 300ms")
    expect(nodeRule).toContain("animation: convax-node-enter var(--canvas-motion-node-enter)")
    expect(styles).not.toMatch(/\.convax-node\.is-selected > \.convax-node__entry-shell/)
    expect(portRule).toContain("transform var(--canvas-motion-port) var(--canvas-motion-ease-elastic)")
    expect(portRule).toContain("scale(0.55)")
    expect(styles).toMatch(
      /\.convax-node__connection:hover \.convax-node__connection-icon,[\s\S]*?transform:[^;]*scale\(1\.35\)/,
    )
    expect(styles).toContain(".convax-canvas .react-flow__node.selected .convax-node__surface")
    expect(pendingConnectionRule).toContain("stroke: var(--canvas-edge")
    expect(pendingConnectionRule).toContain("stroke-dasharray: 7 6")
    expect(liveConnectionRule).toContain("stroke: var(--canvas-edge)")
    expect(liveConnectionRule).toContain("stroke-dasharray: 7 6")
    expect(selectedEdgeRule).not.toContain("animation:")
    expect(selectedEdgeRule).not.toContain("stroke-dasharray")
    expect(referenceEdgeRule).toContain("stroke-dasharray: 8 7")
    expect(referenceEdgeRule).toContain("var(--canvas-motion-edge-loop) linear infinite")
    expect(menuRule).toContain("var(--canvas-motion-menu, 100ms)")
    expect(styles).toMatch(/@keyframes convax-menu-enter \{[\s\S]*?transform: scale\(0\.95\)/)
    expect(styles).toContain("@keyframes convax-surface-enter-top")
    expect(styles).toContain("@keyframes convax-surface-enter-bottom")
    expect(styles).toContain("@keyframes convax-surface-exit-top")
    expect(styles).toContain("@keyframes convax-surface-exit-bottom")
    expect(styles).toContain(".convax-canvas.is-leaving .convax-motion-surface--top")
    expect(styles).toContain(".convax-canvas.is-leaving .convax-motion-surface--bottom")
    expect(generationRule).toContain("pointer-events: auto")
    expect(generationEnterRule).toContain("convax-generation-panel-enter")
    expect(generationEnterRule).toContain("var(--canvas-motion-generation-panel)")
    expect(generationExitRule).toContain("convax-generation-panel-exit")
    expect(generationExitRule).toContain("var(--canvas-motion-generation-panel)")
    expect(generationKeyframes).toContain("translateY(8px)")
    expect(generationKeyframes).toContain("translateY(0)")
    expect(generationKeyframes).not.toContain("scale(")
    expect(styles).toMatch(/@keyframes convax-selection-toolbar-enter \{[\s\S]*?translateY\(5px\) scale\(0\.92\)/)
  })

  test("gives magnetic connection buttons a broad trigger without duplicating the dragged source", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const triggerRule = cssRule(styles, ".convax-canvas .convax-node__connection::before")
    const draggingSourceRule = cssRule(
      styles,
      ".convax-canvas .convax-node__connection.connecting .convax-node__connection-icon",
    )

    expect(triggerRule).toContain("inset: -26px")
    expect(draggingSourceRule).toContain("opacity: 0")
    expect(draggingSourceRule).toContain("translate3d(0, 0, 0)")
  })

  test("clamps Canvas-owned overlays to host-provided safe viewport insets", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const creationFrameRule = cssRule(styles, ".convax-canvas .convax-creation-toolbar-frame")
    expect(creationFrameRule).toContain("--canvas-safe-top")
    expect(creationFrameRule).toContain("--canvas-safe-right")
    expect(creationFrameRule).toContain("--canvas-safe-left")
    expect(creationFrameRule).toContain(
      "translateX(calc((var(--canvas-safe-left, 0px) - var(--canvas-safe-right, 0px)) / 2))",
    )
    expect(cssRule(styles, ".convax-canvas .convax-viewport-toolbar")).toContain("--canvas-safe-left")
    expect(cssRule(styles, ".convax-canvas .convax-canvas-minimap")).toContain("--canvas-safe-right")
    expect(cssRule(styles, ".convax-canvas .convax-selection-toolbar")).toContain("--canvas-safe-right")
  })

  test("renders drag snap guides as dashed lines in normal and forced colors", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const guideRule = cssRule(styles, ".convax-canvas .convax-snap-guide")
    const verticalGuideRule = cssRule(styles, ".convax-canvas .convax-snap-guide.is-vertical")
    const horizontalGuideRule = cssRule(styles, ".convax-canvas .convax-snap-guide.is-horizontal")

    expect(guideRule).toContain("background: transparent")
    expect(verticalGuideRule).toContain("border-left: 1px dashed var(--canvas-accent)")
    expect(horizontalGuideRule).toContain("border-top: 1px dashed var(--canvas-accent)")
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.convax-snap-guide\.is-vertical \{[\s\S]*border-left-color: CanvasText;[\s\S]*\.convax-snap-guide\.is-horizontal \{[\s\S]*border-top-color: CanvasText;/,
    )
  })

  test("anchors creation at safe top center while keeping viewport tools at the bottom", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const creationRule = cssRule(styles, ".convax-canvas .convax-creation-toolbar")
    const viewportRule = cssRule(styles, ".convax-canvas .convax-viewport-toolbar")

    expect(creationRule).toContain("min-height: 42px")
    expect(creationRule).toContain("gap: 4px")
    expect(creationRule).toContain("padding: 4px")
    expect(creationRule).toContain("border: 0")
    expect(creationRule).toContain("border-radius: 8px")
    expect(creationRule).toContain("backdrop-filter: blur(18px)")
    expect(viewportRule).toContain("min-height: 42px")
    expect(viewportRule).toContain("--canvas-safe-bottom")
    expect(styles).not.toContain(".convax-canvas .convax-toolbar-divider")
  })

  test("keeps the node-search glyph clear of its input text across host stylesheet order", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const searchInputRule = styles.match(/\.convax-canvas \.convax-node-search__input \{[^}]+\}/s)?.[0] ?? ""

    expect(searchInputRule).toContain("padding-inline-start: 2.25rem")
  })

  test("makes node search a canvas-wide modal layer without pointer-event passthrough", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const searchLayerRule = styles.match(/\.convax-canvas \.convax-node-search__layer \{[^}]+\}/s)?.[0] ?? ""
    const searchBackdropRule = styles.match(/\.convax-canvas \.convax-node-search__backdrop \{[^}]+\}/s)?.[0] ?? ""

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

  test("removes Canvas transitions and animations from the resolved host policy", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()

    expect(styles).toContain('.convax-canvas[data-canvas-reduced-motion="true"] *,')
    expect(styles).toContain('.convax-canvas[data-canvas-reduced-motion="true"] *::before,')
    expect(styles).toContain('.convax-canvas[data-canvas-reduced-motion="true"] *::after')
    expect(styles).toContain("animation: none !important")
    expect(styles).toContain("transition: none !important")
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)")
  })

  test("keeps node entrance inside Convax chrome and presents the final frame in forced colors", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const reactFlowNodeRule = cssRule(styles, ".convax-canvas .react-flow__node")
    const entryRule = cssRule(
      styles,
      '.convax-canvas .convax-node[data-canvas-node-entering="true"] > .convax-node__entry-shell',
    )

    expect(reactFlowNodeRule).not.toContain("animation:")
    expect(reactFlowNodeRule).not.toContain("transform:")
    expect(entryRule).toContain("animation: convax-node-enter")
    expect(styles).toContain(
      '.convax-canvas .convax-node[data-canvas-node-entering="true"] > .react-flow__resize-control',
    )
    expect(styles).toContain('.convax-canvas .react-flow__node-toolbar[data-canvas-node-entering="true"]')
    expect(styles).toContain("@keyframes convax-node-chrome-enter")
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*data-canvas-node-entering="true"[\s\S]*animation: none;[\s\S]*transform: none;/,
    )
  })

  test("keeps pending-focus chrome hidden after selected connection ports become visible", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const selectedConnectionIndex = styles.indexOf(".convax-canvas .convax-node.is-selected .convax-node__connection")
    const pendingFocusSelectedIndex = styles.indexOf(
      '.convax-canvas .convax-node[data-canvas-node-entry-phase="pending-focus"].is-selected > .convax-node__connection',
    )

    expect(selectedConnectionIndex).toBeGreaterThan(-1)
    expect(pendingFocusSelectedIndex).toBeGreaterThan(selectedConnectionIndex)
    expect(styles).toMatch(
      /\.convax-node\[data-canvas-node-entry-phase="pending-focus"\]\.is-selected > \.convax-node__connection,[\s\S]*?opacity:\s*0/,
    )
  })
})

describe("Canvas theme closure", () => {
  test("opens the top-toolbar create menu below its trigger", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const createMenuRule = cssRule(styles, ".convax-canvas .convax-canvas-create-menu")

    expect(createMenuRule).toContain("left: 0")
    expect(createMenuRule).toContain("top: calc(100% + 10px)")
    expect(createMenuRule).toContain("overflow-y: auto")
    expect(styles).not.toContain("convax-canvas-more-menu")
  })

  test("keeps the pending connection overlay inside the Canvas coordinate space", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const overlayRule = cssRule(styles, ".convax-pending-connection")
    const menuRule = cssRule(styles, ".convax-pending-connection__menu")

    expect(overlayRule).toContain("position: absolute")
    expect(menuRule).toContain("position: absolute")
    expect(`${overlayRule}\n${menuRule}`).not.toContain("position: fixed")
  })

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
      ".convax-canvas .convax-canvas-create-menu",
      ".convax-canvas .convax-arrange-menu",
      ".convax-canvas .convax-zoom-menu",
      ".convax-canvas .convax-tool-surface,\n.convax-canvas .convax-floating-panel",
      ".convax-canvas .convax-node-toolbar__surface",
    ]
    const menuRules = selectors.map((selector) => cssRule(styles, selector)).join("\n")

    expect(menuRules).toContain("var(--canvas-surface")
    expect(menuRules).toContain("var(--canvas-text")
    expect(menuRules).toContain("var(--canvas-floating-shadow")
    expect(menuRules).not.toMatch(/#[\da-f]{3,8}\b|rgb\(|(?:background|color|fill|stroke):\s*(?:white|black)\b/i)
    expect(styles).toMatch(
      /\.convax-arrange-menu__action:hover,[\s\S]*?background:\s*var\(--canvas-interactive-hover,\s*var\(--ui-interactive-hover\)\)/,
    )
    expect(styles).toMatch(
      /\.convax-zoom-menu__item:active\s*\{[^}]*background:\s*var\(--canvas-interactive-pressed,\s*var\(--ui-interactive-pressed\)\)/s,
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
    expect(rules).not.toMatch(/#[\da-f]{3,8}\b|rgb\(|(?:background|color|fill|stroke):\s*(?:white|black)\b/i)
  })

  test("themes media and outline empty states while keeping selected rows accent-aware", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const mediaStateRule = cssRule(styles, ".convax-canvas .convax-media-state-card")
    const mediaContentRule = cssRule(styles, ".convax-canvas .convax-media-state-card__content")
    const mediaIconRule = cssRule(styles, ".convax-canvas .convax-media-state-card__icon")
    const mediaHintRule = cssRule(styles, ".convax-canvas .convax-media-state-card__description")
    const mediaAddRule = cssRule(styles, ".convax-canvas .convax-media-state-card__action-button")
    const outlineEmptyRule = cssRule(styles, ".convax-canvas-outline__empty")

    expect(mediaStateRule).toContain("light-dark(var(--canvas-node-background), #050506)")
    expect(mediaStateRule).toContain("border-radius: inherit")
    expect(mediaContentRule).toContain("display: flex")
    expect(mediaContentRule).toContain("flex-direction: column")
    expect(mediaIconRule).toContain("var(--canvas-text-muted)")
    expect(mediaHintRule).toContain("color: var(--canvas-text-muted)")
    expect(mediaAddRule).toContain("min-width: 0")
    expect(mediaAddRule).toContain("border-radius: 999px")
    expect(mediaAddRule).not.toContain("var(--canvas-accent)")
    expect(outlineEmptyRule).toContain("var(--canvas-text-muted")
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.convax-canvas \.convax-media-state-card__action-button[\s\S]*border-color: CanvasText/,
    )
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
