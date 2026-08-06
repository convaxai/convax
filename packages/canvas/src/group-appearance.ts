import type { CanvasDocument, CanvasNode } from "./types"

export const canvasGroupAppearanceKey = "convaxGroupAppearance"
export const canvasGroupAppearanceSchema = "convax.group-appearance/1"

export const canvasGroupColorOptions = [
  { id: "default", label: "Default" },
  { id: "gray", label: "Gray" },
  { id: "brown", label: "Brown" },
  { id: "orange", label: "Orange" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "pink", label: "Pink" },
  { id: "red", label: "Red" },
] as const

export const canvasGroupEmojiOptions = [
  { emoji: "📁", id: "folder", label: "Folder" },
  { emoji: "💼", id: "briefcase", label: "Briefcase" },
  { emoji: "📥", id: "inbox", label: "Inbox" },
  { emoji: "📎", id: "paperclip", label: "Paperclip" },
  { emoji: "🔖", id: "bookmark", label: "Bookmark" },
  { emoji: "📚", id: "books", label: "Books" },
  { emoji: "📓", id: "notebook", label: "Notebook" },
  { emoji: "💡", id: "idea", label: "Idea" },
  { emoji: "✨", id: "sparkles", label: "Sparkles" },
  { emoji: "⭐", id: "star", label: "Star" },
  { emoji: "🔥", id: "fire", label: "Fire" },
  { emoji: "⚡", id: "bolt", label: "Bolt" },
  { emoji: "🎯", id: "target", label: "Target" },
  { emoji: "🚀", id: "rocket", label: "Rocket" },
  { emoji: "🧭", id: "compass", label: "Compass" },
  { emoji: "🌍", id: "globe", label: "Globe" },
  { emoji: "🗺️", id: "map", label: "Map" },
  { emoji: "📷", id: "camera", label: "Camera" },
  { emoji: "🎬", id: "film", label: "Film" },
  { emoji: "🎵", id: "music", label: "Music" },
  { emoji: "🎨", id: "palette", label: "Palette" },
  { emoji: "🖼️", id: "image", label: "Image" },
  { emoji: "📊", id: "chart", label: "Chart" },
  { emoji: "📅", id: "calendar", label: "Calendar" },
  { emoji: "🕒", id: "clock", label: "Clock" },
  { emoji: "✅", id: "check", label: "Check" },
  { emoji: "⚠️", id: "warning", label: "Warning" },
  { emoji: "❤️", id: "heart", label: "Heart" },
  { emoji: "💎", id: "gem", label: "Gem" },
  { emoji: "🏆", id: "trophy", label: "Trophy" },
  { emoji: "🌱", id: "plant", label: "Plant" },
  { emoji: "🍃", id: "leaf", label: "Leaf" },
  { emoji: "☕", id: "coffee", label: "Coffee" },
  { emoji: "🎮", id: "game", label: "Game" },
  { emoji: "🤖", id: "robot", label: "Robot" },
  { emoji: "🧠", id: "brain", label: "Brain" },
  { emoji: "👥", id: "team", label: "Team" },
  { emoji: "📦", id: "package", label: "Package" },
  { emoji: "🛠️", id: "tools", label: "Tools" },
  { emoji: "🧩", id: "puzzle", label: "Puzzle" },
  { emoji: "🗂️", id: "index", label: "Index" },
  { emoji: "📝", id: "memo", label: "Memo" },
  { emoji: "✏️", id: "pencil", label: "Pencil" },
  { emoji: "📌", id: "pin", label: "Pin" },
  { emoji: "🔗", id: "link", label: "Link" },
  { emoji: "🗄️", id: "archive", label: "Archive" },
  { emoji: "🗃️", id: "card-file", label: "Card file" },
  { emoji: "💻", id: "laptop", label: "Laptop" },
  { emoji: "🖥️", id: "desktop", label: "Desktop" },
  { emoji: "📱", id: "phone", label: "Phone" },
  { emoji: "🎙️", id: "microphone", label: "Microphone" },
  { emoji: "🎧", id: "headphones", label: "Headphones" },
  { emoji: "🔑", id: "key", label: "Key" },
  { emoji: "🔒", id: "lock", label: "Lock" },
  { emoji: "🔍", id: "search", label: "Search" },
  { emoji: "🔔", id: "bell", label: "Bell" },
  { emoji: "📣", id: "megaphone", label: "Megaphone" },
  { emoji: "🎁", id: "gift", label: "Gift" },
  { emoji: "🎉", id: "party", label: "Party" },
  { emoji: "🚩", id: "flag", label: "Flag" },
  { emoji: "⏳", id: "hourglass", label: "Hourglass" },
  { emoji: "☀️", id: "sun", label: "Sun" },
  { emoji: "🌙", id: "moon", label: "Moon" },
  { emoji: "☁️", id: "cloud", label: "Cloud" },
  { emoji: "🌈", id: "rainbow", label: "Rainbow" },
  { emoji: "🌸", id: "blossom", label: "Blossom" },
  { emoji: "🌻", id: "sunflower", label: "Sunflower" },
  { emoji: "🌳", id: "tree", label: "Tree" },
  { emoji: "🍀", id: "clover", label: "Clover" },
  { emoji: "🌵", id: "cactus", label: "Cactus" },
  { emoji: "⛰️", id: "mountain", label: "Mountain" },
  { emoji: "🌊", id: "wave", label: "Wave" },
  { emoji: "🦋", id: "butterfly", label: "Butterfly" },
  { emoji: "🐱", id: "cat", label: "Cat" },
  { emoji: "🐶", id: "dog", label: "Dog" },
  { emoji: "🦊", id: "fox", label: "Fox" },
  { emoji: "🦄", id: "unicorn", label: "Unicorn" },
  { emoji: "🐳", id: "whale", label: "Whale" },
  { emoji: "🍎", id: "apple", label: "Apple" },
  { emoji: "🍕", id: "pizza", label: "Pizza" },
  { emoji: "🍰", id: "cake", label: "Cake" },
  { emoji: "⚽", id: "football", label: "Football" },
  { emoji: "🏀", id: "basketball", label: "Basketball" },
  { emoji: "🧘", id: "focus", label: "Focus" },
  { emoji: "🕊️", id: "peace", label: "Peace" },
] as const

export type CanvasGroupColor = (typeof canvasGroupColorOptions)[number]["id"]
export type CanvasGroupEmoji = (typeof canvasGroupEmojiOptions)[number]["id"]

const canvasGroupColorValues = {
  blue: "oklch(0.73 0.105 245)",
  brown: "oklch(0.67 0.075 58)",
  default: "oklch(0.74 0.035 82)",
  gray: "oklch(0.69 0.018 255)",
  green: "oklch(0.74 0.115 146)",
  orange: "oklch(0.78 0.13 60)",
  pink: "oklch(0.78 0.105 350)",
  purple: "oklch(0.72 0.11 305)",
  red: "oklch(0.71 0.135 27)",
  yellow: "oklch(0.87 0.12 92)",
} as const satisfies Record<CanvasGroupColor, string>

export function getCanvasGroupColorValue(color: CanvasGroupColor) {
  return canvasGroupColorValues[color]
}

export interface CanvasGroupAppearance {
  color: CanvasGroupColor
  emoji: CanvasGroupEmoji
}

interface StoredCanvasGroupAppearance extends CanvasGroupAppearance {
  schema: typeof canvasGroupAppearanceSchema
}

export const defaultCanvasGroupAppearance: CanvasGroupAppearance = {
  color: "default",
  emoji: "folder",
}

const colorIds = new Set<string>(canvasGroupColorOptions.map((option) => option.id))
const emojiIds = new Set<string>(canvasGroupEmojiOptions.map((option) => option.id))

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isCanvasGroupColor(value: unknown): value is CanvasGroupColor {
  return typeof value === "string" && colorIds.has(value)
}

function isCanvasGroupEmoji(value: unknown): value is CanvasGroupEmoji {
  return typeof value === "string" && emojiIds.has(value)
}

function parseCanvasGroupAppearance(value: unknown): StoredCanvasGroupAppearance | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    value.schema !== canvasGroupAppearanceSchema ||
    !isCanvasGroupColor(value.color) ||
    !isCanvasGroupEmoji(value.emoji)
  ) {
    return undefined
  }
  return {
    color: value.color,
    emoji: value.emoji,
    schema: canvasGroupAppearanceSchema,
  }
}

function storedAppearanceForNode(node: CanvasNode) {
  if (node.data.kind !== "group" || !isRecord(node.data.metadata)) return undefined
  return node.data.metadata[canvasGroupAppearanceKey]
}

export function getCanvasGroupAppearance(node: CanvasNode | undefined): CanvasGroupAppearance {
  if (!node) return defaultCanvasGroupAppearance
  const parsed = parseCanvasGroupAppearance(storedAppearanceForNode(node))
  return parsed ? { color: parsed.color, emoji: parsed.emoji } : defaultCanvasGroupAppearance
}

export function hasUnsupportedCanvasGroupAppearance(node: CanvasNode | undefined) {
  const stored = node ? storedAppearanceForNode(node) : undefined
  return stored !== undefined && parseCanvasGroupAppearance(stored) === undefined
}

export function getCanvasGroupEmoji(emoji: CanvasGroupEmoji) {
  return canvasGroupEmojiOptions.find((option) => option.id === emoji)?.emoji ?? "📁"
}

export function setCanvasGroupAppearance(
  document: CanvasDocument,
  nodeId: string,
  appearance: CanvasGroupAppearance,
): CanvasDocument {
  if (!isCanvasGroupColor(appearance.color) || !isCanvasGroupEmoji(appearance.emoji)) {
    throw new Error("Canvas group appearance is invalid")
  }
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.data.kind !== "group") return document
  if (hasUnsupportedCanvasGroupAppearance(node)) {
    throw new Error("Canvas group appearance schema is unsupported")
  }
  const current = getCanvasGroupAppearance(node)
  if (current.color === appearance.color && current.emoji === appearance.emoji) return document

  return {
    ...document,
    nodes: document.nodes.map((candidate) => {
      if (candidate.id !== nodeId || candidate.data.kind !== "group") return candidate
      const data = candidate.data
      const currentMetadata = isRecord(data.metadata) ? data.metadata : {}
      const metadata = { ...currentMetadata }
      if (
        appearance.color === defaultCanvasGroupAppearance.color &&
        appearance.emoji === defaultCanvasGroupAppearance.emoji
      ) {
        delete metadata[canvasGroupAppearanceKey]
      } else {
        metadata[canvasGroupAppearanceKey] = {
          ...appearance,
          schema: canvasGroupAppearanceSchema,
        } satisfies StoredCanvasGroupAppearance
      }
      if (Object.keys(metadata).length === 0) {
        const { metadata: _metadata, ...withoutMetadata } = data
        return { ...candidate, data: withoutMetadata as CanvasNode["data"] }
      }
      return { ...candidate, data: { ...data, metadata } }
    }),
  }
}
