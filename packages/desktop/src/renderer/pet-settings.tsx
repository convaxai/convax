import { Button } from "@convax/ui"
import { Check, Download, PawPrint, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import type { PetInventoryItem, PetInventorySnapshot, PetSettingsClient } from "../pet-contracts"
import { appMessage, type AppLocale } from "./app-language"

export async function selectPet(client: PetSettingsClient, id: string) {
  await client.select({ id })
}

export async function setPetAwake(client: PetSettingsClient, awake: boolean) {
  await client.setAwake({ awake })
}

export async function importCustomPet(client: PetSettingsClient) {
  try {
    const pet = await client.importCustom()
    return pet ? ({ pet, status: "imported" } as const) : ({ status: "cancelled" } as const)
  } catch {
    return { status: "error" } as const
  }
}

export async function deleteCustomPet(client: PetSettingsClient, id: string, confirmed: boolean) {
  if (!confirmed) return false
  await client.deleteCustom({ id })
  return true
}

interface PetSettingsContentProps {
  busy?: boolean
  confirmDelete?: PetInventoryItem
  error?: string
  inventory: PetInventorySnapshot
  locale: AppLocale
  onCancelDelete?(): void
  onConfirmDelete?(id: string): void
  onImport(): void
  onRequestDelete?(pet: PetInventoryItem): void
  onSelect(id: string): void
  onSetAwake(awake: boolean): void
}

export function PetSettingsContent({
  busy = false,
  confirmDelete,
  error,
  inventory,
  locale,
  onCancelDelete = () => undefined,
  onConfirmDelete = () => undefined,
  onImport,
  onRequestDelete = () => undefined,
  onSelect,
  onSetAwake,
}: PetSettingsContentProps) {
  const selected = inventory.pets.find((pet) => pet.id === inventory.selectedId)
  return (
    <section aria-label={appMessage(locale, "pets.title")} className="space-y-5">
      <div className="flex items-center justify-between gap-6 rounded-xl border border-border bg-card px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{appMessage(locale, "pets.desktopCompanion")}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{appMessage(locale, "pets.description")}</p>
        </div>
        <Button disabled={busy || (!inventory.awake && !selected)} onClick={() => onSetAwake(!inventory.awake)}>
          <PawPrint />
          {appMessage(locale, inventory.awake ? "pets.tuck" : "pets.wake")}
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-end justify-between gap-5">
        <div>
          <h3 className="text-sm font-medium">{appMessage(locale, "pets.collection")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{appMessage(locale, "pets.collectionDescription")}</p>
        </div>
        <Button disabled={busy} onClick={onImport} size="sm" variant="outline">
          <Download />
          {appMessage(locale, "pets.import")}
        </Button>
      </div>

      {inventory.pets.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {inventory.pets.map((pet) => {
            const isSelected = pet.id === inventory.selectedId
            return (
              <article
                className={`relative rounded-xl border bg-card p-4 transition-colors ${
                  isSelected ? "border-primary/60 ring-2 ring-primary/10" : "border-border hover:border-primary/30"
                }`}
                key={pet.id}
              >
                <button
                  aria-pressed={isSelected}
                  className="block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  disabled={busy}
                  onClick={() => onSelect(pet.id)}
                  type="button"
                >
                  <span className="grid h-36 place-items-center rounded-lg bg-muted/35">
                    <span
                      aria-label={pet.alt}
                      className="block h-[104px] w-24 bg-no-repeat [background-size:800%_900%] [image-rendering:pixelated]"
                      role="img"
                      style={{ backgroundImage: `url("${pet.assetUrl.replaceAll('"', "%22")}")` }}
                    />
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-2">
                    <strong className="truncate text-sm font-medium">{pet.name}</strong>
                    {isSelected ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                        <Check className="size-3" /> {appMessage(locale, "pets.selected")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{pet.description}</span>
                </button>
                {pet.source === "custom" ? (
                  <Button
                    aria-label={appMessage(locale, "pets.deleteNamed", { name: pet.name })}
                    className="absolute right-2 top-2"
                    disabled={busy}
                    onClick={() => onRequestDelete(pet)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
          <div>
            <PawPrint className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{appMessage(locale, "pets.empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{appMessage(locale, "pets.emptyDescription")}</p>
          </div>
        </div>
      )}

      {confirmDelete ? (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-foreground/20 p-5 backdrop-blur-[2px]">
          <div aria-modal="true" className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 shadow-2xl" role="dialog">
            <h2 className="text-sm font-semibold">{appMessage(locale, "pets.deleteTitle")}</h2>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {appMessage(locale, "pets.deleteDescription", { name: confirmDelete.name })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button disabled={busy} onClick={onCancelDelete} size="sm" variant="ghost">
                {appMessage(locale, "pets.cancel")}
              </Button>
              <Button disabled={busy} onClick={() => onConfirmDelete(confirmDelete.id)} size="sm" variant="destructive">
                {appMessage(locale, "pets.delete")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function PetSettingsSurface({ client, locale }: { client: PetSettingsClient; locale: AppLocale }) {
  const [inventory, setInventory] = useState<PetInventorySnapshot>({ awake: false, pets: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState<PetInventoryItem>()
  const refresh = useCallback(async () => setInventory(await client.list()), [client])

  useEffect(() => {
    void refresh().catch(() => setError(appMessage(locale, "pets.loadFailed")))
    return client.onDidChange(() => void refresh().catch(() => setError(appMessage(locale, "pets.loadFailed"))))
  }, [client, locale, refresh])

  const mutate = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await operation()
      await refresh()
    } catch {
      setError(appMessage(locale, "pets.actionFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PetSettingsContent
      busy={busy}
      confirmDelete={confirmDelete}
      error={error}
      inventory={inventory}
      locale={locale}
      onCancelDelete={() => setConfirmDelete(undefined)}
      onConfirmDelete={(id) =>
        void mutate(async () => {
          await deleteCustomPet(client, id, true)
          setConfirmDelete(undefined)
        })
      }
      onImport={() => {
        void mutate(async () => {
          const result = await importCustomPet(client)
          if (result.status === "error") throw new Error("Custom pet import failed")
          if (result.status === "imported") await selectPet(client, result.pet.id)
        })
      }}
      onRequestDelete={setConfirmDelete}
      onSelect={(id) => void mutate(() => selectPet(client, id))}
      onSetAwake={(awake) => void mutate(() => setPetAwake(client, awake))}
    />
  )
}
