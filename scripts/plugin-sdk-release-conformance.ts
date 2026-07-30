import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
  PLUGIN_SDK_CHECK_RESULTS_SCHEMA,
  PLUGIN_SDK_RELEASE_PROFILE,
  pluginSdkReleaseCheckDefinitions,
} from "./plugin-sdk-release-evidence"

function fail(message: string): never {
  throw new TypeError(`Plugin SDK release conformance: ${message}`)
}

function outputArgument(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]) {
    fail("expected exactly --output <path>")
  }
  return resolve(argv[1])
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dir, "..")
  const output = outputArgument(process.argv.slice(2))
  for (const check of pluginSdkReleaseCheckDefinitions) {
    process.stdout.write(`\n[plugin-sdk conformance] ${check.id}: ${check.command}\n`)
    const child = Bun.spawn({
      cmd: [process.execPath, ...check.argv],
      cwd: repositoryRoot,
      env: process.env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    })
    const exitCode = await child.exited
    if (exitCode !== 0) fail(`${check.id} failed with exit code ${exitCode}`)
  }
  const result = {
    schema: PLUGIN_SDK_CHECK_RESULTS_SCHEMA,
    profile: PLUGIN_SDK_RELEASE_PROFILE,
    checks: pluginSdkReleaseCheckDefinitions.map(({ id }) => ({
      id,
      status: "passed",
    })),
  }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" })
}

if (import.meta.main) {
  await main()
}
