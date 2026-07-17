import canvasStoryboardSkill from "../../resources/skills/canvas-storyboard/SKILL.md?raw"

export interface DesktopBuiltinSkillBundle {
  description: string
  files: Readonly<Record<string, string | Uint8Array>>
  id: string
  name: string
  version: string
}

export interface DesktopBuiltinSkillShowcaseAsset {
  altText: string
  mimeType: "image/png" | "video/mp4"
  path: string
}

export interface DesktopBuiltinSkillPresentation {
  displayName: string
  id: string
  showcase: {
    animation: DesktopBuiltinSkillShowcaseAsset
    poster: DesktopBuiltinSkillShowcaseAsset
  }
}

export const desktopBuiltinSkillCatalog = [
  {
    description: "Convert a script or brief into ordered, reviewable shot cards on the active Canvas.",
    files: { "SKILL.md": canvasStoryboardSkill },
    id: "canvas-storyboard",
    name: "Storyboard Builder",
    version: "0.1.0",
  },
] as const satisfies readonly DesktopBuiltinSkillBundle[]
