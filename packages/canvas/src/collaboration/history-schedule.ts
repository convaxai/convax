import { compareUtf8V2, encodeRestrictedJcsV2, parseUint32V2 } from "@convax/collaboration"
import type { CanvasHistoryBindingV2, CanvasHistoryTemplateV2, Uint32V2 } from "./types"
import { CanvasSchemaErrorV2 } from "./validation"

export const CANVAS_UNDOABLE_INTENT_KINDS_V2 = Object.freeze([
  "canvas.nodes.create/2",
  "canvas.resources.add/2",
  "canvas.resources.pending.create/2",
  "canvas.resources.pending-generation.create/2",
  "canvas.elements.remove/2",
  "canvas.nodes.set-geometry/2",
  "canvas.nodes.update-data/2",
  "canvas.nodes.set-plugin-state/2",
  "canvas.nodes.set-structural-parent/2",
  "canvas.nodes.group/2",
  "canvas.nodes.ungroup/2",
  "canvas.edges.connect/2",
  "canvas.metadata.update/2",
  "canvas.plugin.creation-group.create/2",
] as const)

const TEMPLATE_RANK: Readonly<Record<CanvasHistoryTemplateV2["op"], number>> = Object.freeze({
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
export function scheduleCanvasHistoryTemplatesV2(
  templates: readonly CanvasHistoryTemplateV2[],
  initialBindings: readonly CanvasHistoryBindingV2[],
): readonly CanvasHistoryTemplateV2[] {
  const bindings = new Map<string, CanvasHistoryBindingV2["ref"]>()
  for (const binding of initialBindings) {
    assertHandle(binding.handle)
    if (bindings.has(binding.handle)) invalid("duplicate history binding")
    bindings.set(binding.handle, binding.ref)
  }

  const producerByNode = new Map<string, string>()
  const producerByEdge = new Map<string, string>()
  const groups = new Map<string, Extract<CanvasHistoryTemplateV2, { op: "creation-group.restore" }>>()
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

  const successors = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()
  for (const handle of groups.keys()) {
    successors.set(handle, new Set())
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
    const targets = successors.get(producer)
    if (targets === undefined) invalid(`creation-group source producer ${producer} is absent`)
    if (!targets.has(groupHandle)) {
      targets.add(groupHandle)
      inDegree.set(groupHandle, inDegree.get(groupHandle)! + 1)
    }
  }

  const groupSchedule: CanvasHistoryTemplateV2[] = []
  const remaining = new Set(groups.keys())
  while (remaining.size > 0) {
    const ready = [...remaining].filter((handle) => inDegree.get(handle) === 0).sort(compareUtf8V2)
    const next = ready[0]
    if (next === undefined) invalid("creation-group source dependency cycle")
    remaining.delete(next)
    groupSchedule.push(groups.get(next)!)
    for (const target of successors.get(next)!) inDegree.set(target, inDegree.get(target)! - 1)
  }

  const withoutGroups = templates.filter((template) => template.op !== "creation-group.restore")
  withoutGroups.sort((left, right) => {
    const rank = TEMPLATE_RANK[left.op] - TEMPLATE_RANK[right.op]
    return rank || compareUtf8V2(templatePrimaryKey(left), templatePrimaryKey(right))
  })
  assertUniqueOuterKeys(withoutGroups)
  const beforeGroups = withoutGroups.filter((template) => TEMPLATE_RANK[template.op] < 11)
  const afterGroups = withoutGroups.filter((template) => TEMPLATE_RANK[template.op] > 11)
  return Object.freeze([...beforeGroups, ...groupSchedule, ...afterGroups])
}

export function assertCanvasHistoryTemplateScheduleV2(
  templates: readonly CanvasHistoryTemplateV2[],
  initialBindings: readonly CanvasHistoryBindingV2[],
): void {
  const scheduled = scheduleCanvasHistoryTemplatesV2(templates, initialBindings)
  if (scheduled.length !== templates.length) invalid("history schedule cardinality changed")
  for (let index = 0; index < templates.length; index += 1) {
    if (!byteEqual(templates[index], scheduled[index]))
      invalid("history template order is not the canonical rank-plus-Kahn schedule")
  }
}

export interface CanvasHistoryOrdinalPlanEntryV2 {
  readonly ordinal: Uint32V2
  readonly kind: "node" | "edge" | "relation" | "creation-group"
  readonly handle: string
}

/** Allocates the frozen contiguous ordinal plan only after scheduling succeeds. */
export function planCanvasHistoryDerivedOrdinalsV2(
  templates: readonly CanvasHistoryTemplateV2[],
  initialBindings: readonly CanvasHistoryBindingV2[],
): readonly CanvasHistoryOrdinalPlanEntryV2[] {
  const scheduled = scheduleCanvasHistoryTemplatesV2(templates, initialBindings)
  const plan: Omit<CanvasHistoryOrdinalPlanEntryV2, "ordinal">[] = []
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
  return Object.freeze(plan.map((entry, index) => Object.freeze({ ...entry, ordinal: parseUint32V2(String(index)) })))
}

function assertUniqueOuterKeys(templates: readonly CanvasHistoryTemplateV2[]): void {
  let prior: string | undefined
  for (const template of templates) {
    const key = `${TEMPLATE_RANK[template.op]}/${templatePrimaryKey(template)}`
    if (prior === key) invalid(`duplicate history template key ${key}`)
    prior = key
  }
}

function templatePrimaryKey(template: CanvasHistoryTemplateV2): string {
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

function containmentTargetKey(target: Extract<CanvasHistoryTemplateV2, { op: "containment.set" }>["child"]): string {
  return target.mode === "handle"
    ? `0/${target.handle}`
    : `1/${target.ref.kind}/${target.ref.id}/${target.ref.incarnation}`
}

function assertSortedMembers(values: readonly { readonly handle: string }[], label: string): void {
  let prior: string | undefined
  for (const value of values) {
    assertHandle(value.handle)
    if (prior !== undefined && compareUtf8V2(prior, value.handle) >= 0)
      invalid(`${label} must be handle-sorted and duplicate-free`)
    prior = value.handle
  }
}

function assertHandle(value: string): void {
  if (!/^[ne]\/(0|[1-9]\d*)$/u.test(value)) invalid(`invalid history handle ${value}`)
  parseUint32V2(value.slice(2))
}

function assertGroupHandle(value: string): void {
  if (!/^g\/(0|[1-9]\d*)$/u.test(value)) invalid(`invalid creation-group handle ${value}`)
  parseUint32V2(value.slice(2))
}

function byteEqual(left: unknown, right: unknown): boolean {
  const a = encodeRestrictedJcsV2(left)
  const b = encodeRestrictedJcsV2(right)
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

function invalid(message: string): never {
  throw new CanvasSchemaErrorV2("invalid-history-schedule", message)
}
