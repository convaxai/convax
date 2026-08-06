import { describe, expect, test } from "bun:test"

import { parseInstalledPetLibrary } from "./pet-library"

function pet(id: string, spritesheet = `assets/${id}.webp`) {
  return {
    alt: `${id} pixel companion`,
    description: `${id} packaged companion`,
    displayName: id[0]!.toUpperCase() + id.slice(1),
    id,
    spritesheet,
    spriteVersion: 2,
  }
}

function library(pets: unknown[] = [pet("aster"), pet("comet", "assets/comet.png")]) {
  return { pets, schema: "convax.pet-library/1" }
}

describe("parseInstalledPetLibrary", () => {
  test("returns immutable cloned metadata for a strict packaged library", () => {
    const input = library()
    const parsed = parseInstalledPetLibrary(input)

    expect(parsed).toEqual(input as typeof parsed)
    expect(parsed).not.toBe(input)
    expect(parsed.pets).not.toBe(input.pets)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.pets)).toBe(true)
    expect(parsed.pets.every(Object.isFrozen)).toBe(true)
  })

  test.each([
    ["wrong schema", { ...library(), schema: "convax.pet-library" }],
    ["unknown root field", { ...library(), source: "legacy" }],
    ["empty library", library([])],
    ["too many pets", library(Array.from({ length: 65 }, (_, index) => pet(`pet-${index}`)))],
    ["unknown pet field", library([{ ...pet("aster"), source: "legacy" }])],
    ["missing pet field", library([{ ...pet("aster"), alt: undefined }])],
    ["invalid pet id", library([pet("Bad_Id")])],
    ["unsafe spritesheet", library([pet("aster", "../aster.webp")])],
    ["unsupported spritesheet", library([pet("aster", "assets/aster.gif")])],
    ["unsupported sprite version", library([{ ...pet("aster"), spriteVersion: 3 }])],
    ["duplicate ids", library([pet("same"), pet("same", "assets/other.webp")])],
    ["duplicate spritesheets", library([pet("first", "assets/shared.webp"), pet("second", "assets/shared.webp")])],
    ["case-colliding spritesheets", library([pet("first", "assets/shared.webp"), pet("second", "assets/SHARED.WEBP")])],
  ])("rejects %s", (_label, value) => {
    expect(() => parseInstalledPetLibrary(value)).toThrow()
  })

  test("rejects blank or overlong display metadata", () => {
    expect(() => parseInstalledPetLibrary(library([{ ...pet("aster"), displayName: "   " }]))).toThrow()
    expect(() => parseInstalledPetLibrary(library([{ ...pet("aster"), description: "x".repeat(2_001) }]))).toThrow()
  })
})
