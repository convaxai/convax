export const githubUrl = "https://github.com/convaxai/convax"
export const downloadUrl = `${githubUrl}/releases/latest`
export const authxOrigin = "https://authx.microvoid.io"
export const convaxAuthxProjectId = "project_OKnlkG5kU1lNrOqJs0GFTu4JM2SwNkHz"

export function projectUserPortalUrl(planKey?: string): string {
  const path = `/account/projects/${encodeURIComponent(convaxAuthxProjectId)}${planKey ? "/plan" : ""}`
  const url = new URL(path, authxOrigin)
  if (planKey) url.searchParams.set("plan", planKey)
  return url.href
}

export const navItems = [
  { label: "Product", href: "#product" },
  { label: "Workflow", href: "#workflow" },
  { label: "Marketplace", href: "#marketplace" },
  { label: "Use cases", href: "#use-cases" },
  { label: "Pricing", href: "#pricing" },
] as const

export const valuePillars = [
  {
    number: "01",
    title: "Real projects",
    description: "Work directly with the files and folders that already make up your project.",
  },
  {
    number: "02",
    title: "Editable canvases",
    description: "Arrange text, media, files, and tools spatially without flattening the process.",
  },
  {
    number: "03",
    title: "Context-aware Agent",
    description: "Give the Agent the exact files, nodes, canvases, and Skills it needs.",
  },
] as const

export const workflowChapters = [
  {
    eyebrow: "01 · Projects",
    title: "Start from the work you already have.",
    description:
      "Open a real local folder. Browse project files, move them onto a canvas, and keep the result editable instead of rebuilding context in another chat.",
    detail: "Files stay connected to the project",
    visual: "project",
  },
  {
    eyebrow: "02 · Canvas",
    title: "See the whole process, not just the latest answer.",
    description:
      "Use multiple infinite canvases to connect briefs, references, images, video, notes, and interactive tools into a shared working model.",
    detail: "Every connection remains visible",
    visual: "canvas",
  },
  {
    eyebrow: "03 · Agent",
    title: "Ask an Agent that can see what you mean.",
    description:
      "Attach selected nodes, files, folders, or a full canvas to the conversation. The Agent can inspect, create, arrange, and reveal work through the same operations as the interface.",
    detail: "Scoped context, explicit actions",
    visual: "agent",
  },
  {
    eyebrow: "04 · Extensions",
    title: "Bring specialist tools into the workspace.",
    description:
      "Install Skills and Plugins that add focused workflows, Canvas cards, generation tools, and creative surfaces without turning Convax into a closed suite.",
    detail: "A workspace that keeps growing",
    visual: "plugins",
  },
] as const

export const plugins = [
  {
    name: "Convax Account",
    type: "Service",
    description: "Connect OpenRouter chat and live image generation through your Convax account.",
    tone: "orange",
  },
  {
    name: "ChatCut",
    type: "Video",
    description: "Move connected Canvas media into an authenticated, editable video workflow.",
    tone: "coral",
  },
  {
    name: "FFmpeg Tools",
    type: "Transform",
    description: "Run reviewed media transforms against host-staged Canvas files.",
    tone: "blue",
  },
  {
    name: "3D Director Desk",
    type: "Creative surface",
    description: "Block characters, props, panoramas, and cameras in an interactive scene.",
    tone: "lime",
  },
] as const

export const useCases = [
  {
    title: "Creative direction",
    description: "Keep briefs, references, shot ideas, and generated assets in one visible system.",
  },
  {
    title: "Image workflows",
    description: "Connect source material to generation and review without losing provenance.",
  },
  {
    title: "Video production",
    description: "Organize media, timelines, transforms, and specialist tools around the same project.",
  },
  {
    title: "Research & planning",
    description: "Turn files, notes, web material, and Agent output into a structure you can revisit.",
  },
] as const

export const plans = [
  {
    key: "free",
    name: "Free",
    priceCny: null,
    aiBudgetUsd: "$1.00",
    description: "Explore Convax with a small monthly allowance.",
    details: ["Monthly budget reset", "OpenRouter AI access", "No payment method required"],
    cta: "Start free",
    href: projectUserPortalUrl(),
  },
  {
    key: "pro",
    name: "Pro",
    priceCny: "0.01",
    aiBudgetUsd: "$20.00",
    description: "For regular individual projects and everyday Agent work.",
    details: ["Monthly budget reset", "OpenRouter AI access", "Alipay monthly billing"],
    cta: "Choose Pro",
    href: projectUserPortalUrl("pro"),
  },
  {
    key: "ultra",
    name: "Ultra",
    priceCny: "672",
    aiBudgetUsd: "$100.00",
    description: "For heavier creative and generation workflows.",
    details: ["Monthly budget reset", "OpenRouter AI access", "Alipay monthly billing"],
    cta: "Choose Ultra",
    href: projectUserPortalUrl("ultra"),
  },
  {
    key: "max",
    name: "Max",
    priceCny: "1,345",
    aiBudgetUsd: "$200.00",
    description: "For the largest monthly AI allowance.",
    details: ["Monthly budget reset", "OpenRouter AI access", "Alipay monthly billing"],
    cta: "Choose Max",
    href: projectUserPortalUrl("max"),
  },
] as const
