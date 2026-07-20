import type { DefaultRemoteCapability } from "./default-capability-provisioner"

/**
 * Product-owned, one-time remote defaults. These entries still use the normal
 * verified Registry installer; this list only decides whether Desktop should
 * attempt the first installation without a renderer prompt.
 */
export const desktopDefaultRemoteCapabilityCatalog = [
  {
    companionSkillName: "ffmpeg-canvas",
    pluginId: "ffmpeg-tools",
  },
] as const satisfies readonly DefaultRemoteCapability[]
