import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const editorSource = readFileSync(fileURLToPath(new URL("./canvas-editor.tsx", import.meta.url)), "utf8")
const nodeSource = readFileSync(fileURLToPath(new URL("./builtin-node.tsx", import.meta.url)), "utf8")
const generationSource = readFileSync(
  fileURLToPath(new URL("./canvas-generation-panel.tsx", import.meta.url)),
  "utf8",
)

describe("Canvas loading adoption", () => {
  test("blocking hydration uses shared Loading with resolved reducedMotion", () => {
    expect(editorSource).toContain('label="Loading canvas…"')
    expect(editorSource).toContain("reducedMotion={prefersReducedMotion}")
    expect(editorSource).toContain("from \"@convax/ui\"")
    expect(editorSource).toContain("Loading,")
    expect(editorSource).toContain("LoadingSpinner,")
    expect(editorSource).not.toContain("LoaderCircle")
    expect(editorSource).toContain('role="alert"')
  })

  test("node pending and generation overlays keep one owner status and decorative spinners", () => {
    expect(nodeSource).toContain("LoadingSpinner")
    expect(nodeSource).toContain("reducedMotion={editor.reducedMotion}")
    expect(nodeSource).toContain('data-canvas-persisted-resource-status="pending"')
    expect(nodeSource).toContain('data-canvas-file-generation-activity={props.run.status}')
    expect(nodeSource).toContain('role="status"')
    expect(nodeSource).toContain('role="alert"')
    expect(nodeSource).not.toContain("LoaderCircle")
    expect(nodeSource).not.toContain("BorderBeam")
  })

  test("generation panel catalog waits use Loading without inventing lifecycle state", () => {
    expect(generationSource).toContain('label="Loading generation tools…"')
    expect(generationSource).toContain('label="Loading generation options…"')
    expect(generationSource).toContain("reducedMotion={props.reducedMotion}")
    expect(generationSource).toContain("catalogStatus === \"error\"")
    expect(generationSource).toContain('role="alert"')
    expect(generationSource).not.toContain("LoaderCircle")
  })
})
