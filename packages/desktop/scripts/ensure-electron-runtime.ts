import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const electronPackageRoot = path.dirname(require.resolve("electron/package.json"))

interface CommandResult {
  readonly exitCode: number
}

type RunCommand = (command: readonly string[], output: "ignore" | "inherit") => Promise<CommandResult>

export async function resolveInstalledBinary() {
  const relativeBinary = await fs
    .readFile(path.join(electronPackageRoot, "path.txt"), "utf8")
    .then((value) => value.trim())
    .catch(() => "")
  if (!relativeBinary) return null
  const binary = path.join(electronPackageRoot, "dist", relativeBinary)
  return fs.access(binary).then(
    () => binary,
    () => null,
  )
}

export function resolveMacElectronApplication(binary: string): string {
  const executableDirectory = path.dirname(binary)
  if (
    path.basename(executableDirectory) !== "MacOS" ||
    path.basename(path.dirname(executableDirectory)) !== "Contents"
  ) {
    throw new Error("Electron macOS executable is outside an application bundle")
  }
  const application = path.dirname(path.dirname(executableDirectory))
  if (!application.endsWith(".app")) throw new Error("Electron macOS application bundle is invalid")
  return application
}

/**
 * Electron's downloaded macOS bundle can carry only a linker signature, which does
 * not seal its resources. Keychain then cannot persist its Safe Storage trust and
 * may ask for the login password on every Project open. A complete deterministic
 * ad-hoc signature gives development builds one reusable code identity without
 * weakening the OS-backed vault or changing release signing.
 */
export async function ensureMacElectronDevelopmentSignature(input: {
  readonly binary: string
  readonly platform: NodeJS.Platform
  readonly run?: RunCommand
}): Promise<"not-required" | "already-valid" | "signed"> {
  if (input.platform !== "darwin") return "not-required"
  const application = resolveMacElectronApplication(input.binary)
  const run = input.run ?? runCommand
  const verify = ["/usr/bin/codesign", "--verify", "--deep", "--strict", application] as const
  if ((await run(verify, "ignore")).exitCode === 0) return "already-valid"

  const sign = await run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", application], "inherit")
  if (sign.exitCode !== 0) throw new Error(`Electron development signing failed with exit code ${sign.exitCode}`)
  const verified = await run(verify, "inherit")
  if (verified.exitCode !== 0) {
    throw new Error(`Electron development signature verification failed with exit code ${verified.exitCode}`)
  }
  console.log("Electron development signature repaired")
  return "signed"
}

export async function prepareElectronRuntime(): Promise<void> {
  let binary = await resolveInstalledBinary()
  if (!binary) {
    const installer = path.join(electronPackageRoot, "install.js")
    await fs.access(installer).catch(() => {
      throw new Error("Electron dependency is missing; run `bun install`")
    })
    const install = Bun.spawn([process.execPath, installer], {
      cwd: electronPackageRoot,
      stderr: "inherit",
      stdout: "inherit",
    })
    const exitCode = await install.exited
    binary = await resolveInstalledBinary()
    if (exitCode !== 0 || !binary) {
      throw new Error(`Electron runtime installation failed with exit code ${exitCode}`)
    }
    console.log("Electron runtime restored")
  }
  await ensureMacElectronDevelopmentSignature({ binary, platform: process.platform })
}

async function runCommand(command: readonly string[], output: "ignore" | "inherit"): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    stderr: output,
    stdout: output,
  })
  return Object.freeze({ exitCode: await child.exited })
}

if (import.meta.main) {
  await prepareElectronRuntime()
}
