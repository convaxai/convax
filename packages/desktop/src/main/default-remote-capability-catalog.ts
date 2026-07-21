import type { DefaultRemoteCapability } from "./default-capability-provisioner"

/**
 * Product-owned remote defaults. These entries still use the normal verified
 * Registry installer. Desktop installs and updates a present default without a
 * renderer prompt, while its durable receipt keeps a later user removal intact.
 */
export const desktopDefaultRemoteCapabilityCatalog = [
  {
    pluginId: "ffmpeg-tools",
  },
] as const satisfies readonly DefaultRemoteCapability[]
