export type CanvasUiLocale = "en" | "zh-CN"

const englishMessages = {
  "media.audio": "audio",
  "media.file": "file",
  "media.image": "image",
  "media.text": "text",
  "media.video": "video",
  "mediaEmpty.add": "Add",
  "mediaEmpty.addImage": "Add image",
  "mediaEmpty.addVideo": "Add video",
  "mediaEmpty.blank": "Empty {kind}",
  "mediaEmpty.blankHint": "Describe what you want to generate below",
  "mediaEmpty.unavailable": "{kind} unavailable",
  "mediaEmpty.unavailableHint": "Relink a selected Project resource or choose a local file",
  "resourceRelink.incompatibleFile": "The selected file does not match this {kind} node",
} as const

type CanvasMessageKey = keyof typeof englishMessages

const chineseMessages = {
  "media.audio": "音频",
  "media.file": "文件",
  "media.image": "图片",
  "media.text": "文本",
  "media.video": "视频",
  "mediaEmpty.add": "添加",
  "mediaEmpty.addImage": "添加图片",
  "mediaEmpty.addVideo": "添加视频",
  "mediaEmpty.blank": "空{kind}",
  "mediaEmpty.blankHint": "在下方描述你想生成的内容",
  "mediaEmpty.unavailable": "{kind}不可用",
  "mediaEmpty.unavailableHint": "重新关联所选项目资源，或选择本地文件",
  "resourceRelink.incompatibleFile": "所选文件与该{kind}节点类型不匹配",
} satisfies Record<CanvasMessageKey, string>

export function canvasFileKindLabel(locale: CanvasUiLocale, kind: string): string {
  if (kind === "audio") return canvasMessage(locale, "media.audio")
  if (kind === "file") return canvasMessage(locale, "media.file")
  if (kind === "image") return canvasMessage(locale, "media.image")
  if (kind === "text") return canvasMessage(locale, "media.text")
  if (kind === "video") return canvasMessage(locale, "media.video")
  return kind
}

export function resolveCanvasUiLocale(value: string | null | undefined): CanvasUiLocale {
  return value === "zh-CN" ? "zh-CN" : "en"
}

export function canvasMessage(
  locale: CanvasUiLocale,
  key: CanvasMessageKey,
  values?: Readonly<Record<string, string>>,
): string {
  const template = (locale === "zh-CN" ? chineseMessages : englishMessages)[key]
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`)
}
