import { constants as fsConstants, type Dirent } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { canonicalize as canonicalizeConvaxUri } from "@convax/uri"

import type { PetCustomCollectionSnapshot, PetCustomPet } from "../pet-contracts"
import {
  assertValidPetAssetInspection,
  petAssetMaxBytes,
  type PetAssetInspection,
  type PetAssetInspector,
} from "./pet-asset-inspector"

export const customPetSchema = "convax.custom-pet/1" as const
export const maximumCustomPets = 32
export const customPetIdPattern = /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/

export type CustomPetSummary = PetCustomPet
export type CustomPetCollectionSnapshot = PetCustomCollectionSnapshot

interface CustomPetMetadata {
  alt: string
  description: string
  displayName: string
  filename: "spritesheet.png" | "spritesheet.webp"
  id: string
  schema: typeof customPetSchema
  spriteVersion: 2
}

export interface CustomPetStoreOptions {
  createId(): string
  inspector: PetAssetInspector
  petsRoot: string
}

const metadataFilename = "metadata.json"

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function isInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}

function requireCustomPetId(value: string) {
  if (value.length > 80 || !customPetIdPattern.test(value)) throw new Error("Custom pet id is invalid")
  return value
}

function assetUrl(id: string) {
  return canonicalizeConvaxUri(`convax-pet-asset://pet/${encodeURIComponent(id)}`)
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function metadataFrom(value: unknown, expectedId: string): CustomPetMetadata {
  const input = asRecord(value, "Custom pet metadata")
  const expected = ["alt", "description", "displayName", "filename", "id", "schema", "spriteVersion"]
  const keys = Object.keys(input)
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error("Custom pet metadata is invalid")
  }
  if (
    input.schema !== customPetSchema ||
    input.id !== expectedId ||
    (input.filename !== "spritesheet.png" && input.filename !== "spritesheet.webp") ||
    input.spriteVersion !== 2
  ) {
    throw new Error("Custom pet metadata is invalid")
  }
  const limits = { alt: 160, description: 240, displayName: 80 } as const
  for (const [key, maximum] of Object.entries(limits) as Array<[keyof typeof limits, number]>) {
    const field = input[key]
    if (
      typeof field !== "string" ||
      !field ||
      field !== field.trim() ||
      field.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(field)
    ) {
      throw new Error("Custom pet metadata is invalid")
    }
  }
  return input as unknown as CustomPetMetadata
}

function summaryFrom(metadata: CustomPetMetadata): CustomPetSummary {
  return {
    alt: metadata.alt,
    description: metadata.description,
    displayName: metadata.displayName,
    id: metadata.id,
    source: "custom",
    spritesheetUrl: assetUrl(metadata.id),
    spriteVersion: 2,
  }
}

function cloneSnapshot(snapshot: CustomPetCollectionSnapshot): CustomPetCollectionSnapshot {
  return {
    pets: snapshot.pets.map((pet) => ({ ...pet })),
    revision: snapshot.revision,
  }
}

export class CustomPetStore {
  readonly #createId: () => string
  readonly #inspector: PetAssetInspector
  readonly #listeners = new Set<(snapshot: CustomPetCollectionSnapshot) => void>()
  readonly #petsRoot: string
  #revision = 0
  #mutationTail = Promise.resolve()

  constructor(options: CustomPetStoreOptions) {
    if (!path.isAbsolute(options.petsRoot)) throw new Error("Custom pet root must be absolute")
    this.#createId = options.createId
    this.#inspector = options.inspector
    this.#petsRoot = path.resolve(options.petsRoot)
  }

  async getSnapshot(): Promise<CustomPetCollectionSnapshot> {
    return {
      pets: await this.#list(),
      revision: this.#revision,
    }
  }

  subscribe(listener: (snapshot: CustomPetCollectionSnapshot) => void) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  importAtlas(sourcePath: string) {
    return this.#exclusive(() => this.#importAtlas(sourcePath))
  }

  delete(id: string) {
    return this.#exclusive(() => this.#delete(id))
  }

  async resolveAsset(id: string) {
    const record = await this.#read(requireCustomPetId(id))
    return record.asset
  }

  async #importAtlas(sourcePath: string) {
    if (!path.isAbsolute(sourcePath)) throw new Error("Custom pet source must be an absolute path")
    const extension = path.extname(sourcePath).toLocaleLowerCase("en-US")
    if (extension !== ".png" && extension !== ".webp") throw new Error("Custom pet must be a PNG or WebP file")
    if ((await this.#list()).length >= maximumCustomPets) throw new Error("Custom pet collection is full")

    const id = requireCustomPetId(`custom-${this.#createId()}`)
    const root = await this.#ensureRoot()
    const staging = path.join(root, `.staging-${id}`)
    const target = path.join(root, id)
    const filename = `spritesheet${extension}` as CustomPetMetadata["filename"]
    try {
      await fs.mkdir(staging, { mode: 0o700 })
      const bytes = await this.#readSource(sourcePath)
      const stagedAsset = path.join(staging, filename)
      await fs.writeFile(stagedAsset, bytes, { flag: "wx", mode: 0o600 })
      const inspection = await this.#inspector.inspect(stagedAsset)
      assertValidPetAssetInspection(inspection, extension.slice(1) as PetAssetInspection["format"])

      const sourceName = path.basename(sourcePath, path.extname(sourcePath)).trim()
      const displayName = (sourceName || "Custom pet").slice(0, 80)
      const metadata: CustomPetMetadata = {
        alt: `${displayName}, a custom pixel companion`.slice(0, 160),
        description: "A local custom companion.",
        displayName,
        filename,
        id,
        schema: customPetSchema,
        spriteVersion: 2,
      }
      await fs.writeFile(path.join(staging, metadataFilename), `${JSON.stringify(metadata, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      })
      try {
        await fs.lstat(target)
        throw new Error("Generated custom pet id already exists")
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") throw error
      }
      await fs.rename(staging, target)
      this.#revision += 1
      await this.#publish()
      return summaryFrom(metadata)
    } finally {
      await fs.rm(staging, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  async #delete(id: string) {
    requireCustomPetId(id)
    const root = await this.#ensureRoot()
    const directory = await fs.realpath(path.join(root, id))
    if (!isInside(directory, root) || path.dirname(directory) !== root) {
      throw new Error("Custom pet directory is invalid")
    }
    const stat = await fs.lstat(directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Custom pet directory is invalid")
    await fs.rm(directory, { recursive: true })
    this.#revision += 1
    await this.#publish()
  }

  async #list() {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(this.#petsRoot, { encoding: "utf8", withFileTypes: true })
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return []
      throw error
    }
    const pets: CustomPetSummary[] = []
    for (const entry of entries) {
      if (
        pets.length >= maximumCustomPets ||
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        !customPetIdPattern.test(entry.name)
      ) {
        continue
      }
      try {
        const record = await this.#read(entry.name)
        pets.push(summaryFrom(record.metadata))
      } catch {
        // Invalid or externally tampered records stay unavailable.
      }
    }
    return pets.sort(
      (left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id),
    )
  }

  async #read(id: string) {
    const root = await this.#ensureRoot()
    const directory = await fs.realpath(path.join(root, id))
    if (!isInside(directory, root) || path.dirname(directory) !== root) throw new Error("Custom pet path is invalid")
    const directoryStat = await fs.lstat(directory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error("Custom pet path is invalid")

    const metadataPath = path.join(directory, metadataFilename)
    const metadataStat = await fs.lstat(metadataPath)
    if (metadataStat.isSymbolicLink() || !metadataStat.isFile() || metadataStat.size > 16_384) {
      throw new Error("Custom pet metadata is invalid")
    }
    const metadata = metadataFrom(JSON.parse(await fs.readFile(metadataPath, "utf8")), id)
    const asset = await fs.realpath(path.join(directory, metadata.filename))
    if (!isInside(asset, directory) || path.dirname(asset) !== directory) throw new Error("Custom pet asset is invalid")
    const assetStat = await fs.lstat(asset)
    if (assetStat.isSymbolicLink() || !assetStat.isFile()) throw new Error("Custom pet asset is invalid")
    const expectedFormat: PetAssetInspection["format"] = metadata.filename.endsWith(".png") ? "png" : "webp"
    assertValidPetAssetInspection(await this.#inspector.inspect(asset), expectedFormat)
    return { asset, metadata }
  }

  async #readSource(sourcePath: string) {
    const handle = await fs.open(sourcePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error("Custom pet source must be a regular file")
      if (stat.size > petAssetMaxBytes) throw new Error("Pet spritesheet must not exceed 20 MiB")
      const bytes = await handle.readFile()
      if (bytes.byteLength > petAssetMaxBytes) throw new Error("Pet spritesheet must not exceed 20 MiB")
      return bytes
    } finally {
      await handle.close()
    }
  }

  async #ensureRoot() {
    await fs.mkdir(this.#petsRoot, { mode: 0o700, recursive: true })
    const stat = await fs.lstat(this.#petsRoot)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Custom pet root must be a real directory")
    return fs.realpath(this.#petsRoot)
  }

  async #publish() {
    const snapshot = await this.getSnapshot()
    for (const listener of this.#listeners) {
      try {
        listener(cloneSnapshot(snapshot))
      } catch {}
    }
  }

  #exclusive<Result>(operation: () => Promise<Result>) {
    const result = this.#mutationTail.then(operation, operation)
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
