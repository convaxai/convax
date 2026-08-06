import { compareUtf8, encodeRestrictedJcs, parseUint32 } from "@convax/collaboration"
import type { CanvasHistoryBinding, CanvasHistoryTemplate, Uint32 } from "./types"
import { CanvasSchemaError } from "./validation"

export const CANVAS_UNDOABLE_INTENT_KINDS = Object.freeze([
  "canvas.agent.create",
  "canvas.resources.add",
  "canvas.resources.pending.create",
  "canvas.resources.pending-generation.create",
  "canvas.elements.remove",
  "canvas.nodes.set-geometry",
  "canvas.nodes.update-data",
  "canvas.nodes.set-plugin-state",
  "canvas.nodes.set-structural-parent",
  "canvas.nodes.group",
  "canvas.nodes.ungroup",
  "canvas.edges.connect",
  "canvas.metadata.update",
  "canvas.plugin.creation-group.create",
  "canvas.plugin.surface.create",
] as const)

const TEMPLATE_RANK: Readonly<Record<CanvasHistoryTemplate["op"], number>> = Object.freeze({
  "node.create": 10,
  "creation-group.restore": 11,
  "pending-generation.restore": 12,
  "edge.create": 20,
  "node.geometry": 30,
  "node.data": 31,
  "node.plugin": 32,
  "containment.set": 40,
  "edge.tombstone": 50,
  "node.tombstone": 60,
  "metadata.set": 70,
})

/**
 * Canonical rank-plus-Kahn schedule for one stored history direction.
 * This function allocates no ids and mutates no bindings or Y.Doc.
 */
export function scheduleCanvasHistoryTemplates(
  templates: readonly CanvasHistoryTemplate[],
  initialBindings: readonly CanvasHistoryBinding[],
): readonly CanvasHistoryTemplate[] {
  const bindings = new Map<string, CanvasHistoryBinding["ref"]>()
  for (const binding of initialBindings) {
    assertHandle(binding.handle)
    if (bindings.has(binding.handle)) invalid("duplicate history binding")
    bindings.set(binding.handle, binding.ref)
  }

  const producerByNode = new Map<string, string>()
  const producerByEdge = new Map<string, string>()
  const groups = new Map<string, Extract<CanvasHistoryTemplate, { op: "creation-group.restore" }>>()
  const addProducer = <T extends string>(map: Map<string, T>, handle: string, producer: T): void => {
    assertHandle(handle)
    if (map.has(handle)) invalid(`duplicate producer for ${handle}`)
    map.set(handle, producer)
  }

  for (const template of templates) {
    switch (template.op) {
      case "node.create":
        addProducer(producerByNode, template.handle, "ordinary")
        break
      case "edge.create":
        addProducer(producerByEdge, template.handle, "ordinary")
        break
      case "pending-generation.restore":
        addProducer(producerByNode, template.node, "pending")
        assertSortedMembers(template.edges, "pending-generation edges")
        for (const edge of template.edges) addProducer(producerByEdge, edge.handle, "pending")
        break
      case "creation-group.restore":
        assertGroupHandle(template.groupHandle)
        if (groups.has(template.groupHandle)) invalid(`duplicate creation-group handle ${template.groupHandle}`)
        assertSortedMembers(template.nodes, "creation-group nodes")
        assertSortedMembers(template.edges, "creation-group edges")
        if (template.nodes.length + template.edges.length === 0) invalid("creation-group restore must produce a member")
        groups.set(template.groupHandle, template)
        for (const node of template.nodes) addProducer(producerByNode, node.handle, template.groupHandle)
        for (const edge of template.edges) addProducer(producerByEdge, edge.handle, template.groupHandle)
        break
      default:
        break
    }
  }

  const dependents = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()
  for (const handle of groups.keys()) {
    dependents.set(handle, new Set())
    inDegree.set(handle, 0)
  }
  for (const [groupHandle, template] of groups) {
    if (template.source.mode === "external") continue
    const sourceHandle = template.source.handle
    assertHandle(sourceHandle)
    if (!bindings.has(sourceHandle)) invalid(`creation-group source ${sourceHandle} has no initial binding`)
    if (bindings.get(sourceHandle) !== null) continue
    const producer = producerByNode.get(sourceHandle)
    if (producer === undefined || producer === "pending")
      invalid(`creation-group source ${sourceHandle} has a missing or late producer`)
    if (producer === "ordinary") continue
    if (producer === groupHandle) invalid(`creation-group ${groupHandle} has a self dependency`)
    const targets = dependents.get(producer)
    if (targets === undefined) invalid(`creation-group source producer ${producer} is absent`)
    if (!targets.has(groupHandle)) {
      targets.add(groupHandle)
      inDegree.set(groupHandle, inDegree.get(groupHandle)! + 1)
    }
  }

  const groupSchedule: CanvasHistoryTemplate[] = []
  const remaining = new Set(groups.keys())
  while (remaining.size > 0) {
    const ready = [...remaining].filter((handle) => inDegree.get(handle) === 0).sort(compareUtf8)
    const next = ready[0]
    if (next === undefined) invalid("creation-group source dependency cycle")
    remaining.delete(next)
    groupSchedule.push(groups.get(next)!)
    for (const target of dependents.get(next)!) inDegree.set(target, inDegree.get(target)! - 1)
  }

  const withoutGroups = templates.filter((template) => template.op !== "creation-group.restore")
  withoutGroups.sort((left, right) => {
    const rank = TEMPLATE_RANK[left.op] - TEMPLATE_RANK[right.op]
    return rank || compareUtf8(templatePrimaryKey(left), templatePrimaryKey(right))
  })
  assertUniqueOuterKeys(withoutGroups)
  const beforeGroups = withoutGroups.filter((template) => TEMPLATE_RANK[template.op] < 11)
  const afterGroups = withoutGroups.filter((template) => TEMPLATE_RANK[template.op] > 11)
  return Object.freeze([...beforeGroups, ...groupSchedule, ...afterGroups])
}

export function assertCanvasHistoryTemplateSchedule(
  templates: readonly CanvasHistoryTemplate[],
  initialBindings: readonly CanvasHistoryBinding[],
): void {
  const scheduled = scheduleCanvasHistoryTemplates(templates, initialBindings)
  if (scheduled.length !== templates.length) invalid("history schedule cardinality changed")
  for (let index = 0; index < templates.length; index += 1) {
    if (!byteEqual(templates[index], scheduled[index]))
      invalid("history template order is not the canonical rank-plus-Kahn schedule")
  }
}

export interface CanvasHistoryOrdinalPlanEntry {
  readonly ordinal: Uint32
  readonly kind: "node" | "edge" | "relation" | "creation-group"
  readonly handle: string
}

/** Allocates the frozen contiguous ordinal plan only after scheduling succeeds. */
export function planCanvasHistoryDerivedOrdinals(
  templates: readonly CanvasHistoryTemplate[],
  initialBindings: readonly CanvasHistoryBinding[],
): readonly CanvasHistoryOrdinalPlanEntry[] {
  const scheduled = scheduleCanvasHistoryTemplates(templates, initialBindings)
  const plan: Omit<CanvasHistoryOrdinalPlanEntry, "ordinal">[] = []
  for (const template of scheduled) {
    switch (template.op) {
      case "node.create":
        plan.push({ kind: "node", handle: template.handle })
        break
      case "edge.create":
        plan.push({ kind: "edge", handle: template.handle })
        break
      case "containment.set":
        plan.push({ kind: "relation", handle: containmentTargetKey(template.child) })
        break
      case "pending-generation.restore":
        plan.push({ kind: "node", handle: template.node })
        for (const edge of template.edges) plan.push({ kind: "edge", handle: edge.handle })
        break
      case "creation-group.restore":
        plan.push({ kind: "creation-group", handle: template.groupHandle })
        for (const node of template.nodes) plan.push({ kind: "node", handle: node.handle })
        for (const edge of template.edges) plan.push({ kind: "edge", handle: edge.handle })
        break
      default:
        break
    }
  }
  return Object.freeze(plan.map((entry, index) => Object.freeze({ ...entry, ordinal: parseUint32(String(index)) })))
}

function assertUniqueOuterKeys(templates: readonly CanvasHistoryTemplate[]): void {
  let prior: string | undefined
  for (const template of templates) {
    const key = `${TEMPLATE_RANK[template.op]}/${templatePrimaryKey(template)}`
    if (prior === key) invalid(`duplicate history template key ${key}`)
    prior = key
  }
}

function templatePrimaryKey(template: CanvasHistoryTemplate): string {
  switch (template.op) {
    case "node.create":
    case "node.tombstone":
    case "node.geometry":
    case "node.data":
    case "node.plugin":
    case "edge.create":
    case "edge.tombstone":
      return template.handle
    case "pending-generation.restore":
      return template.node
    case "creation-group.restore":
      return template.groupHandle
    case "metadata.set":
      return template.field
    case "containment.set":
      return containmentTargetKey(template.child)
  }
  return invalid("unknown history template operation")
}

function containmentTargetKey(target: Extract<CanvasHistoryTemplate, { op: "containment.set" }>["child"]): string {
  return target.mode === "handle"
    ? `0/${target.handle}`
    : `1/${target.ref.kind}/${target.ref.id}/${target.ref.incarnation}`
}

function assertSortedMembers(values: readonly { readonly handle: string }[], label: string): void {
  let prior: string | undefined
  for (const value of values) {
    assertHandle(value.handle)
    if (prior !== undefined && compareUtf8(prior, value.handle) >= 0)
      invalid(`${label} must be handle-sorted and duplicate-free`)
    prior = value.handle
  }
}

function assertHandle(value: string): void {
  if (!/^[ne]\/(0|[1-9]\d*)$/u.test(value)) invalid(`invalid history handle ${value}`)
  parseUint32(value.slice(2))
}

function assertGroupHandle(value: string): void {
  if (!/^g\/(0|[1-9]\d*)$/u.test(value)) invalid(`invalid creation-group handle ${value}`)
  parseUint32(value.slice(2))
}

function byteEqual(left: unknown, right: unknown): boolean {
  const a = encodeRestrictedJcs(left)
  const b = encodeRestrictedJcs(right)
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

function invalid(message: string): never {
  throw new CanvasSchemaError("invalid-history-schedule", message)
}
