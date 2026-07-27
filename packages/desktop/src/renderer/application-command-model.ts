export type ApplicationCommandGroup = "canvas" | "navigation" | "utility"

export interface ApplicationCommand {
  disabled?: boolean
  group: ApplicationCommandGroup
  id: string
  keywords?: readonly string[]
  label: string
  run(): void
  shortcut?: string
}

export function runApplicationCommand(command: ApplicationCommand | undefined): boolean {
  if (!command || command.disabled) return false
  command.run()
  return true
}
