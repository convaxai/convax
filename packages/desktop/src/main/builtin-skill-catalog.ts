import canvasStoryboardSkill from "../../resources/skills/canvas-storyboard/SKILL.md?raw"

export interface DesktopBuiltinSkillBundle {
  description: string
  files: Readonly<Record<string, string | Uint8Array>>
  id: string
  name: string
}

export const desktopBuiltinSkillCatalog = [{
  description: "Convert a script or brief into ordered, reviewable shot cards on the active Canvas.",
  files: { "SKILL.md": canvasStoryboardSkill },
  id: "canvas-storyboard",
  name: "Storyboard Builder",
}] as const satisfies readonly DesktopBuiltinSkillBundle[]
