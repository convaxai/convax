const { app } = require("electron")
const { writeFileSync } = require("node:fs")
const { isAbsolute } = require("node:path")

app.whenReady().then(() => {
  const outputPath = process.argv.at(-1)
  if (!outputPath || !isAbsolute(outputPath)) app.exit(2)
  writeFileSync(outputPath, JSON.stringify({
    electronVersion: process.versions.electron,
    rtcPeerConnection: typeof globalThis.RTCPeerConnection,
  }))
  app.exit(0)
})
