import { describe, expect, mock, test } from "bun:test"

import { DshProjectProcessRegistry } from "./dsh-project-process-registry"

function processHandle(label: string) {
  return { close: mock(async () => undefined), label }
}

describe("DshProjectProcessRegistry", () => {
  test("deduplicates concurrent acquisition for one stable Project binding", async () => {
    const handle = processHandle("one")
    const start = mock(async () => handle)
    const registry = new DshProjectProcessRegistry({ resolveOptions: async () => ({}) as never, start: start as never })

    const [left, right] = await Promise.all([
      registry.acquire({ directory: "/projects/one", scopeId: "project-one" }),
      registry.acquire({ directory: "/projects/one", scopeId: "project-one" }),
    ])

    expect(left).toBe(handle as never)
    expect(right).toBe(handle as never)
    expect(start).toHaveBeenCalledTimes(1)
    await registry.close()
    expect(handle.close).toHaveBeenCalledTimes(1)
  })

  test("isolates Projects and closing one does not close the other", async () => {
    const handles = new Map([
      ["project-a", processHandle("a")],
      ["project-b", processHandle("b")],
    ])
    const registry = new DshProjectProcessRegistry({
      resolveOptions: async () => ({}) as never,
      start: (options) => Promise.resolve(handles.get(options.scopeId)! as never),
    })
    const [a, b] = await Promise.all([
      registry.acquire({ directory: "/projects/a", scopeId: "project-a" }),
      registry.acquire({ directory: "/projects/b", scopeId: "project-b" }),
    ])

    expect(a).not.toBe(b)
    await registry.closeProject("project-a")
    expect(handles.get("project-a")!.close).toHaveBeenCalledTimes(1)
    expect(handles.get("project-b")!.close).not.toHaveBeenCalled()
    await registry.close()
    expect(handles.get("project-b")!.close).toHaveBeenCalledTimes(1)
  })

  test("rejects rebinding a live Project and permits retry after startup failure", async () => {
    let attempts = 0
    const registry = new DshProjectProcessRegistry({
      resolveOptions: async () => ({}) as never,
      start: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("startup failed")
        return processHandle("retry") as never
      },
    })
    await expect(registry.acquire({ directory: "/projects/a", scopeId: "project-a" })).rejects.toThrow("startup failed")
    await expect(registry.acquire({ directory: "/projects/a", scopeId: "project-a" })).resolves.toBeDefined()
    await expect(registry.acquire({ directory: "/projects/other", scopeId: "project-a" })).rejects.toThrow(
      "already bound",
    )
    await registry.close()
  })
})
