import { CommandMenu, type CommandMenuItem } from "@convax/ui"
import { Bot, FolderOpen, Search, Settings, Sparkles } from "lucide-react"
import type { ReactNode } from "react"
import { runApplicationCommand, type ApplicationCommand, type ApplicationCommandGroup } from "./application-command-model"

function commandIcon(command: ApplicationCommand): ReactNode {
  if (command.id === "canvas.search") return <Search />
  if (command.id === "utility.agent") return <Bot />
  if (command.id === "utility.generate") return <Sparkles />
  if (command.id === "navigation.settings") return <Settings />
  return <FolderOpen />
}

function groupLabel(group: ApplicationCommandGroup) {
  if (group === "canvas") return "Canvas"
  if (group === "utility") return "Workspace"
  return "Navigation"
}

export function applicationCommandMenuItems(
  commands: readonly ApplicationCommand[],
): readonly CommandMenuItem[] {
  return commands.map((command) => ({
    description: groupLabel(command.group),
    disabled: command.disabled,
    icon: commandIcon(command),
    id: command.id,
    keywords: [command.group, ...(command.keywords ?? [])],
    label: command.label,
    shortcut: command.shortcut,
  }))
}

export function ApplicationCommandPalette(props: {
  commands: readonly ApplicationCommand[]
  emptyText: string
  label: string
  onOpenChange(open: boolean): void
  open: boolean
  placeholder: string
}) {
  return (
    <CommandMenu
      aria-label={props.label}
      emptyText={props.emptyText}
      items={applicationCommandMenuItems(props.commands)}
      onOpenChange={props.onOpenChange}
      onSelect={(item) => {
        runApplicationCommand(props.commands.find((command) => command.id === item.id))
      }}
      open={props.open}
      placeholder={props.placeholder}
    />
  )
}
