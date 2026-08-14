import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  assertAutomaticPreinstalledAuthorization,
  assertAutomaticPreinstalledCapability,
  assertLocalMarketplaceIdentity,
  assertMarketplaceSmokeSnapshot,
  assertNoLegacyDefaultCapabilityReceipt,
  packagedStartupStageReached,
} from "./desktop-packaged-smoke-marketplace"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("packaged smoke automatic preinstall assertions", () => {
  test("distinguishes successful and failed background provisioning markers", () => {
    expect(packagedStartupStageReached("2026-08-14T00:00:00.000Z window-created\n", "marketplace-provisioned")).toBe(
      false,
    )
    expect(
      packagedStartupStageReached(
        "2026-08-14T00:00:00.000Z window-created\n2026-08-14T00:00:01.000Z marketplace-provisioned\n",
        "marketplace-provisioned",
      ),
    ).toBe(true)
    expect(() =>
      packagedStartupStageReached(
        "2026-08-14T00:00:01.000Z marketplace-provision-failed AggregateError\n",
        "marketplace-provisioned",
      ),
    ).toThrow("provisioning failed")
  })

  test("requires the InstalledCapability projection to be ready", () => {
    expect(() =>
      assertAutomaticPreinstalledCapability(
        {
          id: "ffmpeg-tools",
          kind: "plugin",
          sourceLabel: "convax-official",
          state: "ready",
          version: "0.3.1",
        },
        { id: "ffmpeg-tools", version: "0.3.1" },
      ),
    ).not.toThrow()
    expect(() =>
      assertAutomaticPreinstalledCapability(
        {
          id: "ffmpeg-tools",
          kind: "plugin",
          sourceLabel: "convax-official",
          state: "setup-required",
          version: "0.3.1",
        },
        { id: "ffmpeg-tools", version: "0.3.1" },
      ),
    ).toThrow("must be ready")
    expect(() =>
      assertAutomaticPreinstalledCapability(
        {
          id: "ffmpeg-tools",
          kind: "plugin",
          sourceLabel: "another-source",
          state: "ready",
          version: "0.3.1",
        },
        { id: "ffmpeg-tools", version: "0.3.1" },
      ),
    ).toThrow("must be ready")
  })

  test("requires the immutable Plugin authorization digest in its exact ExecutionGrant", async () => {
    const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-preinstall-smoke-"))
    roots.push(userDataRoot)
    const authorizationContractDigest = "a".repeat(64)
    const sourceKey = "b".repeat(64)
    const artifactDigest = "c".repeat(64)
    await fs.mkdir(path.join(userDataRoot, "marketplaces"), { recursive: true })
    await fs.writeFile(
      path.join(userDataRoot, "marketplaces", "state-v1.json"),
      JSON.stringify({
        executionGrants: [
          {
            authorizationContractDigest,
            identity: { id: "ffmpeg-tools", kind: "plugin" },
            revision: 1,
            sourceKey,
          },
        ],
        installations: [
          {
            artifactDigest,
            id: "ffmpeg-tools",
            kind: "plugin",
            sourceKey,
            version: "0.3.1",
          },
        ],
        schema: "convax.marketplace-state/1",
      }),
    )
    await expect(
      assertAutomaticPreinstalledAuthorization(userDataRoot, {
        artifactDigest,
        authorizationContractDigest,
        id: "ffmpeg-tools",
        sourceKey,
        version: "0.3.1",
      }),
    ).resolves.toBeUndefined()
    await expect(
      assertAutomaticPreinstalledAuthorization(userDataRoot, {
        artifactDigest: "d".repeat(64),
        authorizationContractDigest,
        id: "ffmpeg-tools",
        sourceKey,
        version: "0.3.1",
      }),
    ).rejects.toThrow("installation is missing")
    await expect(
      assertAutomaticPreinstalledAuthorization(userDataRoot, {
        artifactDigest,
        authorizationContractDigest,
        id: "ffmpeg-tools",
        sourceKey: "e".repeat(64),
        version: "0.3.1",
      }),
    ).rejects.toThrow("installation is missing")
    await fs.writeFile(
      path.join(userDataRoot, "marketplaces", "state-v1.json"),
      JSON.stringify({
        executionGrants: [],
        installations: [{ artifactDigest, id: "ffmpeg-tools", kind: "plugin", sourceKey, version: "0.3.1" }],
        schema: "convax.marketplace-state/1",
      }),
    )
    await expect(
      assertAutomaticPreinstalledAuthorization(userDataRoot, {
        artifactDigest,
        authorizationContractDigest,
        id: "ffmpeg-tools",
        sourceKey,
        version: "0.3.1",
      }),
    ).rejects.toThrow("ExecutionGrant")
  })

  test("does not recreate the legacy default capability receipt", async () => {
    const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-default-receipt-smoke-"))
    roots.push(userDataRoot)
    await expect(assertNoLegacyDefaultCapabilityReceipt(userDataRoot)).resolves.toBeUndefined()
    await fs.writeFile(path.join(userDataRoot, "default-capabilities.json"), "{}")
    await expect(assertNoLegacyDefaultCapabilityReceipt(userDataRoot)).rejects.toThrow("legacy default capability")
  })

  test("validates source-locked Builtin storyboard and Official automatic preinstall without exposing internal sources", () => {
    expect(() =>
      assertMarketplaceSmokeSnapshot(
        {
          catalogCard: { id: "canvas-storyboard", kind: "skill" },
          ffmpegInstalled: {
            id: "ffmpeg-tools",
            kind: "plugin",
            sourceLabel: "convax-official",
            state: "ready",
            version: "0.3.1",
          },
          marketplaceSurfaceVisible: true,
          settingsSources: [{ id: "convax-official", removable: false }],
          storyboardSources: ["convax-builtin"],
          storyboardChoice: { marketplaceLabel: "convax-builtin", setup: "none", version: "1.0.0" },
          storyboardInstalled: {
            id: "canvas-storyboard",
            kind: "skill",
            sourceLabel: "convax-builtin",
            state: "ready",
            version: "1.0.0",
          },
        },
        { id: "ffmpeg-tools", version: "0.3.1" },
      ),
    ).not.toThrow()
    expect(() =>
      assertMarketplaceSmokeSnapshot(
        {
          catalogCard: { id: "canvas-storyboard", kind: "skill" },
          ffmpegInstalled: {
            id: "ffmpeg-tools",
            kind: "plugin",
            sourceLabel: "convax-official",
            state: "ready",
            version: "0.3.1",
          },
          marketplaceSurfaceVisible: true,
          settingsSources: [
            { id: "convax-official", removable: false },
            { id: "convax-local", removable: false },
          ],
          storyboardSources: ["convax-builtin"],
          storyboardChoice: { marketplaceLabel: "convax-builtin", setup: "none", version: "1.0.0" },
          storyboardInstalled: {
            id: "canvas-storyboard",
            kind: "skill",
            sourceLabel: "convax-builtin",
            state: "ready",
            version: "1.0.0",
          },
        },
        { id: "ffmpeg-tools", version: "0.3.1" },
      ),
    ).toThrow("internal source")
    expect(() =>
      assertMarketplaceSmokeSnapshot(
        {
          catalogCard: { id: "canvas-storyboard", kind: "skill" },
          ffmpegInstalled: {
            id: "ffmpeg-tools",
            kind: "plugin",
            sourceLabel: "convax-official",
            state: "ready",
            version: "0.3.1",
          },
          marketplaceSurfaceVisible: true,
          settingsSources: [{ id: "convax-official", removable: false }],
          storyboardSources: ["convax-builtin", "convax-official"],
          storyboardChoice: { marketplaceLabel: "convax-builtin", setup: "none", version: "1.0.0" },
          storyboardInstalled: {
            id: "canvas-storyboard",
            kind: "skill",
            sourceLabel: "convax-builtin",
            state: "ready",
            version: "1.0.0",
          },
        },
        { id: "ffmpeg-tools", version: "0.3.1" },
      ),
    ).toThrow("source-locked")
  })

  test("requires target-specific automatic preinstalls to stay absent on unsupported targets", () => {
    const snapshot = {
      catalogCard: { id: "canvas-storyboard", kind: "skill" },
      marketplaceSurfaceVisible: true,
      settingsSources: [{ id: "convax-official", removable: false }],
      storyboardSources: ["convax-builtin"],
      storyboardChoice: { marketplaceLabel: "convax-builtin", setup: "none", version: "1.0.0" },
      storyboardInstalled: {
        id: "canvas-storyboard",
        kind: "skill",
        sourceLabel: "convax-builtin",
        state: "ready",
        version: "1.0.0",
      },
    }
    expect(() => assertMarketplaceSmokeSnapshot(snapshot)).not.toThrow()
    expect(() =>
      assertMarketplaceSmokeSnapshot({
        ...snapshot,
        ffmpegInstalled: {
          id: "ffmpeg-tools",
          kind: "plugin",
          sourceLabel: "convax-official",
          state: "ready",
          version: "0.3.1",
        },
      }),
    ).toThrow("unsupported target")
  })

  test("keeps Marketplace IPC assertions when Project authority storage blocks the workspace UI", () => {
    const snapshot = {
      catalogCard: { id: "canvas-storyboard", kind: "skill" },
      marketplaceSurfaceVisible: false,
      settingsSources: [{ id: "convax-official", removable: false }],
      storyboardSources: ["convax-builtin"],
      storyboardChoice: { marketplaceLabel: "convax-builtin", setup: "none", version: "1.0.0" },
      storyboardInstalled: {
        id: "canvas-storyboard",
        kind: "skill",
        sourceLabel: "convax-builtin",
        state: "ready",
        version: "1.0.0",
      },
    }
    expect(() =>
      assertMarketplaceSmokeSnapshot(snapshot, undefined, { marketplaceSurfaceRequired: false }),
    ).not.toThrow()
    expect(() => assertMarketplaceSmokeSnapshot(snapshot)).toThrow("did not expose")
  })

  test("validates the transparent Local source identity from userData", async () => {
    const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-local-smoke-"))
    roots.push(userDataRoot)
    const localRoot = path.join(userDataRoot, "marketplaces", "local", "primary")
    await fs.mkdir(localRoot, { recursive: true })
    await fs.writeFile(
      path.join(localRoot, "marketplace.json"),
      JSON.stringify({
        marketplaceId: "convax-local",
        policyVersion: 1,
        sourceInstanceId: "00000000-0000-4000-8000-000000000001",
      }),
    )
    await expect(assertLocalMarketplaceIdentity(userDataRoot)).resolves.toMatchObject({
      marketplaceId: "convax-local",
      policyVersion: 1,
    })
    await fs.writeFile(
      path.join(localRoot, "marketplace.json"),
      JSON.stringify({ marketplaceId: "convax-local", policyVersion: 1, sourceInstanceId: "not-a-uuid" }),
    )
    await expect(assertLocalMarketplaceIdentity(userDataRoot)).rejects.toThrow("invalid")
  })
})
