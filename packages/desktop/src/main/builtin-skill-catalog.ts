/**
 * Legacy Skill-management adapter types. Concrete Builtin Skill source is
 * owned by convax-plugins and reaches Desktop only through the locked Builtin
 * Marketplace bundle.
 */
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
