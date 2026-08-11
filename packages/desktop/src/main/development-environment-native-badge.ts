import type { DesktopDevelopmentIdentity } from "./app-branding"

const glyphs: Readonly<Record<string, readonly string[]>> = Object.freeze({
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
})

export interface DevelopmentEnvironmentNativeBadge {
  bitmap: Buffer
  height: number
  width: number
}

function badgeColor(id: string) {
  let hash = 2166136261
  for (const character of id) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const palette = [
    [37, 99, 235],
    [124, 58, 237],
    [219, 39, 119],
    [220, 38, 38],
    [217, 119, 6],
    [5, 150, 105],
    [8, 145, 178],
  ] as const
  return palette[(hash >>> 0) % palette.length]!
}

export function createDevelopmentEnvironmentNativeBadge(
  identity: DesktopDevelopmentIdentity,
): DevelopmentEnvironmentNativeBadge {
  const width = 32
  const height = 32
  const bitmap = Buffer.alloc(width * height * 4)
  const [red, green, blue] = badgeColor(identity.id)
  const radiusSquared = 14 * 14
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const dx = x - 15.5
      const dy = y - 15.5
      if (dx * dx + dy * dy > radiusSquared) continue
      bitmap[offset] = blue
      bitmap[offset + 1] = green
      bitmap[offset + 2] = red
      bitmap[offset + 3] = 255
    }
  }

  const glyphCharacter = identity.label.match(/[a-z0-9]/iu)?.[0]?.toUpperCase() ?? "S"
  const glyph = glyphs[glyphCharacter] ?? glyphs.S!
  const scale = 4
  const glyphLeft = 10
  const glyphTop = 6
  for (let row = 0; row < glyph.length; row += 1) {
    for (let column = 0; column < glyph[row]!.length; column += 1) {
      if (glyph[row]![column] !== "1") continue
      for (let pixelY = 0; pixelY < scale; pixelY += 1) {
        for (let pixelX = 0; pixelX < scale; pixelX += 1) {
          const x = glyphLeft + column * scale + pixelX
          const y = glyphTop + row * scale + pixelY
          const offset = (y * width + x) * 4
          bitmap[offset] = 255
          bitmap[offset + 1] = 255
          bitmap[offset + 2] = 255
          bitmap[offset + 3] = 255
        }
      }
    }
  }
  return Object.freeze({ bitmap, height, width })
}
