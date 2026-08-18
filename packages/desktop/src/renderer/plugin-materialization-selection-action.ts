import type { CanvasSelectionActionContext } from "@convax/canvas"
import type { PortablePluginI18n } from "@convax/plugin-sdk"

import {
  hasWebPluginCanvasSurface,
  isSupportedWebPluginManifestSchema,
  type ActiveInstalledWebPluginSummary,
} from "../plugin-contracts"
import { isManagedProjectVideoSelection, type MediaOperationLocalizedText } from "./media-operation-selection-action"

export interface PluginMaterializationAction {
  description: MediaOperationLocalizedText
  id: string
  i18n?: PortablePluginI18n
  pluginId: string
  pluginVersion: string
  title: MediaOperationLocalizedText
}

export function listInstalledPluginMaterializationActions(
  installedPlugins: readonly ActiveInstalledWebPluginSummary[],
): readonly PluginMaterializationAction[] {
  return installedPlugins.flatMap((plugin) => {
    if (!isSupportedWebPluginManifestSchema(plugin.schema) || !plugin.hostApi || !hasWebPluginCanvasSurface(plugin)) {
      return []
    }
    return (plugin.contributes.canvas.selectionActions ?? []).flatMap((contribution) =>
      "action" in contribution &&
      contribution.target === "video" &&
      contribution.action.type === "materialize-own-plugin-node" &&
      contribution.action.connect === "selection-to-created"
        ? [
            {
              description: contribution.description,
              id: contribution.id,
              ...(plugin.i18n === undefined ? {} : { i18n: plugin.i18n }),
              pluginId: plugin.id,
              pluginVersion: plugin.version,
              title: contribution.title,
            },
          ]
        : [],
    )
  })
}

export function canRunPluginMaterialization(
  context: CanvasSelectionActionContext,
  _action: PluginMaterializationAction,
) {
  return isManagedProjectVideoSelection(context)
}
