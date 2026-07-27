import { describe, expect, test } from "bun:test"
import {
  runApplicationCommand,
  type ApplicationCommand,
} from "./application-command-model"

function command(overrides: Partial<ApplicationCommand>): ApplicationCommand {
  return {
    group: "navigation",
    id: "home",
    label: "Go to Projects",
    run: () => undefined,
    ...overrides,
  }
}

describe("application command model", () => {
  test("runs enabled commands once and fails closed for unavailable commands", () => {
    let calls = 0
    const enabled = command({ run: () => calls++ })

    expect(runApplicationCommand(enabled)).toBe(true)
    expect(calls).toBe(1)
    expect(runApplicationCommand(command({ disabled: true, run: () => calls++ }))).toBe(false)
    expect(runApplicationCommand(undefined)).toBe(false)
    expect(calls).toBe(1)
  })
})
