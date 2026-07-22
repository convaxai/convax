import type { AgentResource } from "@convax/agent-runtime"

export const agentComposerResourceAttribute = "data-agent-composer-resource"
export const agentComposerTokenAttribute = "data-agent-composer-token"
export const agentComposerTokenActionAttribute = "data-agent-composer-token-action"

export interface AgentComposerTokenPresentation {
  editLabel: string
  family: "canvas" | "project" | "skill"
  label: string
  prefix: "@" | "$"
  removeLabel: string
  title: string
}

export function serializeAgentComposerResource(resource: AgentResource) {
  return JSON.stringify({ resource, version: 1 })
}

export function parseAgentComposerResource(value: string): AgentResource | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.resource)) return null
    const resource = parsed.resource
    if (resource.kind === "skill") {
      return isNonEmptyString(resource.name) ? { kind: "skill", name: resource.name.trim() } : null
    }
    if (resource.kind === "resource") {
      if (!isNonEmptyString(resource.uri) || !isOptionalString(resource.name)) return null
      return {
        kind: "resource",
        ...(resource.name === undefined ? {} : { name: resource.name }),
        uri: resource.uri,
      }
    }
    if (resource.kind === "file" || resource.kind === "directory") {
      if (
        !isNonEmptyString(resource.path) ||
        !isOptionalString(resource.name) ||
        !isOptionalString(resource.mime)
      ) {
        return null
      }
      return {
        kind: resource.kind,
        ...(resource.mime === undefined ? {} : { mime: resource.mime }),
        ...(resource.name === undefined ? {} : { name: resource.name }),
        path: resource.path,
      }
    }
    return null
  } catch {
    return null
  }
}

export function agentComposerTokenPresentation(resource: AgentResource): AgentComposerTokenPresentation {
  if (resource.kind === "skill") {
    const label = resource.name
    return {
      editLabel: `Change Skill: ${label}`,
      family: "skill",
      label,
      prefix: "$",
      removeLabel: `Remove Skill: ${label}`,
      title: `Skill: ${label}`,
    }
  }

  if (resource.kind === "resource" && resource.uri.startsWith("convax://canvas/")) {
    const label = resource.name || resource.uri
    return {
      editLabel: `Change Canvas reference: ${label}`,
      family: "canvas",
      label,
      prefix: "@",
      removeLabel: `Remove Canvas reference: ${label}`,
      title: `Canvas reference: ${label}`,
    }
  }

  const label = resource.name || (resource.kind === "resource" ? resource.uri : portableBasename(resource.path))
  return {
    editLabel: `Change Project reference: ${label}`,
    family: "project",
    label,
    prefix: "@",
    removeLabel: `Remove Project reference: ${label}`,
    title: `Project reference: ${resource.kind === "resource" ? resource.uri : resource.path}`,
  }
}

export function createAgentComposerToken(resource: AgentResource, disabled = false) {
  const presentation = agentComposerTokenPresentation(resource)
  const token = document.createElement("span")
  token.setAttribute(agentComposerTokenAttribute, "")
  token.setAttribute(agentComposerResourceAttribute, serializeAgentComposerResource(resource))
  token.setAttribute("contenteditable", "false")
  token.title = presentation.title
  token.className = [
    "mx-0.5 inline-flex max-w-56 select-none items-center overflow-hidden rounded-md border align-baseline text-xs font-medium",
    presentation.family === "skill"
      ? "border-primary/25 bg-primary/10 text-primary"
      : presentation.family === "canvas"
        ? "border-primary/20 bg-accent text-accent-foreground"
        : "border-border bg-muted/70 text-foreground",
  ].join(" ")

  const edit = document.createElement("button")
  edit.type = "button"
  edit.disabled = disabled
  edit.setAttribute(agentComposerTokenActionAttribute, "edit")
  edit.setAttribute("aria-label", presentation.editLabel)
  edit.className =
    "inline-flex min-w-0 items-center gap-1 truncate px-1.5 py-0.5 outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"

  const prefix = document.createElement("span")
  prefix.setAttribute("aria-hidden", "true")
  prefix.className = "shrink-0"
  prefix.textContent = presentation.prefix
  const label = document.createElement("span")
  label.className = "truncate"
  label.textContent = presentation.label
  edit.append(prefix, label)

  const remove = document.createElement("button")
  remove.type = "button"
  remove.disabled = disabled
  remove.setAttribute(agentComposerTokenActionAttribute, "remove")
  remove.setAttribute("aria-label", presentation.removeLabel)
  remove.className =
    "grid size-5 shrink-0 place-items-center border-l border-current/15 text-current/65 outline-none hover:bg-accent/70 hover:text-current focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
  remove.textContent = "×"

  token.append(edit, remove)
  return token
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string"
}

function portableBasename(path: string) {
  const normalized = path.replace(/\/+$/, "")
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path
}
