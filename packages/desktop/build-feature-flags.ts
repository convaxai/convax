export const desktopBuildFeatureEnvironment = {
  services: "CONVAX_FEATURE_SERVICES",
  skillsAndPlugins: "CONVAX_FEATURE_SKILLS_AND_PLUGINS",
} as const

export interface DesktopBuildFeatureFlags {
  services: boolean
  skillsAndPlugins: boolean
}

function parseBuildFeatureFlag(name: string, value: string | undefined): boolean {
  if (value === undefined) return true

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
      return true
    case "0":
    case "false":
      return false
    default:
      throw new Error(`${name} must be one of true, false, 1, or 0; received ${JSON.stringify(value)}`)
  }
}

export function resolveDesktopBuildFeatureFlags(
  environment: Readonly<Record<string, string | undefined>>,
): DesktopBuildFeatureFlags {
  return {
    services: parseBuildFeatureFlag(
      desktopBuildFeatureEnvironment.services,
      environment[desktopBuildFeatureEnvironment.services],
    ),
    skillsAndPlugins: parseBuildFeatureFlag(
      desktopBuildFeatureEnvironment.skillsAndPlugins,
      environment[desktopBuildFeatureEnvironment.skillsAndPlugins],
    ),
  }
}
