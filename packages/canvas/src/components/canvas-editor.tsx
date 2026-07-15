import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react"
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Input,
  Shortcut,
  Tooltip,
  TooltipProvider,
  cn,
} from "@convax/ui"
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Check,
  ChevronUp,
  ClipboardPaste,
  Columns3,
  Copy,
  Download,
  FileUp,
  Focus,
  Group,
  LayoutGrid,
  LoaderCircle,
  Magnet,
  MapPinned,
  MousePointer2,
  Redo2,
  Rows3,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  addCanvasNodes,
  alignCanvasNodes,
  type CanvasAlign,
  type CanvasDistribute,
  type CanvasLayout,
  connectCanvasNodes,
  distributeCanvasNodes,
  duplicateCanvasSelection,
  groupCanvasNodes,
  layoutCanvasNodes,
  removeCanvasElements,
  ungroupCanvasNode,
} from "../commands"
import {
  createCanvasClipboardPayload,
  parseCanvasClipboard,
  pasteCanvasClipboard,
  serializeCanvasClipboard,
} from "../clipboard"
import { createDefaultCanvasNodeRegistry } from "../builtin-registry"
import { createMediaNode, createTextNode, getCanvasNodeSize } from "../document"
import { CanvasEditorProvider } from "../editor-context"
import { canvasHistoryReducer, createCanvasHistory } from "../history"
import type { CanvasNodeRegistry } from "../node-registry"
import {
  CanvasServicesProvider,
  type CanvasServices,
  useCanvasService,
} from "../services"
import type { CanvasDocument, CanvasNode, CanvasPoint, CanvasSelection } from "../types"
import { createCanvasShortcutHandler } from "../use-canvas-shortcuts"
import { useSpacePanning } from "../use-space-panning"
import { CanvasConnectionLine, CanvasEdgeView } from "./canvas-edge"

const defaultNodeRegistry = createDefaultCanvasNodeRegistry()
const edgeTypes = { canvas: CanvasEdgeView } satisfies EdgeTypes

function equalIds(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((id) => right.has(id))
}

function equalCanvasNodes(left: readonly CanvasNode[], right: readonly CanvasNode[]) {
  if (left.length !== right.length) return false
  return left.every((node, index) => {
    const next = right[index]
    if (node === next) return true
    return node.id === next.id
      && node.position.x === next.position.x
      && node.position.y === next.position.y
      && node.measured?.width === next.measured?.width
      && node.measured?.height === next.measured?.height
      && node.width === next.width
      && node.height === next.height
      && node.dragging === next.dragging
      && node.resizing === next.resizing
      && node.hidden === next.hidden
      && node.parentId === next.parentId
      && node.data === next.data
      && node.style === next.style
  })
}

function findOpenCanvasPoint(document: CanvasDocument, preferred: CanvasPoint) {
  const candidates = [
    { x: 0, y: 0 },
    { x: 340, y: 0 },
    { x: -340, y: 0 },
    { x: 0, y: 240 },
    { x: 340, y: 240 },
    { x: -340, y: 240 },
    { x: 0, y: -240 },
    { x: 340, y: -240 },
    { x: -340, y: -240 },
  ].map((offset) => ({ x: preferred.x + offset.x, y: preferred.y + offset.y }))
  return candidates.find((candidate) => !document.nodes.some((node) => {
    if (node.parentId) return false
    const size = getCanvasNodeSize(node)
    return candidate.x < node.position.x + size.width + 24
      && candidate.x + 320 + 24 > node.position.x
      && candidate.y < node.position.y + size.height + 24
      && candidate.y + 200 + 24 > node.position.y
  })) ?? candidates[0]
}

export interface CanvasEditorProps {
  className?: string
  initialDocument: CanvasDocument
  nodeRegistry?: CanvasNodeRegistry
  onlyRenderVisibleElements?: boolean
  onDocumentChange?: (document: CanvasDocument) => void
  readOnly?: boolean
  services: CanvasServices
}

export function CanvasEditor(props: CanvasEditorProps) {
  return (
    <CanvasServicesProvider services={props.services}>
      <ReactFlowProvider>
        <CanvasEditorContent {...props} nodeRegistry={props.nodeRegistry ?? defaultNodeRegistry} />
      </ReactFlowProvider>
    </CanvasServicesProvider>
  )
}

function CanvasEditorContent(props: CanvasEditorProps & { nodeRegistry: CanvasNodeRegistry }) {
  const [history, dispatch] = useReducer(canvasHistoryReducer, props.initialDocument, createCanvasHistory)
  const [selection, setSelection] = useState<CanvasSelection>(() => ({ nodeIds: new Set(), edgeIds: new Set() }))
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [edgesHidden, setEdgesHidden] = useState(false)
  const [miniMapVisible, setMiniMapVisible] = useState(true)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [prompt, setPrompt] = useState("")
  const [query, setQuery] = useState("")
  const [generating, setGenerating] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [insertPoint, setInsertPoint] = useState<CanvasPoint | null>(null)
  const spacePanning = useSpacePanning()
  const rootRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const pointerRef = useRef<CanvasPoint | null>(null)
  const altDragRef = useRef<{ nodeIds: string[]; positions: Map<string, CanvasPoint> } | null>(null)
  const reactFlow = useReactFlow<CanvasNode>()
  const uploadService = useCanvasService("upload")
  const generateService = useCanvasService("generate")
  const persistenceService = useCanvasService("persistence")
  const exportService = useCanvasService("export")
  const notificationService = useCanvasService("notify")
  const telemetryService = useCanvasService("telemetry")
  const registryVersion = useSyncExternalStore(
    props.nodeRegistry.subscribe,
    props.nodeRegistry.getVersion,
    props.nodeRegistry.getVersion,
  )

  const readOnly = props.readOnly ?? false
  const selectedNodeIds = [...selection.nodeIds]
  const selectedEdgeIds = [...selection.edgeIds]
  const nodeById = useMemo(
    () => new Map(history.document.nodes.map((node) => [node.id, node])),
    [history.document.nodes],
  )
  const arrangeNodeIds = useMemo(() => {
    const ids = [...selection.nodeIds]
    if (ids.length !== 1) return ids
    const selected = nodeById.get(ids[0])
    if (selected?.type !== "group") return ids
    return history.document.nodes.filter((node) => node.parentId === selected.id).map((node) => node.id)
  }, [history.document.nodes, nodeById, selection.nodeIds])
  const arrangeNodes = arrangeNodeIds.flatMap((id) => {
    const node = nodeById.get(id)
    return node ? [node] : []
  })
  const canArrangeSelection = arrangeNodes.length >= 2
    && arrangeNodes.every((node) => node.parentId === arrangeNodes[0]?.parentId)
  const canDistributeSelection = canArrangeSelection && arrangeNodes.length >= 3
  const canvasNodeIds = useMemo(
    () => history.document.nodes.filter((node) => !node.parentId).map((node) => node.id),
    [history.document.nodes],
  )
  const canLayoutCanvas = canvasNodeIds.length >= 2
  const nodes = useMemo(() => {
    const depth = (node: CanvasNode): number => {
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      return parent ? depth(parent) + 1 : 0
    }
    return history.document.nodes
      .map((node) => node.selected === selection.nodeIds.has(node.id)
        ? node
        : { ...node, selected: selection.nodeIds.has(node.id) })
      .sort((left, right) => depth(left) - depth(right))
  }, [history.document.nodes, nodeById, selection.nodeIds])
  const edges = useMemo(() => {
    if (edgesHidden) return []
    return history.document.edges.map((edge) => ({
      ...edge,
      selected: selection.edgeIds.has(edge.id),
      type: !edge.type || edge.type === "smoothstep" ? "canvas" : edge.type,
    }))
  }, [edgesHidden, history.document.edges, selection.edgeIds])
  const nodeTypes = useMemo(() => {
    const fallback = props.nodeRegistry.get("file")?.component
    const definitions = props.nodeRegistry.list()
    const types = new Set([
      ...definitions.map((definition) => definition.type),
      ...history.document.nodes.map((node) => node.type ?? "text"),
    ])
    return Object.fromEntries(
      [...types].flatMap((type) => {
        const component = props.nodeRegistry.get(type)?.component ?? fallback
        return component ? [[type, component]] : []
      }),
    ) as NodeTypes
  }, [history.document.nodes.map((node) => node.type).sort().join(","), props.nodeRegistry, registryVersion])
  const connectionNodeTypes = useMemo(
    () => props.nodeRegistry
      .list()
      .filter((definition) => !definition.hidden && definition.type !== "group")
      .map((definition) => ({ label: definition.label, type: definition.type })),
    [props.nodeRegistry, registryVersion],
  )

  const updateSelection = useCallback((nodeIds: readonly string[], edgeIds: readonly string[] = []) => {
    setSelection((current) => {
      const next = { nodeIds: new Set(nodeIds), edgeIds: new Set(edgeIds) }
      if (equalIds(current.nodeIds, next.nodeIds) && equalIds(current.edgeIds, next.edgeIds)) return current
      return next
    })
  }, [])
  const selectNodes = useCallback((nodeIds: readonly string[]) => updateSelection(nodeIds), [updateSelection])
  const commit = useCallback(
    (update: (document: CanvasDocument) => CanvasDocument) => {
      if (readOnly) return
      dispatch({ type: "commit", document: update(history.document) })
    },
    [history.document, readOnly],
  )
  const pointAtCenter = useCallback(() => {
    const bounds = rootRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
  }, [reactFlow])
  const fitAfterRender = useCallback(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      void reactFlow.fitView({ duration: 220, maxZoom: 1.1, padding: 0.3 })
    }))
  }, [reactFlow])
  const nextInsertPoint = useCallback(
    (index = 0) => {
      const point = insertPoint ?? pointerRef.current ?? pointAtCenter()
      const open = findOpenCanvasPoint(history.document, point)
      return { x: open.x + index * 36, y: open.y + index * 36 }
    },
    [history.document, insertPoint, pointAtCenter],
  )
  const notifyError = useCallback(
    (title: string, error: unknown) => {
      notificationService?.show({ kind: "error", title, description: error instanceof Error ? error.message : String(error) })
    },
    [notificationService],
  )

  useEffect(() => props.onDocumentChange?.(history.document), [history.document, props.onDocumentChange])
  useEffect(() => {
    const nodeIds = new Set(history.document.nodes.map((node) => node.id))
    const edgeIds = new Set(history.document.edges.map((edge) => edge.id))
    setSelection((current) => {
      const next = {
        nodeIds: new Set([...current.nodeIds].filter((id) => nodeIds.has(id))),
        edgeIds: new Set([...current.edgeIds].filter((id) => edgeIds.has(id))),
      }
      if (equalIds(current.nodeIds, next.nodeIds) && equalIds(current.edgeIds, next.edgeIds)) return current
      return next
    })
  }, [history.document.edges, history.document.nodes])
  useEffect(() => {
    if (!persistenceService) return
    const controller = new AbortController()
    void persistenceService.load(history.document.id, controller.signal).then(
      (document) => {
        if (document) dispatch({ type: "replace", document })
      },
      (error) => notifyError("Could not load canvas", error),
    )
    return () => controller.abort()
  }, [history.document.id, persistenceService, notifyError])
  useEffect(() => {
    if (!persistenceService || history.document.revision === 0) return
    setSaveState("saving")
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void persistenceService.save(history.document, controller.signal).then(
        () => setSaveState("saved"),
        (error) => {
          setSaveState("idle")
          notifyError("Could not save canvas", error)
        },
      )
    }, 500)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [history.document, persistenceService, notifyError])

  const addNode = useCallback(
    (type: string, position?: CanvasPoint) => {
      const definition = props.nodeRegistry.get(type)
      if (!definition || readOnly) return
      const result = addCanvasNodes(history.document, [definition.create({ position: position ?? nextInsertPoint() })])
      dispatch({ type: "commit", document: result.document })
      selectNodes(result.selectedNodeIds)
      fitAfterRender()
      setNodeMenuOpen(false)
      setInsertPoint(null)
      telemetryService?.track({ name: "canvas.node.added", properties: { type } })
    },
    [fitAfterRender, history.document, nextInsertPoint, props.nodeRegistry, readOnly, selectNodes, telemetryService],
  )
  const duplicate = useCallback(() => {
    const result = duplicateCanvasSelection(history.document, selectedNodeIds)
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [history.document, selectedNodeIds, selectNodes])
  const quickConnect = useCallback(
    (nodeId: string, side: "left" | "right", nodeType: string) => {
      const anchor = history.document.nodes.find((node) => node.id === nodeId)
      const definition = props.nodeRegistry.get(nodeType)
      if (!anchor || !definition || readOnly) return
      const anchorSize = getCanvasNodeSize(anchor)
      const created = definition.create({ position: anchor.position })
      const createdSize = getCanvasNodeSize(created)
      const node = {
        ...created,
        parentId: anchor.parentId,
        position: {
          x: side === "right"
            ? anchor.position.x + anchorSize.width + 160
            : anchor.position.x - createdSize.width - 160,
          y: anchor.position.y + (anchorSize.height - createdSize.height) / 2,
        },
      }
      const withNode = addCanvasNodes(history.document, [node]).document
      dispatch({
        type: "commit",
        document: connectCanvasNodes(withNode, side === "right"
          ? {
              source: anchor.id,
              sourceHandle: "source-right",
              target: node.id,
              targetHandle: "target-left",
            }
          : {
              source: node.id,
              sourceHandle: "source-right",
              target: anchor.id,
              targetHandle: "target-left",
            }),
      })
      selectNodes([node.id])
      telemetryService?.track({ name: "canvas.node.connected", properties: { side, type: nodeType } })
    },
    [history.document, props.nodeRegistry, readOnly, selectNodes, telemetryService],
  )
  const remove = useCallback(() => {
    commit((document) => removeCanvasElements(document, { nodeIds: selectedNodeIds, edgeIds: selectedEdgeIds }))
    updateSelection([])
  }, [commit, selectedEdgeIds, selectedNodeIds, updateSelection])
  const group = useCallback(() => {
    const result = groupCanvasNodes(history.document, selectedNodeIds)
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [history.document, selectedNodeIds, selectNodes])
  const ungroup = useCallback(() => {
    const groupId = selectedNodeIds.find((id) => history.document.nodes.some((node) => node.id === id && node.type === "group"))
    if (!groupId) return
    const result = ungroupCanvasNode(history.document, groupId)
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [history.document, selectedNodeIds, selectNodes])
  const align = useCallback((direction: CanvasAlign) => {
    if (!canArrangeSelection) return
    commit((document) => alignCanvasNodes(document, arrangeNodeIds, direction))
  }, [arrangeNodeIds, canArrangeSelection, commit])
  const distribute = useCallback((axis: CanvasDistribute) => {
    if (!canDistributeSelection) return
    commit((document) => distributeCanvasNodes(document, arrangeNodeIds, axis))
  }, [arrangeNodeIds, canDistributeSelection, commit])
  const layout = useCallback((value: CanvasLayout = "grid") => {
    if (!canArrangeSelection) return
    commit((document) => layoutCanvasNodes(document, { nodeIds: arrangeNodeIds, layout: value }))
  }, [arrangeNodeIds, canArrangeSelection, commit])
  const layoutCanvas = useCallback(() => {
    if (!canLayoutCanvas) return
    commit((document) => layoutCanvasNodes(document, { nodeIds: canvasNodeIds, layout: "grid" }))
    fitAfterRender()
  }, [canLayoutCanvas, canvasNodeIds, commit, fitAfterRender])
  const copy = useCallback(() => {
    const payload = createCanvasClipboardPayload(history.document, selectedNodeIds)
    if (!payload) return
    void navigator.clipboard.writeText(serializeCanvasClipboard(payload)).then(
      () => notificationService?.show({ kind: "info", title: "Copied to clipboard" }),
      (error) => notifyError("Could not copy selection", error),
    )
  }, [history.document, notificationService, notifyError, selectedNodeIds])
  const paste = useCallback(() => {
    void navigator.clipboard.readText().then(
      (value) => {
        const payload = parseCanvasClipboard(value)
        if (!payload) return
        const roots = payload.nodes.filter((node) => !node.parentId)
        const target = insertPoint ?? pointerRef.current
        const offset = target && roots.length
          ? {
              x: target.x - Math.min(...roots.map((node) => node.position.x)),
              y: target.y - Math.min(...roots.map((node) => node.position.y)),
            }
          : undefined
        const result = pasteCanvasClipboard(history.document, payload, offset)
        dispatch({ type: "commit", document: result.document })
        selectNodes(result.selectedNodeIds)
      },
      (error) => notifyError("Could not read clipboard", error),
    )
  }, [history.document, insertPoint, notifyError, selectNodes])

  const uploadFiles = useCallback(
    (files: readonly File[], position?: CanvasPoint) => {
      if (!uploadService || files.length === 0 || readOnly) return
      const controller = new AbortController()
      void uploadService
        .upload({
          files,
          position,
          context: { documentId: history.document.id, selectedNodeIds, source: "canvas" },
          signal: controller.signal,
        })
        .then(
          (resources) => {
            const point = position ?? nextInsertPoint()
            const result = addCanvasNodes(
              history.document,
              resources.map((resource, index) =>
                createMediaNode({ position: { x: point.x + index * 36, y: point.y + index * 36 }, resource }),
              ),
            )
            dispatch({ type: "commit", document: result.document })
            selectNodes(result.selectedNodeIds)
            fitAfterRender()
            notificationService?.show({ kind: "success", title: `${resources.length} item${resources.length === 1 ? "" : "s"} added` })
          },
          (error) => notifyError("Upload failed", error),
        )
    },
    [fitAfterRender, history.document, nextInsertPoint, notificationService, notifyError, readOnly, selectedNodeIds, selectNodes, uploadService],
  )
  const runGenerate = useCallback(() => {
    if (!generateService || readOnly) return
    if (!prompt.trim()) {
      setGenerateOpen(true)
      return
    }
    setGenerating(true)
    const controller = new AbortController()
    const references = history.document.nodes
      .filter((node) => selection.nodeIds.has(node.id))
      .map((node) => ({
        nodeId: node.id,
        kind: node.data.kind,
        text: "text" in node.data && typeof node.data.text === "string" ? node.data.text : undefined,
        url: "url" in node.data && typeof node.data.url === "string" ? node.data.url : undefined,
      }))
    void generateService
      .generate({
        prompt: prompt.trim(),
        references,
        context: { documentId: history.document.id, selectedNodeIds, source: "canvas" },
        signal: controller.signal,
      })
      .then(
        (items) => {
          const nodes = items.flatMap((item, index) => {
            const position = nextInsertPoint(index)
            if (item.resource) return [createMediaNode({ label: item.title, position, resource: item.resource })]
            if (!item.nodeType || item.nodeType === "text") {
              return [createTextNode({ label: item.title ?? "Generated", position, text: item.text ?? prompt.trim() })]
            }
            const definition = props.nodeRegistry.get(item.nodeType)
            return definition ? [definition.create({ position, data: { ...item.metadata, label: item.title, text: item.text } })] : []
          })
          const result = addCanvasNodes(history.document, nodes)
          dispatch({ type: "commit", document: result.document })
          selectNodes(result.selectedNodeIds)
          fitAfterRender()
          setGenerateOpen(false)
          setPrompt("")
          notificationService?.show({ kind: "success", title: "Generation complete" })
        },
        (error) => notifyError("Generation failed", error),
      )
      .finally(() => setGenerating(false))
  }, [fitAfterRender, generateService, history.document, nextInsertPoint, notificationService, notifyError, prompt, props.nodeRegistry, readOnly, selectedNodeIds, selectNodes, selection.nodeIds])
  const exportCanvas = useCallback(() => {
    if (!exportService) return
    const controller = new AbortController()
    void exportService
      .export({ document: history.document, format: "json", selectedNodeIds }, controller.signal)
      .then(undefined, (error) => notifyError("Export failed", error))
  }, [exportService, history.document, notifyError, selectedNodeIds])

  const clearOverlays = useCallback(() => {
    updateSelection([])
    setNodeMenuOpen(false)
    setGenerateOpen(false)
    setSearchOpen(false)
  }, [updateSelection])
  const shortcutHandler = createCanvasShortcutHandler(
    {
      addNode: () => setNodeMenuOpen(true),
      clearSelection: clearOverlays,
      copy,
      delete: remove,
      duplicate,
      fitView: () => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 }),
      generate: runGenerate,
      group,
      layout: () => selectedNodeIds.length > 0 ? layout() : layoutCanvas(),
      openSearch: () => setSearchOpen(true),
      paste,
      redo: () => dispatch({ type: "redo" }),
      selectAll: () => selectNodes(history.document.nodes.filter((node) => !node.parentId).map((node) => node.id)),
      undo: () => dispatch({ type: "undo" }),
      ungroup,
      zoomIn: () => void reactFlow.zoomIn({ duration: 140 }),
      zoomOut: () => void reactFlow.zoomOut({ duration: 140 }),
    },
    readOnly,
  )
  const controller = useMemo(
    () => ({
      document: history.document,
      selection,
      readOnly,
      connectionNodeTypes,
      beginGesture: () => dispatch({ type: "begin-gesture" }),
      endGesture: () => dispatch({ type: "end-gesture" }),
      commit,
      quickConnect,
      selectNodes,
    }),
    [commit, connectionNodeTypes, history.document, quickConnect, readOnly, selectNodes, selection],
  )
  const searchResults = query.trim()
    ? history.document.nodes.filter((node) => `${node.data.label} ${"text" in node.data ? node.data.text : ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : history.document.nodes.slice(0, 8)

  return (
    <CanvasEditorProvider controller={controller}>
      <TooltipProvider>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={rootRef}
              className={cn(
                "convax-canvas relative size-full overflow-hidden bg-background text-foreground outline-none",
                spacePanning && "is-space-panning",
                props.className,
              )}
              onDragOver={(event) => {
                if (!uploadService || readOnly) return
                event.preventDefault()
                event.dataTransfer.dropEffect = "copy"
              }}
              onDrop={(event) => {
                if (!uploadService || readOnly) return
                event.preventDefault()
                uploadFiles([...event.dataTransfer.files], reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
              }}
              onDoubleClick={(event) => {
                if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("react-flow__pane")) return
                addNode("text", reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
              }}
              onKeyDown={shortcutHandler}
              onPointerMove={(event) => {
                if (!(event.target instanceof HTMLElement) || event.target.closest("button, input, textarea, [data-canvas-shortcuts='ignore']")) return
                pointerRef.current = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
              }}
              tabIndex={0}
            >
              <ReactFlow
                colorMode="light"
                connectionLineComponent={CanvasConnectionLine}
                deleteKeyCode={null}
                edgeTypes={edgeTypes}
                edges={edges}
                elementsSelectable={!readOnly}
                fitView
                fitViewOptions={{ maxZoom: 1.2, padding: 0.3 }}
                maxZoom={2.5}
                minZoom={0.15}
                nodeTypes={nodeTypes}
                nodes={nodes}
                nodesConnectable={!readOnly}
                nodesDraggable={!readOnly && !spacePanning}
                nodesFocusable
                nodeDragThreshold={4}
                onlyRenderVisibleElements={props.onlyRenderVisibleElements ?? true}
                autoPanOnNodeFocus={false}
                panActivationKeyCode="Space"
                panOnDrag={[0, 1]}
                panOnScroll
                selectionOnDrag={false}
                selectionMode={SelectionMode.Partial}
                snapGrid={[8, 8]}
                snapToGrid={snapToGrid}
                zoomActivationKeyCode={["Meta", "Control"]}
                zoomOnDoubleClick={false}
                zoomOnPinch
                zoomOnScroll={false}
                onConnect={(connection) => commit((document) => connectCanvasNodes(document, connection))}
                onEdgesChange={(changes) => {
                  const selectionChanges = changes.filter((change) => change.type === "select")
                  if (selectionChanges.length > 0) {
                    setSelection((current) => {
                      const edgeIds = new Set(current.edgeIds)
                      selectionChanges.forEach((change) => change.selected ? edgeIds.add(change.id) : edgeIds.delete(change.id))
                      if (equalIds(current.edgeIds, edgeIds)) return current
                      return { nodeIds: current.nodeIds, edgeIds }
                    })
                  }
                  const documentChanges = changes.filter((change) => change.type !== "select")
                  if (documentChanges.length === 0) return
                  commit((document) => ({ ...document, edges: applyEdgeChanges(documentChanges, document.edges) }))
                }}
                onNodeContextMenu={(_, node) => {
                  if (!selection.nodeIds.has(node.id)) selectNodes([node.id])
                  setInsertPoint(node.position)
                }}
                onNodeDoubleClick={(_, node) => selectNodes([node.id])}
                onNodeDragStart={(event, node) => {
                  dispatch({ type: "begin-gesture" })
                  if (!(event instanceof MouseEvent) || !event.altKey) return
                  const nodeIds = selection.nodeIds.has(node.id) ? selectedNodeIds : [node.id]
                  altDragRef.current = {
                    nodeIds,
                    positions: new Map(history.document.nodes.filter((item) => nodeIds.includes(item.id)).map((item) => [item.id, item.position])),
                  }
                }}
                onNodeDragStop={() => {
                  if (altDragRef.current) {
                    const duplicated = duplicateCanvasSelection(history.document, altDragRef.current.nodeIds, { x: 0, y: 0 })
                    const positions = altDragRef.current.positions
                    dispatch({
                      type: "replace",
                      document: {
                        ...duplicated.document,
                        nodes: duplicated.document.nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id) ?? node.position } : node),
                      },
                    })
                    selectNodes(duplicated.selectedNodeIds)
                    altDragRef.current = null
                  }
                  dispatch({ type: "end-gesture" })
                }}
                onNodesChange={(changes) => {
                  const selectionChanges = changes.filter((change) => change.type === "select")
                  if (selectionChanges.length > 0) {
                    setSelection((current) => {
                      const nodeIds = new Set(current.nodeIds)
                      selectionChanges.forEach((change) => change.selected ? nodeIds.add(change.id) : nodeIds.delete(change.id))
                      if (equalIds(current.nodeIds, nodeIds)) return current
                      return { nodeIds, edgeIds: current.edgeIds }
                    })
                  }
                  const documentChanges = changes.filter((change) => change.type !== "select" && change.type !== "remove")
                  if (documentChanges.length === 0) return
                  const nextNodes = applyNodeChanges(documentChanges, history.document.nodes)
                  if (equalCanvasNodes(history.document.nodes, nextNodes)) return
                  dispatch({ type: "replace", document: { ...history.document, nodes: nextNodes } })
                }}
                onPaneClick={() => {
                  updateSelection([])
                  rootRef.current?.focus()
                }}
                onPaneContextMenu={(event) => {
                  setInsertPoint(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
                  rootRef.current?.focus()
                }}
              >
                <Background color="var(--canvas-grid)" gap={24} size={1.2} variant={BackgroundVariant.Dots} />
                {miniMapVisible ? (
                  <MiniMap
                    className="!bottom-4 !right-4 !h-24 !w-36 !rounded-md !border !border-border !bg-card !shadow-sm"
                    maskColor="color-mix(in oklab, var(--background) 68%, transparent)"
                    nodeColor="var(--muted-foreground)"
                    pannable
                    zoomable
                  />
                ) : null}
              </ReactFlow>

              <CanvasHeader
                canExport={Boolean(exportService)}
                canGenerate={Boolean(generateService)}
                canRedo={history.future.length > 0}
                canUndo={history.past.length > 0}
                canUpload={Boolean(uploadService)}
                document={history.document}
                generating={generating}
                onAddNote={() => addNode("note")}
                onAddText={() => addNode("text")}
                onExport={exportCanvas}
                onGenerate={() => setGenerateOpen(true)}
                onRedo={() => dispatch({ type: "redo" })}
                onSearch={() => setSearchOpen(true)}
                onUndo={() => dispatch({ type: "undo" })}
                onUpload={() => uploadInputRef.current?.click()}
                readOnly={readOnly}
                saveState={saveState}
              />

              {selectedNodeIds.length > 0 && !readOnly ? (
                <SelectionToolbar
                  canArrange={canArrangeSelection}
                  canDistribute={canDistributeSelection}
                  canGroup={selectedNodeIds.length > 1}
                  canUngroup={selectedNodeIds.some((id) => history.document.nodes.some((node) => node.id === id && node.type === "group"))}
                  onAlign={align}
                  onDelete={remove}
                  onDistribute={distribute}
                  onDuplicate={duplicate}
                  onGroup={group}
                  onLayout={layout}
                  onUngroup={ungroup}
                />
              ) : null}

              <ViewportToolbar
                canLayout={canLayoutCanvas}
                edgesHidden={edgesHidden}
                miniMapVisible={miniMapVisible}
                onEdgesHiddenChange={() => setEdgesHidden((hidden) => !hidden)}
                onFit={() => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 })}
                onLayout={layoutCanvas}
                onMiniMapChange={() => setMiniMapVisible((visible) => !visible)}
                onSnapChange={() => setSnapToGrid((enabled) => !enabled)}
                onZoomIn={() => void reactFlow.zoomIn({ duration: 140 })}
                onZoomOut={() => void reactFlow.zoomOut({ duration: 140 })}
                snapToGrid={snapToGrid}
              />

              {nodeMenuOpen ? (
                <FloatingPanel className="left-1/2 top-20 w-64 -translate-x-1/2">
                  <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">Add to canvas</div>
                  <div className="grid grid-cols-2 gap-1">
                    {props.nodeRegistry.list().filter((definition) => !definition.hidden && definition.type !== "group").map((definition) => (
                      <Button key={definition.type} className="justify-start" onClick={() => addNode(definition.type)} size="sm" variant="ghost">
                        {definition.type === "note" ? <StickyNote /> : <Type />}
                        {definition.label}
                      </Button>
                    ))}
                  </div>
                </FloatingPanel>
              ) : null}

              {generateOpen ? (
                <FloatingPanel className="left-1/2 top-20 w-[min(440px,calc(100%-32px))] -translate-x-1/2">
                  <form
                    className="flex gap-2"
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault()
                      runGenerate()
                    }}
                  >
                    <Input autoFocus data-canvas-shortcuts="ignore" onChange={(event) => setPrompt(event.currentTarget.value)} placeholder="Describe what to create..." value={prompt} />
                    <Button aria-label="Run generation" disabled={generating || !prompt.trim()} size="icon" type="submit">
                      {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                    </Button>
                  </form>
                  <div className="mt-2 text-xs text-muted-foreground">{selectedNodeIds.length ? `${selectedNodeIds.length} selected node${selectedNodeIds.length === 1 ? "" : "s"} will be used as context.` : "No reference nodes selected."}</div>
                </FloatingPanel>
              ) : null}

              {searchOpen ? (
                <FloatingPanel className="left-1/2 top-20 w-[min(380px,calc(100%-32px))] -translate-x-1/2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input autoFocus className="pl-9" data-canvas-shortcuts="ignore" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search nodes" value={query} />
                  </div>
                  <div className="mt-2 max-h-64 overflow-auto">
                    {searchResults.map((node) => (
                      <button
                        key={node.id}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          selectNodes([node.id])
                          setSearchOpen(false)
                          void reactFlow.fitView({ duration: 220, nodes: [node], padding: 0.7 })
                        }}
                        type="button"
                      >
                        <span className="size-2 rounded-full bg-muted-foreground" />
                        <span className="truncate">{node.data.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{node.data.kind}</span>
                      </button>
                    ))}
                  </div>
                </FloatingPanel>
              ) : null}

              <input
                ref={uploadInputRef}
                className="hidden"
                multiple
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  uploadFiles([...(event.currentTarget.files ?? [])])
                  event.currentTarget.value = ""
                }}
                type="file"
              />
            </div>
          </ContextMenuTrigger>
          <CanvasContextMenu
            canArrange={canArrangeSelection}
            canDistribute={canDistributeSelection}
            canGroup={selectedNodeIds.length > 1}
            canRedo={history.future.length > 0}
            canUngroup={selectedNodeIds.some((id) => history.document.nodes.some((node) => node.id === id && node.type === "group"))}
            canUndo={history.past.length > 0}
            canUpload={Boolean(uploadService)}
            hasNodeSelection={selectedNodeIds.length > 0}
            hasSelection={selectedNodeIds.length > 0 || selectedEdgeIds.length > 0}
            onAddNote={() => addNode("note")}
            onAddText={() => addNode("text")}
            onAlign={align}
            onCopy={copy}
            onDelete={remove}
            onDistribute={distribute}
            onDuplicate={duplicate}
            onFit={() => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 })}
            onGroup={group}
            onLayout={() => layout("grid")}
            onPaste={paste}
            onRedo={() => dispatch({ type: "redo" })}
            onUngroup={ungroup}
            onUndo={() => dispatch({ type: "undo" })}
            onUpload={() => uploadInputRef.current?.click()}
            readOnly={readOnly}
          />
        </ContextMenu>
      </TooltipProvider>
    </CanvasEditorProvider>
  )
}

function IconButton(props: {
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
  shortcut?: string
  tooltipSide?: "bottom" | "left" | "right" | "top"
}) {
  return (
    <Tooltip
      content={<span className="flex items-center gap-3">{props.label}{props.shortcut ? <Shortcut>{props.shortcut}</Shortcut> : null}</span>}
      side={props.tooltipSide}
    >
      <span className="inline-flex">
        <Button
          aria-label={props.label}
          aria-pressed={props.pressed}
          className={cn(props.pressed && "bg-accent text-accent-foreground")}
          disabled={props.disabled}
          onClick={props.onClick}
          size="icon-sm"
          variant="ghost"
        >
          {props.icon}
        </Button>
      </span>
    </Tooltip>
  )
}

function ToolSurface(props: { children: ReactNode; className?: string }) {
  return <div className={cn("convax-tool-surface absolute z-20 flex items-center rounded-md border p-1 text-card-foreground", props.className)}>{props.children}</div>
}

function FloatingPanel(props: { children: ReactNode; className?: string }) {
  return <div className={cn("convax-floating-panel absolute z-30 rounded-md border p-3 text-popover-foreground", props.className)}>{props.children}</div>
}

function CanvasHeader(props: {
  canExport: boolean
  canGenerate: boolean
  canRedo: boolean
  canUndo: boolean
  canUpload: boolean
  document: CanvasDocument
  generating: boolean
  onAddNote: () => void
  onAddText: () => void
  onExport: () => void
  onGenerate: () => void
  onRedo: () => void
  onSearch: () => void
  onUndo: () => void
  onUpload: () => void
  readOnly: boolean
  saveState: "idle" | "saving" | "saved"
}) {
  return (
    <>
      <ToolSurface className="left-4 top-4 h-10 max-w-[calc(100%-32px)] gap-2 px-3">
        <div className="grid size-5 grid-cols-2 gap-0.5" aria-hidden="true">
          <span className="bg-foreground" /><span className="bg-emerald-500" /><span className="bg-emerald-500" /><span className="bg-foreground" />
        </div>
        <span className="truncate text-sm font-semibold">{props.document.metadata.title}</span>
        {props.saveState !== "idle" ? <span className="text-xs text-muted-foreground">{props.saveState === "saving" ? "Saving..." : "Saved"}</span> : null}
      </ToolSurface>
      <ToolSurface className="left-1/2 top-4 -translate-x-1/2 gap-0.5 max-[820px]:top-16">
        <IconButton icon={<MousePointer2 />} label="Select" onClick={() => undefined} shortcut="V" />
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton disabled={props.readOnly} icon={<Type />} label="Text" onClick={props.onAddText} />
        <IconButton disabled={props.readOnly} icon={<StickyNote />} label="Note" onClick={props.onAddNote} />
        {props.canUpload ? <IconButton disabled={props.readOnly} icon={<FileUp />} label="Upload" onClick={props.onUpload} /> : null}
        {props.canGenerate ? <IconButton disabled={props.readOnly || props.generating} icon={props.generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />} label="Generate" onClick={props.onGenerate} shortcut="⌘↵" /> : null}
      </ToolSurface>
      <ToolSurface className="right-4 top-4 gap-0.5 max-[820px]:top-16">
        <IconButton disabled={!props.canUndo || props.readOnly} icon={<Undo2 />} label="Undo" onClick={props.onUndo} shortcut="⌘Z" />
        <IconButton disabled={!props.canRedo || props.readOnly} icon={<Redo2 />} label="Redo" onClick={props.onRedo} shortcut="⇧⌘Z" />
        <IconButton icon={<Search />} label="Search" onClick={props.onSearch} shortcut="⌘F" />
        {props.canExport ? <IconButton icon={<Download />} label="Export" onClick={props.onExport} /> : null}
      </ToolSurface>
    </>
  )
}

const selectionAlignActions = [
  { direction: "left", icon: <AlignStartVertical />, label: "Left" },
  { direction: "center", icon: <AlignCenterVertical />, label: "Center" },
  { direction: "right", icon: <AlignEndVertical />, label: "Right" },
  { direction: "top", icon: <AlignStartHorizontal />, label: "Top" },
  { direction: "middle", icon: <AlignCenterHorizontal />, label: "Middle" },
  { direction: "bottom", icon: <AlignEndHorizontal />, label: "Bottom" },
] satisfies readonly { direction: CanvasAlign; icon: ReactNode; label: string }[]

const selectionDistributeActions = [
  { axis: "horizontal", icon: <AlignHorizontalSpaceBetween />, label: "Horizontal" },
  { axis: "vertical", icon: <AlignVerticalSpaceBetween />, label: "Vertical" },
] satisfies readonly { axis: CanvasDistribute; icon: ReactNode; label: string }[]

const selectionLayoutActions = [
  { layout: "horizontal", icon: <Columns3 />, label: "Horizontal" },
  { layout: "vertical", icon: <Rows3 />, label: "Vertical" },
  { layout: "grid", icon: <LayoutGrid />, label: "Grid" },
] satisfies readonly { layout: CanvasLayout; icon: ReactNode; label: string }[]

function SelectionToolbar(props: {
  canArrange: boolean
  canDistribute: boolean
  canGroup: boolean
  canUngroup: boolean
  onAlign: (direction: CanvasAlign) => void
  onDelete: () => void
  onDistribute: (axis: CanvasDistribute) => void
  onDuplicate: () => void
  onGroup: () => void
  onLayout: (layout: CanvasLayout) => void
  onUngroup: () => void
}) {
  const [arrangeMenuOpen, setArrangeMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!arrangeMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && menuRef.current?.contains(event.target)) return
      setArrangeMenuOpen(false)
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArrangeMenuOpen(false)
    }
    window.addEventListener("pointerdown", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [arrangeMenuOpen])
  useEffect(() => {
    if (props.canArrange) return
    setArrangeMenuOpen(false)
  }, [props.canArrange])
  return (
    <ToolSurface className="convax-selection-toolbar bottom-5 left-1/2 -translate-x-1/2 gap-0.5 max-[760px]:bottom-16">
      <IconButton icon={<Copy />} label="Duplicate" onClick={props.onDuplicate} shortcut="⌘D" tooltipSide="top" />
      <IconButton disabled={!props.canGroup} icon={<Group />} label="Group" onClick={props.onGroup} shortcut="⌘G" tooltipSide="top" />
      <IconButton disabled={!props.canUngroup} icon={<Ungroup />} label="Ungroup" onClick={props.onUngroup} shortcut="⇧⌘G" tooltipSide="top" />
      <span className="mx-1 h-5 w-px bg-border" />
      <div ref={menuRef} className="relative">
        <IconButton
          disabled={!props.canArrange}
          icon={<AlignStartVertical />}
          label="Align and arrange"
          onClick={() => setArrangeMenuOpen((open) => !open)}
          pressed={arrangeMenuOpen}
          tooltipSide="top"
        />
        {arrangeMenuOpen ? (
          <div className="convax-arrange-menu" data-canvas-shortcuts="ignore" role="menu">
            <div className="convax-arrange-menu__title">Align</div>
            <div className="convax-arrange-menu__grid" role="group">
              {selectionAlignActions.map((action) => (
                <button
                  key={action.direction}
                  className="convax-arrange-menu__action"
                  onClick={() => {
                    props.onAlign(action.direction)
                    setArrangeMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
            <div className="convax-arrange-menu__title">Distribute</div>
            <div className="convax-arrange-menu__grid convax-arrange-menu__grid--two" role="group">
              {selectionDistributeActions.map((action) => (
                <button
                  key={action.axis}
                  className="convax-arrange-menu__action"
                  disabled={!props.canDistribute}
                  onClick={() => {
                    props.onDistribute(action.axis)
                    setArrangeMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
            <div className="convax-arrange-menu__title">Layout</div>
            <div className="convax-arrange-menu__grid" role="group">
              {selectionLayoutActions.map((action) => (
                <button
                  key={action.layout}
                  className="convax-arrange-menu__action"
                  onClick={() => {
                    props.onLayout(action.layout)
                    setArrangeMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <IconButton disabled={!props.canArrange} icon={<LayoutGrid />} label="Tidy up" onClick={() => props.onLayout("grid")} shortcut="⌥⇧F" tooltipSide="top" />
      <span className="mx-1 h-5 w-px bg-border" />
      <IconButton icon={<Trash2 />} label="Delete" onClick={props.onDelete} shortcut="⌫" tooltipSide="top" />
    </ToolSurface>
  )
}

const zoomPresets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

function ViewportToolbar(props: {
  canLayout: boolean
  edgesHidden: boolean
  miniMapVisible: boolean
  onEdgesHiddenChange: () => void
  onFit: () => void
  onLayout: () => void
  onMiniMapChange: () => void
  onSnapChange: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  snapToGrid: boolean
}) {
  const viewport = useViewport()
  const reactFlow = useReactFlow<CanvasNode>()
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!zoomMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && menuRef.current?.contains(event.target)) return
      setZoomMenuOpen(false)
    }
    window.addEventListener("pointerdown", closeMenu)
    return () => window.removeEventListener("pointerdown", closeMenu)
  }, [zoomMenuOpen])
  return (
    <ToolSurface className="convax-viewport-toolbar bottom-3 left-3 gap-0.5">
      <IconButton icon={<Focus />} label="Fit view" onClick={props.onFit} shortcut="⌘0" tooltipSide="top" />
      <IconButton
        icon={<Workflow />}
        label={props.edgesHidden ? "Show edges" : "Hide edges"}
        onClick={props.onEdgesHiddenChange}
        pressed={props.edgesHidden}
        tooltipSide="top"
      />
      <IconButton
        disabled={!props.canLayout}
        icon={<LayoutGrid />}
        label="Tidy canvas"
        onClick={props.onLayout}
        shortcut="⌥⇧F"
        tooltipSide="top"
      />
      <IconButton icon={<Magnet />} label="Snap to grid" onClick={props.onSnapChange} pressed={props.snapToGrid} tooltipSide="top" />
      <IconButton icon={<MapPinned />} label="Minimap" onClick={props.onMiniMapChange} pressed={props.miniMapVisible} tooltipSide="top" />
      <span className="mx-1 h-5 w-px bg-border" />
      <IconButton icon={<ZoomOut />} label="Zoom out" onClick={props.onZoomOut} shortcut="⌘−" tooltipSide="top" />
      <div ref={menuRef} className="relative">
        <Tooltip content="Zoom presets" side="top">
          <Button
            aria-expanded={zoomMenuOpen}
            aria-haspopup="menu"
            className="convax-zoom-trigger"
            onClick={() => setZoomMenuOpen((open) => !open)}
            size="sm"
            variant="ghost"
          >
            <span>{Math.round(viewport.zoom * 100)}%</span>
            <ChevronUp className={cn("transition-transform", zoomMenuOpen && "rotate-180")} />
          </Button>
        </Tooltip>
        {zoomMenuOpen ? (
          <div className="convax-zoom-menu" data-canvas-shortcuts="ignore" role="menu">
            <div className="convax-zoom-menu__title">Zoom</div>
            {zoomPresets.map((zoom) => (
              <button
                key={zoom}
                className="convax-zoom-menu__item"
                onClick={() => {
                  void reactFlow.zoomTo(zoom, { duration: 160 })
                  setZoomMenuOpen(false)
                }}
                role="menuitem"
                type="button"
              >
                <span>{Math.round(zoom * 100)}%</span>
                {Math.abs(viewport.zoom - zoom) < 0.01 ? <Check /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <IconButton icon={<ZoomIn />} label="Zoom in" onClick={props.onZoomIn} shortcut="⌘+" tooltipSide="top" />
    </ToolSurface>
  )
}

function CanvasContextMenu(props: {
  canArrange: boolean
  canDistribute: boolean
  canGroup: boolean
  canRedo: boolean
  canUngroup: boolean
  canUndo: boolean
  canUpload: boolean
  hasNodeSelection: boolean
  hasSelection: boolean
  onAddNote: () => void
  onAddText: () => void
  onAlign: (direction: CanvasAlign) => void
  onCopy: () => void
  onDelete: () => void
  onDistribute: (axis: CanvasDistribute) => void
  onDuplicate: () => void
  onFit: () => void
  onGroup: () => void
  onLayout: () => void
  onPaste: () => void
  onRedo: () => void
  onUngroup: () => void
  onUndo: () => void
  onUpload: () => void
  readOnly: boolean
}) {
  return (
    <ContextMenuContent className="w-60">
      {!props.readOnly ? <ContextMenuLabel>Create</ContextMenuLabel> : null}
      {!props.readOnly ? <ContextMenuItem onSelect={props.onAddText}><Type />Add text</ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuItem onSelect={props.onAddNote}><StickyNote />Add note</ContextMenuItem> : null}
      {props.canUpload && !props.readOnly ? <ContextMenuItem onSelect={props.onUpload}><FileUp />Upload files</ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuSeparator /> : null}
      <ContextMenuLabel>Canvas</ContextMenuLabel>
      {!props.readOnly ? <ContextMenuItem onSelect={props.onPaste}><ClipboardPaste />Paste<Shortcut>⌘V</Shortcut></ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuItem disabled={!props.canUndo} onSelect={props.onUndo}><Undo2 />Undo<Shortcut>⌘Z</Shortcut></ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuItem disabled={!props.canRedo} onSelect={props.onRedo}><Redo2 />Redo<Shortcut>⇧⌘Z</Shortcut></ContextMenuItem> : null}
      <ContextMenuItem onSelect={props.onFit}><Focus />Fit view<Shortcut>⌘0</Shortcut></ContextMenuItem>
      {props.hasSelection ? <ContextMenuSeparator /> : null}
      {props.hasSelection ? <ContextMenuLabel>Selection</ContextMenuLabel> : null}
      {props.hasNodeSelection ? <ContextMenuItem onSelect={props.onCopy}><Copy />Copy<Shortcut>⌘C</Shortcut></ContextMenuItem> : null}
      {props.hasNodeSelection && !props.readOnly ? <ContextMenuItem onSelect={props.onDuplicate}><Copy />Duplicate<Shortcut>⌘D</Shortcut></ContextMenuItem> : null}
      {props.canGroup && !props.readOnly ? <ContextMenuItem onSelect={props.onGroup}><Group />Group<Shortcut>⌘G</Shortcut></ContextMenuItem> : null}
      {props.canUngroup && !props.readOnly ? <ContextMenuItem onSelect={props.onUngroup}><Ungroup />Ungroup<Shortcut>⇧⌘G</Shortcut></ContextMenuItem> : null}
      {props.canArrange && !props.readOnly ? <ContextMenuItem onSelect={props.onLayout}><LayoutGrid />Tidy up<Shortcut>⌥⇧F</Shortcut></ContextMenuItem> : null}
      {props.canArrange && !props.readOnly ? <ContextMenuItem onSelect={() => props.onAlign("left")}><AlignStartVertical />Align left</ContextMenuItem> : null}
      {props.canArrange && !props.readOnly ? <ContextMenuItem onSelect={() => props.onAlign("top")}><AlignStartHorizontal />Align top</ContextMenuItem> : null}
      {props.canDistribute && !props.readOnly ? <ContextMenuItem onSelect={() => props.onDistribute("horizontal")}><AlignHorizontalSpaceBetween />Distribute horizontally</ContextMenuItem> : null}
      {props.canDistribute && !props.readOnly ? <ContextMenuItem onSelect={() => props.onDistribute("vertical")}><AlignVerticalSpaceBetween />Distribute vertically</ContextMenuItem> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuSeparator /> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem className="text-destructive" onSelect={props.onDelete}><Trash2 />Delete<Shortcut>⌫</Shortcut></ContextMenuItem> : null}
    </ContextMenuContent>
  )
}
