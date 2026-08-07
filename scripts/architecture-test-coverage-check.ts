#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "..")

interface CoverageRow {
  invariant: string
  testFile: string
  coverage: string
}

/** Strip leading and trailing backtick marks from a value. */
function stripBackticks(value: string): string {
  let v = value.trim()
  while (v.startsWith("`")) {
    v = v.slice(1)
  }
  while (v.endsWith("`")) {
    v = v.slice(0, -1)
  }
  return v.trim()
}

/** Parse the architecture test coverage matrix markdown into structured rows. */
function parseCoverageMatrix(markdown: string): CoverageRow[] {
  const rows: CoverageRow[] = []
  const lines = markdown.split("\n")
  let inTable = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("| Invariant |") || trimmed.startsWith("| **Invariant** |")) {
      inTable = true
      continue
    }
    if (!inTable) continue
    // Exit table on next section header or horizontal rule after rows
    if (trimmed.startsWith("## ") || trimmed.startsWith("---")) {
      inTable = false
      continue
    }
    if (!trimmed.startsWith("|")) continue
    // Skip table separator rows like |----------|-----------|---------|
    if (/^\|[\s-]+\|[\s-]+\|[\s-]+\|$/.test(trimmed)) continue

    const cells = trimmed
      .split("|")
      .map(stripBackticks)
      .filter(Boolean)
    if (cells.length < 3) continue
    const [invariant, testFile, coverage] = cells
    // Skip header rows inside the table
    if (
      invariant === "Invariant" ||
      invariant === "**Invariant**" ||
      testFile === "Test File" ||
      testFile === "**Test File**"
    ) {
      continue
    }
    rows.push({ invariant, testFile, coverage })
  }
  return rows
}

/**
 * Verify that every test file referenced in the matrix exists on disk.
 * Supports multi-file cells separated by commas or ", ".
 * Skips CI workflow references (non-file entries).
 */
function verifyTestFile(cell: string): { missing: string[]; found: string[] } {
  const missing: string[] = []
  const found: string[] = []
  const paths = cell.split(",").map((p) => p.trim()).filter(Boolean)
  for (const tp of paths) {
    // Skip CI workflow references and other non-file metadata
    if (tp.startsWith("CI workflow:")) {
      found.push(tp)
      continue
    }
    // Strip remaining backtick marks from individual paths
    const cleanPath = stripBackticks(tp)
    const resolvedPath = join(repoRoot, cleanPath)
    if (existsSync(resolvedPath)) {
      found.push(cleanPath)
    } else {
      missing.push(cleanPath)
    }
  }
  return { missing, found }
}

async function main() {
  const matrixPath = join(repoRoot, "docs", "architecture-test-coverage-matrix.md")
  if (!existsSync(matrixPath)) {
    console.error("FAIL: architecture-test-coverage-matrix.md not found at", matrixPath)
    process.exit(1)
  }

  const matrixMd = readFileSync(matrixPath, "utf-8")
  const rows = parseCoverageMatrix(matrixMd)
  if (rows.length === 0) {
    console.error("FAIL: No coverage rows parsed from matrix document")
    process.exit(1)
  }

  let failures = 0

  console.log(`Architecture Test Coverage Check\n${"─".repeat(48)}\nParsed ${rows.length} coverage rows.\n`)

  for (const row of rows) {
    const { missing } = verifyTestFile(row.testFile)

    if (missing.length > 0) {
      console.error(`✗ ${row.testFile}`)
      console.error(`  Invariant: ${row.invariant.slice(0, 90)}${row.invariant.length > 90 ? "…" : ""}`)
      for (const m of missing) {
        console.error(`  Missing: ${m}`)
      }
      failures++
    }
  }

  if (failures > 0) {
    console.error(`\n${"─".repeat(48)}\nFAIL: ${failures} coverage row(s) have missing test files.`)
    process.exit(1)
  }

  console.log(`${"─".repeat(48)}\nPASS: All ${rows.length} coverage rows verified.`)
}

main()
