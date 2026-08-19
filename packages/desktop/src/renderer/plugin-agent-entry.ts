import type { AgentResource, AgentSession } from "@convax/agent-runtime"
import type { WebPluginManifest } from "../plugin-contracts"

export interface PluginAgentComposerPort {
  addResources(resources: readonly AgentResource[]): void
  focusComposer(): void
}

export interface PluginAgentSessionPort {
  finishSession(input: { scopeId: string; sessionId: string }): void
  showSession(input: { scopeId: string; session: AgentSession }): boolean
}

/**
 * A single owned Skill is an unambiguous Agent entry for a headless Plugin.
 * Plugins with zero or multiple Skills still open the composer without silently
 * selecting a workflow for the user.
 */
export function pluginAgentComposerResource(
  plugin: Pick<WebPluginManifest, "contributes">,
): Extract<AgentResource, { kind: "skill" }> | undefined {
  const skills = plugin.contributes.skills ?? []
  return skills.length === 1 ? { kind: "skill", name: skills[0]!.name } : undefined
}

export function openPluginInAgent(plugin: Pick<WebPluginManifest, "contributes">, composer: PluginAgentComposerPort) {
  const resource = pluginAgentComposerResource(plugin)
  if (resource) composer.addResources([resource])
  else composer.focusComposer()
}

/** Makes a Plugin-started DSH session visible before its prompt can request user input. */
export function showPluginAgentSession(
  panel: PluginAgentSessionPort | null,
  input: { scopeId: string; session: AgentSession },
) {
  if (!panel?.showSession(input)) {
    throw new Error("The Agent panel is not ready for this Plugin request")
  }
  let finished = false
  return () => {
    if (finished) return
    finished = true
    panel.finishSession({ scopeId: input.scopeId, sessionId: input.session.id })
  }
}
