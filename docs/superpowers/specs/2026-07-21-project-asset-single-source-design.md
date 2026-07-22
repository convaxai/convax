# Project 资产单一事实来源与延迟回收设计

状态：已批准的破坏性重构设计，供后续 implementation plan 使用。

本文只解决三件事：Canvas 内容以 Project 管理的磁盘资源为唯一来源、Project 外文件按内容去重复制、无引用 managed asset 延迟回收。设计明确接受安全的 partial success，不提供跨文件 ACID、自动移动追踪或通用资源目录。

## 1. 背景与现状

当前实现已经通过 `ProjectManager.watchProject` 监听已打开 Project 的文件系统变化，并以约 120 ms 防抖刷新 Project Files 中可见目录。递归监听不可用时会退化为根目录监听，watcher 出错后最多重试 5 次。

这只能说明 App 能感知“目录可能变化”，还不能保证：

- Canvas 中的文件内容随外部修改刷新；
- 删除后节点进入明确的 missing 状态；
- 移动或重命名后引用自动跟随；
- 同一个外部文件重复拖入时只保存一份；
- 无引用的 `.convax/assets` 文件最终会被回收。

当前 Canvas 还允许把文本正文或运行时 URL 放进文档数据，Project 内媒体也可能被再次复制到 `.convax/assets`。这些行为造成多个内容来源，难以回答“用户改了磁盘文件后哪一份才是真的”。

## 2. 目标

### 2.1 核心目标

1. Project 管理的磁盘资源是内容的唯一事实来源：`project-file` 读取用户可见文件，`managed-asset` 读取 Project 持有的不可变私有副本。
2. Canvas 文档只保存资源引用和视图状态，不保存文本正文、二进制、`data:` URL、`blob:` URL 或原生绝对路径。
3. Project 内文件直接引用，不复制。
4. 只有从 Project 外引入的本地文件才复制到 `.convax/assets`。
5. managed asset 按实际文件内容的 SHA-256 去重；重复拖入只增加引用，不增加物理副本。
6. Canvas 新建文本和生成结果先成为用户可见 Project 文件，再由 Canvas 引用。
7. 没有任何 Canvas 引用的 managed asset 经过 7 天宽限期和删除前完整复查后回收。
8. 文件监听能让引用节点刷新或进入 missing 状态。

### 2.2 非目标

v1 明确不做：

- Resource Catalog、引用计数数据库或资产搜索索引；
- Canvas 与文件系统之间的跨文件事务；
- App 内外移动或重命名后的自动引用重写；
- 路径历史、inode 身份跟踪或跨平台 rename 配对；
- Canvas 级别撤销已保存的文件内容；
- 专有富文本文件格式；
- HTTP/HTTPS URL 导入、SSRF 下载器或通用网络代理；
- 云资产、远程占位符和按需下载；
- 旧 Canvas 资源结构的迁移或双读兼容；
- 防御恶意同 UID 进程在校验与 syscall 之间并发替换当前 Project 的目录项（包括 `.convax/` 和 `Notes/`）。

这些限制是简化方案的一部分，不是遗漏。未来只有在真实产品需求出现后才单独设计。

## 3. 核心模型

### 3.1 内容与视图分离

Canvas 文档保存：

- 节点 id、类型、位置、尺寸和关系；
- 一个类型化资源引用；
- 展示名称、检测到的 MIME 等可重建提示；
- 编辑器的非内容视图状态。

文件系统保存：

- 文本正文；
- 图片、视频、音频和普通文件字节；
- Canvas 新建内容；
- 生成结果。

运行时读取资源后可以在内存中形成文本、对象 URL、缩略图或媒体 metadata，但这些 hydration 结果不写回 Canvas 文档。

### 3.2 三种 Project 引用

```ts
type ProjectResourceReference =
  | {
      kind: "project-file"
      path: string
    }
  | {
      kind: "managed-asset"
      sha256: string
      name: string
      mediaType?: string
    }
  | {
      kind: "project-directory"
      path: string
    }
```

`project-file.path` 是规范化 POSIX 分隔符的 Project 相对路径。它不能逃出 Project，也不能以任何大小写形式指向 `.convax`。`managed-asset` 是独立引用类型；只有可信 Project adapter 可以根据 digest 把它解析到 `.convax/assets/blobs/`，该私有路径不能成为 `project-file` 引用。

`managed-asset.sha256` 是 64 位小写十六进制摘要。物理路径由固定规则推导：

```text
.convax/assets/blobs/<sha256>
```

`name` 和 `mediaType` 只是显示与解码提示，不参与寻址，也不能证明文件内容。每次进入需要信任字节的边界时，Main 读取实际文件并重新验证大小、签名或摘要。

其中 `project-file` 和 `managed-asset` 是两种内容引用。`project-directory` 不是内容资源；现有 folder node 用它保存 Project 内目录，不允许指向 `.convax`，也不进入 managed asset GC。

如果 Plugin 节点需要多个持久资源，它们必须进入 host-owned 的类型化资源槽位；Plugin 自己的 opaque JSON 字符串不能保存路径或哈希，也不能让资产保持存活。

### 3.3 不需要 Resource Catalog

Resource Catalog 在 v1 没有新的权威信息：

- Project 文件的位置已经由 `project-file.path` 给出；
- managed asset 的位置可以从 SHA-256 确定性推导；
- 展示名称和 MIME 已在引用或运行时检查中获得；
- 存活性必须从全部 Canvas 文档中的类型化引用扫描得出；
- `gc.json` 只记录“何时首次确认无引用”，不是资源目录。

再增加 catalog 会复制路径、摘要、引用计数或 metadata，并产生 catalog、Canvas 和磁盘三者不一致的问题。因此 v1 不引入 catalog。未来若大型 Project 的全量扫描有可测量的性能问题，可以增加可重建索引，但它仍不能成为正确性的来源。

## 4. 持久化布局

```text
<project>/
  Notes/
    Untitled-<short-id>.md
  Generated/
    <generated-name>-<short-id>.<ext>
  ...用户已有文件...
  .convax/
    project.json
    canvases/
      catalog.json
      <canvas-id>/document.json
    assets/
      blobs/
        <sha256>
      .staging/
        <operation-id>
      gc.json
    staging/
      <short-lived-operation-id>
```

规则：

- `Notes/` 和 `Generated/` 是普通用户目录，可见、可移动、可版本控制；
- `.convax/assets/blobs/` 只保存 Project 外导入文件的内容副本；
- `.convax/assets/.staging/` 只保存尚未发布为 managed blob 的短期导入文件；
- `.convax/assets/gc.json` 与它管理的 store 放在一起，但不是 Resource Catalog；
- `.convax/staging/` 是 Notes/Generated 发布等操作的可丢弃临时区，不保存事务日志；
- 所有 staging 都位于 Project 所在文件系统，便于使用同文件系统原子操作。

`.convax` 继续对普通 Project Files 操作、Renderer、Agent 和 Plugin 隐藏。只有 `@convax/project/node` 的受限能力可以解析这些路径。

## 5. 资源进入 Canvas

### 5.1 统一判定

Main 收到 host-owned 文件或目录 token 后解析真实路径，并与 Project 根真实路径比较：

- Project 内普通文件：创建 `project-file` 引用；
- Project 内目录：创建 `project-directory` 引用；
- Project 外普通文件：导入 managed asset，再创建 `managed-asset` 引用；
- Project 外目录、任何 symlink、无法安全解析或不允许的对象：拒绝。

调用方不能通过传入 `kind` 或伪造 Project 相对路径选择分支。

Main 在任何文件复制或 `Notes/` 发布之前，以 Project、Canvas、actor 和
`commandId` 建立同载荷幂等边界。同一命令因响应丢失而重试时复用第一次
物理操作的结果，不重复复制 managed blob，也不重复发布可编辑副本或新建
文本；相同 `commandId` 的不同载荷明确冲突。混合本地文件与 `new-text` 的
批次先完成 Project 文件发布，再进入 managed asset mutex；Canvas 提交仍在
该 mutex 内完成，因此不会锁重入，也不会在引用提交前被 GC 删除。

### 5.2 Project 内文件

Project 内文件不复制。拖入两次的结果是两个 Canvas 节点引用同一个 Project 相对路径，`.convax/assets` 增加 0 个文件。

读取时 Main 重新执行路径规范化、真实路径 containment、文件类型和大小检查。文件内容发生外部修改后，下一次 hydration 直接读取新内容。

### 5.3 Project 外文件与去重

导入过程由 `@convax/project/node` 的 managed asset store 执行：

1. 把外部文件流式复制到 `.convax/assets/.staging/<operation-id>`；
2. 复制时计算实际字节 SHA-256，要求输入仍是同一个普通文件，并执行可配置的流式大小限制；v1 默认单文件上限为 8 GiB，避免把常见视频误判为不支持；
3. 完成后再次从 staging 文件验证摘要；
4. 若 `blobs/<sha256>` 已存在，验证其实际摘要；一致则删除 staging 并复用现有 blob；
5. 若目标不存在，使用同文件系统的原子 no-replace 发布；并发失败者验证 winner 后复用；
6. 返回 `managed-asset` 引用，由 Canvas application service 创建节点。

同一个外部文件移动到 Canvas 两次时，可以得到两个节点，但物理结果始终是一个 `blobs/<sha256>` 文件。不同文件名但字节完全相同也只保存一份；每个引用仍可保留自己的显示名称。

导入是 value copy。Canvas 和 Project 元数据都不持久化、监听或继续访问原始外部路径；复制完成后，managed blob 是该引用的权威字节来源。原始外部文件后续发生修改、移动或删除都不会自动传播到 Canvas。

如果 blob 已存在但实际摘要与路径不符，导入失败并报告 managed store 损坏，不能覆盖或信任该文件。

`name` 和 `mediaType` 只是每个引用自己的展示提示，不参与内容地址，也不是文件系统信任依据。实际读取和 hydration 仍从 blob 字节重新校验；managed store 不为任意文件格式维护第二套扩展名或魔数目录。

### 5.4 Partial success

managed blob 发布成功而 Canvas 提交失败时，不回滚删除 blob。它只是暂时没有引用，后续 GC 会处理。这样避免为了维持跨文件原子性而引入 WAL，也避免误删并发引用的内容。

## 6. 文本与 Canvas 新建内容

### 6.1 新建文本

v1 的 Canvas 文本使用标准 UTF-8 Markdown：

1. 在 `Notes/` 中用 exclusive create 创建 `Untitled-<short-id>.md`；
2. 创建引用该文件的文本节点；
3. 文本正文始终从文件读取，Canvas 文档不保存正文。

文件创建成功但 Canvas 提交失败时保留该文件，并提示“文件已创建，添加到 Canvas 失败”。用户可以从 Project Files 再次拖入。

Project 文件发布器不按 pathname 删除 `.convax/staging/` 中成功或失败的 staging alias；这些条目统一由 Task 9 的 24 小时延迟 GC 回收。发布前后的连续目录身份复查对普通 symlink 和检查前已经完成的替换仍然 fail closed；portable Node 无法把父目录验证与 `link` syscall 合并为一个原子操作，因此不承诺抵御同 UID 进程在两者之间并发替换当前 Project 的目录项（包括 `.convax/` 和 `Notes/`），这类直接篡改已由 §2.2 排除在威胁模型外。

v1 不定义 `.convax-note.json`，也不承诺完整富文本往返。需要粗体、列表、标题和链接时使用 Markdown。现有 `.txt` 和 `.md` Project 文件都可以作为文本资源；其他格式默认只读或由对应文件 renderer 打开。

### 6.2 编辑能力

编辑器能力由实际文件格式决定，不在 Canvas 文档中持久化另一份 `format`：

| 文件                                    | v1 能力                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| `.md`                                   | Markdown 编辑与预览                                           |
| `.txt`                                  | 纯文本编辑                                                    |
| `name` 为 `.md`/`.txt` 的 managed asset | 只读；编辑前先“保存为 Notes 副本”并切换为 `project-file` 引用 |
| 其他格式                                | 只读或交给注册的文件 renderer                                 |

读取文本时返回由实际字节计算的 `contentRevision`。保存前重新读取并比较；若文件从编辑开始后被外部修改，拒绝静默覆盖，用户选择重新加载或另存副本。

这是一项冲突检测，不是跨进程原子 CAS。极窄的“比较完成后、替换发生前”外部写入竞争仍采用最后完成者结果；v1 不为此引入平台专用事务协议。

### 6.3 Draft、保存、取消与撤销

- 未保存 draft 只存在 Renderer 内存；
- “取消编辑”丢弃 draft，不改磁盘文件；
- 编辑器撤销只作用于本次未保存 draft；
- “保存”通过 Project Files 写入端口原子替换目标文件；
- 保存后的文件修改不进入 Canvas undo 栈；
- Canvas undo 只撤销节点、位置、关系等 Canvas 文档变化；
- 需要回退已保存文件时由外部版本控制、文件历史或用户再次编辑完成。

关闭窗口、切换 Project/Canvas 时，有未保存 draft 就提示保存、丢弃或取消切换，不做后台隐式落盘。

## 7. 生成内容

生成内容是用户主动创建的 Project 内容，不属于 managed asset：

1. generation sidecar 把结果交给 host-controlled staging；
2. Main 验证数量、大小、MIME、签名和调用作用域；
3. 在 `.convax/staging/` 准备同文件系统临时文件；
4. 使用唯一短 id 和 no-replace 发布到 `Generated/`；
5. 创建引用该 Project 文件的 Canvas 节点；
6. 文本结果发布为 UTF-8 `.md`，媒体保留验证后的规范扩展名。

文件发布是提交点。Canvas 提交失败时保留 `Generated/` 中的结果，并报告“生成成功，添加到 Canvas 失败”。App 不尝试回滚用户生成文件，也不需要 generated publication WAL。

崩溃可能留下两种安全结果：

- `.convax/staging/` 中未发布的临时文件，24 小时后清理；
- `Generated/` 中已经发布但尚无 Canvas 节点的用户文件，永久保留，用户可再次拖入。

已有文件、目录或 symlink 不被覆盖；名称冲突时选择新的 short id。

## 8. 文件监听与移动语义

### 8.1 监听目标

现有 watcher 继续负责 Project 文件树刷新。资源层增加按事件失效：

- 任意合并后的 filesystem event 都使当前 Project 的全部已挂载 `project-file` 和 `project-directory` runtime snapshot 进入 stale；
- event 中的可选 path 只用于优先刷新相关的可见节点，不能缩小失效集合；
- watcher 重启、事件缺少 path、rename 或多个事件被合并时使用相同的整体失效语义；
- 内容修改：节点刷新内容和预览，不修改 Canvas document revision；
- 原路径删除：节点保留并显示 missing；
- 路径重新出现：节点重新 hydration。

进入 stale 不要求立即重读所有文件；当前挂载或再次访问的节点按需 hydration。watcher 是失效提示，不是事件日志。正确性来自每次读取时重新验证文件，而不是假设所有 OS 事件都可靠到达。

### 8.2 移动与重命名

v1 不自动改写引用，无论移动发生在 App 内还是 App 外：

- 原路径消失后节点进入 missing；
- 新路径作为普通 Project 文件出现；
- 用户通过“重新定位”或重新拖入建立新引用；
- App 不根据文件名、mtime、size、inode 或哈希猜测用户意图；
- 目录移动同样不批量重写 Canvas 文档。

这会牺牲便利性，但消除了物理移动、多个 Canvas revision、崩溃恢复和回滚之间的事务耦合。自动跟随移动应作为独立产品功能设计，而不是本次资产存储重构的前置条件。

### 8.3 删除

- 删除 Project 可见文件：保留 Canvas 节点并显示 missing；
- 删除 Canvas 节点：不删除 Project 可见文件；
- 删除 managed asset 引用：只改变 Canvas 文档，实际 blob 由 GC 延迟处理；
- 用户手工修改 `.convax/assets` 属于不受支持行为；摘要不匹配时 fail closed。

## 9. Managed asset GC

### 9.1 为什么 `gc.json` 放在 assets 下

路径固定为：

```text
.convax/assets/gc.json
```

它与 blob 和 import staging 属于同一个 managed store，随 store 一起移动和备份，也便于 `@convax/project/node` 独占管理。它只记录延迟删除时间，不保存资源 metadata、路径映射、引用计数或 Canvas id，所以不是 Resource Catalog。

固定 schema：

```json
{
  "schemaVersion": 1,
  "entries": {
    "<sha256>": {
      "unreferencedSince": "2026-07-14T10:00:00.000Z"
    }
  }
}
```

状态通过临时文件加原子替换写入。它是可重建的保守缓存；缺失或损坏时不删除任何文件，在本次完整扫描中从零重建时间。所有当前无引用 blob 从本次扫描时间开始新的 `unreferencedSince`，因此不会因为状态丢失而立即删除。

### 9.2 引用根

每次完整扫描读取当前 schema 下全部 Canvas 文档，并只收集类型化字段中的 `managed-asset.sha256`：

- 节点主资源；
- poster 等明确的 host-owned 资源槽位；
- Plugin 节点的 host-owned resource bindings。

任意 catalog-owned Canvas 的 `document.json` 缺失、无法读取、schema 不支持或资源字段校验失败时，本次 GC 整体停止。缺失文档不视为“尚未物化的空 Canvas”；普通新 Canvas 在首次文档物化前阻塞 GC，是防止缩小 durable 引用根的保守取舍。opaque Plugin JSON、普通字符串、运行时 URL 和日志都不算引用。

### 9.3 单段宽限回收

默认常量：

| 阶段                         |    时长 |
| ---------------------------- | ------: |
| 首次确认无引用后的宽限期     |    7 天 |
| staging 最短保留期           | 24 小时 |
| 完整扫描最小间隔             | 24 小时 |
| 首次 Canvas 访问后的空闲延迟 |   30 秒 |
| 扫描失败后的重试延迟         | 15 分钟 |

一次 GC 在 Project 级 asset mutex 内按以下顺序执行：

1. 扫描全部 Canvas 引用根；失败则无副作用退出；
2. 枚举 `blobs/` 中名称合法的普通文件和固定 `gc-delete-<sha256>` quarantine alias，不跟随 symlink；
3. 为仍被引用的 blob 删除旧 GC 记录，为首次无引用的 blob 记录当前 `unreferencedSince`；
4. 把已有记录、持续无引用满 7 天且本轮仍无引用的 blob列为删除候选；候选的旧记录暂时保留；
5. 原子保存 exact `{ schemaVersion: 1, entries }` `gc.json`；保存失败则不删除任何 blob；
6. 仅在加载到有效旧状态时恢复 live quarantine：用 no-replace hard link 发布缺失的 canonical blob，重新 no-follow 打开并验证同一身份和摘要后 unlink alias；canonical 已存在时不覆盖，只在双方验证后删除冗余 alias；重建无效状态的本轮不做这类 destructive cleanup；
7. 再次完整扫描全部 Canvas 引用根；候选重新被引用时先清除其记录并重新保存状态；
8. 删除前先对全部剩余候选完成 no-follow 身份、大小、时间和摘要预检；任何预检失败都不开始删除；
9. 将 canonical blob 原子 rename 到固定 private quarantine alias，重新 no-follow 打开并验证后只 unlink alias；失败记录和 crash 后遗留 alias 留待下一轮重试；
10. 下一轮扫描从状态中移除已经不存在的 blob 记录；
11. 清理超过 24 小时的普通 `.convax/assets/.staging/*` 和 `.convax/staging/*` 文件，不递归、不跟随 symlink，并排除 GC quarantine alias。

最终物理删除最早发生在第一次确认无引用后的约 7 天，并可能因为 24 小时扫描间隔更晚。短暂重新引用会清除旧计时；再次变成无引用后重新计算 7 天。

如果进程在 `gc.json` 保存后、删除前退出，blob 和到期记录都保留，下一轮重试。如果进程在删除后退出，最多留下指向不存在 blob 的 stale timing entry，下一轮枚举会删除该记录。两种情况都不需要 WAL。

不维护引用计数。即使一个摘要被 100 个节点引用，扫描结果也只是“存在至少一个引用”。

### 9.4 调度

GC 不监听每次节点删除，也不创建高频定时器。调度状态只存在于 Desktop 进程内，`gc.json` 不记录上次成功扫描时间，Desktop 也不使用其 mtime 节流：

- Project 第一次成功访问 Canvas 文档时，空闲 30 秒后运行；
- Canvas 文档读取前捕获调度 lease；Project close/closeAll 使慢读取持有的旧 lease 失效，读取完成不能重新打开已关闭 Project 的计时器；
- Project 持续打开时，每次成功扫描后 24 小时运行下一轮；失败后 15 分钟重试；
- 进程重启后可能多执行一次安全的完整扫描；
- Project 关闭和 App 退出时不强制运行；
- 同一 Project 只允许一个 GC；重复请求合并；
- 不同 Project 的 GC 由 Desktop 限制为全局单任务后台执行。

### 9.5 与导入和重新引用的并发

managed import、managed reference admission 和 GC 扫描/删除共享同一个 Desktop 组合出的 `ProjectManagedAssetStore` 实例及其中的进程内 Project asset mutex；不得为 preparation、repository 和 GC 分别创建互不相干的 store。

新增 managed 引用前必须在 mutex 内确认 `blobs/<sha256>` 存在且摘要正确，并让该引用的 Canvas commit 在同一 mutex 临界区完成。外部导入回调进入 repository save 时，只允许 repository 的引用复核复用仍有效的同 store、同 Project 异步锁上下文；其他重入失败，过期上下文重新排队。这避免自锁，也不在 admission 与 commit 之间释放锁。GC 从最终引用扫描到候选删除也始终持有该 mutex，因此新引用不能插入到最终复查与删除之间。managed blob 发布成功但 Canvas 提交失败时，留下的 blob 仍是安全的无引用文件，下一轮 GC 会开始计时。

进程崩溃不需要前滚或回滚事务：

- staging 可以稍后清理；
- live orphan 会被下一轮标记；
- 删除前崩溃只会延长保留，删除后崩溃只会留下可清理的 stale timing entry；
- 已发布的用户文件永不由 managed asset GC 删除。

## 10. 破坏性切换

本方案不兼容旧资源结构：

- 提升 Canvas document schema；
- 删除 inline text、remote URL 和旧 path-only managed reference 的新写入路径；
- 不提供双写、兼容读取或自动迁移；
- 新版本遇到旧 schema 时明确拒绝打开并说明版本不支持；
- 拒绝打开不等于自动删除，旧文档和旧 assets 不进入新 GC；
- 测试 fixture、示例 Project 和开发数据直接重建为新 schema；
- Desktop preload/main/renderer 合约若不兼容则同步提升 protocol version。

这是一次发布边界清晰的替换，不在运行时混合两套语义。

## 11. Package 所有权

### `@convax/canvas`

- 拥有内容节点的通用资源槽位语义、资源 application/business ports，以及 runtime hydration、missing/corrupt 展示状态的 headless 合约；
- 不定义或解析 `ProjectResourceReference`，不拥有 Project 路径、managed digest、文件 I/O 或 GC。

### `@convax/project/canvas`

- 拥有 host-owned metadata 中的具体 `ProjectResourceReference` union、Project scope 校验、合法字段遍历和序列化校验；
- 确保 dehydrate 后没有文本正文、URL 或 native path；
- 为 GC 提供“从一个有效 Canvas 文档枚举 managed hashes”的纯函数。

### `@convax/project/node`

- 解析 Project 绑定与真实路径；
- 实现 Project 文件读取、文本写入、managed import 和摘要验证；
- 拥有 `.convax/assets`、`gc.json`、staging 和 Project asset mutex；
- 实现 Canvas repository 的新 schema 持久化和旧 schema 拒绝。

### `@convax/project-files`

- 保持 Project 相对路径的文件 CRUD、目录树、watch event 和文本读写合约；
- 不读取 Canvas 文档，不维护资源引用或 GC 状态。

### `@convax/desktop`

- 把外部拖入 token、Project scope、Canvas application service 和 native adapter 组合起来；
- 调度 watcher 失效、GC 和 generation 文件发布；
- 通过窄 IPC 暴露类型化能力，不向 Renderer 暴露原生路径或 `.convax` JSON。

## 12. 错误与产品状态

资源节点至少区分：

- `ready`：路径与内容验证成功；
- `missing`：Project 文件路径不存在；
- `corrupt`：managed blob 不存在、不是普通文件或摘要不匹配；
- `unsupported`：文件格式没有可用 renderer；
- `conflict`：文本保存前检测到外部修改。

错误不通过清空节点、写入空正文或自动重新导入来“修复”。用户可以重新加载、重新定位、另存副本或删除节点。

## 13. 测试范围

### 资源与 schema

- Project 内文件产生 `project-file`，不写 `.convax/assets`；
- Project 内目录产生 `project-directory`，Project 外目录被拒绝；
- `project-file` 拒绝所有大小写形式的 `.convax` 路径；
- 同一外部文件重复导入只产生一个 blob；
- 相同字节不同文件名仍去重；
- 外部来源绝对路径不进入 Canvas/Project 元数据，导入后修改原文件不改变 managed blob；
- managed 引用路径只能由合法 SHA-256 推导；
- 持久化 Canvas 不包含正文、运行时 URL、原生路径；
- opaque Plugin state 中的字符串不成为 GC root；
- 旧 schema 被明确拒绝且文件未被修改。

### 文本与生成

- 新建文本先创建 `Notes/*.md`，再提交 Canvas；
- Canvas 提交失败时文件保留；
- `.md`、`.txt` 和只读格式能力正确；
- draft 取消不写盘，保存后 Canvas undo 不回滚文件；
- 外部修改触发冲突提示；
- 生成结果进入 `Generated/`，Canvas 失败时仍保留；
- 文本生成结果是文件引用，不是 inline text。

### Watcher

- 单次或合并 filesystem event 使当前 Project 的挂载资源整体 stale，可选 path 只影响刷新优先级；
- 修改使相关 runtime snapshot 按需刷新；
- 删除使节点进入 missing；
- 路径重新出现后恢复；
- move/rename 不自动改写 Canvas 引用。

### GC

- 首次 orphan 只记录时间，不移动；
- 7 天前不删除，满 7 天仍要重新扫描全部引用；
- 重新引用清除旧计时；
- `gc.json` 原子保存失败时不删除候选；
- 删除失败保留到期记录并在下一轮重试；
- `gc.json` 缺失/损坏时本轮不删除并可重建；
- 任一 Canvas 无法扫描时无删除副作用；
- symlink 和未知目录项不被跟随或删除；
- GC、导入和 managed 引用 admission 串行；
- Project 文件、`Notes/` 和 `Generated/` 永远不进入 managed GC。

## 14. 实施顺序

1. 提升 Canvas schema，落地三种 Project 引用并删除 inline content 新写路径；
2. 让 Project 内资源直接引用；
3. 实现 content-addressed external import 和并发去重；
4. 将 Canvas 新建文本与 generation 输出改为 file-first；
5. 接入 watcher 失效、missing/corrupt 状态和手动重新定位；
6. 实现 `gc.json`、单段 7 天宽限回收和 24 小时调度；
7. 删除旧 path-only managed、inline text、remote URL 与回滚资产逻辑；
8. 更新 Desktop protocol、架构文档和端到端 smoke tests。

每一步都使用同一新 schema，不添加临时兼容层。

## 15. 验收标准

方案完成后必须满足：

1. Project 内文件拖入 Canvas 0 次复制；
2. 同一 Project 外文件拖入 Canvas两次，Canvas 可有两个节点，`.convax/assets/blobs` 只有一个文件；
3. Canvas 文档中没有正文、二进制或临时 URL；
4. Canvas 新建文本直接生成 `Notes/*.md`；
5. 图片、视频、音频、文本和普通文件统一通过类型化引用读取；
6. 生成结果直接生成用户可见 `Generated/*` 文件；
7. 文件外部修改后节点刷新，删除后显示 missing；
8. 移动或重命名不会被错误猜测或自动改写；
9. 无引用 managed blob 至少保留约 7 天，并在删除前重新完成全部引用扫描；
10. `gc.json` 丢失、Canvas 扫描失败或摘要异常时 GC 保守停止；
11. 不存在 Resource Catalog、文件移动 WAL、Canvas catalog WAL、generation publication WAL 或每候选 GC WAL；
12. 旧 schema 不迁移、不双读，并且不会被新 GC 删除。

## 16. 最终结论

这次重构的关键不是让 Canvas“管理更多资产”，而是让 Canvas 不再拥有内容：

- Project 内内容留在用户文件中；
- Project 外内容只在 `.convax/assets` 保存一份按内容寻址的副本；
- Canvas 只保存引用；
- 新建和生成内容先落成用户文件；
- watcher 负责失效提示，读取负责最终验证；
- GC 通过全量引用扫描和单段 7 天宽限控制增长；
- partial success 通过“保留文件、允许重试”处理，不升级为文件系统事务框架。

这个边界足以实现用户资产单一来源，也为将来的移动跟随、索引或更强事务留下独立演进空间。
