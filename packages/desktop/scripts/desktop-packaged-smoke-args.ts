export interface DesktopPackagedSmokeLaunchOptions {
  debuggerPort: number
  executable: string
  platform: NodeJS.Platform
}

export function desktopPackagedSmokeLaunchArguments(options: DesktopPackagedSmokeLaunchOptions) {
  return [
    options.executable,
    "--host-resolver-rules=MAP microvoid.github.io 127.0.0.1",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${options.debuggerPort}`,
    // The smoke profile must not read or mutate the developer's login Keychain.
    // Without this Electron can block on a native Safe Storage authorization
    // prompt when another Convax build already owns the same Keychain item.
    ...(options.platform === "darwin" ? ["--use-mock-keychain"] : []),
  ]
}
