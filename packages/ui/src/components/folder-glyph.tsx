import type { CSSProperties } from "react"
import { cn } from "../lib/utils"

export type FolderGlyphSize = "compact" | "picker"

export interface FolderGlyphProps {
  className?: string
  color: string
  size?: FolderGlyphSize
}

const sizeClasses: Record<FolderGlyphSize, { body: string; root: string; tab: string }> = {
  compact: {
    body: "rounded-[4px]",
    root: "h-[15px] w-5",
    tab: "-top-[3px] left-[3px] h-[5px] w-2 rounded-t-[2px]",
  },
  picker: {
    body: "rounded-[5px]",
    root: "h-[19px] w-[26px]",
    tab: "-top-1 left-[3px] h-1.5 w-2.5 rounded-t-[3px]",
  },
}

/** Decorative folder silhouette whose bounded material color is supplied by its domain owner. */
export function FolderGlyph({ className, color, size = "picker" }: FolderGlyphProps) {
  const classes = sizeClasses[size]
  const material = `color-mix(in oklab, ${color} 64%, var(--ui-surface-raised))`
  const materialStyle = { background: material } satisfies CSSProperties

  return (
    <span
      aria-hidden="true"
      className={cn("relative block shrink-0", classes.root, className)}
      data-ui-folder-glyph=""
      data-ui-folder-glyph-size={size}
    >
      <span className={cn("absolute", classes.tab)} style={materialStyle} />
      <span
        className={cn("absolute inset-0", classes.body)}
        style={{
          ...materialStyle,
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 34%), 0 3px 7px -5px rgb(0 0 0 / 65%)",
        }}
      />
    </span>
  )
}
