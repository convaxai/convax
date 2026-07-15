import type { ProjectClient } from "@convax/project"

declare global {
  interface Window {
    convax: {
      platform: NodeJS.Platform
      projects: ProjectClient
    }
  }
}

export {}
