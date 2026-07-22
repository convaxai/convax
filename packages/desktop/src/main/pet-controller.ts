import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import type { PetActivitySnapshot, PetInventoryItem, PetInventorySnapshot, PetRendererSnapshot } from "../pet-contracts"
import {
  assertValidPetAssetInspection,
  petAssetMaxBytes,
  type PetAssetInspector,
  type PetAssetInspection,
} from "./pet-asset-inspector"
import { defaultPetState, type PetPersistedState, type PetSelection, type PetStateStore } from "./pet-state-store"

const customPetSchema = "convax.custom-pet/1" as const
const customPetMetadataFile = "metadata.json"
const customPetIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

interface CustomPetMetadata {
  alt: string
  description: string
  filename: "spritesheet.png" | "spritesheet.webp"
  id: string
  name: string
  schema: typeof customPetSchema
  spriteVersion: 2
}

export interface PetPluginManager {
  list(): Promise<InstalledWebPluginSummary[]>
  resolveAsset(pluginId: string, relativePath: string): Promise<string>
}

export interface PetActivitySource {
  getSnapshot(): PetActivitySnapshot
  subscribe(listener: (snapshot: PetActivitySnapshot) => void): () => void
}

export interface PetWindowPort {
  close(): Promise<void> | void
  open(snapshot: PetRendererSnapshot): Promise<void> | void
  update(snapshot: PetRendererSnapshot): Promise<void> | void
}

export interface PetControllerOptions {
  activity: PetActivitySource
  createId: () => string
  inspector: PetAssetInspector
  petsRoot: string
  pluginManager: PetPluginManager
  stateStore: PetStateStore
  window: PetWindowPort
}

function cloneDefaultState(): PetPersistedState {
  return {
    awake: defaultPetState.awake,
    positions: {},
    schema: defaultPetState.schema,
    seen: {},
  }
}

function selectionId(selection: PetSelection | undefined) {
  if (!selection) return undefined
  return selection.kind === "plugin" ? `plugin:${selection.pluginId}` : `custom:${selection.id}`
}

function selectionFromId(id: string): PetSelection {
  if (id.startsWith("plugin:")) {
    const pluginId = id.slice("plugin:".length)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error("Pet Plugin selection is invalid")
    return { kind: "plugin", pluginId }
  }
  if (id.startsWith("custom:")) {
    const customId = id.slice("custom:".length)
    if (!customPetIdPattern.test(customId)) throw new Error("Custom pet selection is invalid")
    return { id: customId, kind: "custom" }
  }
  throw new Error("Pet selection is invalid")
}

function assetUrl(id: string) {
  return `convax-pet-asset://pet/${encodeURIComponent(id)}`
}

function pluginPet(plugin: InstalledWebPluginSummary): PetInventoryItem | null {
  const pet = plugin.contributes.pet
  if (!pet) return null
  const id = `plugin:${plugin.id}`
  return {
    alt: pet.alt,
    assetUrl: assetUrl(id),
    description: pet.description,
    id,
    name: pet.name,
    source: "plugin",
    spriteVersion: 2,
  }
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function customMetadata(value: unknown, expectedId: string): CustomPetMetadata {
  const input = asRecord(value, "Custom pet metadata")
  const allowed = ["alt", "description", "filename", "id", "name", "schema", "spriteVersion"]
  const unknown = Object.keys(input).find((key) => !allowed.includes(key))
  if (unknown || allowed.some((key) => !(key in input))) throw new Error("Custom pet metadata is invalid")
  if (
    input.schema !== customPetSchema ||
    input.id !== expectedId ||
    !customPetIdPattern.test(expectedId) ||
    (input.filename !== "spritesheet.png" && input.filename !== "spritesheet.webp") ||
    input.spriteVersion !== 2
  ) {
    throw new Error("Custom pet metadata is invalid")
  }
  for (const [key, maximum] of [
    ["alt", 500],
    ["description", 2_000],
    ["name", 120],
  ] as const) {
    if (typeof input[key] !== "string" || input[key].length < 1 || input[key].length > maximum) {
      throw new Error("Custom pet metadata is invalid")
    }
  }
  return input as unknown as CustomPetMetadata
}

function itemFromCustom(metadata: CustomPetMetadata): PetInventoryItem {
  const id = `custom:${metadata.id}`
  return {
    alt: metadata.alt,
    assetUrl: assetUrl(id),
    description: metadata.description,
    id,
    name: metadata.name,
    source: "custom",
    spriteVersion: 2,
  }
}

function isInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}

export class PetController {
  readonly #activity: PetActivitySource
  readonly #createId: () => string
  readonly #inspector: PetAssetInspector
  readonly #listeners = new Set<() => void>()
  readonly #petsRoot: string
  readonly #pluginManager: PetPluginManager
  readonly #stateStore: PetStateStore
  readonly #window: PetWindowPort
  #activitySnapshot: PetActivitySnapshot = { activities: [], revision: 0 }
  #disposeActivity?: () => void
  #initialized = false
  #state = cloneDefaultState()

  constructor(options: PetControllerOptions) {
    if (!path.isAbsolute(options.petsRoot)) throw new Error("Custom pet root must be absolute")
    this.#activity = options.activity
    this.#createId = options.createId
    this.#inspector = options.inspector
    this.#petsRoot = path.resolve(options.petsRoot)
    this.#pluginManager = options.pluginManager
    this.#stateStore = options.stateStore
    this.#window = options.window
  }

  async initialize() {
    if (this.#initialized) return
    this.#initialized = true
    this.#state = await this.#stateStore.read()
    this.#activitySnapshot = this.#activity.getSnapshot()
    this.#disposeActivity = this.#activity.subscribe((snapshot) => {
      this.#activitySnapshot = snapshot
      void this.#updateWindow().catch(() => this.#window.close())
    })

    const inventory = await this.#inventory()
    const selectedId = selectionId(this.#state.selected)
    if (selectedId && !inventory.some((item) => item.id === selectedId)) {
      this.#state = { ...this.#state, awake: false, selected: undefined }
      await this.#persist()
    }
    if (this.#state.awake) await this.#openWindow()
  }

  dispose() {
    this.#disposeActivity?.()
    this.#disposeActivity = undefined
    this.#window.close()
  }

  async listPets(): Promise<PetInventorySnapshot> {
    const pets = await this.#inventory()
    const selectedId = selectionId(this.#state.selected)
    return {
      awake: this.#state.awake,
      pets,
      ...(selectedId && pets.some((pet) => pet.id === selectedId) ? { selectedId } : {}),
    }
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getPosition(displayId: string) {
    const position = this.#state.positions[displayId]
    return position ? { ...position } : undefined
  }

  getDisplayId() {
    return this.#state.displayId
  }

  async setPosition(displayId: string, position: { x: number; y: number }, scaleFactor: number) {
    this.#state = {
      ...this.#state,
      displayId,
      positions: { ...this.#state.positions, [displayId]: { ...position, scaleFactor } },
    }
    await this.#persist()
  }

  async select(id: string) {
    const selection = selectionFromId(id)
    const pets = await this.#inventory()
    if (!pets.some((pet) => pet.id === id)) throw new Error("Pet selection is no longer available")
    this.#state = { ...this.#state, selected: selection }
    await this.#persist()
    if (this.#state.awake) await this.#openWindow()
    this.#emitChange()
  }

  async setAwake(awake: boolean) {
    if (awake) {
      const selectedId = selectionId(this.#state.selected)
      if (!selectedId || !(await this.#inventory()).some((pet) => pet.id === selectedId)) {
        throw new Error("Select an available pet before waking it")
      }
      this.#state = { ...this.#state, awake: true }
      await this.#persist()
      await this.#openWindow()
      this.#emitChange()
      return
    }
    await this.#window.close()
    this.#state = { ...this.#state, awake: false }
    await this.#persist()
    this.#emitChange()
  }

  async beforePluginChange(pluginId: string) {
    if (this.#state.selected?.kind !== "plugin" || this.#state.selected.pluginId !== pluginId) return
    await this.#window.close()
  }

  async pluginChanged(pluginId: string) {
    if (this.#state.selected?.kind !== "plugin" || this.#state.selected.pluginId !== pluginId) return
    const selectedId = selectionId(this.#state.selected)
    const available = (await this.#inventory()).some((pet) => pet.id === selectedId)
    if (!available) {
      this.#state = { ...this.#state, awake: false, selected: undefined }
      await this.#persist()
      await this.#window.close()
      this.#emitChange()
      return
    }
    if (this.#state.awake) await this.#openWindow()
    this.#emitChange()
  }

  async importCustom(sourcePath: string) {
    if (!path.isAbsolute(sourcePath)) throw new Error("Custom pet source must be an absolute path")
    const extension = path.extname(sourcePath)
    if (extension !== ".png" && extension !== ".webp") throw new Error("Custom pet must be a PNG or WebP file")
    await this.#ensurePetsRoot()
    const customId = this.#createId()
    if (!customPetIdPattern.test(customId)) throw new Error("Generated custom pet id is invalid")
    const staging = path.join(this.#petsRoot, `.staging-${customId}`)
    const target = path.join(this.#petsRoot, customId)
    const filename = `spritesheet${extension}` as CustomPetMetadata["filename"]
    try {
      await fs.mkdir(staging, { mode: 0o700 })
      const bytes = await this.#readCustomSource(sourcePath)
      const stagedAsset = path.join(staging, filename)
      await fs.writeFile(stagedAsset, bytes, { flag: "wx", mode: 0o600 })
      const inspection = await this.#inspector.inspect(stagedAsset)
      assertValidPetAssetInspection(inspection, extension === ".png" ? "png" : "webp")

      const baseName = path.basename(sourcePath, extension).trim().slice(0, 120) || "Custom pet"
      const metadata: CustomPetMetadata = {
        alt: `${baseName}, a custom pixel companion`,
        description: "A local custom pet imported into Convax.",
        filename,
        id: customId,
        name: baseName,
        schema: customPetSchema,
        spriteVersion: 2,
      }
      await fs.writeFile(path.join(staging, customPetMetadataFile), `${JSON.stringify(metadata, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      })
      try {
        await fs.lstat(target)
        throw new Error("Generated custom pet id already exists")
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      }
      await fs.rename(staging, target)
      this.#emitChange()
      return itemFromCustom(metadata)
    } finally {
      await fs.rm(staging, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  async deleteCustom(id: string) {
    const selection = selectionFromId(id)
    if (selection.kind !== "custom") throw new Error("Only custom pets can be deleted")
    const directory = path.join(this.#petsRoot, selection.id)
    const root = await this.#ensurePetsRoot()
    const realDirectory = await fs.realpath(directory)
    if (!isInside(realDirectory, root) || path.dirname(realDirectory) !== root) {
      throw new Error("Custom pet directory is invalid")
    }
    if (this.#state.selected?.kind === "custom" && this.#state.selected.id === selection.id) {
      await this.#window.close()
      this.#state = { ...this.#state, awake: false, selected: undefined }
      await this.#persist()
    }
    await fs.rm(realDirectory, { recursive: true })
    this.#emitChange()
  }

  async resolveSelectedAsset() {
    const id = selectionId(this.#state.selected)
    if (!id) throw new Error("No pet is selected")
    return this.resolvePetAsset(id)
  }

  async resolvePetAsset(id: string) {
    const selection = selectionFromId(id)
    if (selection.kind === "plugin") {
      const plugin = (await this.#pluginManager.list()).find((candidate) => candidate.id === selection.pluginId)
      const pet = plugin?.contributes.pet
      if (!pet) throw new Error("Pet Plugin is no longer available")
      return this.#pluginManager.resolveAsset(plugin.id, pet.spritesheet)
    }
    const { asset } = await this.#readCustom(selection.id)
    return asset
  }

  async #inventory() {
    const plugins = (await this.#pluginManager.list())
      .map(pluginPet)
      .filter((pet): pet is PetInventoryItem => pet !== null)
    const custom = await this.#listCustom()
    return [...plugins, ...custom].sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )
  }

  async #listCustom() {
    const readEntries = async () => {
      try {
        return await fs.readdir(this.#petsRoot, { encoding: "utf8", withFileTypes: true })
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
        throw error
      }
    }
    const entries = await readEntries()
    const pets: PetInventoryItem[] = []
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        !customPetIdPattern.test(entry.name)
      ) {
        continue
      }
      try {
        const { metadata } = await this.#readCustom(entry.name)
        pets.push(itemFromCustom(metadata))
      } catch {
        // Invalid or externally tampered custom pets are never exposed.
      }
    }
    return pets
  }

  async #readCustom(id: string) {
    if (!customPetIdPattern.test(id)) throw new Error("Custom pet id is invalid")
    const root = await this.#ensurePetsRoot()
    const directory = await fs.realpath(path.join(root, id))
    if (!isInside(directory, root) || path.dirname(directory) !== root) throw new Error("Custom pet path is invalid")
    const directoryStat = await fs.lstat(directory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error("Custom pet path is invalid")
    const metadataPath = path.join(directory, customPetMetadataFile)
    const metadataStat = await fs.lstat(metadataPath)
    if (metadataStat.isSymbolicLink() || !metadataStat.isFile() || metadataStat.size > 16_384) {
      throw new Error("Custom pet metadata is invalid")
    }
    const metadata = customMetadata(JSON.parse(await fs.readFile(metadataPath, "utf8")), id)
    const asset = await fs.realpath(path.join(directory, metadata.filename))
    if (!isInside(asset, directory)) throw new Error("Custom pet asset is invalid")
    const assetStat = await fs.lstat(asset)
    if (assetStat.isSymbolicLink() || !assetStat.isFile()) throw new Error("Custom pet asset is invalid")
    const inspection = await this.#inspector.inspect(asset)
    const expectedFormat: PetAssetInspection["format"] = metadata.filename.endsWith(".png") ? "png" : "webp"
    assertValidPetAssetInspection(inspection, expectedFormat)
    return { asset, metadata }
  }

  async #readCustomSource(sourcePath: string) {
    const noFollow = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    const handle = await fs.open(sourcePath, noFollow)
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

  async #ensurePetsRoot() {
    await fs.mkdir(this.#petsRoot, { mode: 0o700, recursive: true })
    const stat = await fs.lstat(this.#petsRoot)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Custom pet root must be a real directory")
    return fs.realpath(this.#petsRoot)
  }

  async #persist() {
    this.#state = await this.#stateStore.update((current) => ({ ...this.#state, seen: current.seen }))
  }

  #emitChange() {
    for (const listener of this.#listeners) listener()
  }

  async #selectedSnapshot() {
    const selectedId = selectionId(this.#state.selected)
    if (!selectedId) return null
    const pet = (await this.#inventory()).find((candidate) => candidate.id === selectedId)
    return pet ? { activity: this.#activitySnapshot, pet } : null
  }

  async #openWindow() {
    const snapshot = await this.#selectedSnapshot()
    if (!snapshot) throw new Error("Selected pet is no longer available")
    await this.#window.open(snapshot)
  }

  async #updateWindow() {
    if (!this.#initialized || !this.#state.awake) return
    const snapshot = await this.#selectedSnapshot()
    if (!snapshot) {
      await this.#window.close()
      return
    }
    await this.#window.update(snapshot)
  }
}
