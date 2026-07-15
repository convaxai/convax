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
  Copy,
  Download,
  FileUp,
  Focus,
  Group,
  LayoutGrid,
  LoaderCircle,
  MousePointer2,
  Redo2,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Ungroup,
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

const defaultNodeRegistry = createDefaultCanvasNodeRegistry()

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
  const [prompt, setPrompt] = useState("")
  const [query, setQuery] = useState("")
  const [generating, setGenerating] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [insertPoint, setInsertPoint] = useState<CanvasPoint | null>(null)
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
  const nodes = useMemo(() => {
    const byId = new Map(history.document.nodes.map((node) => [node.id, node]))
    const depth = (node: CanvasNode): number => {
      const parent = node.parentId ? byId.get(node.parentId) : undefined
      return parent ? depth(parent) + 1 : 0
    }
    return history.document.nodes
      .map((node) => node.selected === selection.nodeIds.has(node.id)
        ? node
        : { ...node, selected: selection.nodeIds.has(node.id) })
      .sort((left, right) => depth(left) - depth(right))
  }, [history.document.nodes, selection.nodeIds])
  const edges = useMemo(
    () => history.document.edges.map((edge) => ({ ...edge, selected: selection.edgeIds.has(edge.id) })),
    [history.document.edges, selection.edgeIds],
  )
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
  const layout = useCallback(() => {
    commit((document) => layoutCanvasNodes(document, { nodeIds: selectedNodeIds }))
  }, [commit, selectedNodeIds])
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
      layout,
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
      beginGesture: () => dispatch({ type: "begin-gesture" }),
      endGesture: () => dispatch({ type: "end-gesture" }),
      commit,
      selectNodes,
    }),
    [commit, history.document, readOnly, selectNodes, selection],
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
              className={cn("convax-canvas relative size-full overflow-hidden bg-background text-foreground outline-none", props.className)}
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
                connectionLineStyle={{ stroke: "var(--ring)", strokeWidth: 1.5 }}
                deleteKeyCode={null}
                edges={edges}
                elementsSelectable={!readOnly}
                fitView
                fitViewOptions={{ maxZoom: 1.2, padding: 0.3 }}
                maxZoom={2.5}
                minZoom={0.15}
                nodeTypes={nodeTypes}
                nodes={nodes}
                nodesConnectable={!readOnly}
                nodesDraggable={!readOnly}
                nodesFocusable
                nodeDragThreshold={4}
                panActivationKeyCode="Space"
                panOnDrag={[1]}
                panOnScroll
                selectionOnDrag
                selectionMode={SelectionMode.Partial}
                snapGrid={[8, 8]}
                snapToGrid
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
                <Background color="var(--border)" gap={24} size={1.2} variant={BackgroundVariant.Dots} />
                <MiniMap
                  className="!bottom-4 !right-4 !h-24 !w-36 !rounded-md !border !border-border !bg-card !shadow-sm"
                  maskColor="color-mix(in oklab, var(--background) 68%, transparent)"
                  nodeColor="var(--muted-foreground)"
                  pannable
                  zoomable
                />
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
                  canGroup={selectedNodeIds.length > 1}
                  canUngroup={selectedNodeIds.some((id) => history.document.nodes.some((node) => node.id === id && node.type === "group"))}
                  onDelete={remove}
                  onDuplicate={duplicate}
                  onGroup={group}
                  onLayout={layout}
                  onUngroup={ungroup}
                />
              ) : null}

              <ViewportToolbar
                onFit={() => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 })}
                onZoomIn={() => void reactFlow.zoomIn({ duration: 140 })}
                onZoomOut={() => void reactFlow.zoomOut({ duration: 140 })}
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
            canGroup={selectedNodeIds.length > 1}
            canUngroup={selectedNodeIds.some((id) => history.document.nodes.some((node) => node.id === id && node.type === "group"))}
            hasSelection={selectedNodeIds.length > 0 || selectedEdgeIds.length > 0}
            onAddNote={() => addNode("note")}
            onAddText={() => addNode("text")}
            onAlign={() => commit((document) => alignCanvasNodes(document, selectedNodeIds, "left"))}
            onCopy={copy}
            onDelete={remove}
            onDistribute={() => commit((document) => distributeCanvasNodes(document, selectedNodeIds, "horizontal"))}
            onDuplicate={duplicate}
            onFit={() => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 })}
            onGroup={group}
            onLayout={layout}
            onPaste={paste}
            onUngroup={ungroup}
            readOnly={readOnly}
          />
        </ContextMenu>
      </TooltipProvider>
    </CanvasEditorProvider>
  )
}

function IconButton(props: { disabled?: boolean; icon: ReactNode; label: string; onClick: () => void; shortcut?: string }) {
  return (
    <Tooltip content={<span className="flex items-center gap-3">{props.label}{props.shortcut ? <Shortcut>{props.shortcut}</Shortcut> : null}</span>}>
      <Button aria-label={props.label} disabled={props.disabled} onClick={props.onClick} size="icon-sm" variant="ghost">
        {props.icon}
      </Button>
    </Tooltip>
  )
}

function ToolSurface(props: { children: ReactNode; className?: string }) {
  return <div className={cn("absolute z-20 flex items-center rounded-md border border-border bg-card/95 p-1 text-card-foreground shadow-sm backdrop-blur", props.className)}>{props.children}</div>
}

function FloatingPanel(props: { children: ReactNode; className?: string }) {
  return <div className={cn("absolute z-30 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg", props.className)}>{props.children}</div>
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

function SelectionToolbar(props: {
  canGroup: boolean
  canUngroup: boolean
  onDelete: () => void
  onDuplicate: () => void
  onGroup: () => void
  onLayout: () => void
  onUngroup: () => void
}) {
  return (
    <ToolSurface className="bottom-5 left-1/2 -translate-x-1/2 gap-0.5">
      <IconButton icon={<Copy />} label="Duplicate" onClick={props.onDuplicate} shortcut="⌘D" />
      <IconButton disabled={!props.canGroup} icon={<Group />} label="Group" onClick={props.onGroup} shortcut="⌘G" />
      <IconButton disabled={!props.canUngroup} icon={<Ungroup />} label="Ungroup" onClick={props.onUngroup} shortcut="⇧⌘G" />
      <IconButton icon={<LayoutGrid />} label="Auto layout" onClick={props.onLayout} shortcut="⌥⇧F" />
      <span className="mx-1 h-5 w-px bg-border" />
      <IconButton icon={<Trash2 />} label="Delete" onClick={props.onDelete} shortcut="⌫" />
    </ToolSurface>
  )
}

function ViewportToolbar(props: { onFit: () => void; onZoomIn: () => void; onZoomOut: () => void }) {
  const viewport = useViewport()
  return (
    <ToolSurface className="bottom-4 left-4 gap-0.5">
      <IconButton icon={<ZoomOut />} label="Zoom out" onClick={props.onZoomOut} shortcut="⌘−" />
      <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(viewport.zoom * 100)}%</span>
      <IconButton icon={<ZoomIn />} label="Zoom in" onClick={props.onZoomIn} shortcut="⌘+" />
      <IconButton icon={<Focus />} label="Fit view" onClick={props.onFit} shortcut="⌘0" />
    </ToolSurface>
  )
}

function CanvasContextMenu(props: {
  canGroup: boolean
  canUngroup: boolean
  hasSelection: boolean
  onAddNote: () => void
  onAddText: () => void
  onAlign: () => void
  onCopy: () => void
  onDelete: () => void
  onDistribute: () => void
  onDuplicate: () => void
  onFit: () => void
  onGroup: () => void
  onLayout: () => void
  onPaste: () => void
  onUngroup: () => void
  readOnly: boolean
}) {
  return (
    <ContextMenuContent>
      <ContextMenuLabel>Canvas</ContextMenuLabel>
      {!props.readOnly ? <ContextMenuItem onSelect={props.onAddText}><Type />Add text</ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuItem onSelect={props.onAddNote}><StickyNote />Add note</ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuItem onSelect={props.onPaste}>Paste<Shortcut>⌘V</Shortcut></ContextMenuItem> : null}
      <ContextMenuItem onSelect={props.onFit}><Focus />Fit view<Shortcut>⌘0</Shortcut></ContextMenuItem>
      {props.hasSelection ? <ContextMenuSeparator /> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem onSelect={props.onCopy}>Copy<Shortcut>⌘C</Shortcut></ContextMenuItem> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem onSelect={props.onDuplicate}><Copy />Duplicate<Shortcut>⌘D</Shortcut></ContextMenuItem> : null}
      {props.canGroup && !props.readOnly ? <ContextMenuItem onSelect={props.onGroup}><Group />Group<Shortcut>⌘G</Shortcut></ContextMenuItem> : null}
      {props.canUngroup && !props.readOnly ? <ContextMenuItem onSelect={props.onUngroup}><Ungroup />Ungroup<Shortcut>⇧⌘G</Shortcut></ContextMenuItem> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem onSelect={props.onLayout}><LayoutGrid />Auto layout<Shortcut>⌥⇧F</Shortcut></ContextMenuItem> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem onSelect={props.onAlign}>Align left</ContextMenuItem> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem onSelect={props.onDistribute}>Distribute horizontally</ContextMenuItem> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuSeparator /> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem className="text-destructive" onSelect={props.onDelete}><Trash2 />Delete<Shortcut>⌫</Shortcut></ContextMenuItem> : null}
    </ContextMenuContent>
  )
}
