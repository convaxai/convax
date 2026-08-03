#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"

const historyRelativePath = "packages/plugin-api/history"
const ledgerFileName = "ledger.json"
const ledgerSchema = "convax.plugin-api-history-ledger/1"
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const sha256Pattern = /^[a-f0-9]{64}$/

interface HistoryReceipt {
  readonly artifactSchema: string
  readonly sha256: string
  readonly version: string
  readonly wireSchemaDialect: string
}

interface HistoryLedger {
  readonly retired: readonly HistoryReceipt[]
  readonly schema: typeof ledgerSchema
}

export interface PluginApiHistoryPolicyInput {
  readonly baseHistory: ReadonlyMap<string, Uint8Array>
  readonly currentHistory: ReadonlyMap<string, Uint8Array>
  readonly currentVersion: string
}

function historyError(message: string): never {
  throw new Error(`Plugin API history policy rejected the change: ${message}`)
}

function json(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error })
  }
}

function ledger(bytes: Uint8Array, label: string): HistoryLedger {
  const value = json(bytes, label)
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.get(value, "schema") !== ledgerSchema ||
    !Array.isArray(Reflect.get(value, "retired"))
  ) {
    historyError(`${label} is not a ${ledgerSchema} document`)
  }
  return value as HistoryLedger
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function assertReceipt(receipt: HistoryReceipt, label: string) {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    typeof receipt.artifactSchema !== "string" ||
    typeof receipt.wireSchemaDialect !== "string" ||
    typeof receipt.version !== "string" ||
    !semverPattern.test(receipt.version) ||
    typeof receipt.sha256 !== "string" ||
    !sha256Pattern.test(receipt.sha256)
  ) {
    historyError(`${label} is invalid`)
  }
}

/**
 * Enforces append-only Plugin API history against an explicit repository base.
 *
 * Existing Catalog receipts are byte-immutable. Existing ledger receipts are
 * an immutable prefix; a major cutover may only append receipts for snapshots
 * that already existed in the base. The only new snapshot may be the package's
 * current version.
 */
export function assertPluginApiHistoryPolicy(input: PluginApiHistoryPolicyInput): void {
  if (!semverPattern.test(input.currentVersion)) historyError("the current package version is invalid")

  for (const [name, baseBytes] of input.baseHistory) {
    if (name === ledgerFileName) continue
    const currentBytes = input.currentHistory.get(name)
    if (!currentBytes) historyError(`existing receipt was deleted: ${name}`)
    if (!Buffer.from(currentBytes).equals(Buffer.from(baseBytes))) {
      historyError(`existing receipt bytes changed: ${name}`)
    }
  }

  const newSnapshots = [...input.currentHistory.keys()].filter(
    (name) => name !== ledgerFileName && !input.baseHistory.has(name),
  )
  const expectedNewSnapshot = `${input.currentVersion}.json`
  if (!input.currentHistory.has(expectedNewSnapshot)) {
    historyError(`the current snapshot is missing: ${expectedNewSnapshot}`)
  }
  if (newSnapshots.some((name) => name !== expectedNewSnapshot) || newSnapshots.length > 1) {
    historyError(`new snapshots must contain only ${expectedNewSnapshot}`)
  }

  const baseLedgerBytes = input.baseHistory.get(ledgerFileName)
  const currentLedgerBytes = input.currentHistory.get(ledgerFileName)
  if (baseLedgerBytes && !currentLedgerBytes) historyError("the existing ledger was deleted")
  if (!currentLedgerBytes) return

  const baseReceipts = baseLedgerBytes ? ledger(baseLedgerBytes, "base history ledger").retired : []
  const currentReceipts = ledger(currentLedgerBytes, "current history ledger").retired
  if (currentReceipts.length < baseReceipts.length) historyError("existing ledger receipts were deleted")
  for (const [index, receipt] of baseReceipts.entries()) {
    if (!isDeepStrictEqual(currentReceipts[index], receipt)) {
      historyError(`existing ledger receipt ${receipt.version} was modified or reordered`)
    }
  }

  const seen = new Set<string>()
  for (const [index, receipt] of currentReceipts.entries()) {
    assertReceipt(receipt, `ledger receipt ${index}`)
    if (seen.has(receipt.version)) historyError(`ledger receipt ${receipt.version} is duplicated`)
    seen.add(receipt.version)
    if (index < baseReceipts.length) continue
    if (receipt.version === input.currentVersion) {
      historyError(`the current version cannot be appended as a retired receipt: ${receipt.version}`)
    }
    const name = `${receipt.version}.json`
    const baseBytes = input.baseHistory.get(name)
    if (!baseBytes) historyError(`appended ledger receipt did not exist in the base: ${receipt.version}`)
    if (receipt.sha256 !== digest(baseBytes)) {
      historyError(`appended ledger receipt digest does not match immutable base bytes: ${receipt.version}`)
    }
  }
}

function git(repositoryRoot: string, args: readonly string[]): Uint8Array {
  const result = Bun.spawnSync(["git", "-C", repositoryRoot, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || `git ${args[0]} failed`)
  }
  return result.stdout
}

async function readCurrentHistory(repositoryRoot: string) {
  const directory = join(repositoryRoot, historyRelativePath)
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort()
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name))] as const)))
}

function readBaseHistory(repositoryRoot: string, base: string) {
  const output = new TextDecoder().decode(
    git(repositoryRoot, ["ls-tree", "-r", "--name-only", base, "--", historyRelativePath]),
  )
  const paths = output
    .split(/\r?\n/)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
  return new Map(paths.map((entry) => [basename(entry), git(repositoryRoot, ["show", `${base}:${entry}`])] as const))
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--base" || !args[1] || /[\u0000\r\n]/.test(args[1])) {
    throw new TypeError("Usage: bun scripts/plugin-api-history-policy.ts --base <git-revision>")
  }
  const repositoryRoot = resolve(import.meta.dir, "..")
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "packages/plugin-api/package.json"), "utf8")) as {
    version?: unknown
  }
  if (typeof packageJson.version !== "string") throw new TypeError("Plugin API package version is missing")
  assertPluginApiHistoryPolicy({
    baseHistory: readBaseHistory(repositoryRoot, args[1]),
    currentHistory: await readCurrentHistory(repositoryRoot),
    currentVersion: packageJson.version,
  })
  process.stdout.write(`Plugin API history is append-only relative to ${args[1]}.\n`)
}

if (import.meta.main) await main()
