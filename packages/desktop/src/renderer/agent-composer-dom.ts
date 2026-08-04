import type { AgentResource } from "@convax/agent-runtime"
import { isAgentCanvasResource } from "../agent-canvas-context"
import {
  findAgentComposerQuery,
  normalizeAgentComposerDraft,
  type AgentComposerDraft,
  type AgentComposerQueryTrigger,
} from "./agent-composer-state"

export const agentComposerResourceAttribute = "data-agent-composer-resource"
export const agentComposerTokenAttribute = "data-agent-composer-token"
export const agentComposerTokenActionAttribute = "data-agent-composer-token-action"
export const agentComposerTokenClassName =
  "mx-0.5 inline-flex max-w-56 select-none items-center overflow-hidden rounded-md border align-baseline text-xs font-medium"
export const agentComposerTokenEditClassName =
  "inline-flex min-w-0 items-center gap-1 truncate px-1.5 py-0.5 outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
export const agentComposerTokenRemoveClassName =
  "grid size-5 shrink-0 place-items-center border-l border-current/15 text-current/65 outline-none hover:bg-accent/70 hover:text-current focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"

export interface AgentComposerTokenPresentation {
  editLabel: string
  family: "canvas" | "project" | "skill"
  label: string
  prefix: "@" | "$"
  removeLabel: string
  title: string
}

export interface AgentComposerQueryRange {
  end: number
  node: Text
  start: number
  trigger: AgentComposerQueryTrigger
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
      if (!isNonEmptyString(resource.path) || !isOptionalString(resource.name) || !isOptionalString(resource.mime)) {
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

  if (resource.kind === "resource") {
    if (isAgentCanvasResource(resource)) {
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
    const label = resource.name || resource.uri
    return {
      editLabel: `Change Project reference: ${label}`,
      family: "project",
      label,
      prefix: "@",
      removeLabel: `Remove Project reference: ${label}`,
      title: `Project reference: ${resource.uri}`,
    }
  }

  const label = resource.name || portableBasename(resource.path)
  return {
    editLabel: `Change Project reference: ${label}`,
    family: "project",
    label,
    prefix: "@",
    removeLabel: `Remove Project reference: ${label}`,
    title: `Project reference: ${resource.path}`,
  }
}

export function agentComposerTokenFamilyClassName(family: AgentComposerTokenPresentation["family"]) {
  return family === "skill"
    ? "border-primary/25 bg-primary/10 text-primary"
    : family === "canvas"
      ? "border-primary/20 bg-accent text-accent-foreground"
      : "border-border bg-muted/70 text-foreground"
}

export function createAgentComposerToken(resource: AgentResource, disabled = false) {
  const presentation = agentComposerTokenPresentation(resource)
  const token = document.createElement("span")
  token.setAttribute(agentComposerTokenAttribute, "")
  token.setAttribute(agentComposerResourceAttribute, serializeAgentComposerResource(resource))
  token.setAttribute("contenteditable", "false")
  token.title = presentation.title
  token.className = [agentComposerTokenClassName, agentComposerTokenFamilyClassName(presentation.family)].join(" ")

  const edit = document.createElement("button")
  edit.type = "button"
  edit.disabled = disabled
  edit.setAttribute(agentComposerTokenActionAttribute, "edit")
  edit.setAttribute("aria-label", presentation.editLabel)
  edit.className = agentComposerTokenEditClassName

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
  remove.className = agentComposerTokenRemoveClassName
  remove.textContent = "×"

  token.append(edit, remove)
  return token
}

export function readAgentComposerDraft(root: HTMLElement): AgentComposerDraft {
  const segments: AgentComposerDraft["segments"] = []
  const appendText = (text: string) => {
    if (!text) return
    const previous = segments.at(-1)
    if (previous?.type === "text") previous.text += text
    else segments.push({ text, type: "text" })
  }
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent ?? "")
      return
    }
    if (!(node instanceof HTMLElement)) return
    const serialized = node.getAttribute(agentComposerResourceAttribute)
    if (serialized !== null) {
      const resource = parseAgentComposerResource(serialized)
      if (resource) segments.push({ resource, type: "resource" })
      return
    }
    if (node.tagName === "BR") {
      appendText("\n")
      return
    }
    const block = node !== root && (node.tagName === "DIV" || node.tagName === "P")
    if (block && segments.length) appendText("\n")
    for (const child of node.childNodes) visit(child)
  }
  for (const child of root.childNodes) visit(child)
  return normalizeAgentComposerDraft({ segments })
}

export function writeAgentComposerDraft(root: HTMLElement, draft: AgentComposerDraft) {
  const disabled = root.getAttribute("contenteditable") === "false"
  const nodes = normalizeAgentComposerDraft(draft).segments.map((segment) =>
    segment.type === "resource"
      ? createAgentComposerToken(segment.resource, disabled)
      : document.createTextNode(segment.text),
  )
  root.replaceChildren(...nodes)
}

export function findAgentComposerQueryRange(
  root: HTMLElement,
): (AgentComposerQueryRange & { query: string }) | undefined {
  const selection = window.getSelection()
  if (!selection?.isCollapsed || selection.rangeCount === 0) return undefined
  const range = selection.getRangeAt(0)
  if (!(range.startContainer instanceof Text) || !root.contains(range.startContainer)) return undefined
  const query = findAgentComposerQuery(range.startContainer.data, range.startOffset)
  return query ? { ...query, node: range.startContainer } : undefined
}

export function repairAgentComposerInsertedTriggerSelection(
  root: HTMLElement,
  input: { data: string | null; inputType: string },
) {
  if (input.inputType !== "insertText" || (input.data !== "@" && input.data !== "$")) return false
  const selection = window.getSelection()
  if (!selection?.isCollapsed || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!(range.startContainer instanceof Text) || !root.contains(range.startContainer)) return false
  const node = range.startContainer
  const offset = range.startOffset
  if (findAgentComposerQuery(node.data, offset)) return false
  if (node.data.slice(offset, offset + input.data.length) !== input.data) return false
  const repairedOffset = offset + input.data.length
  const repairedQuery = findAgentComposerQuery(node.data, repairedOffset)
  const expectedTrigger = input.data === "@" ? "reference" : "skill"
  if (repairedQuery?.trigger !== expectedTrigger) return false
  placeComposerSelection(root, node, repairedOffset)
  return true
}

export function captureAgentComposerSelection(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return undefined
  const range = selection.getRangeAt(0)
  return composerContainsRange(root, range) ? range.cloneRange() : undefined
}

export function insertAgentComposerTrigger(root: HTMLElement, trigger: "@" | "$", bookmark?: Range) {
  const range = resolveComposerRange(root, bookmark)
  range.deleteContents()
  const node = document.createTextNode(trigger)
  range.insertNode(node)
  placeComposerSelection(root, node, node.data.length)
}

export function insertAgentComposerPlainText(root: HTMLElement, text: string, bookmark?: Range) {
  if (!text) return
  const range = resolveComposerRange(root, bookmark)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  placeComposerSelection(root, node, node.data.length)
}

export function insertAgentComposerResources(root: HTMLElement, resources: readonly AgentResource[], bookmark?: Range) {
  if (!resources.length) return
  const range = resolveComposerRange(root, bookmark)
  range.deleteContents()
  const fragment = document.createDocumentFragment()
  for (const resource of resources) {
    fragment.append(createAgentComposerToken(resource), document.createTextNode("\u00a0"))
  }
  const finalSpacer = fragment.lastChild
  range.insertNode(fragment)
  if (finalSpacer instanceof Text) placeComposerSelection(root, finalSpacer, finalSpacer.data.length)
}

export function replaceAgentComposerQuery(root: HTMLElement, query: AgentComposerQueryRange, resource: AgentResource) {
  if (!query.node.isConnected || !root.contains(query.node)) return
  const range = document.createRange()
  range.setStart(query.node, query.start)
  range.setEnd(query.node, query.end)
  range.deleteContents()
  const token = createAgentComposerToken(resource)
  const spacer = document.createTextNode("\u00a0")
  range.insertNode(spacer)
  range.insertNode(token)
  placeComposerSelection(root, spacer, spacer.data.length)
}

export function replaceAgentComposerToken(root: HTMLElement, token: HTMLElement, resource: AgentResource) {
  if (!token.isConnected || !root.contains(token)) return
  const replacement = createAgentComposerToken(resource)
  token.replaceWith(replacement)
  placeComposerSelectionAfter(root, replacement)
}

export function removeAgentComposerToken(root: HTMLElement, token: HTMLElement) {
  if (!token.isConnected || !root.contains(token)) return
  const next = token.nextSibling
  const previous = token.previousSibling
  token.remove()
  if (next instanceof Text) placeComposerSelection(root, next, 0)
  else if (previous instanceof Text) placeComposerSelection(root, previous, previous.data.length)
  else focusAgentComposerAtEnd(root)
}

export function focusAgentComposerAtEnd(root: HTMLElement) {
  root.focus()
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  setComposerSelection(range)
}

function resolveComposerRange(root: HTMLElement, bookmark?: Range) {
  if (bookmark && composerContainsRange(root, bookmark)) return bookmark.cloneRange()
  const selected = captureAgentComposerSelection(root)
  if (selected) return selected
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  return range
}

function composerContainsRange(root: HTMLElement, range: Range) {
  return root.contains(range.startContainer) && root.contains(range.endContainer)
}

function placeComposerSelection(root: HTMLElement, node: Node, offset: number) {
  root.focus()
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  setComposerSelection(range)
}

function placeComposerSelectionAfter(root: HTMLElement, node: Node) {
  root.focus()
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  setComposerSelection(range)
}

function setComposerSelection(range: Range) {
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
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
