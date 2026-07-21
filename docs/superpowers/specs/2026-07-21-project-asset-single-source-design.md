# Project 资产单一事实来源与 Managed Asset 回收设计

日期：2026-07-21
状态：待实现（破坏性重构）
范围：Project 文件引用、Canvas 文件节点、外部资产接纳、文本编辑、生成结果发布、文件监听、去重、垃圾回收和旧资源模型删除

> 本设计采用一次性破坏性切换。新版本只实现并持久化本文定义的新资源模型，
> 不兼容、不迁移、不双读、不双写旧 Canvas 资源格式和旧 managed asset 布局。

## 1. 背景

当前 Canvas 对不同内容类型采用了不一致的持久化方式：

- Project 内的图片、视频、音频等文件在进入 Canvas 时会复制到
  `.convax/assets`，同一文件重复拖入会生成多个按名称避冲突的副本；
- 文本文件进入 Canvas 时会把正文直接写入 Canvas 文档；
- Canvas 新建文本同样以内嵌正文为事实来源；
- 已进入 Canvas 的内容不会与原 Project 文件形成统一、明确的同步关系；
- 普通节点删除没有对应的 managed asset 自动回收流程。

这会造成以下问题：

1. 用户的 Project 文件与 Canvas 内部副本形成两个内容来源；
2. 同一大文件重复进入 Canvas 会重复占用磁盘；
3. 文本、图片和视频具有不同的读取、编辑与持久化语义；
4. 外部修改无法稳定反映到 Canvas；
5. `.convax/assets` 会积累无引用文件；
6. Agent、Plugin、原生集成可能读取到与用户文件不同的副本。

本设计将用户的 Project 文件确立为内容层，将 Canvas 收敛为视图、布局和关系层。

## 2. 设计目标

### 2.1 核心目标

- 用户资产是内容的唯一事实来源；
- Canvas 文档只保存布局、关系、展示配置和类型化文件引用；
- Project 内文件进入 Canvas 时保持原位，不创建 managed copy；
- Project 外文件进入 Canvas 时只在 `.convax/assets` 保存一个内容寻址副本；
- 文本、图片、视频、音频和普通文件使用一致的引用模型；
- Canvas 新建内容和生成内容直接发布为用户可见的 Project 文件；
- 同一资源可被多个节点和多个 Canvas 共同引用；
- 无引用 managed asset 在安全宽限期后自动回收；
- Agent、Plugin、UI 和原生集成通过同一受控资源能力读取文件；
- 保持 Project 可移植性，不持久化主机绝对路径。
- 一次性删除旧资源模型、旧 API 和旧行为，不保留运行时兼容分支。

### 2.2 非目标

- 不实现跨设备实时协作或分布式文件同步；
- 不为所有 Project 文件建立全局资源数据库；
- 不把 `.convax/assets` 变成用户文件版本历史；
- 不自动删除任何 Project 可见目录中的文件；
- 不承诺无歧义地识别所有外部文件移动；
- 不用持久化引用计数代替对 Canvas 文档的真实扫描；
- 不改变现有内部 package 依赖方向；
- 不自动迁移、转换或修复旧 Canvas 资源数据；
- 不保证使用旧资源 schema 的 Project 可由新版本打开；
- 不提供旧格式导入器、兼容模式、feature flag 或回退写入路径。

## 3. 核心决策

### 3.1 内容与视图分离

```text
实际文件内容
  ├─ Project 内用户文件
  └─ .convax/assets 中的外部导入副本

Canvas 文档
  └─ 节点布局、关系、展示配置和文件引用
```

Canvas 文档不再持久化：

- 文本正文；
- 媒体二进制；
- `data:` URL；
- `blob:` URL；
- 原生绝对路径；
- 可从文件引用重新生成的运行时 URL。

### 3.2 不引入 Resource Catalog

本设计不增加完整的 Project Resource Catalog。

完整 Catalog 原本可以集中存储稳定资源 id、当前路径、MIME、大小、哈希和引用状态，但它也会成为需要与 Canvas 文档和文件系统持续同步的第二套持久化索引。当前需求可以通过以下更小模型满足：

- Project 文件直接持久化 Project 相对路径；
- managed asset 直接以 SHA-256 作为身份；
- MIME、大小和 revision 从文件系统实时推导；
- GC 通过扫描 Canvas 文档计算真实引用集合；
- 仅用 `.convax/assets/gc.json` 保存孤儿首次发现时间。

未来只有在明确需要资源标签、版本历史、海量 Canvas 索引加速或路径无关稳定身份时，才重新评估 Resource Catalog。

### 3.3 推荐方案与被拒绝方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 每次拖入都复制到 `.convax/assets` | 拒绝 | 重复占用空间并产生第二内容来源 |
| 长期引用 Project 外绝对路径 | 拒绝 | 不可移植、授权复杂且容易失效 |
| Project 内直接引用，Project 外导入并按内容去重 | 采用 | 保持用户资产主权、可移植性和安全边界 |
| 持久化引用计数并在归零时立即删除 | 拒绝 | 容易因崩溃和并发漂移而误删 |
| 延迟 mark-and-sweep | 采用 | 可以从真实 Canvas 文档重建引用并提供撤销宽限期 |
| 保留旧资源模型并渐进迁移 | 拒绝 | 形成长期双轨逻辑，扩大状态组合和测试面 |
| 一次性切换并删除旧资源逻辑 | 采用 | 只维护一种 schema、资产布局和资源语义 |

## 4. 持久化布局

```text
<project root>/
  Notes/
    Untitled.md
    Untitled.convax-note.json

  Generated/
    image-20260721-001.png

  .convax/
    project.json
    canvases/
      catalog.json
      <canvas-id>/
        document.json

    transactions/
      path-move-<operation-id>.json
      canvas-catalog-<operation-id>/
        transaction.json
        canvas/
      generated-publish-<operation-id>/
        transaction.json
        outputs/
          <output-index>
      asset-gc-delete-<operation-id>/
        transaction.json
        quarantine/
          <64-character-sha256>

    assets/
      gc.json
      blobs/
        sha256/
          ab/
            <64-character-sha256>
      staging/
        <operation-id>
```

约束如下：

- `Notes/` 是 Canvas 新建文本的默认用户可见目录；
- `Generated/` 是 AI、Plugin 和其他生成能力的默认用户可见输出目录；
- `.convax/assets/blobs` 只保存从 Project 外部接纳的持久副本；
- `.convax/assets/staging` 只保存尚未完成发布的临时文件；
- `.convax/assets/gc.json` 只保存 GC 调度和孤儿宽限状态；
- `.convax/transactions` 只保存尚未完成的短生命周期跨文件事务记录、create/delete Canvas 的 staged/quarantined 目录、生成发布 staging 和 GC 的私有删除隔离区，成功恢复或提交后立即删除；
- `.convax/assets` 不保存 Project 内已有文件的副本；
- Project 可见文件永远不参与 managed asset 自动回收。

## 5. 类型化资源引用

Project 为 Canvas 提供两种可移植内容引用和一种目录定位引用：

```ts
export type ProjectCanvasResourceReference =
  | {
      kind: "project-file"
      path: string
      fingerprint?: {
        modifiedAtMs: number
        sha256?: string
        size: number
      }
    }
  | {
      kind: "managed-asset"
      sha256: string
      name?: string
      mimeType?: string
    }
  | {
      kind: "project-directory"
      path: string
    }
```

Canvas core 不直接认识上述 Project union，而是持久化一个 host-neutral envelope：

```ts
export interface CanvasResourceReferenceEnvelope {
  provider: string
  reference: JsonValue
}

export interface CanvasNodeResources {
  primary?: CanvasResourceReferenceEnvelope
  poster?: CanvasResourceReferenceEnvelope
  plugin?: Record<string, CanvasResourceReferenceEnvelope>
}
```

Canvas core 负责 envelope、JSON 大小和 slot 名称校验；`@convax/project/canvas` 只接受
`provider: "convax.project"`，并把 `reference` 严格解析为
`ProjectCanvasResourceReference`。未知 provider、额外字段、无效 Project 引用或混合新旧资源字段都会使整个文档无效，不允许部分 hydration。

### 5.1 Project 文件引用

- `path` 是规范化 POSIX 分隔符的 Project 相对路径；
- `path` 是当前定位信息，不是主机绝对路径；
- `fingerprint` 是可选的非权威恢复提示；大小和时间戳只能用于列出候选，只有
  SHA-256 完全匹配才允许自动恢复路径；
- 文件内容、大小、MIME 和当前 revision 不作为 Canvas 持久化事实来源；
- Runtime 每次通过 Project 能力解析并验证该路径。

### 5.2 Managed asset 引用

- `sha256` 是文件内容身份；
- 物理路径由 SHA-256 确定，无需额外 Catalog 映射；
- `name` 只用于用户展示和导出建议；
- `mimeType` 是提示，读取时仍需验证实际文件签名；
- 相同 SHA-256 在同一 Project 中最多有一个持久 blob。

### 5.3 Project 目录引用

`project-directory` 只允许用于 folder node 的 `resources.primary`。其路径必须解析为 Project 内真实目录，不参与文件内容读取、Plugin/Agent 文件能力或 managed asset GC。

### 5.4 Canvas 节点

Canvas 保持 host-neutral。新 schema 为所有已有 node kind 定义唯一持久化形态：

| node kind | 新 schema 资源字段 | 明确删除的旧持久化字段 |
| --- | --- | --- |
| `text` | `resources.primary` 必填；可引用 Project 文件或只读 managed asset；`format` 只允许 `plain`、`markdown` 或 `rich-text-json` | `text`、`richText`、`url` |
| `image` / `video` / `audio` / `file` | `resources.primary` 必填；`resources.poster` 仅在海报本身是独立持久文件时使用 | `url`、`posterUrl` |
| `folder` | `resources.primary` 必填且只能是 `project-directory` | 顶层 `path` |
| `plugin.*` 文件节点 | `resources.plugin` 保存 host 管理的命名资源绑定；是否需要 `primary` 由 host 注册的节点契约决定 | Plugin state 内嵌路径、哈希或资源 envelope |
| `group` / `agent` | 不允许持久化资源字段 | 任意资源字段 |

`url`、`posterUrl` 和文本正文只存在于 runtime hydrated view model，不属于
`CanvasDocument`。文件名、MIME、尺寸和时长可以作为非权威展示提示。文本
`format` 是选择严格文件解码器所需的 schema 判别值，但文件扩展名、MIME 和
内容头仍必须与它一致；任何不一致都 fail closed，不能把二进制或未知格式当作
纯文本打开后覆盖。

Plugin 的 `convaxPluginState` 仍是 Plugin 拥有的有界 JSON，但不得直接持有 Project 路径、managed SHA-256 或 resource envelope。Plugin 如需持久拥有二进制资源，必须通过 host 能力创建 `resources.plugin[slot]` 绑定，私有 state 只保存 slot key。通过 Canvas 入边读取的文件仍由源 file node 持有，不在 Plugin node 上复制引用。

`@convax/canvas` 提供唯一的 `collectCanvasResourceEnvelopes(document)` schema traversal，枚举 `primary`、`poster` 和每个 Plugin binding。GC、复制、导出和诊断都复用该 traversal，不允许各自递归扫描任意 metadata JSON。

节点仍然保存：

- 节点 id；
- 文件类型与展示名称；
- 位置、尺寸、适配方式和其他展示属性；
- Canvas 边和分组关系；
- 上述显式 `resources` 引用槽位；
- 与内容无关的 namespaced Plugin 状态。

## 6. 资源读取与运行时 hydration

所有调用方使用同一受控资源能力：

```text
Canvas node reference
  -> Project-scoped resource resolver
  -> real-path / containment / identity validation
  -> typed read handle or runtime URL
  -> Canvas renderer / Agent / Plugin / native integration
```

资源读取返回同一已验证文件句柄上的 snapshot：

```ts
interface ResourceSnapshot {
  cacheRevision: string
  contentRevision?: string
  url: string
}
```

运行时 URL 必须包含 `cacheRevision`，例如：

```text
convax-asset://<project-id>/file?...&revision=<cache-revision>
```

这样外部文件修改后不会因为浏览器缓存继续展示旧内容。

两类 revision 不得混用：

- `cacheRevision` 可以由文件身份、大小、高精度修改时间和 watcher generation 组成，只用于缓存失效和 UI 刷新，不具有并发控制权威性；
- `contentRevision` 是从同一个 no-follow 已验证句柄读取全部字节后计算的实际 SHA-256。可编辑 Project 文件必须返回该值；managed asset 的路径哈希只是 expected digest，不能直接作为已验证 revision 返回；
- 文本保存、高风险外部调用和任何声称 expected revision 的 API 必须比较 `contentRevision`，不得只比较 mtime、size、inode/file id 或 watcher 序号；
- 大型只读媒体可以延迟计算 `contentRevision`，但在计费调用、Plugin 外部执行或其他高风险边界前必须计算并复核。

这保证相同大小、mtime 被保留或文件身份复用时仍能发现内容变化。它不能阻止不遵守 Convax 协调器的外部进程在最后一次校验后再次写文件，因此本文只对 Main-mediated 写入提供强 OCC；对任意外部编辑器提供内容级冲突检测和明确的剩余竞态说明，不宣称跨进程原子 compare-and-swap。

解析 managed asset 时，Main 必须打开并验证 no-follow 句柄，从该句柄流式计算实际 SHA-256，再与引用和内容寻址路径中的 expected digest 比较。只有相等时才能返回该实际 digest 作为 `contentRevision` 或把字节交给高风险调用。普通渲染可以只返回 `cacheRevision` 并延迟内容哈希；任何没有实际读取字节的路径都不得声称拥有 `contentRevision`。digest 不匹配时返回类型化 `ManagedAssetCorruption`、不返回资源字节，并禁止把该文件当作合法 blob 自动删除或覆盖。

## 7. Project 内文件进入 Canvas

流程：

1. 验证调用者当前 Project 作用域；
2. 规范化 Project 相对路径；
3. 解析真实路径并检查 containment、符号链接和文件类型；
4. 读取必要的 MIME、尺寸或媒体元数据；
5. 创建引用原 Project 路径的 Canvas 节点；
6. 通过 Canvas application service 提交节点和关系。

不执行复制，不写入 `.convax/assets`。

同一 Project 文件拖入两次时：

```text
Canvas 节点：2 个
Project 文件：1 个
.convax/assets 新文件：0 个
```

Project 中两个内容相同但路径不同的文件仍被视为两个用户文件，不自动合并。

## 8. Project 外文件进入 Canvas

Project 外文件必须先进入受控 managed asset store，Canvas 不持久化绝对路径。

### 8.1 接纳流程

1. Renderer 通过现有受控导入 token 授权选中的外部文件；
2. Main 在创建临时文件前，以 `operation-id` 获取 staging lease，再创建 `.convax/assets/staging/<operation-id>`；
3. 单次流式复制文件，同时计算 SHA-256 和大小；
4. 校验文件类型、大小限制和源文件读取前后身份；
5. 根据 SHA-256 得到最终 blob 路径；
6. 在检查或发布最终 blob 前，通过 coordinator 的短 shared barrier 以 `operation-id + sha256` 注册 managed-blob lease；如果 GC 正持有 exclusive barrier，先等待其结束再重新检查 blob；
7. 如果 blob 已存在，从实际 no-follow 句柄重新计算并验证 SHA-256 后删除 staging、复用该 blob；
8. 如果 blob 不存在，在 managed-blob lease 保护下将 staging 原子发布到最终路径；
9. staging 已删除或发布后释放 staging lease，但保持 managed-blob lease；
10. 进入 shared resource commit barrier，预先清除该哈希的 GC orphan 记录，再创建和提交 Canvas 节点；
11. Canvas commit 成功、失败或取消进入终态后释放 managed-blob lease。

admission API 必须把“staging lease、哈希、coordinator-ordered managed-blob lease、发布、Canvas conflict retry 和终态释放”封装为一个 host-owned operation，不能向 Renderer/Plugin/Agent 返回一个无 lease 的 prepared managed reference。staging lease 从临时路径出现前持续到 staging 消失；managed-blob lease 从最终路径第一次检查前持续到 Canvas commit 终态，两者在发布交接阶段重叠。managed-blob lease 注册与 GC exclusive deletion 不能交错越界；Canvas CAS 重试期间它始终有效。发布后 commit 失败可以留下无引用 blob；释放 lease 后它从下一次完整扫描开始获得新的 7 天宽限期，不做即时删除。

### 8.2 并发去重

相同 Project、相同 SHA-256 的发布必须 single-flight。两个并发导入都完成哈希后，只有一个操作能够发布 blob；另一个验证已发布文件并复用。

### 8.3 远程 URL

远程 URL 不是长期可移植用户资产。新增远程资源只能由 Desktop host UI 中
明确的“从 URL 导入”用户操作发起，由 Desktop Main 的受控下载器进入 staging，
完成验证后按 Project 外文件处理。该命令只返回已接纳的类型化资源结果，不返回
任意响应正文，因此不是通用 fetch 代理。

本次重构不向 sandboxed Plugin、Plugin MessageChannel RPC 或 Agent tool 暴露该
命令。`connected-image`、文件读取、生成工具等既有 Plugin 权限均不得隐式获得
URL 导入能力；Plugin 即使知道 URL 也不能请求 Main 下载。未来若 Agent 或 Plugin
确实需要公共网络导入，必须设计独立的命名能力、授权提示、审计和流量边界，不能
复用文件读取或生成权限。Tool Plugin 自身经安装授权的外部可执行文件是否访问
供应商网络，属于 generation executor 的另一条信任边界，不会获得此下载器。

顶层 trusted host renderer 只能通过一个命名的 narrow typed bridge 提交规范化 URL
值和当前 Project/Canvas 作用域，不能选择网络代理、请求头、解析地址或落盘路径。
Main 校验 IPC sender 是当前应用主 frame、scope 未过期且命令来自 host UI 的显式
导入动作；bridge 只返回已接纳资源结果。Plugin iframe 没有 preload，host 也不会
把该 bridge 转发到 MessageChannel；Agent tool registry 不注册此能力。禁止的是
Plugin/Agent 入口和 generic fetch，不是顶层 host UI 到 Main 的受控调用链。

下载器必须落实以下 SSRF 和资源消耗边界：

- 只接受无用户名、密码和 fragment 的 `https:` URL，默认只允许 443 端口；
- 每次 DNS 解析都拒绝 loopback、private、link-local、carrier-grade NAT、multicast、unspecified、文档保留地址和云 metadata 目标的 IPv4/IPv6 结果；
- 连接时固定已验证的解析结果，并核对实际 remote address，防止 DNS rebinding；
- 最多跟随 5 次 redirect，且每一跳重新执行完整 URL、端口和地址校验；
- 不携带浏览器 cookie、认证、环境代理或调用者自定义 header；
- 设置连接、首字节、总时长和无进度超时；同时用 `Content-Length` 预检与流式字节计数强制单文件上限；
- staging 使用随机 host-owned 文件名，忽略远端路径和 `Content-Disposition` 提供的落盘路径；
- 下载完成后验证 MIME、文件签名、大小和 SHA-256，再原子发布；任何失败、取消或超限都关闭连接并清理 staging。

如果未来需要私有网络、认证下载或自定义端口，必须作为新的显式能力单独设计，不能放宽此公共 URL 导入边界。

## 9. Canvas 新建内容

### 9.1 新建文本

1. 根据用户选择的文本格式，在 `Notes/` 选择可用文件名，例如纯文本
   `Untitled.txt`、Markdown `Untitled.md` 或富文本
   `Untitled.convax-note.json`；
2. 使用 no-clobber 原子创建避免覆盖已有文件；
3. 创建引用该 Project 相对路径的 Canvas 节点；
4. 用户编辑时写入该文件，Canvas 文档不保存正文。

如果文件创建成功但 Canvas 节点提交失败，保留用户可见文件并明确提示，避免删除已经成为用户资产的内容。

三种格式的持久化契约如下：

| `format` | 文件与 MIME | 权威内容 |
| --- | --- | --- |
| `plain` | `.txt`，`text/plain; charset=utf-8` | UTF-8 纯文本；无富文本语义 |
| `markdown` | `.md`，`text/markdown; charset=utf-8` | UTF-8 Markdown 源码 |
| `rich-text-json` | `.convax-note.json`，`application/vnd.convax.rich-text+json` | 下述版本化结构化文档 |

富文本文件 v1 是用户可见、可复制和可版本控制的普通 JSON 文件：

```json
{
  "kind": "convax-rich-text",
  "schemaVersion": 1,
  "document": {
    "type": "doc",
    "content": []
  }
}
```

`document` 使用 `@convax/canvas` 发布的有界富文本文件 schema，完整表达允许的
node type、text、marks、attrs、顺序和嵌套。保存前验证 JSON 值、深度、节点数和
总字节上限；`NaN`、二进制、函数、原生路径和 `data:`/`blob:` 资源不得进入该
格式。富文本 attrs 中的 URL 只是文档内容，不授予 host 资源访问或 GC 存活权；
持久二进制仍必须通过 Canvas 的显式资源槽位引用。

“无损”定义为对当前版本允许的富文本树执行 decode → encode → decode 后得到
结构等价的 node、text、marks 和 attrs，而不是要求 JSON 空白或对象 key 顺序逐
字节相同。实现不得把富文本静默降级为 Markdown/纯文本，也不得丢弃无法识别的
节点后保存；未知 `schemaVersion`、未知 node/mark 或不满足约束的文件只读报错，
禁止覆盖。破坏性切换只拒绝旧 Canvas 内嵌 `richText`，不意味着新格式可以丢失
富文本能力。

v1 schema 冻结为当前编辑器配置可产生的 ProseMirror JSON 子集：

- node 只允许 `doc`、`paragraph`、`text`、`heading`、`blockquote`、
  `bulletList`、`orderedList`、`listItem`、`codeBlock`、`hardBreak`、
  `horizontalRule`、`table`、`tableRow`、`tableHeader` 和 `tableCell`；根必须是
  唯一 `doc`，子节点组合必须通过对应 ProseMirror content expression；
- mark 只允许 `bold`、`italic`、`strike`、`underline`、`code` 和 `link`；mark
  顺序规范化但集合和属性不得丢失；
- `heading.level` 只允许 1、2、3；`paragraph.textAlign` 与
  `heading.textAlign` 只允许 `null/left/center/right/justify`；
- `orderedList.start` 是正整数，`orderedList.type` 只允许
  `null/1/a/A/i/I`；`codeBlock.language` 只允许 bounded string 或 null；
- `tableCell`/`tableHeader` 只允许正整数 `colspan/rowspan`、与 colspan 长度一致
  的正整数 `colwidth` 数组或 null，以及 `null/left/center/right` 的 `align`；
- `link` 只允许 bounded `href`、`target`、`rel`、`class`、`title` 字符串或 null，
  URI 仍经过现有 Link allowlist；其他 node/mark 不允许 attrs；
- 所有 object 拒绝未知 key 和 prototype-bearing 值。codec 的规范来源是 Convax
  自己导出的 `ConvaxRichTextFileV1` validator/encoder，不在运行时把第三方 TipTap
  版本当作持久化 schema；升级编辑器 extension 时必须显式提升或兼容此文件版本。

### 9.2 文本编辑

文本编辑采用文件级乐观并发控制：

1. 开始编辑时从同一已验证读取句柄获得正文和 `contentRevision`；
2. 未保存文本只作为短生命周期 Renderer draft；
3. 编辑防抖后通过 Project 写入端口执行原子替换；
4. Main 对同一路径的自身写入加 path-scoped mutex，重新打开并计算当前内容 SHA-256；
5. 当前 `contentRevision` 与 expected 值不同时拒绝静默覆盖；
6. 写入临时文件并在替换前再次核对打开句柄、路径 identity 和 metadata，随后原子替换；
7. UI 提供重新加载、明确覆盖或另存副本；
8. 写入成功后从新文件计算 snapshot，并刷新所有引用节点。

metadata-only token 不能用于第 5 步。明确覆盖是新的写命令，必须携带用户确认和刚读取的新 `contentRevision`，不能以“忽略 revision”的布尔参数绕过校验。

managed asset 按 SHA-256 寻址且不可原位编辑。用户首次编辑引用 managed asset 的文本时，Main 将当前字节原子发布为 `Notes/` 下的新 Project 文件，Canvas 在同一资源提交屏障内把 `primary` 改为 Project 文件引用；只有该提交成功后才进入正常编辑。原 managed blob 继续遵守 7 天 GC 宽限期。

以下边界必须先 flush 成功：

- 切换 Canvas；
- 切换 Project；
- 调用依赖该文本的 Agent 或生成工具；
- 关闭窗口；
- 用户执行显式保存。

## 10. 生成内容

生成内容是用户主动创建的 Project 内容，不默认发布到 `.convax/assets`。

流程：

1. 外部生成工具把结果写入 host-controlled staging；
2. Main 验证调用作用域、结果数量、大小、MIME 和文件签名；
3. Main 通过下述 `publishGeneratedNoReplace` 协议发布到用户可见的
   `Generated/`；
4. 创建引用新 Project 文件的 Canvas 节点；
5. 通过 `CanvasResourceBusinessService` 提交节点、关系和 revision；
6. 可选 view 效果不能把成功的文件与 Canvas 提交变成失败。

如果结果已发布但 Canvas 提交失败，保留 `Generated/` 中的文件并报告“生成成功，添加到 Canvas 失败”。不得因为 UI 或 Canvas 错误删除用户生成成果。

`publishGeneratedNoReplace` 不信任外部工具返回的目录或文件名。Main 只接受
bounded suggested basename，规范化扩展名后在 `Generated/` 内选择候选名，并把
整次多结果发布封装为 `generated-publish-<operation-id>` durable transaction：

`transaction.json.outputs[i]` 为每个输出独立保存 basename、expected digest、
source/target identity、最终相对路径、错误和 phase；一个输出的失败或发布不能
覆盖另一个输出的恢复证据。顶层只记录 operation identity 与整体终态。

1. 先原子创建并 fsync `transaction.json`，记录 operation、输出个数、随机 staging
   basename 和 `phase: "planned"`，再在同一 transaction 的 `outputs/` 下用
   exclusive create 创建文件；文件创建后、写入任何结果字节前立即记录 exact
   identity 和 `phase: "copying"`；staging 与 `Generated/` 位于同一文件系统；
2. 从外部 host-controlled staging 复制每个输出，同时验证字节、大小、MIME、签名
   和结果摘要；flush/fsync 后在 WAL 记录 digest 和 `phase: "prepared"`；
3. 为该输出记录当前候选 Project 相对路径，然后使用 native `moveNoReplace` 把
   transaction output 原子发布到已验证的 `Generated/` parent；普通 POSIX
   `rename` 的覆盖语义不满足要求；
4. 若目标已存在、发生大小写等价冲突或并发发布抢占，保留现有目标不变，在 WAL
   记录新的 bounded 数字后缀候选并重试 no-replace；
5. move 后 fsync/flush 两个 parent，再持久化最终路径、发布后 exact identity/digest
   和 `phase: "published"`，此时文件转为用户资产，后续恢复不得删除它；
6. 全部输出达到 `published` 或明确 `failed` 后返回精确结果列表并清理 transaction；
   Canvas commit 独立发生，失败时仍保留已发布文件。

目标是文件、目录、symlink 或任何未知对象时一律视为冲突，绝不覆盖或跟随。
如果当前平台 adapter 不能提供原子 no-replace，生成调用在产生用户可见文件前
fail closed。多结果生成逐个发布；部分结果已经发布后发生失败时保留这些用户
文件、返回精确 partial-success 列表，绝不通过回滚覆盖或删除已有路径。

Project open 在编辑和 watcher 启动前恢复 generated publish transaction：

- `planned` 且 output 不存在时清理空事务；`copying`/`prepared` 且 output 仍只位于
  transaction 时，按 WAL 验证 private parent、basename 和 exact identity 后删除
  未发布 staging；
- `planned` 却出现 output、未知 entry、identity 不符或 transaction parent 不明时
  保留全部字节并进入 repair，不递归清理；这覆盖 create 与 `copying` phase commit
  之间无法证明 identity 的 crash window；
- `prepared` 且 exact transaction output 仍存在时，可以证明 no-replace move 尚未
  发生：无论当前候选 target 不存在、是原有用户对象还是并发发布 winner，都保留
  target 不动、删除 exact private staging 并把该输出记为 `aborted`；恢复不重试
  生成，也不因 source/target 同时存在进入 repair；
- WAL 仍为 `prepared`、transaction output 已消失且目标路径存在相同
  identity/digest，说明 crash 发生在 move 与 phase commit 之间，前滚为
  `published` 并保留用户文件；
- `published` 的目标无论仍存在、已被用户移动/删除或 identity 已改变，都不再由
  transaction 删除或覆盖，只完成 transaction cleanup 并报告恢复诊断；
- transaction source 缺失而 target 也缺失或不匹配、WAL/parent identity 不明，
  或其他无法唯一判断的状态保留所有字节并进入 repair。

## 11. 文件监听与同步

Project watcher 继续监听已打开 Project 根目录中的普通文件变化。资源层在收到变化后：

- 使匹配路径的运行时 revision 失效；
- 刷新文本、图片、视频、音频或普通文件节点；
- 使 Agent/Plugin 后续读取获得最新内容；
- 不通过文件变化直接改写 Canvas 布局 revision。

### 11.1 App 内移动或重命名

App 内文件或目录操作返回明确的源路径、目标路径和 entry kind。Desktop 协调器通过 Canvas application/repository 能力更新所有受影响 Canvas 文档中的 Project 引用。不得由 Project Files package 直接编辑 Canvas JSON。

该操作通过后文同一个 Project resource commit coordinator 的 exclusive barrier 和短生命周期事务记录协调：

1. Desktop 先取得 Project edit-quiesce token，阻止新的 Renderer mutation，flush 该 Project 下所有已挂载 Canvas；任何 draft 无法 flush 或存在 revision conflict 时不开始移动；
2. 获取 exclusive barrier，等待所有在途 Canvas/catalog/resource commit 完成，并阻止新提交；
3. 验证 source identity、target 不存在、目标不在源目录子树中，并要求平台 adapter 提供不覆盖目标的 `moveNoReplace`；无法保证 no-clobber 或跨 volume 时在任何 mutation 前失败；
4. 加载所有 Canvas 文档及其 storage revision，按下述规则生成逐 slot rewrite plan；
5. 写入并 fsync `.convax/transactions/path-move-<operation-id>.json`，记录 entry kind、源/目标及任何 case-only 临时路径的 identity、每个受影响 node/slot 的 before/after reference、before storage revision、预期 after revision 和 phase；
6. 执行物理 `moveNoReplace(source, target)`，fsync 必要目录，并持久化 `physical-moved` phase；
7. 使用 exclusive callback 获得的不可伪造 mutation context，通过 Canvas application/repository 的内部 `saveWithinMutation` CAS 对每个文档只应用 reference patch，不替换整个旧文档，也不重入 shared barrier；
8. 全部成功后持久化 `references-updated`，删除事务记录、释放 barrier，再发布一次合并后的文件系统变动事件；
9. 崩溃恢复必须在 Project 进入可编辑状态和启动 GC 前、持有 exclusive barrier 时运行，并根据 phase 与实际 identity 幂等完成或回滚。

目录移动的 rewrite plan 使用规范化 POSIX path segment 语义：

- 文件移动只重写严格等于 source path 的 `project-file` reference；
- 目录移动重写所有等于 source 或以 `source + "/"` 开头的 `project-file`，保留其 descendant suffix；
- folder node 的 `project-directory` 同样按 segment prefix 重写；
- `primary`、`poster` 和 Plugin resource bindings 使用同一 schema traversal，不能漏掉 metadata 中的第二套扫描；
- managed SHA-256 不随目录移动变化；
- 大小写敏感性跟随真实 Project filesystem；case-only rename 由 `moveNoReplace` 使用事务内临时路径分两跳完成，每一跳的路径、identity 和 phase 都写入 WAL，不通过字符串 lower-case 猜测；
- rewrite 后出现非法路径、目标冲突、重复 slot 或目标落入 `.convax` 保护区时，物理移动前整体失败。

失败回滚必须同时恢复物理位置和引用：

1. 如果 phase 已到 `physical-moved`，先验证 target 仍是事务记录的 exact identity 且 source 仍不存在；
2. 使用同一 no-clobber primitive 执行 `moveNoReplace(target, source)`，绝不覆盖外部进程新建的 source；
3. fsync 后持久化 `physical-restored`；
4. 对已提交的文档逐一执行基于当前 storage revision 的 inverse reference patch，只恢复本事务修改的 slot；
5. 物理恢复和全部 inverse CAS 都成功后才删除事务记录；
6. 任一 identity、no-clobber 或 CAS guard 不匹配时停止自动恢复，保留现状并进入显式 repair，绝不删除、覆盖或写回旧 Canvas snapshot。

事务记录只承担一次移动的崩溃恢复，不是永久资源索引。它保存精确 reference patch，不保存可直接覆盖回去的 Canvas snapshot。事务完成前不得向用户报告成功，watcher 也不得把中间 phase 发布成多个用户可见操作；edit-quiesce token 在提交、完整回滚或进入 repair 后才释放。

### 11.2 App 外移动或重命名

文件系统事件不能可靠提供跨平台稳定的 rename 配对，因此采用保守策略：

- 原路径消失时节点进入 missing 状态；
- watcher 可在受影响目录范围内根据 fingerprint 搜索候选；
- 大小和时间戳匹配只用于提示候选；
- 只有唯一候选的 SHA-256 与持久化 fingerprint 完全匹配时才允许自动恢复；
- 多个相同候选时不得猜测；
- 用户重新定位后更新相关 Canvas 引用。

### 11.3 删除

- 删除 Project 可见文件后，Canvas 节点保留并显示 missing；
- 删除节点不会删除 Project 可见文件；
- managed asset 只有在所有 Canvas 引用消失并通过 GC 宽限期后才删除。

## 12. Managed asset GC 状态

GC 状态与 managed asset store 同目录：

```text
.convax/assets/gc.json
```

建议 schema：

```json
{
  "schemaVersion": "convax.asset-gc/1",
  "requiresFullScan": false,
  "lastSuccessfulScanAt": "2026-07-21T10:00:00.000Z",
  "orphans": {
    "abc123...": {
      "unreferencedSince": "2026-07-14T09:00:00.000Z"
    }
  }
}
```

`gc.json` 不保存：

- 引用计数；
- Project 文件路径；
- Canvas id 或节点 id；
- MIME、文件大小或展示名称；
- SHA-256 到路径的映射。

这些信息从 Canvas 文档、固定内容寻址规则和实际文件实时推导。

### 12.1 成功重新引用必须持久重置宽限期

只靠 24 小时完整扫描无法观察“两个扫描之间短暂重新引用后又删除”的情况，因此 orphan reset 是 managed reference commit 的前置持久化步骤，不只是 GC 扫描的副作用。

`@convax/project/node` 提供串行、CAS/原子替换的 `GcStateRepository.clearOrphansBeforeReference(hashes, mutationContext)`：

1. Canvas repository 在 shared barrier 内比较旧/新文档的显式资源槽位，计算 `newlyAddedHashes = newManagedHashes - oldManagedHashes`；
2. 对每个 `newlyAddedHashes`，在写 Canvas 文档前从 `orphans` 删除并 fsync/原子提交 `gc.json`；
3. `gc.json` 更新成功后才允许 Canvas 文档原子提交；
4. 如果随后 Canvas commit 失败，额外延长保留时间是安全的；
5. 如果 GC 状态更新失败，必须在 Canvas 写入前终止 reference commit；
6. reference removal 不直接复用旧时间；下一次完整扫描重新以当时的时间创建 orphan 记录。

Project writer guard 保证只有一个 Main，`GcStateRepository` 自身再串行化 shared commit 间的状态更新，避免两个并发 reference commit 相互覆盖。`gc.json` 缺失时 clear 操作可以创建无 orphan、要求完整扫描的新状态；损坏时按第 18 节 fail safe 恢复，绝不继续使用其中的旧时间戳。

因此，即使某哈希在两次 GC 扫描之间经历“引用成功 → 引用删除”，成功引用前已经持久删除旧 orphan 记录；后续扫描只能建立新的 `unreferencedSince`。

## 13. GC 时间参数

默认配置：

| 参数 | 默认值 |
| --- | ---: |
| 无引用资产宽限期 | 7 天 |
| 完整 GC 最小间隔 | 24 小时 |
| 引用变化后的后台扫描防抖 | 5 分钟 |
| Project 打开后的首次扫描延迟 | 空闲 30 秒 |
| 无 lease staging 保留期 | 24 小时 |

这些默认值属于产品策略，可以在未来通过明确设置调整，但不能由 Plugin、Agent 或 Canvas 节点改变。

## 14. GC 调度

GC 使用事件触发加时间节流，不为每个 Project 创建持续高频定时器。

### 14.1 触发条件

- Project 打开时，如果距离上次成功扫描超过 24 小时，则在空闲 30 秒后请求扫描；
- 删除节点、删除 Canvas、替换 managed 引用等操作提交成功后，防抖 5 分钟请求扫描；
- App 持续运行且距离上次成功扫描达到 24 小时时，在空闲时请求扫描；
- 外部资产导入前发现磁盘空间紧张时，同步执行一次已过宽限期资产的安全清理；
- 用户点击“扫描可回收资产”时立即扫描，但默认仍遵守宽限期；
- 用户明确确认“立即清理孤儿资产”时，可以忽略宽限期；
- Project 关闭或 App 退出时不强制扫描，避免拖慢关闭流程。

### 14.2 Single-flight

同一 Project 同时最多运行一个 GC。运行期间的新请求合并为一个 `rerunRequested` 标记；当前扫描结束后，如有必要再运行一次。不同 Project 可以独立调度，但 Desktop 应限制全局并发，避免多个大型 Project 同时占用磁盘。

### 14.3 Project resource commit coordinator

`@convax/project/node` 为每个已打开 Project 创建一个作用域内 coordinator，并让以下写路径强制经过它：

- `CanvasDocumentRepository.save`；
- Canvas catalog create/delete；
- managed asset admission 与 resource binding commit；
- Plugin resource binding 更新；
- App 内文件移动事务；
- GC blob 删除。

它提供公平、可取消的 shared/exclusive barrier：

```ts
interface ProjectResourceCommitCoordinator {
  acquireStagingLease(input: {
    operationId: string
    signal: AbortSignal
  }): Promise<StagingLease>
  acquireManagedLease(input: {
    operationId: string
    sha256: string
    signal: AbortSignal
  }): Promise<ManagedAssetLease>
  withReferenceCommit<T>(
    signal: AbortSignal,
    run: (context: ProjectResourceMutationContext) => Promise<T>,
  ): Promise<T>
  withExclusiveMutation<T>(
    signal: AbortSignal,
    run: (context: ProjectResourceMutationContext) => Promise<T>,
  ): Promise<T>
}
```

`acquireStagingLease` 在创建 staging 路径前通过同一 Project lease registry 注册，staging cleanup 在删除前也查询该 registry。`acquireManagedLease` 在一个短 shared barrier 内注册 lease 后返回幂等 release handle；它不在整个文件复制或 Canvas retry 期间占用 shared lock，但 exclusive GC 随后必定能观察到该 lease。若 GC 已先取得 exclusive barrier，lease acquisition 等待 GC 完成，调用方随后必须重新检查目标 blob 是否仍存在。两种 release 都是幂等的，取消/异常路径由 host operation 的 `finally` 统一收口。

普通 Canvas document save、catalog rename/touch 和 resource binding commit 在 shared barrier 内完成“读取 expected storage revision、校验资源/lease、原子替换文档或 catalog”的最终提交段。Canvas catalog create/delete、文件移动和 GC 删除使用 exclusive barrier；exclusive 请求到达后不再放行新的 shared 请求，避免删除饥饿。

`ProjectResourceMutationContext` 是 Project Node 内部不可构造的 capability。repository 和 asset store 提供仅供聚合内部使用的 `*WithinMutation(context, ...)` 操作；已经持有 exclusive barrier 的移动/GC 流程必须传递该 context，不能再次获取 shared barrier 造成死锁。公开 repository/client API 永远不能接收调用者自造的 context。

这不是隐藏全局或 Desktop service locator：coordinator 由 Project Node adapter 拥有，并显式注入 repository、asset store 和 Desktop 协调器。打包版本已有应用级 single-instance lock；允许多实例的开发模式还必须使用 Project writer ownership guard，禁止两个 Main 同时以可写方式打开同一 Project。无法取得 guard 时不得启用 GC 或任何 Project 私有写入。

### 14.4 Canvas catalog WAL 与崩溃恢复

coordinator 只提供进程内顺序，不提供 catalog JSON 与 Canvas directory 之间的崩溃原子性。`@convax/project/node` 的 catalog manager 因此必须把 create/delete 实现为 durable WAL transaction；不能继续依赖 catch 中的 best-effort rename/remove。

每个 `.convax/transactions/canvas-catalog-<operation-id>/transaction.json` 至少记录：

- operation kind、canvas id 和目标 catalog entry；
- before catalog storage version 与 before/after catalog digest；
- staged 或 quarantined Canvas directory 的 exact identity；
- 当前 phase；
- transaction schema version。

每次 phase 变化都通过临时文件、fsync 和原子替换持久化。create 流程：

1. 在 exclusive barrier 内创建 transaction directory，先写入并 fsync `preparing` WAL；
2. 构建完整的初始 Canvas directory 和当前 schema 的空 `document.json` 到 transaction 的 `canvas/`；
3. fsync staged directory 并持久化 `prepared`；
4. `moveNoReplace` 发布到 `.convax/canvases/<id>/`，持久化 `storage-published`；
5. 用 before storage version CAS 写入包含新 entry 的 catalog；
6. 持久化 `catalog-committed`，再删除 transaction directory 并 fsync transaction parent。

新 Canvas 不再依赖首次 `load` 时懒创建 document；create 返回成功时 catalog entry 和合法 document 必须同时达到可恢复提交状态。

delete 流程：

1. 在 exclusive barrier 内验证 catalog entry 和 Canvas directory identity，写入 `prepared` WAL；
2. `moveNoReplace` 将 Canvas directory 移入 transaction 的 `canvas/` 作为 quarantine，持久化 `storage-quarantined`；
3. 用 before storage version CAS 写入移除 entry 的 catalog；
4. 持久化 `catalog-committed`，再删除 quarantined directory 和 transaction directory，并 fsync transaction parent。

catalog rename/touch 只原子 CAS 一个 catalog 文件，不创建跨文件 WAL。Project writer ownership guard 成功后、Project 对 controller 可见前，recovery 在 exclusive barrier 下扫描全部 catalog transaction：

- catalog 已匹配 after digest 时完成 cleanup，不回滚已提交操作；
- catalog 仍匹配 before digest 时，create 移除且只移除 exact operation-created directory，delete 使用 no-clobber 恢复 exact quarantined directory；
- phase 落后但 catalog/directory 的实际状态可由 digest 和 identity 唯一证明时，按实际提交点幂等推进；
- 任意 catalog version、digest、目录 identity、source/target 占用或 transaction schema 无法唯一证明时进入 Project repair，保留所有字节；
- unresolved transaction 或 repair 状态会阻止 Canvas 编辑、catalog mutation 和 GC。

GC 只能读取 recovery 完成后的 catalog/document 集合。这样 catalog 与 document 不需要假装具备单文件 ACID，但崩溃后必定先恢复成明确的 before/after 状态，或 fail closed 进入 repair。

## 15. 一次 GC 的完整执行流程

### 15.1 阶段一：建立引用快照

读取并验证：

- Project Canvas catalog；
- catalog 中每一个 Canvas 文档；
- 当前进程中正在导入、生成或提交的 managed asset lease。

对每个文档调用 `collectCanvasResourceEnvelopes(document)`，再由
`@convax/project/canvas` 严格解析 Project reference。以下位置共同构成完整引用根：

- file/text/media node 的 `resources.primary`；
- 持久化海报的 `resources.poster`；
- Plugin node 的每个 `resources.plugin[slot]` host-owned binding；
- 当前进程的 admission、generation、Canvas commit 和外部调用 lease。

Canvas 入边不产生隐藏副本：被连接的源 file node 已通过自己的 `primary` 成为根。Plugin 私有 state 中出现疑似 path、SHA-256 或 envelope 不赋予资源存活权；合法持久引用只能通过 host-owned binding 写入。不得通过递归查找任意 64 位字符串来猜测引用。

从全部合法 envelope 中收集 managed SHA-256，形成 `liveHashes`。

如果 catalog 与文档集合不一致、任何 Canvas 文档不存在/损坏/不是当前 schema、任何 envelope 或 Plugin binding 无效、或读取失败，本轮 GC fail closed：

- 不删除 blob；
- 不推进 `unreferencedSince`；
- 不更新 `lastSuccessfulScanAt`；
- 保留原 `gc.json`；
- 记录可诊断错误并在后续安全时机重试。

### 15.2 阶段二：枚举 blob

只扫描：

```text
.convax/assets/blobs/sha256/
```

每个候选必须：

- 位于合法哈希分片目录；
- 文件名是 64 位小写 SHA-256；
- `lstat` 为普通文件；
- 不是符号链接；
- realpath 仍位于 blob 根目录；
- 没有活动 lease。

`gc.json`、`staging/`、非法名称和未知文件不参与自动删除。

### 15.3 阶段三：协调孤儿状态

对每个合法 blob：

```text
hash 在 liveHashes
  -> 删除对应 orphan 记录

hash 不在 liveHashes，且没有 orphan 记录
  -> unreferencedSince = 当前时间

hash 不在 liveHashes，且宽限期未结束
  -> 保留 blob 和 orphan 记录

hash 不在 liveHashes，且宽限期已结束
  -> 加入 deletionCandidates
```

宽限期从第一次成功完整扫描确认无引用时开始。不得使用 blob 的创建时间或修改时间代替，因为一个长期被引用的旧文件可能刚刚失去最后引用。

系统时钟回退时，将负年龄视为零，不提前删除。

### 15.4 阶段四：删除前二次确认

对于 `deletionCandidates`：

1. 获取 Project resource commit coordinator 的 exclusive barrier，并等待全部在途 shared commit 完成；
2. 在 barrier 内重新读取最新 catalog 和其中每一个 Canvas 文档；
3. 使用唯一 schema traversal 重建完整 `liveHashes`，包括 Plugin bindings；任意错误立即放弃本轮全部删除；
4. 重新读取当前全部 lease；
5. 重新读取 `GcStateRepository` 的最新持久状态，不能继续使用阶段一读取的旧 orphan snapshot；
6. 在 barrier 内用最新 `liveHashes` 完整协调 orphan 状态：live hash 删除记录，首次确认无引用的 hash 以当前时间建记录；
7. 只有最新持久状态中仍保留同一 `unreferencedSince`、当前仍无引用、无 lease 且宽限期已结束的哈希才继续；任何被 reference commit 预先 clear 的旧候选都退出本轮删除；
8. 对剩余候选从 no-follow 句柄再次执行 parent containment、文件 identity 和实际
   SHA-256 校验；
9. 将仍满足全部条件的普通受管 blob 固化为 `confirmedCandidates`，记录其 exact
   identity、实际 digest、原路径和 `unreferencedSince`；
10. 保持 exclusive barrier，进入阶段五完成“隔离、隔离后复核、删除和
    `gc.json` 提交”后才释放，随后才允许新的 reference commit。

步骤 8 的实际 digest 与路径哈希不符时，该文件从 `confirmedCandidates` 移除并报告 `ManagedAssetCorruption`；GC 不删除、覆盖或把它重新命名为另一个哈希。

Canvas 添加 managed asset 时必须先创建 lease，再进入 shared barrier 提交节点或 Plugin binding；节点引用提交成功或失败后才释放 lease。因为所有合法引用写入、catalog 变化与 GC 删除都共享同一 coordinator，不存在“二次扫描完成后新增引用、blob 随后被删除”的提交窗口。

### 15.5 阶段五：隔离删除并提交 GC 状态

阶段四的校验结果不能直接交给稍后的 path-based `unlink`，因为 blob path 可能在
两者之间被替换。仍在 exclusive barrier 内，对每个 confirmed candidate 执行一
个 Project-owned `asset-gc-delete-<operation-id>` 事务：

1. 在随机、private、未向 Renderer/Plugin/Agent/watcher 暴露的 transaction 目录中
   原子写入并 fsync `transaction.json`，记录 hash、原 Project 相对路径、阶段四的
   exact identity/实际 digest/`unreferencedSince` 和 `phase: "prepared"`；
2. 通过已验证 source/quarantine parent 的 native `moveNoReplace`，把候选从 blob
   namespace 原子移动到事务的唯一 `quarantine/<hash>`；源消失或目标已存在时不
   覆盖任何对象并中止该候选，校验后到 move 之间发生的 source replacement 则由
   下一步隔离后复核识别；
3. fsync 两个 parent，持久化 `phase: "quarantined"`，再从 quarantine parent
   anchored 的 no-follow 句柄重新计算 identity 和完整 SHA-256；两者必须同时等于
   WAL 和路径 hash；
4. 隔离后复核不一致时绝不删除。仅当原 blob path 仍为空时用 `moveNoReplace`
   恢复被隔离对象；原路径已被占用、parent identity 改变或无法证明恢复安全时，
   保留隔离字节并进入 repair，阻止编辑和后续 GC；成功恢复时持久化
   `phase: "restored"`，move 未发生时持久化 `phase: "aborted"`，两者都保留原
   orphan 状态、fsync 后安全清理 transaction；
5. 复核一致后持久化 `phase: "delete-authorized"`。native adapter 在同一个同步
   critical section 中，以已打开的 quarantine parent handle 对固定 hash basename
   做最后一次 anchored no-follow identity compare，随后执行平台删除；期间不得
   yield 到 Renderer/Plugin/Agent/watcher 或 application callback。它绝不接收原
   blob path、Project 可见路径或递归路径；成功后 fsync/flush parent 并持久化
   `phase: "deleted"`；
6. 全部候选得到明确的 deleted/retained/repair 结果后，基于阶段四重载的最新状态
   提交完整协调结果：删除 live hash 和已成功删除 blob 的 orphan 项，为首次无
   引用 hash 建立新时间，并保留未删除旧 orphan 的原时间；
7. 设置 `lastSuccessfulScanAt` 和 `requiresFullScan: false`，通过同目录临时文件、
   fsync 和原子替换提交 `gc.json`；
8. 对已删除候选持久化 `phase: "state-committed"`，再删除对应 transaction
   directory 并 fsync `.convax/transactions` parent。

原子 quarantine 是删除授权的 namespace transfer：原 blob path 在移动后即使被
外部进程创建新文件，也永远不会传给删除操作。quarantine 目录只能包含 WAL 精确
列出的一个普通文件；出现额外 entry、symlink、parent replacement 或 identity
变化立即进入 repair，不能递归清理。平台能力矩阵为：

| 平台 | no-replace namespace transfer | quarantine 验证与删除 | sweep 条件 |
| --- | --- | --- | --- |
| macOS | 同卷 `renamex_np(..., RENAME_EXCL)` | `0700` 随机 private dir、parent-fd anchored `openat(O_NOFOLLOW)`/`fstat`/digest，随后同步 `unlinkat` 与 parent `fsync` | 全部原语和 writer guard 可用 |
| Linux | 同卷 `renameat2(..., RENAME_NOREPLACE)` | `0700` 随机 private dir、`openat2`/`openat` no-follow containment、`fstat`/digest，随后同步 `unlinkat` 与 parent `fsync` | kernel/filesystem 支持所需 flags |
| Windows | no-replace move 且拒绝 reparse point | private ACL directory、handle/file-id 复核，优先 handle-bound `FileDispositionInfoEx` 并 flush parent | volume 支持 file-id、no-replace 与安全 disposition |

macOS/Linux 的 `unlinkat` 是 name-based，不伪装成 identity-conditional syscall。本设计
关闭的是对不受信 blob namespace 执行“校验后按路径删除”的窗口：atomic move 把
待删除对象转入 fresh、随机、权限收紧、只由当前 Main 持有的 private namespace，
隔离后才复核和删除。Project APIs、watcher、Plugin、Agent、Renderer 和其他 Convax
进程均不能进入该 namespace；writer guard 保证没有第二个 Main。

威胁模型仍覆盖 Project 可见路径和 blob store 上的任意 symlink/path replacement；
它不声称抵御拥有相同 OS 用户身份、绕过 Convax 直接故意改写
`.convax/transactions` 的恶意进程——该进程同样可以在任意两次 syscall 之间改写
WAL 或其他 Project 私有元数据。发现 private parent/entry 在最终检查前变化仍
fail closed 进入 repair。若产品未来要求抵御 hostile same-UID process，必须引入
不同 OS principal 的 privileged helper 或平台 identity-bound delete；在此之前不
得扩大威胁声明。缺少表中平台原语、private ACL/mode 或 writer guard 时自动 GC
只允许 mark，不执行 sweep。

Project open 必须在暴露 controller 或启动 GC 前恢复这些事务：

| durable phase | source / quarantine / GC state | 唯一恢复动作 |
| --- | --- | --- |
| `prepared` | exact source / absent / original orphan | 写 `aborted`，保留 source，清理事务 |
| `prepared` 或 `quarantined` | absent / exact quarantine / original orphan | no-clobber 恢复 source，写 `restored`，清理事务；不延续旧进程删除决定 |
| `quarantined` | exact source / absent / original orphan | 视为已恢复，写 `restored` 并清理事务 |
| `delete-authorized` | absent / exact quarantine / original orphan | 删除尚未发生；no-clobber 恢复，写 `restored` 并清理事务 |
| `delete-authorized` | absent / absent / original orphan 或 orphan 已清除 | exact delete 已发生；写/确认 `deleted`，幂等清除该 WAL 指定的旧 orphan，再写 `state-committed` |
| `deleted` | absent / absent / original orphan 或 orphan 已清除 | 幂等清除该 WAL 指定的旧 orphan，写 `state-committed` |
| `state-committed` | absent / absent / orphan 已清除 | 只清理 transaction directory |
| `aborted` 或 `restored` | exact source / absent / original orphan | 只清理 transaction directory |

恢复中的 `restored`/`aborted` phase 与 GC state 写入也必须 fsync 后再清理事务。
上表之外的任意组合——包括 source/quarantine 同时存在、`deleted` 后又出现对象、
source 被占用、identity/digest 不明、terminal phase 与 orphan 状态矛盾——都保留
全部字节并进入 repair，不猜测 cleanup。这样 crash 位于 move 与 phase 写入之间、
`delete-authorized` 与 exact delete 之间、exact delete 与 `deleted` 之间、state
replace 与 `state-committed` 之间、以及 terminal phase 与事务目录清理之间都有
唯一且幂等的恢复结果。

因此，blob 删除成功但 `gc.json` 更新失败时，durable transaction 能在下次打开时
完成状态提交；删除前崩溃则默认恢复文件。任何路径都不得先宣告成功再异步执行
不可观测删除。

## 16. GC 时间示例

```text
7 月 1 日 10:00  最后一个 Canvas 引用被删除
7 月 1 日 10:05  防抖扫描确认无引用，写入 unreferencedSince
7 月 3 日 09:00  用户重新引用；commit 前持久 clear 旧 orphan
7 月 3 日 09:02  用户再次删除引用
7 月 3 日 09:07  防抖扫描写入新的 unreferencedSince
7 月 10 日 09:07 新宽限期结束
7 月 10～11 日    下一次成功扫描与二次确认后删除
```

正常情况下，孤儿资产会在首次确认无引用后约 7～8 天被删除。如果 Project 长期没有打开，则 GC 延迟到下次打开；App 未运行时不会在后台删除文件。

## 17. Staging 清理

Staging 与正式 blob 使用不同规则：

- 正在运行的操作从 staging 路径创建前开始持有 staging lease；
- 操作成功后 staging 被原子发布或删除；
- 操作取消或失败后立即尝试删除 staging；
- Project 打开和日常 GC 时扫描超过 24 小时且无 lease 的 staging；
- staging 清理不需要 7 天宽限，因为它从未成为已提交用户资源；
- 删除前仍需执行 containment、普通文件和符号链接检查。

## 18. `gc.json` 丢失或损坏

`gc.json` 不是引用事实来源，因此丢失不能触发资产删除。

如果 reference commit 在 GC 之前发现状态缺失或损坏，`GcStateRepository` 先原子安装一个 `requiresFullScan: true`、空 `orphans` 的安全状态，再执行 clear 并允许 Canvas commit。旧 orphan 时间不会被继承；如果安全状态也无法持久化，则 reference commit 在 Canvas 写入前失败。

恢复流程：

1. 将状态视为 `requiresFullScan: true`，忽略所有无法验证的旧时间戳；
2. 完整扫描所有 Canvas 文档；
3. 完整扫描所有合法 blob；
4. 对当前无引用 blob 以“当前时间”建立新的 orphan 记录；
5. 对当前有引用 blob 不建立记录；
6. 原子写入 `requiresFullScan: false` 的新 `gc.json`；
7. 本次恢复扫描不删除任何 blob。

结果只会延迟最多一个宽限期，不会提前删除资产。

## 19. 空间压力与用户控制

延迟 GC 可以阻止无引用资产长期无限增长，但不能限制仍被有效引用的用户内容。产品应显示：

- managed asset 总占用；
- 仍被引用的占用；
- 宽限期内孤儿占用；
- 已超过宽限期、可立即回收的占用；
- staging 占用。

磁盘空间不足时：

1. 清理无 lease 的过期 staging；
2. 清理已经超过宽限期的孤儿；
3. 仍不足时拒绝新的外部导入并给出可行动错误；
4. 不自动删除有效引用资产；
5. 只有用户明确确认后，“立即清理孤儿资产”才可忽略宽限期。

## 20. Agent、Plugin 与原生集成

所有外部能力只接收当前 Project/Canvas 作用域内的类型化资源引用，不接收原生路径。

Main 负责：

1. 验证资源引用属于当前 Project 和 Canvas；
2. 解析 Project 文件或 managed SHA-256；
3. 打开 no-follow 文件句柄；
4. 验证 containment、regular-file identity、大小、MIME 和 revision；
5. 在计费或外部调用前重检资源 revision；
6. 外部进程要求扩展名或稳定快照时创建短生命周期 staging；
7. 调用结束后清理 staging。

当前只允许 Plugin/JianYing 使用 `.convax/assets` 引用的规则需要更新：它们应接受经过 Main 验证的 Project 文件引用，并在需要原生稳定文件时临时 staging，而不是要求永久复制到 `.convax/assets`。

## 21. Package 所有权

### `@convax/canvas`

- host-neutral 文件节点、显式资源引用槽位与唯一 schema traversal；
- 文本不内嵌后的唯一 Canvas schema，以及版本化富文本文件 schema/codec；
- 资源读取、写入和 revision conflict 的 host port；
- 资源添加、节点布局和关系的业务操作；
- 不认识 Project 路径、`.convax`、Node 或 Electron。

### `@convax/project/canvas`

- Project-specific resource reference union；
- Project 路径与 managed SHA-256 的验证规则；
- host-neutral envelope 与 Project reference 的严格转换；
- Canvas document hydrate/dehydrate 适配；
- Project–Canvas 资源关系辅助逻辑；
- 不执行原生文件 I/O。

### `@convax/project/node`

- Project 路径解析与安全文件访问；
- Project writer ownership guard 和 resource commit coordinator；
- 外部资产 staging、哈希、去重和发布；
- 用户可见文本/生成文件的 atomic no-replace 发布与 generated publish WAL 恢复；
- `.convax/assets/gc.json` 持久化；
- GC 扫描、lease、二次确认、删除隔离事务和启动恢复；
- 仅支持当前 schema 的 Canvas repository 访问；
- 短生命周期文件移动事务记录与崩溃恢复；
- Canvas catalog create/delete WAL、quarantine 与启动恢复；
- 文件监听的 native adapter。

### `@convax/project-files`

- Project-scoped 文件 CRUD、读取、预览和变动事件契约；
- 不直接编辑 Canvas 文档；
- 不暴露 `.convax` 私有元数据的一般读写能力。

### `@convax/desktop`

- Electron composition、IPC 和 preload；
- Renderer 文件 hydration 和编辑冲突 UI；
- Project edit-quiesce、App 内文件/目录移动和跨 Canvas 引用更新协调；
- GC 调度、空闲触发和存储使用 UI；
- Agent、Plugin、JianYing 等边缘适配。

依赖方向保持不变。由于这是持久化、Canvas schema、IPC 和安全能力的架构变更，需要同步更新根/局部 `AGENTS.md`、`docs/architecture.md`、边界策略和 Desktop protocol version。

## 22. 破坏性切换策略

### 22.1 破坏范围

本次切换只破坏被本设计替换的资源语义：

- Canvas 内嵌文本正文；
- 按原文件名存放、按名称避冲突的 managed asset；
- `data:`、`blob:`、远程 URL 和原生绝对路径等旧资源引用；
- 仅接受 `.convax/assets` 文件的旧 Agent、Plugin 和原生集成接口；
- 为上述旧格式服务的读取、写入、转换、回退和测试代码。

未被本设计修改的 Project identity、Canvas catalog 和其他 Canvas 业务数据不因为本次重构主动变更格式。

### 22.2 旧数据行为

新版本不读取或转换旧资源节点，不扫描旧 managed asset 布局，也不尝试把旧数据写入 `Notes/`、`Generated/` 或内容寻址 blob。

Canvas 文档必须携带明确的新 schema version。repository 在发现旧版本、缺少版本或旧资源字段时：

1. 返回类型化 `UnsupportedCanvasResourceSchema` 错误；
2. 阻止该 Canvas 进入可编辑状态；
3. 不修改 Canvas 文档；
4. 不把旧资产纳入新 GC 的可删除候选；
5. 提示该 Project 需要使用旧版本应用处理。

这只是 fail-fast 安全边界，不是兼容层。新代码不得解析旧节点以提供预览、只读打开或自动修复。

### 22.3 代码切换约束

- 不保留 dual-read、dual-write、legacy adapter 或兼容 feature flag；
- 不接受新旧资源字段同时存在的文档；
- 不从旧资产路径 fallback 读取；
- 不在新公共 API 中保留 deprecated 参数或返回字段；
- 删除旧逻辑后同步删除对应 fixture、mock、IPC 和 UI 分支；
- schema 和 Desktop protocol 直接提升到新版本，版本不匹配时 fail fast；
- 实现分支可以分提交开发，但合入主线时必须是完整切换状态。

### 22.4 架构契约前置变更

根 `AGENTS.md`、相关 package `AGENTS.md` 和 `docs/architecture.md` 默认要求持久化 schema 变化提供 migration。本设计记录经产品决策确认的 breaking cutover 例外，并与方案修订一起更新这些契约，使规则收敛为：持久化 schema 变化默认迁移；只有明确批准并记录在 canonical architecture 和设计中的 breaking cutover 才可以拒绝旧版本。该例外仍必须满足：

- 提升 schema/protocol version；
- 对旧数据 fail closed，不静默 reset、覆盖或删除；
- 提供 unsupported-version 诊断测试；
- 明确发布说明与数据影响；
- 新 GC 永远不清理无法由当前 schema 证明无引用的旧资产。

本节只豁免 migration/compatibility，不豁免用户数据保护、package ownership、受控 repository、测试或安全边界。

## 23. 安全与跨平台要求

- 所有持久化路径使用规范化 Project 相对 POSIX 分隔符；
- Main 使用 `node:path` 转换为主机路径；
- 不持久化盘符、UNC 路径或绝对路径；
- 校验 Windows 保留设备名、ADS、尾随点/空格和大小写碰撞；
- `.convax` 大小写变体必须受保护；
- native 边界执行 realpath、containment 和 no-follow/identity 检查；
- GC 不对校验过的 blob path 直接 `unlink`；先原子移入 fresh OS-private transaction
  quarantine，隔离后复核 exact identity/digest，再使用平台 anchored no-follow
  delete；缺少所需平台原语时只 mark、不 sweep；
- GC 只删除合法内容寻址 blob，未知文件 fail closed；
- `Notes/` 和 `Generated/` 的创建/发布使用 atomic no-replace，任何并发冲突、
  symlink、目录或大小写等价目标都不覆盖；
- 外部 Plugin、Agent 和 Renderer 不获得原生路径；
- sandboxed Plugin 和 Agent 不获得公共 URL 导入器或其他隐式网络代理；
- 不能为了方便资源读取而削弱 protected-path 或 scope 检查。

## 24. 测试计划

### Canvas

- 新 schema 不持久化文本正文和运行时 URL；
- `text`、全部 media/file、folder、Plugin、group 和 agent 的新持久化形态均有正反 fixture；
- plain、Markdown 和富文本文件各自严格匹配扩展名、MIME、format 与内容 schema；
- 富文本文件对全部允许 node/mark/attrs/Unicode/嵌套执行结构无损 round-trip；
- v1 每种允许 node/mark/attrs 都有 fixture，未知 key 与第三方 extension 节点被拒绝；
- 富文本未知版本、未知 node/mark、超限或非法资源值 fail closed 且不覆盖原文件；
- Project/managed 引用解析与校验；
- 唯一 traversal 完整枚举 primary、poster 和 Plugin bindings；
- 旧 schema、缺少版本和混合新旧字段被明确拒绝；
- 不注册旧 schema decoder 或 migration；
- opaque Plugin state 中疑似哈希不被当作引用，资源只能通过 binding 获得 host 能力；
- content revision conflict；
- stale async 内容读取不会覆盖新 Project/Canvas 状态；
- 多节点共享同一资源引用。

### Project Node

- Project 内文件进入 Canvas 不复制；
- 相同外部内容、不同文件名只产生一个 blob；
- 并发相同内容导入只发布一个 blob；
- staging lease 在临时路径创建前取得并于 staging 消失后释放；managed-blob lease 在最终路径检查前取得并跨 Canvas CAS retry 保持；
- 两种 lease 在发布交接时重叠，取消/异常/成功终态都各自只释放一次；
- host API 不暴露脱离 lease 的 prepared managed reference；
- staging 取消、失败和崩溃恢复；
- 远程下载拒绝私网/loopback/metadata IPv4 与 IPv6、DNS rebinding、非法 redirect、非 HTTPS、自定义端口、超时和流式超限；
- 远程下载只接受 host UI 的显式命令，Plugin RPC 和 Agent tool 均不存在该入口；
- `Generated/` 同名、并发、大小写等价、symlink/目录目标均通过 no-replace
  选择新名称且原对象字节不变；
- generated publish WAL 在 planned/copying/prepared、move 前后和
  published/cleanup 的每个 crash point 只清理 exact private staging、保留已发布
  用户文件；无法证明 identity 的 pre-copy window 进入 repair，并报告精确 partial
  success；不支持 atomic no-replace 的 adapter 在发布前失败；
- no-replace 返回目标冲突后、写入下一个候选名前崩溃时，exact transaction source
  证明 move 未发生；恢复保留既有 target，只清理 private staging，不进入 repair；
- SHA-256 路径验证；
- managed blob 实际内容与路径哈希不符时返回 corruption，既不返回 content revision/字节也不自动删除；
- symlink replacement、Windows 路径和大小写碰撞；
- App 内移动和重命名；
- App 内移动事务的失败、CAS 逆向 patch 与崩溃恢复；
- 文件移动失败后物理 target 被 no-clobber 恢复到 source；source 被外部占用或 identity 改变时进入 repair 且不覆盖；
- 目录移动按 path segment 重写全部 descendant file/folder/Plugin binding 引用，managed hash 不变；
- case-only rename、目标落入源子树、目标冲突和不支持 no-clobber/cross-volume 的前置失败；
- 移动期间并发 Canvas commit 被阻塞，恢复冲突不会覆盖无关 Canvas 修改；
- catalog create/delete 在 WAL 的每一个 crash phase 都恢复为完整 before/after 状态；
- catalog digest、Canvas directory identity 或 transaction schema 不确定时阻止打开和 GC，不猜测 cleanup；
- create 成功即已有当前 schema document，不依赖首次 load 懒创建；
- 外部修改、移动、删除事件；
- 相同 size/mtime 的文本内容变化仍触发 expected content revision 冲突；
- Main-mediated 并发文本写入由 path mutex 和内容哈希 CAS 串行化；
- Project writer guard 拒绝第二个可写 Main；
- resource commit coordinator 的公平性、取消、shared/exclusive 顺序和错误释放；
- exclusive mutation context 内多文档 CAS 不重入 shared barrier，且外部调用者不能伪造 context；
- GC 正常、取消、错误和恢复路径。

### GC

- 跨节点和跨 Canvas 引用阻止回收；
- primary、poster 和 Plugin resource binding 都阻止回收；
- Plugin 私有 state 中的任意字符串不构成引用根；
- 无效 Plugin binding 或未知 resource provider 使整轮 GC fail closed；
- 最后引用消失后首次扫描只标记；
- 宽限期内重新引用移除 orphan 记录；
- 两次扫描之间完成“重新引用并再次删除”时，reference pre-clear 仍让下一次扫描重新开始 7 天；
- GC 在 exclusive barrier 内重载最新状态，不会把 reference commit 已 clear 的旧 orphan 写回；
- 并发 reference commit 的 GC 状态更新串行且不丢失 clear；
- GC 状态 pre-clear 持久化失败时 Canvas reference 尚未写入；
- 7 天后仍无引用才删除；
- 删除前新 lease 阻止删除；
- 删除前新 Canvas 引用阻止删除；
- exclusive barrier 等待在途 commit，并阻止扫描后新增引用越过删除边界；
- catalog create/delete 与 GC 删除交错时仍以 barrier 内完整快照为准，未恢复 WAL 时 GC 不启动；
- 任意 Canvas 文档损坏时整轮 fail closed；
- `gc.json` 缺失或损坏时重建但不删除；
- 系统时钟回退不提前删除；
- staging 使用独立 24 小时规则；
- 非法文件、目录和符号链接不删除；
- blob 校验后、quarantine move 前被替换时不删除替换对象；
- quarantine 后 identity/digest 不匹配时 no-clobber 恢复，原路径被占用时保留
  隔离字节并进入 repair；
- GC delete WAL 的每个 crash phase 都恢复为保留 blob 或已提交删除，歧义时阻止
  编辑和 GC；
- quarantine final check 前注入 parent/entry replacement 时进入 repair；平台测试
  还必须验证对应 no-replace/private-directory/no-follow/delete 原语，不支持时只
  mark、不 sweep；
- `prepared`、`quarantined`、`delete-authorized`、`deleted`、`state-committed`、
  `aborted`、`restored` 的恢复矩阵逐项覆盖 source/quarantine/orphan 组合；
- blob 删除成功但状态写入失败由 durable transaction 完成状态提交；
- single-flight 与 rerun 合并。

### Desktop 与集成

- preload/main/renderer 新协议一致性和旧协议拒绝测试；
- 外部文件导入 token 不泄露原生路径；
- 公共 URL 导入的 narrow preload 只接受当前 trusted top-level main frame、active
  Project/Canvas 和显式 host UI command，并只返回 admitted resource；
- 文件变动刷新 Canvas 且规避缓存；
- Agent 读取最新文本内容；
- Plugin 只能读取当前节点授权的资源；
- Plugin 即使持有任意 HTTPS URL、文件读取或 generation 权限也不能调用公共 URL
  导入器，preload/MessageChannel 不存在通用 fetch IPC；
- JianYing 等原生集成对 Project 文件使用短生命周期 staging；
- Project 切换取消旧作用域的监听、编辑和 GC 任务；
- 存储占用和手动清理 UI。

按变更范围运行相关 package 的 `bun typecheck` 与 `bun test`，并运行根目录 `bun check`、`bun run pack:check`。Desktop persistence/IPC 变更还需执行 `bun run build` 和 `bun run smoke:open-project`。

## 25. 实施顺序

1. 先更新根/Project 架构契约，记录本次 breaking cutover 例外和数据保护底线；
2. 定义覆盖全部现有 node kind、Plugin bindings 和唯一 traversal 的新 Canvas resource schema，并提升 schema version；
3. 建立统一的 Project-scoped resource read/write/content-revision port；
4. 实现 Project writer guard 和 shared/exclusive resource commit coordinator，并将所有 repository/catalog/asset 写路径接入；
5. 实现 Canvas catalog create/delete WAL、staged/quarantined directory 与启动恢复，移除首次 load 懒创建；
6. 改造 Project 内文件拖入流程为直接引用；
7. 实现外部导入 staging、精确定义的 admission lease、SHA-256 内容寻址、并发
   去重和仅 host UI 可用的远程 URL SSRF 防护；
8. 定义富文本文件 codec，改造 Canvas 文本为文件引用及 content-hash OCC 编辑，
   并验证 managed 实际 digest；
9. 用 atomic no-replace 将 Canvas 新建内容发布到 `Notes/`，用 generated publish
   WAL 和 atomic no-replace 将生成结果发布到 `Generated/`；
10. 接入文件监听刷新、文件/目录移动的 descendant rewrite、物理 no-clobber rollback 和外部 missing/relink；
11. 实现 `.convax/assets/gc.json`、reference pre-clear、完整引用根扫描、exclusive
    删除屏障、quarantine delete WAL/恢复、GC 调度和存储统计；
12. 更新 Agent、Plugin 和原生集成的资源读取边界；
13. 删除旧 schema、旧 managed asset、旧资源 API 和全部运行时兼容分支；
14. 更新其余架构文档、IPC protocol、边界策略、发布说明和破坏性变更验收。

实现过程中每个提交仍需通过其所有权边界的类型检查和测试，但不要求旧资源 Project 可打开。合入主线前必须确认生产代码中不存在旧资源 decoder、migration、fallback 或 dual-write。

## 26. 验收标准

- Project 内文件进入 Canvas 后不产生 managed copy；
- 同一 Project 文件可由多个节点和 Canvas 引用；
- Project 外相同内容在 `.convax/assets` 最多有一个持久 blob；
- Canvas 文档不保存文本正文或媒体内容；
- 每个现有 node kind 都有唯一的新 schema 表达，不存在隐式 metadata 资源变体；
- Canvas 新建纯文本、Markdown 和富文本成为 `Notes/` 下可无损重读的真实文件；
- 生成内容通过 atomic no-replace 成为 `Generated/` 下的真实文件，永不覆盖已有
  文件、目录或 symlink；
- generated publish crash recovery 只删除 exact private staging，永不回收已经进入
  `Generated/` 的用户文件；
- 外部修改会刷新所有引用节点；
- stale 文本编辑不会静默覆盖外部修改；
- expected content revision 使用实际内容 SHA-256，相同 metadata 的内容变化也会冲突；
- managed asset 只有在实际字节哈希匹配路径/引用哈希后才产生 content revision；
- App 内移动后引用保持有效；
- 移动失败或恢复不会用旧 Canvas snapshot 覆盖并发修改；
- 文件移动失败会安全恢复物理位置，目录移动会重写所有 descendant typed references；
- Canvas catalog create/delete 的任一 crash point 都可恢复为完整 before/after，无法证明时阻止编辑和 GC；
- 外部删除产生可恢复 missing 状态；
- 在支持上述安全 sweep 原语的平台，无引用 managed asset 首次只标记，7 天后经
  二次确认和 quarantine 复核才删除；不支持的平台明确保持 mark-only 并提示用户；
- 任意一次成功 managed reference commit 都在 Canvas 写入前持久重置旧 orphan 宽限期；
- `gc.json` 损坏、Canvas 文档损坏或路径验证失败时不会删除资产；
- GC 不删除 Project 可见文件、有效引用文件或活动 lease 文件；
- primary、poster、Plugin binding 与 in-flight lease 共同构成完整 GC 引用根；
- exclusive commit barrier 关闭最终扫描与 blob 删除之间的引用提交窗口；
- GC 只对已原子移出 blob namespace、进入 host-private quarantine 且隔离后复核
  成功的对象执行物理删除；任何 crash 或 identity 歧义都恢复或进入 repair，
  并明确不宣称抵御 hostile same-UID 对 private transaction 的直接篡改；
- Agent、Plugin、Renderer 不接收原生路径；
- 公共远程 URL 导入不能访问本机、私网、metadata 服务或通过 redirect/DNS rebinding 绕过限制；
- sandboxed Plugin 和 Agent 不获得公共 URL 导入网络出口；
- trusted top-level host UI 仍通过 narrow typed bridge 完成显式 URL 导入，不存在
  generic fetch 或任意响应读取；
- 旧资源 schema 被明确拒绝且不会被新版本修改；
- 生产代码不包含旧资源迁移、兼容读取、兼容写入或 fallback；
- 旧 managed asset 布局永远不进入新 GC 的删除集合。

## 27. 最终设计摘要

本设计采用最小必要状态：

```text
Project 文件
  -> Canvas 直接保存相对路径引用

Project 外文件
  -> SHA-256 去重
  -> .convax/assets/blobs
  -> Canvas 保存 managed SHA-256 引用

Canvas 新建 / AI 生成
  -> 富文本使用版本化无损文件，其他文本使用 UTF-8/Markdown
  -> 用户可见 Project 文件 + atomic no-replace
  -> Canvas 保存 Project 路径引用

GC
  -> 扫描所有 Canvas 文档获得真实引用
  -> reference commit 在写 Canvas 前 clear 旧 orphan
  -> gc.json 记录首次无引用时间与 full-scan guard
  -> 7 天宽限 + 删除前二次确认 + private quarantine 后复核

Project transactions
  -> file/directory move WAL + physical no-clobber rollback
  -> Canvas catalog create/delete WAL + startup recovery
  -> generated publish WAL + preserve-published recovery
  -> GC private-quarantine delete WAL + full phase recovery matrix

Cutover
  -> 只接受新 resource schema
  -> 删除 migration / fallback / dual-read / dual-write
  -> 旧 schema fail fast 且不被修改
```

由此保证用户资产是唯一内容来源，Canvas 是关系与视图层，`.convax/assets` 只承担外部资产的去重接纳和安全延迟回收。
