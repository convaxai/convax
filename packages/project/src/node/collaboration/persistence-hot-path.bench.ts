import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

const samples = Number(process.env.CONVAX_DURABILITY_BENCH_SAMPLES ?? "80")
if (!Number.isSafeInteger(samples) || samples < 10 || samples > 10_000) throw new Error("invalid sample count")
const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-persistence-hot-path-"))
const bytes = new Uint8Array(4 * 1024)

try {
  await run("filehandle-sync", async (directory, index) => {
    await durableAsync(path.join(directory, `${index}-frame.bin`), bytes)
    await durableAsync(path.join(directory, `${index}-operation.bin`), bytes)
  })
  await run("fsync-sync", async (directory, index) => {
    durableSync(path.join(directory, `${index}-frame.bin`), bytes)
    durableSync(path.join(directory, `${index}-operation.bin`), bytes)
  })
  await runWithReusedDirectory("revalidated-directory-handle", async (directory, directoryHandle, identity, index) => {
    await durableAsyncWithDirectoryHandle(
      path.join(directory, `${index}-frame.bin`),
      bytes,
      directory,
      directoryHandle,
      identity,
    )
    await durableAsyncWithDirectoryHandle(
      path.join(directory, `${index}-operation.bin`),
      bytes,
      directory,
      directoryHandle,
      identity,
    )
  })
  await run("parallel-independent-immutable-objects", async (directory, index) => {
    await Promise.all([
      durableAsync(path.join(directory, `${index}-frame.bin`), bytes),
      durableAsync(path.join(directory, `${index}-operation.bin`), bytes),
    ])
  })
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

async function run(name: string, operation: (directory: string, index: number) => Promise<void>): Promise<void> {
  const directory = path.join(root, name)
  await fs.mkdir(directory)
  const timings: number[] = []
  for (let index = 0; index < samples + 5; index += 1) {
    const started = performance.now()
    await operation(directory, index)
    if (index >= 5) timings.push(performance.now() - started)
  }
  emit(name, timings)
}

async function runWithReusedDirectory(
  name: string,
  operation: (directory: string, handle: fs.FileHandle, identity: fsSync.Stats, index: number) => Promise<void>,
): Promise<void> {
  const directory = path.join(root, name)
  await fs.mkdir(directory)
  const identity = await fs.lstat(directory)
  const handle = await fs.open(directory, "r")
  const timings: number[] = []
  try {
    for (let index = 0; index < samples + 5; index += 1) {
      const started = performance.now()
      await operation(directory, handle, identity, index)
      if (index >= 5) timings.push(performance.now() - started)
    }
  } finally {
    await handle.close()
  }
  emit(name, timings)
}

async function durableAsync(target: string, value: Uint8Array): Promise<void> {
  const handle = await fs.open(target, "wx", 0o600)
  try {
    await handle.writeFile(value)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const directory = await fs.open(path.dirname(target), "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

function durableSync(target: string, value: Uint8Array): void {
  const descriptor = fsSync.openSync(
    target,
    fsSync.constants.O_WRONLY | fsSync.constants.O_CREAT | fsSync.constants.O_EXCL,
    0o600,
  )
  try {
    fsSync.writeFileSync(descriptor, value)
    fsSync.fsyncSync(descriptor)
  } finally {
    fsSync.closeSync(descriptor)
  }
  const directory = fsSync.openSync(path.dirname(target), "r")
  try {
    fsSync.fsyncSync(directory)
  } finally {
    fsSync.closeSync(directory)
  }
}

async function durableAsyncWithDirectoryHandle(
  target: string,
  value: Uint8Array,
  directoryPath: string,
  directoryHandle: fs.FileHandle,
  expected: fsSync.Stats,
): Promise<void> {
  const [opened, current] = await Promise.all([directoryHandle.stat(), fs.lstat(directoryPath)])
  if (
    opened.dev !== expected.dev ||
    opened.ino !== expected.ino ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw new Error("reused directory identity changed")
  }
  const handle = await fs.open(target, "wx", 0o600)
  try {
    await handle.writeFile(value)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await directoryHandle.sync()
}

function emit(candidate: string, values: number[]): void {
  const sorted = [...values].sort((left, right) => left - right)
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
  process.stdout.write(
    `${JSON.stringify({
      format: "convax.persistence-hot-path-benchmark/1",
      candidate,
      samples: values.length,
      latencyMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) },
    })}\n`,
  )
}
