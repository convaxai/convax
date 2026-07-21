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

  Generated/
    image-20260721-001.png

  .convax/
    project.json
    canvases/
      catalog.json
      <canvas-id>/
        document.json

    transactions/
      file-move-<operation-id>.json

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
- `.convax/transactions` 只保存尚未完成的短生命周期跨文件事务记录，成功后立即删除；
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
| `text` | `resources.primary` 必填；可引用 Project 文件或只读 managed asset | `text`、`richText`、`url` |
| `image` / `video` / `audio` / `file` | `resources.primary` 必填；`resources.poster` 仅在海报本身是独立持久文件时使用 | `url`、`posterUrl` |
| `folder` | `resources.primary` 必填且只能是 `project-directory` | 顶层 `path` |
| `plugin.*` 文件节点 | `resources.plugin` 保存 host 管理的命名资源绑定；是否需要 `primary` 由 host 注册的节点契约决定 | Plugin state 内嵌路径、哈希或资源 envelope |
| `group` / `agent` | 不允许持久化资源字段 | 任意资源字段 |

`url`、`posterUrl` 和文本正文只存在于 runtime hydrated view model，不属于
`CanvasDocument`。文件名、MIME、尺寸、时长和文本格式可以作为非权威展示提示；读取时仍从实际文件验证。

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
- `contentRevision` 是从同一个 no-follow 已验证句柄读取全部字节后计算的 SHA-256。managed asset 直接使用其路径哈希；可编辑 Project 文件必须返回该值；
- 文本保存、高风险外部调用和任何声称 expected revision 的 API 必须比较 `contentRevision`，不得只比较 mtime、size、inode/file id 或 watcher 序号；
- 大型只读媒体可以延迟计算 `contentRevision`，但在计费调用、Plugin 外部执行或其他高风险边界前必须计算并复核。

这保证相同大小、mtime 被保留或文件身份复用时仍能发现内容变化。它不能阻止不遵守 Convax 协调器的外部进程在最后一次校验后再次写文件，因此本文只对 Main-mediated 写入提供强 OCC；对任意外部编辑器提供内容级冲突检测和明确的剩余竞态说明，不宣称跨进程原子 compare-and-swap。

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
2. Main 在 `.convax/assets/staging/<operation-id>` 创建专用临时文件；
3. 单次流式复制文件，同时计算 SHA-256 和大小；
4. 校验文件类型、大小限制和源文件读取前后身份；
5. 根据 SHA-256 得到最终 blob 路径；
6. 如果 blob 已存在，验证现有 blob 后删除 staging，并复用该哈希；
7. 如果 blob 不存在，将 staging 原子发布到最终路径；
8. 创建引用该 SHA-256 的 Canvas 节点；
9. Canvas 提交成功后释放 admission lease。

### 8.2 并发去重

相同 Project、相同 SHA-256 的发布必须 single-flight。两个并发导入都完成哈希后，只有一个操作能够发布 blob；另一个验证已发布文件并复用。

### 8.3 远程 URL

远程 URL 不是长期可移植用户资产。新增远程资源只能由 Desktop Main 的受控下载器进入 staging，完成验证后按 Project 外文件处理。Renderer、Plugin 和 Agent 只能提交 URL 值，不能选择网络代理、请求头、解析地址或落盘路径。

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

1. 在 `Notes/` 选择可用文件名，例如 `Untitled.md`；
2. 使用原子创建避免覆盖已有文件；
3. 创建引用该 Project 相对路径的 Canvas 节点；
4. 用户编辑时写入该文件，Canvas 文档不保存正文。

如果文件创建成功但 Canvas 节点提交失败，保留用户可见文件并明确提示，避免删除已经成为用户资产的内容。

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
3. Main 将结果原子发布到用户可见的 `Generated/`；
4. 创建引用新 Project 文件的 Canvas 节点；
5. 通过 `CanvasResourceBusinessService` 提交节点、关系和 revision；
6. 可选 view 效果不能把成功的文件与 Canvas 提交变成失败。

如果结果已发布但 Canvas 提交失败，保留 `Generated/` 中的文件并报告“生成成功，添加到 Canvas 失败”。不得因为 UI 或 Canvas 错误删除用户生成成果。

## 11. 文件监听与同步

Project watcher 继续监听已打开 Project 根目录中的普通文件变化。资源层在收到变化后：

- 使匹配路径的运行时 revision 失效；
- 刷新文本、图片、视频、音频或普通文件节点；
- 使 Agent/Plugin 后续读取获得最新内容；
- 不通过文件变化直接改写 Canvas 布局 revision。

### 11.1 App 内移动或重命名

App 内文件操作返回明确的源路径与目标路径。Desktop 协调器通过 Canvas application/repository 能力更新所有受影响 Canvas 文档中的 Project 文件引用。不得由 Project Files package 直接编辑 Canvas JSON。

该操作通过后文同一个 Project resource commit coordinator 的 exclusive barrier 和短生命周期事务记录协调：

1. 先 flush 当前 Canvas；无法 flush 或存在 revision conflict 时不开始移动；
2. 获取 exclusive barrier，等待所有在途 Canvas/catalog/resource commit 完成，并阻止新提交；
3. 加载所有包含源路径的 Canvas 文档及其 storage revision；
4. 写入并 fsync `.convax/transactions/file-move-<operation-id>.json`，记录源/目标文件 identity、每个受影响节点、before storage revision、预期 after revision 和 phase；
5. 执行文件系统移动并持久化 phase；
6. 使用 exclusive callback 获得的不可伪造 mutation context，通过 Canvas application/repository 的内部 `saveWithinMutation` CAS 对每个文档只应用路径引用 patch，不替换整个旧文档，也不重入 shared barrier；
7. 全部成功后 fsync 必要目录、删除事务记录、释放 barrier，再发布文件系统变动事件；
8. 同进程失败时，逆向 patch 也必须基于当前 storage revision CAS，并只恢复本事务修改的资源引用；不得写回步骤 3 的整份文档快照；
9. 如果任何 CAS guard 不匹配，停止自动回滚，保留文件和文档，进入显式 repair；
10. 崩溃恢复必须在 Project 进入可编辑状态前、持有 exclusive barrier 时运行，并根据已记录 phase 与实际文件 identity 幂等完成或逆向 patch。

事务记录只承担一次移动的崩溃恢复，不是永久资源索引。它不保存可直接覆盖回去的 Canvas snapshot。文件操作在事务完成前不得向用户报告成功。

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

普通 Canvas/catalog/resource commit 在 shared barrier 内完成“读取 expected storage revision、校验资源/lease、原子替换文档或 catalog”的最终提交段。文件移动和 GC 删除使用 exclusive barrier；exclusive 请求到达后不再放行新的 shared 请求，避免删除饥饿。

`ProjectResourceMutationContext` 是 Project Node 内部不可构造的 capability。repository 和 asset store 提供仅供聚合内部使用的 `*WithinMutation(context, ...)` 操作；已经持有 exclusive barrier 的移动/GC 流程必须传递该 context，不能再次获取 shared barrier 造成死锁。公开 repository/client API 永远不能接收调用者自造的 context。

这不是隐藏全局或 Desktop service locator：coordinator 由 Project Node adapter 拥有，并显式注入 repository、asset store 和 Desktop 协调器。打包版本已有应用级 single-instance lock；允许多实例的开发模式还必须使用 Project writer ownership guard，禁止两个 Main 同时以可写方式打开同一 Project。无法取得 guard 时不得启用 GC 或任何 Project 私有写入。

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
5. 从候选集合剔除最新引用或 lease 覆盖的哈希；
6. 对剩余候选再次执行 `lstat`、realpath、文件 identity 和 SHA-256 校验；
7. 将仍满足全部条件的普通受管 blob 固化为 `confirmedCandidates`；
8. 保持 exclusive barrier，进入阶段五完成同步删除和 `gc.json` 提交后才释放，随后才允许新的 reference commit。

Canvas 添加 managed asset 时必须先创建 lease，再进入 shared barrier 提交节点或 Plugin binding；节点引用提交成功或失败后才释放 lease。因为所有合法引用写入、catalog 变化与 GC 删除都共享同一 coordinator，不存在“二次扫描完成后新增引用、blob 随后被删除”的提交窗口。

### 15.5 阶段五：提交 GC 状态

仍在阶段四取得的 exclusive barrier 内执行：

1. 同步删除 `confirmedCandidates` 中的 blob；
2. 从内存状态移除对应 orphan 项；
3. 设置 `lastSuccessfulScanAt`；
4. 将新状态写入同目录临时文件；
5. fsync 必要边界并原子替换 `gc.json`。

如果 blob 删除成功但 `gc.json` 更新失败，旧 orphan 记录是无害的；下次扫描会发现文件不存在并移除记录。记录错误后释放 barrier，不得先宣告成功再异步执行不可观测删除。

## 16. GC 时间示例

```text
7 月 1 日 10:00  最后一个 Canvas 引用被删除
7 月 1 日 10:05  防抖扫描确认无引用，写入 unreferencedSince
7 月 8 日 10:05  宽限期结束
7 月 8～9 日      下一次成功扫描与二次确认后删除
```

正常情况下，孤儿资产会在首次确认无引用后约 7～8 天被删除。如果 Project 长期没有打开，则 GC 延迟到下次打开；App 未运行时不会在后台删除文件。

## 17. Staging 清理

Staging 与正式 blob 使用不同规则：

- 正在运行的操作通过 lease 保护 staging；
- 操作成功后 staging 被原子发布或删除；
- 操作取消或失败后立即尝试删除 staging；
- Project 打开和日常 GC 时扫描超过 24 小时且无 lease 的 staging；
- staging 清理不需要 7 天宽限，因为它从未成为已提交用户资源；
- 删除前仍需执行 containment、普通文件和符号链接检查。

## 18. `gc.json` 丢失或损坏

`gc.json` 不是引用事实来源，因此丢失不能触发资产删除。

恢复流程：

1. 完整扫描所有 Canvas 文档；
2. 完整扫描所有合法 blob；
3. 对当前无引用 blob 以“当前时间”建立新的 orphan 记录；
4. 对当前有引用 blob 不建立记录；
5. 原子写入新的 `gc.json`；
6. 本次恢复扫描不删除任何 blob。

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
- 文本不内嵌后的唯一 Canvas schema；
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
- `.convax/assets/gc.json` 持久化；
- GC 扫描、lease、二次确认和删除；
- 仅支持当前 schema 的 Canvas repository 访问；
- 短生命周期文件移动事务记录与崩溃恢复；
- 文件监听的 native adapter。

### `@convax/project-files`

- Project-scoped 文件 CRUD、读取、预览和变动事件契约；
- 不直接编辑 Canvas 文档；
- 不暴露 `.convax` 私有元数据的一般读写能力。

### `@convax/desktop`

- Electron composition、IPC 和 preload；
- Renderer 文件 hydration 和编辑冲突 UI；
- App 内文件移动后跨 Canvas 引用更新协调；
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
- 删除前重新验证文件，防止 symlink replacement；
- GC 只删除合法内容寻址 blob，未知文件 fail closed；
- 外部 Plugin、Agent 和 Renderer 不获得原生路径；
- 不能为了方便资源读取而削弱 protected-path 或 scope 检查。

## 24. 测试计划

### Canvas

- 新 schema 不持久化文本正文和运行时 URL；
- `text`、全部 media/file、folder、Plugin、group 和 agent 的新持久化形态均有正反 fixture；
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
- staging 取消、失败和崩溃恢复；
- 远程下载拒绝私网/loopback/metadata IPv4 与 IPv6、DNS rebinding、非法 redirect、非 HTTPS、自定义端口、超时和流式超限；
- SHA-256 路径验证；
- symlink replacement、Windows 路径和大小写碰撞；
- App 内移动和重命名；
- App 内移动事务的失败、CAS 逆向 patch 与崩溃恢复；
- 移动期间并发 Canvas commit 被阻塞，恢复冲突不会覆盖无关 Canvas 修改；
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
- 7 天后仍无引用才删除；
- 删除前新 lease 阻止删除；
- 删除前新 Canvas 引用阻止删除；
- exclusive barrier 等待在途 commit，并阻止扫描后新增引用越过删除边界；
- catalog create/delete 与 GC 删除交错时仍以 barrier 内完整快照为准；
- 任意 Canvas 文档损坏时整轮 fail closed；
- `gc.json` 缺失或损坏时重建但不删除；
- 系统时钟回退不提前删除；
- staging 使用独立 24 小时规则；
- 非法文件、目录和符号链接不删除；
- blob 删除成功但状态写入失败可以安全重试；
- single-flight 与 rerun 合并。

### Desktop 与集成

- preload/main/renderer 新协议一致性和旧协议拒绝测试；
- 外部文件导入 token 不泄露原生路径；
- 文件变动刷新 Canvas 且规避缓存；
- Agent 读取最新文本内容；
- Plugin 只能读取当前节点授权的资源；
- JianYing 等原生集成对 Project 文件使用短生命周期 staging；
- Project 切换取消旧作用域的监听、编辑和 GC 任务；
- 存储占用和手动清理 UI。

按变更范围运行相关 package 的 `bun typecheck` 与 `bun test`，并运行根目录 `bun check`、`bun run pack:check`。Desktop persistence/IPC 变更还需执行 `bun run build` 和 `bun run smoke:open-project`。

## 25. 实施顺序

1. 先更新根/Project 架构契约，记录本次 breaking cutover 例外和数据保护底线；
2. 定义覆盖全部现有 node kind、Plugin bindings 和唯一 traversal 的新 Canvas resource schema，并提升 schema version；
3. 建立统一的 Project-scoped resource read/write/content-revision port；
4. 实现 Project writer guard 和 shared/exclusive resource commit coordinator，并将所有 repository/catalog/asset 写路径接入；
5. 改造 Project 内文件拖入流程为直接引用；
6. 实现外部导入 staging、SHA-256 内容寻址、并发去重和远程 URL SSRF 防护；
7. 改造 Canvas 文本为文件引用及 content-hash OCC 编辑；
8. 将 Canvas 新建内容发布到 `Notes/`，将生成结果发布到 `Generated/`；
9. 接入文件监听刷新、App 内受屏障保护的路径更新和外部 missing/relink；
10. 实现 `.convax/assets/gc.json`、完整引用根扫描、exclusive 删除屏障、GC 调度和存储统计；
11. 更新 Agent、Plugin 和原生集成的资源读取边界；
12. 删除旧 schema、旧 managed asset、旧资源 API 和全部运行时兼容分支；
13. 更新其余架构文档、IPC protocol、边界策略、发布说明和破坏性变更验收。

实现过程中每个提交仍需通过其所有权边界的类型检查和测试，但不要求旧资源 Project 可打开。合入主线前必须确认生产代码中不存在旧资源 decoder、migration、fallback 或 dual-write。

## 26. 验收标准

- Project 内文件进入 Canvas 后不产生 managed copy；
- 同一 Project 文件可由多个节点和 Canvas 引用；
- Project 外相同内容在 `.convax/assets` 最多有一个持久 blob；
- Canvas 文档不保存文本正文或媒体内容；
- 每个现有 node kind 都有唯一的新 schema 表达，不存在隐式 metadata 资源变体；
- Canvas 新建文本成为 `Notes/` 下的真实文件；
- 生成内容成为 `Generated/` 下的真实文件；
- 外部修改会刷新所有引用节点；
- stale 文本编辑不会静默覆盖外部修改；
- expected content revision 使用实际内容 SHA-256，相同 metadata 的内容变化也会冲突；
- App 内移动后引用保持有效；
- 移动失败或恢复不会用旧 Canvas snapshot 覆盖并发修改；
- 外部删除产生可恢复 missing 状态；
- 无引用 managed asset 首次只标记，7 天后经二次确认才删除；
- `gc.json` 损坏、Canvas 文档损坏或路径验证失败时不会删除资产；
- GC 不删除 Project 可见文件、有效引用文件或活动 lease 文件；
- primary、poster、Plugin binding 与 in-flight lease 共同构成完整 GC 引用根；
- exclusive commit barrier 关闭最终扫描与 blob 删除之间的引用提交窗口；
- Agent、Plugin、Renderer 不接收原生路径；
- 公共远程 URL 导入不能访问本机、私网、metadata 服务或通过 redirect/DNS rebinding 绕过限制；
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
  -> 用户可见 Project 文件
  -> Canvas 保存 Project 路径引用

GC
  -> 扫描所有 Canvas 文档获得真实引用
  -> gc.json 只记录首次无引用时间
  -> 7 天宽限 + 删除前二次确认

Cutover
  -> 只接受新 resource schema
  -> 删除 migration / fallback / dual-read / dual-write
  -> 旧 schema fail fast 且不被修改
```

由此保证用户资产是唯一内容来源，Canvas 是关系与视图层，`.convax/assets` 只承担外部资产的去重接纳和安全延迟回收。
