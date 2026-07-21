# Canvas 选择上下文与上下文操作面

状态：已采纳，2026-07-17。

本文定义 Convax 如何根据 Canvas 选择派生上下文 UI，解决多选时每个已选节点都显示一套
节点工具栏的问题，并明确选择、编辑模式、DOM 焦点与命令执行之间的边界。

## 决策

`CanvasSelection` 是 Canvas 元素选择状态的唯一事实源。它继续由无序的节点 ID 集合与边
ID 集合组成。Convax 从该状态纯派生 `CanvasSelectionContext`：

```ts
type CanvasSelectionContext =
  | { kind: "none" }
  | { kind: "single-node"; nodeId: CanvasNodeId }
  | { kind: "multi-node"; nodeIds: ReadonlySet<CanvasNodeId> }
  | { kind: "single-edge"; edgeId: CanvasEdgeId }
  | { kind: "multi-edge"; edgeIds: ReadonlySet<CanvasEdgeId> }
  | {
      kind: "mixed"
      nodeIds: ReadonlySet<CanvasNodeId>
      edgeIds: ReadonlySet<CanvasEdgeId>
    }
```

该上下文只存在于内存中，不持久化、不参与同步、不写入 Canvas 文档，也不成为第二份
selection 状态。

Node toolbar 是 `single-node` 上下文的一种呈现，不是名为 `nodeToolbarActive` 的状态。
多节点选择和节点/边混合选择都是 aggregate context，不能为集合中的每个成员分别激活
node-local surface。

## 同类编辑器依据

Figma 和 Canva 没有公开完整的编辑器内部架构。以下内容区分了可由公开产品或 SDK 契约
验证的事实，以及 Convax 基于这些事实作出的设计推断。

### Figma

- Figma 将 `PageNode.selection` 暴露为 direct selection 集合，并明确说明其顺序未定义。
  调用方不能把 `selection[0]` 当作稳定的 primary 或 focused object。参见
  [Plugin API selection 契约](https://developers.figma.com/docs/plugins/api/properties/PageNode-selection/)。
- 多个对象组成一个 selection，可以整体移动、缩放、修改属性或创建 group/frame。参见
  [选择图层和对象](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)。
- mixed value 是一等 UI 语义。Figma 会汇总当前多选中的 Selection Colors，而不是任取
  一个成员的颜色。参见
  [混合选择颜色](https://help.figma.com/hc/en-us/articles/360042553434-View-and-adjust-colors-in-a-mixed-selection)。
- Plugin API 的 `figma.mixed` 是某个节点属性自身含多个值时的 sentinel，并不是跨
  `PageNode.selection` 归并共同属性的 API。它只能证明 mixed value 会被显式表达，不能
  用来推断 Figma 内部的多选属性归并算法。参见
  [`figma.mixed`](https://developers.figma.com/docs/plugins/api/properties/figma-mixed/)。
- selection 与 editing 是分开的。`selectedTextRange` 标识文本编辑目标和范围；vector
  editing 也是在完成选择后显式进入，并显示独立的 secondary tools。参见
  [`selectedTextRange`](https://developers.figma.com/docs/plugins/api/properties/PageNode-selectedtextrange/)
  和 [vector edit mode](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)。

因此，Figma 的公开契约没有暴露或保证通用、稳定的 primary/focused selection，Convax
不能据此建立稳定产品语义。这不否认 Figma 内部可能存在手势 anchor、last-clicked node
等瞬态实现。

### Canva

- Canva Selection API 通过 `count` 与 `contents` 表达零个、一个或多个已选内容。其设计
  规范建议应用通常应支持多选；若某项能力只支持单项，应禁用相关控件或解释限制，而
  不是暗中选择某一个成员。参见
  [Selection API](https://www.canva.dev/docs/apps/selection/) 和
  [Selection 设计规范](https://www.canva.dev/docs/apps/design-guidelines/selection/)。
- selection change 只应更新 UI 可用性，不能被解释为执行授权。Canva 明确反对仅因用户
  改变选择就自动执行替换、生成或其他昂贵操作，真正修改必须来自显式用户动作。
- element selection 与 element-internal editing 具有不同生命周期。文本编辑、图片重新
  定位和 App overlay 都需要显式进入，并具有各自的完成或取消行为。参见
  [文本编辑](https://www.canva.com/help/add-and-edit-text/)、
  [图片重新定位](https://www.canva.com/help/add-background/)和
  [Overlay 设计规范](https://www.canva.dev/docs/apps/design-guidelines/overlays/)。

因此，Canva 进一步支持三条原则：多选是一等 aggregate；单项能力必须 fail closed；
editing mode 不等于 toolbar visibility。

### React Flow

Convax 当前使用 `@xyflow/react` 12.11.2。它的 `NodeToolbar` 已内置单选保护：

- 不传 `isVisible` 时，只有目标节点被选中且全图恰好只有一个 selected node，toolbar
  才会显示；
- 传入任意 boolean `isVisible` 都会覆盖该默认规则；
- `nodeId: string[]` 会把一份 toolbar 锚定到多个节点的联合包围盒，而不是为每个节点
  创建一份 toolbar。

参见官方 [`NodeToolbar` API](https://reactflow.dev/api-reference/components/node-toolbar)、
[示例](https://reactflow.dev/examples/nodes/node-toolbar)和
[源码](https://github.com/xyflow/xyflow/blob/main/packages/react/src/additional-components/NodeToolbar/NodeToolbar.tsx)。

React Flow 的默认规则只统计 selected nodes，不统计 selected edges。Convax 仍必须从自身
的 `CanvasSelection` 派生产品语义：一个节点加一条边属于 `mixed`，不能显示 node-local
actions。

## Convax 交互模型

以下层级必须保持分离：

```text
CanvasSelection                         已选 ID 集合的唯一事实源
  -> CanvasSelectionContext             派生的 none/single/multi/mixed 形态
     -> contextual surfaces             节点、边或 aggregate selection actions

Canvas editing mode                     文本、插件、裁剪等模式的目标与生命周期
DOM focus                               键盘与无障碍输入路由
Command execution                       显式的用户/Agent 意图与 revision guard
```

交互不变量如下：

1. selection 集合的顺序永远不代表 primary node。若未来某个手势需要 anchor，或某个模式
   需要局部 target，必须把它建模为该手势或模式内具名、限域的状态。
2. 由 selection 派生的 node-local mutation toolbar 必须同时满足：上下文为该节点的
   `single-node`、具备相关 capability/permission、当前不是 read-only。具有显式 target
   和独立生命周期的 connection/context overlay 不受这条 toolbar 规则约束；read-only
   下允许的 inspect/copy surface 也应按自身 capability 判定。
3. `multi-node` 与 `mixed` 最多只能呈现一份 aggregate contextual action surface，并且只包含
   适用于整个 selection 的操作。未来若增加共同属性面板，应显式表达 common value 与
   mixed value。Resize handle 属于 transform affordance，不在这条 action surface 规则内；
   本次仍保持现状，后续单独设计 aggregate transform box。
4. selection change 可以结束不再兼容的 editing mode，但不能因此自动执行一次业务操作。
5. DOM focus 永远不能充当 Canvas selection 或 editing ownership 的同义词。
6. 临时 multi-selection 不是持久化的 Canvas group。

## React Flow 适配规则

- 每节点 `NodeToolbar` 只在该节点拥有 `single-node` 上下文时挂载，并且不传
  `isVisible`，继续保留 React Flow 的默认安全检查。
- 用户显式打开、具有自身生命周期的 overlay，例如 connection menu，可以传
  `isVisible`，因为此时可见性不再只由 selection 推导。
- Convax 继续拥有 selection。不能引入 `useOnSelectionChange` 作为第二份事实源，也不能
  将 React Flow selection 镜像到另一个 controller。
- `SelectionToolbar` 继续作为 selection-level surface：它用于 multi-node aggregate，也在
  单选 group 时承载 Ungroup。Canvas 只渲染一份
  `NodeToolbar nodeId={selectedNodeIds} isVisible position={Position.Top}`，由 React Flow 按
  节点 absolute bounds 的联合包围盒锚定到选区顶部，并自动跟随节点移动、pan 与 zoom。
  传入 `isVisible` 前必须先由 Convax 显式验证当前是允许该 surface 的 aggregate context；
  这里的覆盖是 aggregate toolbar 自身生命周期的一部分，不能用于每节点 toolbar。

## 本次实现范围

本次改动：

- 新增并测试纯函数 `deriveCanvasSelectionContext`；
- 通过 `CanvasEditorController` 暴露派生上下文；
- 将内置 node toolbar、renderer contribution toolbar 与 file assistant accessory 限定在
  对应节点的 `single-node` 上下文；
- selection 离开对应节点的 `single-node` 上下文时，结束文本编辑并关闭 node-local
  connection UI；
- `SelectionToolbar` 只在 `multi-node` 或单选 group 上下文显示；`mixed` 下隐藏 node-only
  aggregate actions，右键菜单也只保留真正作用于整个 selection 的操作。

multi-selection resize geometry 属于独立的产品决策。本次不把每节点 resize handles 改造
成 aggregate transform box。

## 验收标准

- 无选择：不显示 node-local contextual toolbar。
- 恰好选择一个节点且未选边：只允许该节点的内置、contributed 与 assistant contextual
  surfaces 显示；若该节点是 group，可同时显示承载 Ungroup 的 selection-level surface。
- 选择两个及以上节点：不显示任何 per-node contextual toolbar；最多显示一份
  锚定在选区最小联合包围盒顶部的 selection-level action surface。
- 同时选择节点和任意边：上下文为 `mixed`，不显示 node-local contextual toolbar。
- 只选择一条或多条边：只允许未来的 edge actions 或 selection actions 显示。
- read-only：mutation toolbar 保持隐藏。
- 在 single-selection 与 multi-selection 间切换时，surface 正确关闭和恢复，不保留过期的
  node-local editing state。

## 未采用方案

- `nodeToolbarActive`：把一个 UI 实现编码成状态，并重复 selection 语义。
- 从遍历顺序派生 `primaryNodeId`：Figma 与 Canva 都不保证第一个选择项具有稳定意义，
  Convax selection 本身也是集合。
- 每个已选节点显示一份 toolbar：会产生重叠控件，并使命令作用域不明确。
- 把 React Flow selection 作为另一份状态源：容易产生更新循环，并与 mounted Canvas view
  已有的 canonical selection 漂移。
