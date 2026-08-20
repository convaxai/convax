import { connect } from "node:net"
import path from "node:path"

const requestSchema = "convax.packaged-smoke-external-authorization-request/1"
const responseSchema = "convax.packaged-smoke-external-authorization-response/1"
const socketName = "auth.sock"
const maximumResponseBytes = 4 * 1024

export async function openPackagedSmokeExternalAuthorization(input: {
  authorizationUrl: string
  socketPath: string
  userDataDirectory: string
}) {
  const expectedSocketPath = path.join(input.userDataDirectory, socketName)
  if (
    !path.isAbsolute(input.userDataDirectory) ||
    !path.isAbsolute(input.socketPath) ||
    path.normalize(input.socketPath) !== expectedSocketPath
  ) {
    throw new Error("Packaged smoke external authorization socket is invalid")
  }
  const response = await new Promise<unknown>((resolve, reject) => {
    const socket = connect(input.socketPath)
    let responseBytes = 0
    let serialized = ""
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error("Packaged smoke external authorization timed out"))
    }, 10_000)
    const cleanup = () => clearTimeout(timeout)
    socket.setEncoding("utf8")
    socket.once("error", (error) => {
      cleanup()
      reject(error)
    })
    socket.on("data", (chunk) => {
      responseBytes += Buffer.byteLength(chunk, "utf8")
      if (responseBytes > maximumResponseBytes) {
        socket.destroy()
        reject(new Error("Packaged smoke external authorization response is too large"))
        return
      }
      serialized += chunk
    })
    socket.once("end", () => {
      cleanup()
      socket.destroy()
      try {
        resolve(JSON.parse(serialized))
      } catch {
        reject(new Error("Packaged smoke external authorization response is invalid"))
      }
    })
    socket.write(
      `${JSON.stringify({
        authorizationUrl: input.authorizationUrl,
        schema: requestSchema,
      })}\n`,
    )
  })
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    Object.keys(response).sort().join("\0") !== ["schema", "status"].sort().join("\0") ||
    (response as Record<string, unknown>).schema !== responseSchema ||
    (response as Record<string, unknown>).status !== "accepted"
  ) {
    throw new Error("Packaged smoke external authorization was not accepted")
  }
}
