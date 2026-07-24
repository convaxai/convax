import { requireWebPluginRelativePath, validatePortablePluginSegment } from "../plugin-contracts"

export const installedPetLibrarySchema = "convax.pet-library/1" as const

export interface InstalledPetLibraryEntry {
  readonly alt: string
  readonly description: string
  readonly displayName: string
  readonly id: string
  readonly spritesheet: string
  readonly spriteVersion: 2
}

export interface InstalledPetLibrary {
  readonly pets: readonly InstalledPetLibraryEntry[]
  readonly schema: typeof installedPetLibrarySchema
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const expectedKeys = new Set(expected)
  const unknown = Object.keys(value).find((key) => !expectedKeys.has(key))
  if (unknown) throw new Error(`${label} contains an unsupported field: ${unknown}`)
  const missing = expected.find((key) => !(key in value))
  if (missing) throw new Error(`${label} is missing ${missing}`)
}

function requireString(value: unknown, label: string, maximumLength: number) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

function parsePetId(value: unknown, label: string) {
  const id = requireString(value, label, 80)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`${label} must use kebab-case`)
  validatePortablePluginSegment(id)
  return id
}

export function parseInstalledPetLibrary(value: unknown): InstalledPetLibrary {
  const input = asRecord(value, "Pet library")
  assertExactKeys(input, ["pets", "schema"], "Pet library")
  if (input.schema !== installedPetLibrarySchema) {
    throw new Error(`Pet library schema must equal ${installedPetLibrarySchema}`)
  }
  if (!Array.isArray(input.pets) || input.pets.length < 1 || input.pets.length > 64) {
    throw new Error("Pet library pets must contain between 1 and 64 entries")
  }
  const pets = input.pets.map((value, index): InstalledPetLibraryEntry => {
    const label = `Pet library pets[${index}]`
    const entry = asRecord(value, label)
    assertExactKeys(entry, ["alt", "description", "displayName", "id", "spritesheet", "spriteVersion"], label)
    const spritesheet = requireWebPluginRelativePath(entry.spritesheet, `${label} spritesheet`)
    if (!/\.(?:png|webp)$/i.test(spritesheet)) {
      throw new Error(`${label} spritesheet must be a PNG or WebP file`)
    }
    if (entry.spriteVersion !== 2) throw new Error(`${label} spriteVersion must equal 2`)
    return Object.freeze({
      alt: requireString(entry.alt, `${label} alt`, 500),
      description: requireString(entry.description, `${label} description`, 2_000),
      displayName: requireString(entry.displayName, `${label} displayName`, 120),
      id: parsePetId(entry.id, `${label} id`),
      spritesheet,
      spriteVersion: 2 as const,
    })
  })
  if (new Set(pets.map((pet) => pet.id)).size !== pets.length) {
    throw new Error("Pet library pets contain duplicate ids")
  }
  if (new Set(pets.map((pet) => pet.spritesheet.toLocaleLowerCase("en-US"))).size !== pets.length) {
    throw new Error("Pet library pets contain duplicate spritesheet paths")
  }
  return Object.freeze({
    pets: Object.freeze(pets),
    schema: installedPetLibrarySchema,
  })
}
