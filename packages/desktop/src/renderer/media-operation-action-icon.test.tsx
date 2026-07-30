import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MediaOperationActionIcon } from "./media-operation-action-icon"
import type { MediaOperationEditor } from "./media-operation-selection-action"

describe("MediaOperationActionIcon", () => {
  test.each([
    ["confirmation", "lucide-clapperboard"],
    ["crop-region", "lucide-crop"],
    ["time-point", "lucide-image-down"],
    ["time-range", "lucide-scissors"],
  ] satisfies readonly (readonly [MediaOperationEditor, string])[])(
    "uses the admitted %s editor icon",
    (editor, expectedClassName) => {
      expect(renderToStaticMarkup(<MediaOperationActionIcon editor={editor} />)).toContain(expectedClassName)
    },
  )
})
