import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

type WorkflowJob = {
  readonly environment?: string
  readonly needs?: string
  readonly permissions?: Record<string, string>
  readonly steps?: readonly {
    readonly run?: string
    readonly uses?: string
    readonly with?: Record<string, unknown>
    readonly ["working-directory"]?: string
  }[]
}

type Workflow = {
  readonly jobs?: Record<string, WorkflowJob>
  readonly on?: {
    readonly workflow_dispatch?: {
      readonly inputs?: Record<string, unknown>
    }
  }
  readonly permissions?: Record<string, string>
}

const repositoryRoot = resolve(import.meta.dir, "..")
const policies = [
  {
    path: ".github/workflows/plugin-sdk-bootstrap.yml",
    privilegedJob: "attest",
    needs: "build",
    environment: "plugin-sdk-bootstrap",
    permissions: { attestations: "write", contents: "read", "id-token": "write" },
  },
  {
    path: ".github/workflows/plugin-sdk-npm-stage.yml",
    privilegedJob: "stage",
    needs: "build",
    environment: "plugin-sdk-npm-stage",
    permissions: { attestations: "write", contents: "read", "id-token": "write" },
  },
  {
    path: ".github/workflows/plugin-sdk-release.yml",
    privilegedJob: "publish",
    needs: "verify",
    environment: "plugin-sdk-release",
    permissions: { attestations: "write", contents: "write", "id-token": "write" },
  },
] as const

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isWorkflow(value: unknown): value is Workflow {
  return isRecord(value) && isRecord(value.jobs) && Object.values(value.jobs).every(isRecord)
}

function exactObject(actual: Record<string, string> | undefined, expected: Record<string, string>): void {
  expect(actual).toEqual(expected)
}

describe("Plugin SDK publication workflow privilege boundary", () => {
  for (const policy of policies) {
    test(`${policy.path} keeps the privileged job artifact-only`, async () => {
      const source = await readFile(resolve(repositoryRoot, policy.path), "utf8")
      const parsed: unknown = Bun.YAML.parse(source)
      expect(isWorkflow(parsed)).toBe(true)
      if (!isWorkflow(parsed)) throw new TypeError(`${policy.path} is not one workflow object`)
      const workflow = parsed
      expect(workflow.permissions).toEqual({ contents: "read" })
      expect(workflow.on?.workflow_dispatch).toBeDefined()
      expect(workflow.on?.workflow_dispatch?.inputs).not.toHaveProperty("commit")

      const job = workflow.jobs?.[policy.privilegedJob]
      const unprivilegedJob = workflow.jobs?.[policy.needs]
      expect(job).toBeDefined()
      expect(unprivilegedJob).toBeDefined()
      expect(unprivilegedJob?.permissions).toBeUndefined()
      expect(job?.needs).toBe(policy.needs)
      expect(job?.environment).toBe(policy.environment)
      exactObject(job?.permissions, policy.permissions)

      for (const candidateJob of Object.values(workflow.jobs ?? {})) {
        for (const step of candidateJob.steps ?? []) {
          if (!step.uses) continue
          expect(step.uses).toMatch(/^[^@\s]+@[a-f0-9]{40}$/u)
          if (step.uses.startsWith("actions/checkout@")) {
            expect(candidateJob).toBe(unprivilegedJob)
            expect(step.with?.["persist-credentials"]).toBe(false)
          }
        }
      }

      const steps = job?.steps ?? []
      expect(steps.length).toBeGreaterThan(0)
      const attestationStep = steps.find((step) => step.uses?.startsWith("actions/attest@"))
      expect(attestationStep).toBeDefined()
      expect(attestationStep?.with?.["create-storage-record"]).toBe(false)
      const privilegedShell = steps
        .map((step) => step.run ?? "")
        .filter(Boolean)
        .join("\n")
      expect(privilegedShell).toContain("tar -xOzf")
      expect(privilegedShell).toContain("package/package.json")
      expect(privilegedShell).toContain("sha256sum")
      expect(privilegedShell).toContain("openssl dgst -sha512")
      expect(privilegedShell).toContain(
        'keys == ["checks", "dependencies", "host", "package", "profile", "schema", "workflow"]',
      )
      for (const step of steps) {
        expect(step["working-directory"]).toBeUndefined()
        if (step.uses) {
          expect(step.uses).not.toContain("actions/checkout")
        }
        if (step.run) {
          expect(step.run).not.toMatch(
            /(?:^|[\n;&|`]|\$\()\s*(?:bash|bun|deno|git|node|perl|python[0-9.]*|ruby|sh|source|zsh)\b/u,
          )
          expect(step.run).not.toMatch(/(?:^|[\s"'`])(?:\.\.?\/|packages\/|scripts\/)/u)
          expect(step.run).not.toMatch(/\bnpm\s+(?:exec|pack|run|test)\b/u)
        }
      }
    })
  }
})
