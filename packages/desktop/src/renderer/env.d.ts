import type { AgentClient } from "@convax/agent-runtime"
import type { CanvasRendererDocumentClient } from "../canvas-document-contracts"
import type { CanvasRendererClient } from "../canvas-renderer-contracts"
import type { CanvasExternalMediaDragRendererClient } from "../canvas-external-drag-contracts"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type { CanvasResourceClient, CanvasTextResourceClient, DesktopProtocolClient } from "../desktop-protocol"
import type { GenerationClient } from "../generation-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import type { WebPluginClient } from "../plugin-contracts"
import type { PluginServiceClient } from "../plugin-service-contracts"
import type { PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import type { PluginMaterializationRendererClient } from "../plugin-materialization-contracts"
import type { PetDisplayedSession, PetNavigationRequest, PetNavigationTarget } from "../pet-contracts"
import type { PetSettingsHostClient } from "./pet-settings-host"
import type { WorkspaceSystemStatusClient } from "../workspace-system-status-contracts"
import type { MarketplaceClient } from "../marketplace-contracts"
import type { MainWindowControlsClient } from "../main-window-controls-contracts"

declare global {
  const __CONVAX_FEATURE_SERVICES__: boolean
  const __CONVAX_FEATURE_SKILLS_AND_PLUGINS__: boolean

  interface Window {
    convax: {
      agent: AgentClient & { skills: DesktopSkillClient }
      canvas: {
        documents: CanvasRendererDocumentClient
        externalMediaDrag?: CanvasExternalMediaDragRendererClient
        pluginMaterialization: PluginMaterializationRendererClient
        renderer: CanvasRendererClient
        resources: CanvasResourceClient
        textResources: CanvasTextResourceClient
      }
      generation: GenerationClient
      mainWindowControls: MainWindowControlsClient
      marketplaces: MarketplaceClient
      pets: PetSettingsHostClient & {
        markDisplayed(input: PetNavigationRequest): Promise<void>
        markSessionDisplayed(input: PetDisplayedSession): Promise<void>
        onNavigate(listener: (target: PetNavigationTarget) => void): () => void
      }
      platform: NodeJS.Platform
      pluginCapabilities: PluginCapabilityRendererClient
      plugins: WebPluginClient
      pluginServices: PluginServiceClient
      projectFiles: ProjectFilesClient
      projects: ProjectLifecycleClient & { canvases: ProjectCanvasClient }
      protocol?: DesktopProtocolClient
      systemStatus: WorkspaceSystemStatusClient
    }
  }
}

export {}
