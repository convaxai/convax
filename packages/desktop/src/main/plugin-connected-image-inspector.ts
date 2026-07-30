export interface PluginConnectedImageInspection {
  height: number
  width: number
}

export interface PluginConnectedImageInspector {
  inspect(bytes: Uint8Array): PluginConnectedImageInspection | null
}

interface DecodedNativeImage {
  getSize(): { height: number; width: number }
  isEmpty(): boolean
}

interface NativeImageDecoder {
  createFromBuffer(buffer: Buffer): DecodedNativeImage
}

/** Main adapter: Electron performs the full decode; malformed payloads fail closed. */
export function createElectronPluginConnectedImageInspector(
  nativeImage: NativeImageDecoder,
): PluginConnectedImageInspector {
  return {
    inspect(bytes) {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes))
      if (image.isEmpty()) return null
      const { height, width } = image.getSize()
      return { height, width }
    },
  }
}
