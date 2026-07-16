import type { AgentClient } from "@convax/agent-runtime"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { CanvasRendererClient } from "../canvas-renderer-contracts"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type { DesktopProtocolClient } from "../desktop-protocol"
import type { DesktopSkillClient } from "../skill-management-contracts"
import type { WebPluginClient } from "../plugin-contracts"

declare global {
  interface Window {
    convax: {
      agent: AgentClient & { skills: DesktopSkillClient }
      canvas: { documents: CanvasDocumentClient; renderer: CanvasRendererClient }
      platform: NodeJS.Platform
      plugins: WebPluginClient
      projectFiles: ProjectFilesClient
      projects: ProjectLifecycleClient & { canvases: ProjectCanvasClient }
      protocol?: DesktopProtocolClient
    }
  }
}

export {}
