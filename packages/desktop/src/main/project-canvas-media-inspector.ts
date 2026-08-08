import type { ProjectCanvasMediaInspector } from "@convax/project/node"

interface DecodedNativeImage {
  getSize(): { height: number; width: number }
  isEmpty(): boolean
}

interface NativeImageDecoder {
  createFromBuffer(buffer: Buffer): DecodedNativeImage
}

/** Main adapter: Project owns stable reads; Electron owns platform image decode. */
export function createProjectCanvasMediaInspector(input: { decoder: NativeImageDecoder }): ProjectCanvasMediaInspector {
  return {
    async inspect(resource) {
      const image = input.decoder.createFromBuffer(Buffer.from(resource.bytes))
      if (image.isEmpty()) return {}
      const { height, width } = image.getSize()
      if (!positiveDimension(width) || !positiveDimension(height)) return {}
      return Object.freeze({ height, width })
    },
  }
}

function positiveDimension(value: number) {
  return Number.isFinite(value) && value > 0
}
