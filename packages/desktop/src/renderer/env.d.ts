import type { AgentClient } from "@convax/agent-runtime"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { CanvasRendererClient } from "../canvas-renderer-contracts"
import type { CanvasExternalMediaDragRendererClient } from "../canvas-external-drag-contracts"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type { DesktopProtocolClient } from "../desktop-protocol"
import type { GenerationClient } from "../generation-contracts"
import type { JianyingRendererClient } from "../jianying-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import type { WebPluginClient } from "../plugin-contracts"
import type { PluginServiceClient } from "../plugin-service-contracts"
import type { PluginCapabilityRendererClient } from "../plugin-capability-ipc"

declare global {
  const __CONVAX_FEATURE_SERVICES__: boolean
  const __CONVAX_FEATURE_SKILLS_AND_PLUGINS__: boolean

  interface Window {
    convax: {
      agent: AgentClient & { skills: DesktopSkillClient }
      canvas: {
        documents: CanvasDocumentClient
        externalMediaDrag?: CanvasExternalMediaDragRendererClient
        renderer: CanvasRendererClient
      }
      generation: GenerationClient
      jianying: JianyingRendererClient
      platform: NodeJS.Platform
      pluginCapabilities: PluginCapabilityRendererClient
      plugins: WebPluginClient
      pluginServices: PluginServiceClient
      projectFiles: ProjectFilesClient
      projects: ProjectLifecycleClient & { canvases: ProjectCanvasClient }
      protocol?: DesktopProtocolClient
    }
  }
}

export {}
