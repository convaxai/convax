import {
  completedBunTestFailureCount,
  normalizeDesktopTestPath,
  parseDesktopTestShard,
  selectDesktopTestShard,
} from "./desktop-test-shard"

const isolatedTests = [
  "electron.vite.config.test.ts",
  "src/main/canvas-external-media-drag-ipc.test.ts",
  "src/main/electron-plugin-service-browser-authorization.test.ts",
  "src/main/main-window-controls-ipc.test.ts",
  "src/main/plugin-capability-ipc.test.ts",
  "src/main/stdio-mcp-client.test.ts",
  "src/main/workspace-system-status-ipc.test.ts",
  "src/renderer/canvas-card-conversation-panel-interaction.test.tsx",
  "src/renderer/pet-settings-host.test.tsx",
] as const

async function runTests(files: readonly string[]) {
  if (process.platform !== "win32") {
    const child = Bun.spawn({
      cmd: [Bun.argv[0]!, "test", "--isolate", ...files],
      cwd: import.meta.dir + "/..",
      stderr: "inherit",
      stdout: "inherit",
    })
    return child.exited
  }

  const child = Bun.spawn({
    cmd: [Bun.argv[0]!, "test", "--isolate", ...files],
    cwd: import.meta.dir + "/..",
    stderr: "pipe",
    stdout: "pipe",
  })
  let recentOutput = ""
  let completionResolved = false
  let resolveCompletion!: (failures: number) => void
  const completion = new Promise<number>((resolve) => {
    resolveCompletion = resolve
  })
  const inspect = (text: string) => {
    recentOutput = `${recentOutput}${text}`.slice(-32 * 1024)
    const failures = completedBunTestFailureCount(recentOutput)
    if (failures === undefined || completionResolved) return
    completionResolved = true
    resolveCompletion(failures)
  }
  const forwarders = [
    forwardTestOutput(child.stdout, process.stdout, inspect),
    forwardTestOutput(child.stderr, process.stderr, inspect),
  ]
  const exited = child.exited.then((exitCode) => ({ kind: "exit" as const, exitCode }))
  const completed = completion.then((failures) => ({ kind: "completed" as const, failures }))
  const first = await Promise.race([exited, completed])
  if (first.kind === "exit") {
    await Promise.allSettled(forwarders)
    return first.exitCode
  }

  const naturalExit = await Promise.race([exited, Bun.sleep(2_000).then(() => undefined)])
  if (naturalExit !== undefined) {
    await Promise.allSettled(forwarders)
    return naturalExit.exitCode
  }

  console.warn("Bun completed the Windows test run but retained a live platform handle; terminating the completed runner")
  child.kill()
  const terminated = await Promise.race([child.exited, Bun.sleep(2_000).then(() => undefined)])
  if (terminated === undefined) child.kill(9)
  await child.exited
  await Promise.allSettled(forwarders)
  return first.failures === 0 ? 0 : 1
}

async function forwardTestOutput(
  stream: ReadableStream<Uint8Array>,
  destination: NodeJS.WriteStream,
  inspect: (text: string) => void,
) {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  while (true) {
    const read = await reader.read()
    if (read.done) break
    destination.write(read.value)
    inspect(decoder.decode(read.value, { stream: true }))
  }
  inspect(decoder.decode())
}

const isolatedSet = new Set<string>(isolatedTests)
const regularTests: string[] = []
const testFiles = new Bun.Glob("**/*.test.{ts,tsx}")
for await (const file of testFiles.scan({ cwd: import.meta.dir + "/..", onlyFiles: true })) {
  const normalizedFile = normalizeDesktopTestPath(file)
  if (!isolatedSet.has(normalizedFile)) regularTests.push(normalizedFile)
}
regularTests.sort()

const shard = parseDesktopTestShard(Bun.env.CONVAX_DESKTOP_TEST_SHARD)
const shardedRegularTests = selectDesktopTestShard(regularTests, shard)
const shardedIsolatedTests = selectDesktopTestShard(isolatedTests, shard)
console.log(
  `Running Desktop test shard ${shard.index}/${shard.total}: ${shardedRegularTests.length} regular and ${shardedIsolatedTests.length} isolated files`,
)

let exitCode = shardedRegularTests.length === 0 ? 0 : await runTests(shardedRegularTests)
if (exitCode === 0) {
  for (const file of shardedIsolatedTests) {
    exitCode = await runTests([file])
    if (exitCode !== 0) break
  }
}

process.exit(exitCode)
