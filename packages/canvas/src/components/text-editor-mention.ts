import { createInlineMarkdownSpec } from "@tiptap/core"
import Mention from "@tiptap/extension-mention"
import { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion"
import type { CanvasDocument, CanvasResourceRuntimeState } from "../types"

const MAX_CANVAS_TEXT_MENTION_CANDIDATES = 50
let mentionSuggestionSequence = 0

export interface CanvasTextMentionCandidate {
  id: string
  kind: string
  label: string
  thumbnailUrl?: string
}

function isMentionableCanvasNode(node: CanvasDocument["nodes"][number] | undefined, textNodeId: string) {
  return Boolean(
    node && node.id !== textNodeId && node.type === "file" && node.data.kind !== "group" && node.data.kind !== "folder",
  )
}

export function isCanvasTextMentionCandidate(document: CanvasDocument, textNodeId: string, mentionedNodeId: string) {
  return isMentionableCanvasNode(
    document.nodes.find((node) => node.id === mentionedNodeId),
    textNodeId,
  )
}

function getCanvasTextMentionThumbnailUrl(kind: string, resourceState: unknown) {
  if (!resourceState || typeof resourceState !== "object") return undefined
  const state = resourceState as CanvasResourceRuntimeState
  if (kind === "image") return state.url?.trim() || undefined
  if (kind === "video") return state.posterUrl?.trim() || undefined
  return undefined
}

export function getCanvasTextMentionCandidates(
  document: CanvasDocument,
  textNodeId: string,
  query: string,
): CanvasTextMentionCandidate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const candidates: CanvasTextMentionCandidate[] = []
  for (const node of document.nodes) {
    if (candidates.length >= MAX_CANVAS_TEXT_MENTION_CANDIDATES || !isMentionableCanvasNode(node, textNodeId)) {
      continue
    }
    const label = node.data.label.trim() || "Untitled"
    const searchText =
      `${label} ${node.data.kind} ${"name" in node.data ? (node.data.name ?? "") : ""}`.toLocaleLowerCase()
    if (normalizedQuery && !searchText.includes(normalizedQuery)) continue
    const thumbnailUrl = getCanvasTextMentionThumbnailUrl(node.data.kind, node.data.resourceState)
    candidates.push({
      id: node.id,
      kind: node.data.kind,
      label,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    })
  }
  return candidates
}

export function moveCanvasTextMentionIndex(index: number, key: string, itemCount: number) {
  if (itemCount <= 0) return 0
  if (key === "Home") return 0
  if (key === "End") return itemCount - 1
  if (key === "ArrowDown" || key === "ArrowRight") return (index + 1) % itemCount
  if (key === "ArrowUp" || key === "ArrowLeft") return (index - 1 + itemCount) % itemCount
  return Math.min(Math.max(index, 0), itemCount - 1)
}

function decodeCanvasTextMentionAttribute(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toWellFormedCanvasTextMentionAttribute(value: string) {
  let result = ""
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1]
        index += 1
      } else {
        result += "\uFFFD"
      }
    } else {
      result += code >= 0xdc00 && code <= 0xdfff ? "\uFFFD" : value[index]
    }
  }
  return result
}

const baseCanvasTextMentionMarkdownSpec = createInlineMarkdownSpec({
  allowedAttributes: ["id", "label", { name: "mentionSuggestionChar", skipIfDefault: "@" }],
  name: "@",
  nodeName: "mention",
  parseAttributes: (value) => {
    const attributes: Record<string, string> = {}
    const attributePattern = /(\w+)=(?:"([^"]*)"|'([^']*)')/g
    let match = attributePattern.exec(value)
    while (match) {
      const [, key, doubleQuoted, singleQuoted] = match
      attributes[key === "char" ? "mentionSuggestionChar" : key] = doubleQuoted ?? singleQuoted ?? ""
      match = attributePattern.exec(value)
    }
    return attributes
  },
  selfClosing: true,
})

const parseCanvasTextMentionMarkdown: typeof baseCanvasTextMentionMarkdownSpec.parseMarkdown = (token, helpers) => {
  const attributes = token.attributes ?? {}
  const encoded = attributes.encoding === "uri"
  const mentionAttributes: Record<string, string> = {}
  for (const key of ["id", "label", "mentionSuggestionChar"] as const) {
    const value = attributes[key]
    if (typeof value !== "string") continue
    mentionAttributes[key] = encoded ? decodeCanvasTextMentionAttribute(value) : value
  }
  return helpers.createNode("mention", mentionAttributes)
}

const renderCanvasTextMentionMarkdown: typeof baseCanvasTextMentionMarkdownSpec.renderMarkdown = (node) => {
  const serializedAttributes = ['encoding="uri"']
  for (const key of ["id", "label", "mentionSuggestionChar"] as const) {
    const value = node.attrs?.[key]
    if (value === undefined || value === null || (key === "mentionSuggestionChar" && value === "@")) continue
    const serializedKey = key === "mentionSuggestionChar" ? "char" : key
    serializedAttributes.push(
      `${serializedKey}="${encodeURIComponent(toWellFormedCanvasTextMentionAttribute(String(value)))}"`,
    )
  }
  return `[@ ${serializedAttributes.join(" ")}]`
}

const canvasTextMentionMarkdownSpec = {
  ...baseCanvasTextMentionMarkdownSpec,
  parseMarkdown: parseCanvasTextMentionMarkdown,
  renderMarkdown: renderCanvasTextMentionMarkdown,
}

export function createCanvasTextMentionExtension(options: {
  enabled: () => boolean
  items: (query: string) => CanvasTextMentionCandidate[]
  onSelect: (candidate: Pick<CanvasTextMentionCandidate, "id" | "label">) => boolean
}) {
  return Mention.extend({
    ...canvasTextMentionMarkdownSpec,
  }).configure({
    HTMLAttributes: {
      class: "convax-text-editor__mention",
    },
    renderHTML: ({ node }) => [
      "span",
      {
        class: "convax-text-editor__mention",
        "data-canvas-text-mention": node.attrs.id,
        "data-type": "mention",
      },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      char: "@",
      container: ".convax-text-editor-modal[open]",
      dismissOnOutsideClick: true,
      items: ({ query }) => options.items(query),
      offset: { mainAxis: 8 },
      placement: "bottom-start",
      render: createCanvasTextMentionSuggestionRenderer,
      shouldShow: () => options.enabled(),
      command: ({ editor, range, props }) => {
        if (typeof props.id !== "string" || typeof props.label !== "string") return
        if (!options.onSelect({ id: props.id, label: props.label })) return
        const inserted = editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              attrs: {
                id: props.id,
                label: props.label,
                mentionSuggestionChar: "@",
              },
              type: "mention",
            },
            { text: " ", type: "text" },
          ])
          .run()
        if (!inserted) return
      },
    },
  })
}

function createCanvasTextMentionSuggestionRenderer() {
  let activeIndex = 0
  let current: SuggestionProps<CanvasTextMentionCandidate, CanvasTextMentionCandidate> | null = null
  let popup: HTMLDivElement | null = null
  let unmount: (() => void) | null = null
  const popupId = `convax-text-mention-suggestions-${++mentionSuggestionSequence}`

  const updateEditorAria = () => {
    if (!current) return
    const editorDom = current.editor.view.dom
    editorDom.setAttribute("aria-autocomplete", "list")
    editorDom.setAttribute("aria-controls", popupId)
    editorDom.setAttribute("aria-expanded", "true")
    if (current.items.length) editorDom.setAttribute("aria-activedescendant", `${popupId}-option-${activeIndex}`)
    else editorDom.removeAttribute("aria-activedescendant")
  }

  const clearEditorAria = () => {
    const editorDom = current?.editor.view.dom
    if (!editorDom) return
    editorDom.removeAttribute("aria-autocomplete")
    editorDom.removeAttribute("aria-controls")
    editorDom.removeAttribute("aria-expanded")
    editorDom.removeAttribute("aria-activedescendant")
  }

  const syncActiveOption = (scroll = false) => {
    if (!popup) return
    const options = popup.querySelectorAll<HTMLButtonElement>(".convax-text-mention-suggestions__option")
    options.forEach((option, index) => {
      option.dataset.active = index === activeIndex ? "true" : "false"
      option.setAttribute("aria-selected", String(index === activeIndex))
    })
    if (scroll) options[activeIndex]?.scrollIntoView({ block: "nearest" })
    updateEditorAria()
  }

  const renderPopup = () => {
    if (!popup || !current) return
    const popupElement = popup
    popupElement.replaceChildren()

    const heading = document.createElement("div")
    heading.className = "convax-text-mention-suggestions__heading"
    heading.textContent = "Mention a Canvas material"
    popupElement.append(heading)

    if (!current.items.length) {
      const empty = document.createElement("div")
      empty.className = "convax-text-mention-suggestions__empty"
      empty.textContent = "No matching materials"
      popupElement.append(empty)
      updateEditorAria()
      return
    }

    current.items.forEach((item, index) => {
      const option = document.createElement("button")
      option.className = "convax-text-mention-suggestions__option"
      option.dataset.active = index === activeIndex ? "true" : "false"
      option.id = `${popupId}-option-${index}`
      option.setAttribute("aria-selected", String(index === activeIndex))
      option.setAttribute("role", "option")
      option.type = "button"

      const preview = document.createElement("span")
      preview.className = "convax-text-mention-suggestions__preview"
      preview.dataset.kind = item.kind
      preview.setAttribute("aria-hidden", "true")
      if (item.thumbnailUrl) {
        const image = document.createElement("img")
        image.alt = ""
        image.className = "convax-text-mention-suggestions__thumbnail"
        image.decoding = "async"
        image.loading = "lazy"
        image.src = item.thumbnailUrl
        image.addEventListener("error", () => {
          preview.dataset.thumbnailFailed = "true"
          image.remove()
        })
        preview.append(image)
      }
      const fallback = document.createElement("span")
      fallback.className = "convax-text-mention-suggestions__fallback"
      fallback.textContent = item.kind === "text" ? "T" : item.kind.slice(0, 1).toLocaleUpperCase() || "•"
      preview.append(fallback)
      const copy = document.createElement("span")
      copy.className = "convax-text-mention-suggestions__copy"
      const label = document.createElement("span")
      label.className = "convax-text-mention-suggestions__label"
      label.textContent = item.label
      const kind = document.createElement("span")
      kind.className = "convax-text-mention-suggestions__kind"
      kind.textContent = item.kind
      copy.append(label, kind)
      option.append(preview, copy)
      option.addEventListener("pointerdown", (event) => event.preventDefault())
      option.addEventListener("pointerenter", () => {
        activeIndex = index
        syncActiveOption()
      })
      option.addEventListener("click", () => current?.command(item))
      popupElement.append(option)
    })
    updateEditorAria()
  }

  const update = (next: SuggestionProps<CanvasTextMentionCandidate, CanvasTextMentionCandidate>) => {
    const activeId = current?.items[activeIndex]?.id
    current = next
    const preservedIndex = activeId ? next.items.findIndex((item) => item.id === activeId) : -1
    activeIndex = preservedIndex >= 0 ? preservedIndex : Math.min(activeIndex, Math.max(0, next.items.length - 1))
    renderPopup()
  }

  return {
    onStart(props: SuggestionProps<CanvasTextMentionCandidate, CanvasTextMentionCandidate>) {
      popup = document.createElement("div")
      popup.className = "convax-text-mention-suggestions"
      popup.dataset.canvasTextMentionSuggestions = ""
      popup.id = popupId
      popup.setAttribute("aria-label", "Canvas materials")
      popup.setAttribute("role", "listbox")
      current = props
      activeIndex = 0
      renderPopup()
      unmount = props.mount(popup)
    },
    onUpdate: update,
    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === "Escape") {
        exitSuggestion(props.view)
        return true
      }
      if (!current?.items.length) return props.event.key === "Enter"
      if (
        props.event.key === "ArrowDown" ||
        props.event.key === "ArrowUp" ||
        props.event.key === "ArrowLeft" ||
        props.event.key === "ArrowRight" ||
        props.event.key === "Home" ||
        props.event.key === "End"
      ) {
        activeIndex = moveCanvasTextMentionIndex(activeIndex, props.event.key, current.items.length)
        syncActiveOption(true)
        return true
      }
      if (props.event.key === "Enter") {
        current.command(current.items[activeIndex])
        return true
      }
      return false
    },
    onExit() {
      clearEditorAria()
      unmount?.()
      unmount = null
      popup = null
      current = null
    },
  }
}
