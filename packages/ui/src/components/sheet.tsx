import { forwardRef, type ComponentProps } from "react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  type DialogProps,
} from "./dialog"

export type SheetSide = "bottom" | "left" | "right"

export const Sheet = Dialog
export const SheetTrigger = DialogTrigger
export const SheetClose = DialogClose
export const SheetTitle = DialogTitle
export const SheetDescription = DialogDescription
export type SheetProps = DialogProps

export const SheetContent = forwardRef<
  HTMLDivElement,
  Omit<ComponentProps<typeof DialogContent>, "placement"> & { side?: SheetSide }
>(function SheetContent({ side = "right", ...props }, ref) {
  return <DialogContent data-sheet-side={side} data-slot="sheet-content" placement={side} ref={ref} {...props} />
})
