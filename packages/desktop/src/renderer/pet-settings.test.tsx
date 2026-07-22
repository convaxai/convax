import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { PetInventorySnapshot, PetSettingsClient } from "../pet-contracts"
import {
  deleteCustomPet,
  importCustomPet,
  PetSettingsContent,
  selectPet,
  setPetAwake,
} from "./pet-settings"

const inventory: PetInventorySnapshot = {
  awake: false,
  pets: [
    {
      alt: "Violet, the Convax pixel companion",
      assetUrl: "convax-pet-asset://pet/plugin%3Aconvax-pet-violet",
      description: "A calm companion that reflects Agent activity.",
      id: "plugin:convax-pet-violet",
      name: "Violet",
      source: "plugin",
      spriteVersion: 2,
    },
    {
      alt: "Mochi, a custom pet",
      assetUrl: "convax-pet-asset://pet/custom%3Amochi",
      description: "A local custom pet.",
      id: "custom:mochi",
      name: "Mochi",
      source: "custom",
      spriteVersion: 2,
    },
  ],
  selectedId: "plugin:convax-pet-violet",
}

function client(overrides: Partial<PetSettingsClient> = {}): PetSettingsClient {
  return {
    deleteCustom: mock(async () => undefined),
    importCustom: mock(async () => null),
    list: mock(async () => inventory),
    markDisplayed: mock(async () => undefined),
    onDidChange: mock(() => () => undefined),
    onNavigate: mock(() => () => undefined),
    select: mock(async () => undefined),
    setAwake: mock(async () => undefined),
    ...overrides,
  }
}

describe("PetSettingsContent", () => {
  test("renders safe pet metadata and explicit wake controls", () => {
    const markup = renderToStaticMarkup(
      <PetSettingsContent
        inventory={inventory}
        locale="en"
        onImport={() => undefined}
        onRequestDelete={() => undefined}
        onSelect={() => undefined}
        onSetAwake={() => undefined}
      />,
    )
    expect(markup).toContain("Violet")
    expect(markup).toContain("Wake pet")
    expect(markup).toContain("Mochi")
    expect(markup).not.toContain("/Users/")
  })
})

describe("pet preference actions", () => {
  test("selects without implicitly waking and wakes only on an explicit action", async () => {
    const value = client()
    await selectPet(value, "plugin:convax-pet-violet")
    expect(value.select).toHaveBeenCalledWith({ id: "plugin:convax-pet-violet" })
    expect(value.setAwake).not.toHaveBeenCalled()
    await setPetAwake(value, true)
    expect(value.setAwake).toHaveBeenCalledWith({ awake: true })
  })

  test("preserves cancellation and hides invalid import implementation details", async () => {
    const cancelled = client()
    expect(await importCustomPet(cancelled)).toEqual({ status: "cancelled" })

    const invalid = client({ importCustom: mock(async () => Promise.reject(new Error("/Users/me/invalid.webp"))) })
    expect(await importCustomPet(invalid)).toEqual({ status: "error" })
  })

  test("requires confirmation before deleting a custom pet", async () => {
    const value = client()
    expect(await deleteCustomPet(value, "custom:mochi", false)).toBe(false)
    expect(value.deleteCustom).not.toHaveBeenCalled()
    expect(await deleteCustomPet(value, "custom:mochi", true)).toBe(true)
    expect(value.deleteCustom).toHaveBeenCalledWith({ id: "custom:mochi" })
  })
})
