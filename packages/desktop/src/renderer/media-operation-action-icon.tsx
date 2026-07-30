import { Clapperboard, Crop, ImageDown, ScanLine, Scissors } from "lucide-react"
import type { MediaOperationEditor } from "./media-operation-selection-action"

export function MediaOperationActionIcon({ editor }: { editor: MediaOperationEditor }) {
  if (editor === "time-point") return <ImageDown />
  if (editor === "time-range") return <Scissors />
  if (editor === "crop-region") return <Crop />
  if (editor === "immediate") return <ScanLine />
  return <Clapperboard />
}
