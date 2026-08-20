import { chmod, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, test } from "bun:test"

import { openPackagedSmokeExternalAuthorization } from "./packaged-smoke-external-authorization"

const directories: string[] = []
const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) return resolve()
          server.close(() => resolve())
        }),
    ),
  )
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

test("sends one bounded authorization URL through the exact packaged smoke userData socket", async () => {
  const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "convax-packaged-smoke-auth-"))
  directories.push(userDataDirectory)
  const socketPath = path.join(userDataDirectory, "auth.sock")
  const requests: unknown[] = []
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let serialized = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk) => {
      serialized += chunk
      if (!serialized.endsWith("\n")) return
      requests.push(JSON.parse(serialized))
      socket.end(
        `${JSON.stringify({
          schema: "convax.packaged-smoke-external-authorization-response/1",
          status: "accepted",
        })}\n`,
      )
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, resolve)
  })
  await chmod(socketPath, 0o600)

  await openPackagedSmokeExternalAuthorization({
    authorizationUrl: "http://127.0.0.1:18101/oauth/authorize?state=opaque",
    socketPath,
    userDataDirectory,
  })
  await new Promise<void>((resolve) => server.close(() => resolve()))

  expect(requests).toEqual([
    {
      authorizationUrl: "http://127.0.0.1:18101/oauth/authorize?state=opaque",
      schema: "convax.packaged-smoke-external-authorization-request/1",
    },
  ])
})

test("rejects a socket outside the exact packaged smoke userData directory", async () => {
  const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "convax-packaged-smoke-auth-"))
  directories.push(userDataDirectory)
  await expect(
    openPackagedSmokeExternalAuthorization({
      authorizationUrl: "http://127.0.0.1:18101/oauth/authorize",
      socketPath: path.join(os.tmpdir(), "external-authorization.socket"),
      userDataDirectory,
    }),
  ).rejects.toThrow("socket is invalid")
})
