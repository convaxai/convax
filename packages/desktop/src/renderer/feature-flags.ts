export interface DesktopFeatureFlags {
  services: boolean
  skillsAndPlugins: boolean
}

export const desktopFeatureFlags: Readonly<DesktopFeatureFlags> = Object.freeze({
  services: typeof __CONVAX_FEATURE_SERVICES__ === "boolean" ? __CONVAX_FEATURE_SERVICES__ : true,
  skillsAndPlugins:
    typeof __CONVAX_FEATURE_SKILLS_AND_PLUGINS__ === "boolean" ? __CONVAX_FEATURE_SKILLS_AND_PLUGINS__ : true,
})
