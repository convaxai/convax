import {
  parse as parseJavaScriptModule,
  type ExportAllDeclaration,
  type ExportNamedDeclaration,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type Program,
} from "acorn"

function hasOpenCodePluginExport(program: Program) {
  return program.body.some(
    (statement) =>
      statement.type === "ExportDefaultDeclaration" ||
      (statement.type === "ExportNamedDeclaration" &&
        (statement.declaration != null || statement.specifiers.length > 0)),
  )
}

function inspectHookModuleDependencies(program: Program) {
  const staticImports: string[] = []
  let dynamicImport = false
  let commonJsReference = false
  const pending: Node[] = [program]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === "Identifier" && ["exports", "module", "require"].includes((node as Identifier).name)) {
      commonJsReference = true
    } else if (node.type === "ImportExpression") {
      dynamicImport = true
    } else if (node.type === "ImportDeclaration") {
      staticImports.push(String((node as ImportDeclaration).source.value))
    } else if (node.type === "ExportNamedDeclaration") {
      const source = (node as ExportNamedDeclaration).source
      if (source) staticImports.push(String(source.value))
    } else if (node.type === "ExportAllDeclaration") {
      staticImports.push(String((node as ExportAllDeclaration).source.value))
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object" && typeof child.type === "string") {
            pending.push(child as Node)
          }
        }
      } else if (value && typeof value === "object" && "type" in value && typeof value.type === "string") {
        pending.push(value as Node)
      }
    }
  }
  return { commonJsReference, dynamicImport, staticImports }
}

/** Validates the only executable Hook shape admitted into a released Plugin snapshot. */
export function assertSelfContainedHookModule(bytes: Uint8Array, label: string) {
  let source: string
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error(`${label} must be valid UTF-8 JavaScript`, { cause: error })
  }
  let program: Program
  try {
    program = parseJavaScriptModule(source, {
      allowHashBang: false,
      ecmaVersion: "latest",
      sourceType: "module",
    })
  } catch (error) {
    throw new Error(`${label} must be a valid JavaScript ESM module`, { cause: error })
  }
  if (!hasOpenCodePluginExport(program)) {
    throw new Error(`${label} must export at least one OpenCode Plugin entry`)
  }
  const dependencies = inspectHookModuleDependencies(program)
  if (dependencies.commonJsReference) {
    throw new Error(`${label} must bundle CommonJS dependencies into the declared Hook file`)
  }
  if (dependencies.dynamicImport) {
    throw new Error(`${label} must not use dynamic runtime imports; bundle the Hook into one file`)
  }
  for (const specifier of dependencies.staticImports) {
    if (specifier === "node:module" || specifier === "bun:module") {
      throw new Error(`${label} must bundle CommonJS dependencies instead of creating a runtime module loader`)
    }
    if (!specifier.startsWith("node:") && !specifier.startsWith("bun:")) {
      throw new Error(`${label} must bundle every non-runtime dependency into the declared Hook file`)
    }
  }
}
