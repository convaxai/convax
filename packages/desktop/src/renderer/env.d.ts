import type { AgentClient } from "@convax/agent-runtime"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { CanvasRendererClient } from "../canvas-renderer-contracts"
import type { ProjectClient } from "@convax/project"

declare global {
  interface Window {
    convax: {
      agent: AgentClient
      canvas: { documents: CanvasDocumentClient; renderer: CanvasRendererClient }
      platform: NodeJS.Platform
      projects: ProjectClient
    }
  }
}

export {}
