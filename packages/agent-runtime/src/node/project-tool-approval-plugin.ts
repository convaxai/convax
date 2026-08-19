interface ToolExecution {
  name: string
}

interface ToolPolicyContext {
  on(
    event: "tools/pre-execute",
    listener: (execution: ToolExecution, next: () => Promise<unknown>) => Promise<unknown> | unknown,
  ): void
}

export interface ProjectToolApprovalPolicyConfig {
  prefixes: readonly string[]
}

export const name = "convax-project-tool-approval-policy"
export const inject = ["tools"]

/** Generic DSH policy Plugin: Desktop chooses prefixes, DSH owns the approval interaction. */
export function apply(context: ToolPolicyContext, config: ProjectToolApprovalPolicyConfig) {
  context.on("tools/pre-execute", (execution, next) => {
    if (config.prefixes.some((prefix) => execution.name.startsWith(prefix))) {
      return { kind: "ask", reason: `Host policy requires approval for ${execution.name}` }
    }
    return next()
  })
}
