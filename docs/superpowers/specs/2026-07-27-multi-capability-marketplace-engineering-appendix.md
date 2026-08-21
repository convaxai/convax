# Convax 多 Marketplace 工程附录

> 历史方案：其中产品锁、固定 Official 与默认安装设计已退役，不是当前架构或实现依据。当前契约以 `docs/architecture.md` 和 `docs/plugin-skill-platform.md` 为准。

状态：随
[主方案](2026-07-27-multi-capability-marketplace-design.md)
一起待最终确认。本文供实现与安全审阅使用，不是产品说明。

阅读路径：

- 协议作者：A-G、H；
- Desktop 实现者：A-F、H-L、N；
- 安全审阅：A、C、F、I-M。

实施、测试和 Future 分别见：

- [实施说明](2026-07-27-multi-capability-marketplace-implementation-notes.md)；
- [验收计划](2026-07-27-multi-capability-marketplace-acceptance-plan.md)；
- [Future](2026-07-27-multi-capability-marketplace-future.md)。

## A. 规范性不变量

以下规则优先于具体 schema、文件名和 UI 实现：

- **INV-01 Single owner**：一个概念只有一个 owner 和一个权威状态源。
- **INV-02 Source is not authority**：Marketplace 只提供内容来源，不授予执行权限。
- **INV-03 Source lock**：已安装 `{kind,id}` 绑定原 Marketplace，禁止跨来源更新或
  换源。
- **INV-04 Passive catalog**：添加或刷新 Marketplace 只允许获取 descriptor、
  Registry、Showcase 和展示素材；不下载 package/companion，不连接其声明的 MCP/
  业务 endpoint，不 OAuth，不启动进程。
- **INV-05 Two decisions**：静态安装与设置是两个独立 mutation；任何首次 HTTP
  connection 或本地 process execution 都必须 setup，OAuth 只是可选子步骤。
- **INV-06 Main-derived inputs**：除专用 `addMarketplace` IPC 接收用户粘贴的 descriptor
  URL 外，Renderer 不提交 URL、header、command、native path、digest 或 MCP method。
- **INV-07 Installed runtime authority**：list/install/update 使用 active source；
  runtime 使用 immutable installed snapshot、InstallRecord 和 ExecutionGrant。
- **INV-08 Isolation**：一个来源的失败、回滚或损坏不得污染其他来源。
- **INV-09 Cache is disposable**：缓存永远不是安装、来源或授权的权威状态。
- **INV-10 Skill ownership**：Plugin-owned Skill 继续由 Plugin 生命周期拥有。
- **INV-11 Skill is inert**：Skill 不因说明中提到工具而获得执行权限。
- **INV-12 Bounded dynamic tools**：`tools/list` 不能扩大 Convax 产品动作 allowlist。
- **INV-13 Exact executable**：本地组件绑定 exact source/path/size/SHA-256。
- **INV-14 Transport split**：HTTP MCP 不能携带 companion；managed stdio 不接收远端
  endpoint。
- **INV-15 Convergence**：每个 mutation 收敛到 previous 或 next 完整状态。
- **INV-16 Fail closed**：任何歧义 fail closed，并保留仍可安全使用的旧状态。

## B. 内部词汇

主方案不使用以下词，Marketplace 子系统固定为以下权威记录：

| 名称                   | 责任                                                    |
| ---------------------- | ------------------------------------------------------- |
| `InstallRecord`        | 内容身份、安装版本、来源和已发布字节摘要                |
| `ExecutionGrant`       | 用户对 exact OAuth/endpoint policy 或本地执行身份的同意 |
| `OwnerBinding`         | Plugin-owned Skill 与 owner Plugin 的权威绑定           |
| `ProvisioningDecision` | 用户对某个产品预装 policy 的保留或卸载决定              |
| `SourceSecurityState`  | 每个 SourceKey 的 sequence 与版本字节 high-water        |
| `RuntimePreference`    | 用户对 exact installed identity/source 的启用或停用选择 |
| `CapabilityTransition` | 一个 mutation 的编排与恢复 envelope                     |

不要继续把所有记录泛称为 receipt。现有 legacy schema/file name 可以在迁移层保留，
但新增 domain type、测试和文档使用上表术语。

子系统外只暴露一个 `InstalledCapability` 聚合 projection；调用方不需要分别理解上述
记录。内部还使用：

```ts
type MarketplaceKind = "builtin" | "network" | "local"
type MarketplaceItemKind = "plugin" | "skill" | "mcp-server"

interface MarketplaceItemRef {
  marketplaceId: string
  kind: MarketplaceItemKind
  id: string
}

interface InstalledIdentity {
  kind: MarketplaceItemKind
  id: string
}

interface RuntimePreference {
  identity: InstalledIdentity
  sourceKey: SourceKey
  desired: "enabled" | "disabled"
  revision: number
}

type SourceKey = string & { readonly __sourceKey: unique symbol }
type SelectionToken = string & { readonly __selectionToken: unique symbol }

interface McpServerPrincipal {
  id: string
  version: string
  runtimeKind: "http-agent" | "managed-stdio"
  authorizationContractDigest: string
  installRecordRevision: number
  executionGrantRevision?: number
}
```

`SourceKey` 和 `SelectionToken` 是 Main-only opaque value。Renderer 只回传 token，
不能构造其中的 revision、version、digest 或 source identity。

MCP Server 使用独立 principal、store 和 runtime namespace，不能伪造
`PluginPrincipal`。

Main 计算：

```text
authorizationContractDigest = SHA-256(canonical({
  sourceKey,
  serverDefinitionDigest,
  extensionDigestOrNone,
  runtimeEntryOrTarget,
  productActions,
  grants,
  executableBindingOrNone
}))
```

`McpServerPrincipal` 与 `ExecutionGrant` 都 exact 绑定该 digest。每次连接、启动或
product action 前重算；跨来源重装、extension 变化、target 变化或 executable 漂移都
不能复用旧 grant。

## C. Source identity

### C.1 Marketplace id

`marketplaceId` 在完整 source graph 中全局唯一，包括 Builtin、Network 和 Local。

它只用于：

- 路由；
- 命名空间；
- 展示来源；
- 与 `SourceKey` 一起绑定安装记录。

它不用于：

- 授予权限；
- 推断可信度；
- 选择 native adapter；
- 识别具体供应商或模型。

### C.2 SourceKey

`SourceKey` 从经过严格校验的 source identity payload 计算。算法细节只在
`@convax/marketplace` 中实现一次：

```text
SHA-256(canonical-json(validated source identity payload))
```

规则：

- Network identity 至少绑定 marketplace id、规范化 descriptor URL、repository 和
  delivery policy。
- Builtin identity 绑定产品定义的 source instance，不包含包成员列表；新增 Builtin
  包不能改变旧安装的来源身份。
- Local identity 绑定 marketplace id、稳定 `sourceInstanceId` 和 policy version，
  不绑定可移动的 native root path。
- 相同 catalog、相同版本或相同 artifact bytes 不能使两个不同 source identity
  等价。
- 修改 Network origin、repository 或 delivery policy 产生新的 SourceKey，不是刷新。

每个 SourceKey 还有权威 `SourceSecurityState`：

```text
highest accepted sequence
accepted revision identity
accepted catalog digest
{kind,id,version} -> normalized metadata/artifact contract digest
```

规则：

- 后续 sequence 复用同 `{kind,id,version}` 但改变 metadata/artifact bytes 时拒绝；
- sequence rollback 拒绝；
- source removal 不删除被 InstallRecord 或 retained source identity 引用的 high-water；
- 重新添加 exact SourceKey 仍使用旧 high-water；
- high-water 不是 cache，不能因清缓存绕过；
- 只有用户执行单独、明确标为降低 rollback protection 的安全状态重置操作时才可清除，
  首版 UI 不提供该操作。

`SourceSecurityState` 使用 Host 固定、schema-versioned 的硬上限：每个 SourceKey
最多保留 16,384 个 version contract，canonical 序列化后最多 8 MiB。任何一个上限
将在下一次 refresh 被超过时：

- 拒绝整个新 Catalog；
- 不裁剪历史、不滚动淘汰 high-water；
- 保留 last-known-good Catalog 和安全状态；
- 将该 Marketplace 标为需要处理，但不影响已安装 runtime。

source store 通过一个原子 decision 同时接受 Catalog 与安全状态：

1. 校验新 Catalog，生成下一份 high-water，并把 Catalog bytes 写成 fsync 完成的
   immutable cache snapshot；
2. 用 revision/CAS 和 atomic rename 提交一个同时包含 next
   `SourceSecurityState`、accepted sequence/revision 和 Catalog digest 的 canonical
   record；
3. 只有该 record 提交后，Catalog projection 才能切换到 next。

因此不能出现“新 Catalog 已可见但其 high-water 尚未落盘”。decision 前 crash 使用
previous，decision 后 crash 使用 next；未被 canonical record 引用的 prepared
snapshot 只能作为 orphan 清理。被引用的 snapshot 缺失或损坏时 source fail closed，
不得从 cache 反推或降低 `SourceSecurityState`。

### C.3 选择 token

Main 在用户打开详情或安装确认页时签发短期、sender-scoped `SelectionToken`，内部绑定：

```text
MarketplaceItemRef
SourceKey
catalog sequence/revision
selected version
normalized metadata digest
artifact URL/size/SHA-256
current target companion identity（如有）
```

安装时 Main 必须重新加载当前 source 并比较 token。任何变化返回 stale selection，
要求用户重新确认；不能安装用户未看到的新版本或新权限。

## D. 聚合和冲突

`@convax/marketplace` 产出两层 projection：

1. source-qualified item：每个 Marketplace 的真实条目；
2. display group：按 `{kind,id}` 聚合的 UI 卡片。

display group 不能：

- 合并权限；
- 合并版本历史；
- 合并摘要；
- 在安装后改变当前来源。

presentation representative 只负责展示：

1. 已安装时使用已安装来源。
2. 未安装时依次选择 Builtin、Official、最早添加的第三方 Network source。
3. 同层按 marketplace id 稳定排序。

安装仍要求用户明确选择来源；presentation representative 不是安装 winner，也不能把
自己的权限、版本或摘要套到其他来源。

选定来源后，Main 必须重新生成该 source 的 exact 名称、说明、version、setup、权限和
字节摘要确认页，再签发 SelectionToken。

安装冲突规则：

```text
没有相同 InstalledIdentity
  -> 允许从用户选定来源全新安装

已有相同 InstalledIdentity 且 SourceKey 相同
  -> 允许同源更新

已有相同 InstalledIdentity 但 SourceKey 不同
  -> source-conflict，要求先卸载
```

`legacy-unbound` 不是 Marketplace 来源。它只允许一次显式、exact-tree 的迁移认领，
规则见迁移章节。

## E. Source adapters

### E.1 Builtin

Builtin adapter 读取打包资源中的 immutable bundle。

要求：

- 完全离线；
- Main-only；
- 只读；
- 先验证 product lock，再验证 `bundle.json` 和每个成员；
- 成员身份必须与 product lock 生成的 early reservation table 一致；
- bundle 损坏时仍保留 reservation，第三方不能抢占 Builtin id；
- Marketplace membership 不自动授予 native trust。

首版 Builtin 内容：

```text
kind: skill
id: canvas-storyboard
version: 0.1.0
```

### E.2 Official

Official 是固定来源：

```text
marketplaceId: convax-official
repository: convaxai/convax-plugins
```

Official adapter 支持：

- Registry v2；
- 旧客户端继续使用的 v1 projection；
- Showcase；
- immutable Release artifacts；
- product lock 固定的离线预装字节；
- 首窗口后的同源网络更新检查。

离线预装字节必须走与在线安装相同的 validator 和 publication transaction，不获得
额外来源或权限。

### E.3 Third-party

首版第三方 transport 只接受固定 GitHub Pages + GitHub Releases policy。

添加流程只接收一个 Marketplace URL。Main 解析并验证：

- descriptor 是 HTTPS；
- Pages owner/repository 与声明一致；
- Registry、Showcase、Release URL 属于允许的 repository 形状；
- 每一跳 redirect 重新验证；
- 不允许 custom domain、任意 allowlist 或 renderer-supplied redirect；
- descriptor 只声明内容来源，不能声明 core、preinstall、native trust 或静默授权。

每个第三方 source 独立持有：

- cache；
- sequence high-water mark；
- failure state；
- refresh single-flight；
- size budget；
- SourceKey。

一个 source rollback、timeout 或 schema 错误只隔离该 source。

### E.4 Local

Local Marketplace 是 host-provisioned source collection，不是单例类型。

每个实例包含：

```ts
interface LocalMarketplaceIdentity {
  marketplaceId: string
  sourceInstanceId: string
  policyVersion: number
}
```

首版产品只声明：

```text
marketplaceId: convax-local
display label: 已导入
visibility: internal
```

约束：

- Main 使用 `Map<marketplaceId, LocalMarketplaceStore>`，不能提供
  `theLocalMarketplace` 一类单例 API。
- `sourceInstanceId` 由 Main 生成并持久化，不因重启或目录迁移改变。
- 两个 Local 即使 tree digest 相同也属于不同来源。
- Local root 丢失但仍有 InstallRecord/Transition 时进入 degraded，不生成新 instance。
- 一个 Local 损坏不影响另一个。
- 产品未声明但仍被安装状态引用的 Local 只读恢复，不自动删除。
- Renderer 永远不能选择 Local marketplaceId 或 native root。

## F. 导入协议

### F.1 严格识别

Main 对用户选择的目录执行 no-follow、realpath 和 bounded inventory，然后检查根标记：

```text
manifest.json -> Plugin
SKILL.md       -> Skill
server.json    -> MCP Server
```

必须恰好匹配一种。多种根标记不是“组合包”，而是错误。

### F.2 Snapshot

合法导入先复制成不可变 Local snapshot，再从 snapshot 安装：

```text
source directory
  -> validate identity and inventory
  -> copy into staging
  -> re-stat/re-hash source and staging
  -> atomically publish immutable snapshot
  -> run normal package installer
  -> commit Local index + InstallRecord through one CapabilityTransition
```

源目录不是后续更新来源。导入完成后修改原目录不会改变已安装内容。

安全要求：

- 拒绝 symlink 和特殊文件；
- 拒绝 traversal、case collision、Windows reserved name、alternate data stream、
  trailing dot/space；
- 限制单文件、文件数、总字节和目录深度；
- 两次验证防止 TOCTOU hybrid tree；
- exact duplicate 是 no-op，不增加 revision；
- 失败或取消不发布 Local index；
- 未被任何 record/transition/index 引用的 snapshot 才能 GC。

### F.3 Local MCP Server

Local MCP Server snapshot 只允许 inert metadata、README、LICENSE 和展示素材。

禁止：

- 把 executable 或 server script 放进 snapshot 后直接运行；
- 从 `server.json packages[]` 执行 npm/PyPI/NuGet/OCI/MCPB；
- 在导入时连接 HTTP MCP endpoint；
- 通过目录内容绕过显式设置。

如果需要本地 stdio，用户在“完成设置”阶段选择 executable。Main 解析 real path，
记录 size/SHA-256，并通过 verified launch snapshot 启动。之后任何路径或字节变化都
使 ExecutionGrant 失效。

## G. Registry 和 authoring wire

### G.1 Descriptor

`marketplace.json` 使用 `convax.marketplace/1`，只负责：

- marketplace id、name、publisher、repository；
- Registry v2 URL；
- Showcase v2 URL；
- compatibility 和 delivery policy。

第三方 descriptor 只声明 v2。Official descriptor 可以同时保留 v1 链接供旧客户端
使用，但新客户端直接选择 v2；选定 v2 后失败不能自动降级为 v1。

### G.2 Registry v2

`convax.registry/2` 原生支持：

```text
plugin
skill
mcp-server
```

顶层至少包含：

```text
schema
marketplaceId
sequence
revision
packages[]
```

每个 package entry 至少包含：

```text
kind
id
version
compatibility
presentation reference
delivery metadata
```

约束：

- `sequence` 单调递增，防 rollback；
- 同一 revision 内容必须 immutable；
- `SourceSecurityState` 跨 revision 约束同 `{kind,id,version}` 的
  metadata/artifact contract digest 不可变化；
- 每个 revision 对每个 `{kind,id}` 恰好广告零或一个 current version；
- duplicate `{kind,id}` 拒绝；
- 历史版本只存在于 InstallRecord 和 immutable artifact，不进入 Catalog；
- update 只比较 installed exact version 与 current entry，不定义 latest/range resolver；
- v1 schema 和 parser 保持 strict，不扩 enum；
- Official v1 projection 只包含能无损表达的 Plugin/Skill；
- MCP Server 不进入 v1 projection。

### G.3 Plugin/Skill source metadata

`convax.package/2` 只作为 Plugin/Skill authoring metadata：

- Plugin/Skill 可以由同一 builder 生成 v2；
- Official 可以继续从兼容 source 生成 v1；
- 作者不手写 wire Registry；
- Plugin-owned Skill owner linkage 继续由 Plugin package closure 表达。

### G.4 MCP Server source metadata

MCP Server 直接使用固定版本的官方 `server.json`。设计基线为：

```text
https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
```

开发前必须把经过审阅的 exact schema bytes 和 SHA-256 提交到
`@convax/marketplace`。运行时不能下载 schema。

身份：

```text
ref.id      == server.json.name
ref.version == server.json.version
```

官方 Registry 允许任意唯一 version string，只推荐 SemVer。Convax V1 不增加 range
resolver，因此：

- 接受符合官方 schema 的 version string；
- Registry current entry + sequence/revision 决定更新；
- exact version 用于安装和更新确认；
- 可解析为 SemVer 时只用于展示，不产生 range 依赖语义。

HTTP profile 还必须在严格校验后，从 `server.json.remotes[]` 中恰好得到一个
Convax V1 支持的 HTTPS entry：

- 零个时不进入普通 Catalog；
- 多于一个时整项拒绝，Host 不替作者猜 endpoint 或 transport；
- supported entry 必须是 fixed HTTPS URL，`variables`、URL template placeholder 和
  custom `headers` 都必须为空；
- 含动态输入的 entry 作为 unsupported metadata 保留，但不参与这个计数；
- Streamable HTTP 是作者默认选择，SSE 只作为单一 entry 的兼容类型；
- 安装与设置界面只展示并确认该 normalized endpoint 和认证摘要，不展示
  `remotes[]`、entry/transport selector、URL variable 或 Header/API Key 表单；
- 首版认证只允许标准 MCP OAuth discovery/flow；匿名 endpoint 无额外输入。

MCP initialize 返回的 `serverInfo.name/version` 只是 runtime observation，不改变安装
身份、来源或授权。namespaced server name 可能包含 `/`，native storage 必须使用：

```text
identityKey = hex(SHA-256(UTF8("mcp-server\0" + server.json.name)))
versionKey = hex(SHA-256(UTF8(
  "mcp-server-version\0" + server.json.name + "\0" + server.json.version
)))
```

不得直接把 raw name 或 raw version 拼进路径。`versionKey` 只作为同一
`identityKey` 下的 native storage key；安装身份和 UI 仍使用原始 version。

### G.5 Convax MCP extension

`convax-mcp.json` 使用严格、可选的 `convax.mcp-server-extension/1`。

它只允许用于 managed-stdio，并且是必需启动声明。首版一个 MCP Server package
只能选择一种 runtime profile；HTTP entry 所在 package 只要包含该文件就整项拒绝，
不能把它当展示补充，也不能静默忽略。

只允许表达：

- managed-stdio 的固定 bare command、常量 argv 和 compatibility；
- managed-stdio 的固定 Convax product action 与 MCP tool name 映射；
- managed-stdio 对应的 Host grants。

禁止表达：

- 重复 id/version；
- `server.json` digest；
- MCP input schema；
- arbitrary executable bytes；
- server script；
- literal credential/secret；
- Hook；
- owned Skill；
- arbitrary Web UI；
- 任意 host method name。

Builder 把完整 `server.json`、可选 extension 和各自 exact digest 写入 Registry v2。
作者不手工同步 digest。

HTTP MCP 首版只供 Agent，不接受 product action 或 Host grant。产品动作公式只适用于
Desktop-owned managed-stdio runtime。

第三方 managed-stdio companion 只允许一个 authoring 入口：

```text
bun marketplace add-target <mcp-directory> --target <platform-arch> --file <binary>
```

CLI 校验 MCP identity、target、regular-file/no-follow、command basename 和
compatibility，把 exact bytes 收入 scaffold-owned：

```text
.marketplace/companion-inputs/<host-generated-item-key>/<target>/<declared-command>
```

作者不直接编辑这个内部布局。`check` 将它视为 inert bytes，不执行 binary。Kit 从该
唯一输入生成独立 immutable Release asset 和 Registry target URL/size/SHA-256，并把
它排除在静态 MCP package ZIP 外。缺输入、target/command 不匹配或同 target 多输入都
使 check/release 失败；Registry、digest 或 Release metadata 没有第二个手写入口。

Agent 动态工具暴露：

```text
Agent tools = runtime tools/list ∩ Agent permission policy
```

Convax 产品动作暴露：

```text
Product tools =
  runtime tools/list
  ∩ extension declared tool names
  ∩ fixed Host action schema
  ∩ installed principal grants
```

动态 `tools/list` 永远不能扩大产品权限。

### G.6 Artifact

Plugin/Skill：

- 使用确定性 ZIP；
- Registry 固定 URL、size、SHA-256；
- Desktop 使用现有 safe-zip；
- package 内容永远作为 inert bytes 校验，不能运行 npm lifecycle。

HTTP MCP Server：

- Registry 直接嵌入标准 metadata；
- 不下载 metadata ZIP；
- 不允许 companion。

Managed stdio MCP Server：

- metadata 与 executable 分离；
- 当前 target 必须恰好匹配一个 companion；
- companion 由 URL、platform、arch、size、SHA-256 固定；
- Registry-managed companion 禁止 PATH fallback。

`server.json packages[]` 中的 npm/PyPI/NuGet/OCI/MCPB 首版不进入普通 Catalog。
开发诊断可以说明“不支持”，但普通用户不会看到不可安装条目。

## H. Product lock 和 bundle

### H.1 发布侧

`convax-plugins` 发布 immutable bundle，内部 `bundle.json` 至少列出：

```text
schema
release identity
members[]
member kind/id/version
member artifact size/SHA-256
presentation size/SHA-256
```

release identity 由发布工具生成。作者不分别维护 bundleVersion、sequence 和 digest。

Builtin bundle 的边界固定为：

- 发布仓和 `canvas-storyboard` 唯一源码 owner 都是 `convax-plugins`；
- 首版成员只有 `convax-builtin/skill/canvas-storyboard`；
- `ffmpeg-tools` 不在 Builtin bundle；
- Convax 不保留可独立修改、可能漂移的第二份 storyboard Skill 源码。

### H.2 消费侧

Convax 的 `marketplaces.lock.json` 是唯一产品权威文件，分为：

```text
policy    # 人工通过 CLI 声明
resolved  # lock 工具生成
```

`policy` 至少包含：

```text
policy revision
Builtin/Official source declarations
preinstalledPackages refs
target support
setup policy
```

`resolved` 至少固定：

```text
Builtin bundle URL/size/SHA-256
Official descriptor/Registry/Showcase immutable URL/size/SHA-256
Official Registry revision
preinstalled package refs and exact versions
package artifact URL/size/SHA-256
owned Skill closure
target companion URL/size/SHA-256
setup policy
```

`policy.preinstalledPackages` 是预装列表的唯一配置入口。只允许
`bun marketplace:configure` 显式修改 policy；`bun marketplace:lock` 按 policy
刷新 exact resolution，不能自行增加条目。打包只消费 lock，并 fail closed 校验
policy 与 resolved 的一一对应。更新 resolved 是显式发布动作。

### H.3 Early reservation

构建从已锁定 Builtin bundle 生成最小 early reservation table，编译进 App。

用途：

- bundle 尚未解析或已损坏时仍防止第三方抢占 Builtin identity；
- bundle 成功解析后做双向成员核对。

reservation 不是手工维护的第二份 product config，也不授予 native trust。

### H.4 Preinstalled

新配置名统一为 `preinstalledPackages`，不再使用 `corePackages`。

首版：

```text
ref: convax-official/plugin/ffmpeg-tools
targets: darwin-arm64
setup: automatic
```

预装先按普通安装事务发布静态 Plugin、owned Skill 和精确 companion，再通过独立、
可恢复的 setup transition 自动写入 ExecutionGrant；设置过程不启动本地组件。自动
设置只接受 product lock 精确固定的 managed Tool companion，拒绝 PATH fallback、
Hook、Service、额外 Plugin capability、credential/secret 输入以及
source/version/target 漂移。没有有效 ExecutionGrant 时仍不能启动本地组件。

用户卸载预装内容时写入 `ProvisioningDecision`：

```text
MarketplaceItemRef
SourceKey
policyEntryDigest = SHA-256(canonical({ SourceKey, ref, targets, setup }))
observed global policy revision
decision: removed-by-user
```

启动 provisioning 在安装前检查该记录。无关条目导致的 global policy revision 变化
不能清除决定；只比较稳定的 per-item `policyEntryDigest`。即使对应 entry 改变，也必须
通过显式用户动作清除/替换 decision，不能靠刷新 resolved 偷偷重装。

如果自动更新改变以下任一内容，旧版本继续可用，直到用户重新确认：

- authorization-bound manifest；
- endpoint/origin；
- grants；
- product action projection；
- executable source/path/size/SHA-256。

## I. InstalledCapability 与 MCP runtime

### I.1 统一 UI 状态

`InstalledCapability` 是 Plugin、Skill、MCP Server 共用的唯一 Renderer contract。
所有 manager 只映射到四种稳定 projection：

```text
setup-required
ready
disabled
attention
```

纯静态 Skill/Plugin 通常在 install 后直接映射为 `ready`。有本地组件的 Plugin 与
MCP Server 遵循相同 setup 规则。Marketplace health 单独投影，不进入扩展状态。

owner 内部可以维护瞬时状态：

```text
absent
  -> installing
  -> installed
  -> setup-required
  -> ready
  -> disabled
  -> attention
  -> removing
```

连接中、认证中、draining 和 update-pending 是短期 operation/badge，不是新的稳定
用户状态。

`RuntimePreference` 只用于有 runtime surface 的 Plugin/MCP Server，按
`{InstalledIdentity, SourceKey}` 持久化：

- 没有记录时，在 valid setup/authorization 后默认 enabled；
- 用户点“停用”提交 `desired: disabled`，所有新调用立即被 Main 拒绝，并
  drain/terminate 当前连接或进程；
- 用户点“启用”必须先重验当前 InstallRecord、ExecutionGrant 和 executable/endpoint
  contract，再提交 `desired: enabled`；前置条件失效时进入需要设置或需要处理；
- restart、source refresh 和同 SourceKey update 保留该记录，绝不隐式启用；
- uninstall 通过同一个 package mutation 删除记录；之后全新安装恢复默认；
- Skill 和没有 runtime surface 的静态 Plugin 不创建该记录。

稳定状态先尊重用户选择：preference disabled 时主状态始终为 `disabled`，缺 setup
或完整性/授权异常只显示次级提示“启用前需重新设置/处理”。其余状态再按缺 setup 为
`setup-required`、完整性或授权异常为 `attention`、否则为 `ready`。只要 preference
是 disabled，runtime gate 都必须拒绝启动和新调用。

### I.2 HTTP MCP

首版 HTTP MCP profile：

- HTTPS；
- `server.json remotes[]` 经校验后必须恰好有一个支持的 HTTPS entry；
- entry 必须是 fixed URL，不含 template variables 或 custom headers；
- Streamable HTTP 是推荐 entry，SSE 是兼容 entry；
- Host、Renderer 和用户都不在多个 entry/transport 中做选择；
- 用户只确认该唯一 normalized endpoint 和认证摘要；
- 首次连接即使匿名也必须 setup 并确认 endpoint；OAuth 只是可选子步骤；
- 只供 Agent 使用，不提供 Convax Canvas/Toolbar/Plugin 直调；
- OpenCode 是真实 MCP client 和 OAuth/token owner；
- InstallRecord/ExecutionGrant 不存 token；
- ExecutionGrant 绑定 normalized server definition、exact HTTP entry、
  endpoint origin 和认证 policy。

Marketplace artifact transport policy与 MCP endpoint outbound policy 分离。合法的
外部 SaaS endpoint 不要求与 Marketplace 同源，但仍执行 HTTPS、redirect、DNS/IP、
private/reserved/metadata address 和 rebinding 防护。

上述防护必须在 OpenCode/Agent Runtime 的真实 socket 边界强制执行。开发 gate 必须
证明 Host 能注入并约束 outbound policy；如果做不到，来自 Builtin、Official、
第三方和 Local 的所有 HTTP MCP execution 都不得启用。Marketplace kind 不能成为
例外，Desktop 预解析 URL/DNS 不能替代 socket-level enforcement。

install/update/uninstall 在 mutation lock 外请求 Agent hard configuration refresh：

- 已运行 prompt 使用原 generation 完成；
- 新 prompt 等待新 generation；
- session 不删除；
- refresh 期间不得让旧 connection 接受新的 prompt。

### I.3 Managed stdio

首版 stdio 只允许：

1. Registry target-specific managed companion；
2. Local import 后用户显式选择并绑定的 executable。

边界固定：

- Desktop 拥有 process、MCP client 和 lifecycle；
- Agent Runtime 只接收 Main-only authenticated loopback Streamable HTTP config；
- OpenCode 不接收 command、argv、cwd、environment 或 native path；
- extension 的 bare command 只允许 ASCII 字母、数字、点、下划线、短横线，不含路径
  分隔符、NUL 或 Windows reserved name；
- Registry target 的 declared command 必须与 extension exact match；
- Local executable basename 在 POSIX exact match，在 Windows ASCII
  case-insensitive match；extension 应声明目标平台实际 basename（含扩展名）；
- extension 只允许常量 argv，用户不能提供动态 argv；
- cwd 是 Host 私有空目录；
- environment 由 Host allowlist 生成；
- 首版禁止 Host 注入 secret、credential env 或任意 credential payload；需要此能力的
  managed-stdio server 判 unsupported，另行设计。

执行前 Main 必须：

- 重读当前 installed identity；
- 重验 server definition 和 extension；
- 解析 executable real path；
- 重验 size/SHA-256；
- 要求匹配 ExecutionGrant；
- 复制 exact bytes 到 private unique launch snapshot；
- 不经 shell、使用 allowlisted environment 启动；
- 拥有并可终止整个 process tree；
- 平台不能保证 process-tree ownership 时 fail closed。

### I.4 Setup 和更新

静态安装与完成设置是独立 transition：

```text
InstallRecord commit
  -> setup-required
  -> user reviews current summary
  -> ExecutionGrant commit
  -> runtime may connect/start
```

同一向导可以连续完成两步，但不能用一个不透明 flag 混成同一个授权。

更新时：

- 纯展示或不影响授权的变化可以保留当前 grant；
- server definition、endpoint、grants、product action 或 executable identity 变化时
  必须重新确认；
- 需要重新 setup 的版本只进入 bounded staging/cache candidate，不发布 package、
  InstallRecord 或 runtime registration；
- 用户确认后，独立 setup transition 写入绑定 candidate
  `authorizationContractDigest` 的 inert candidate ExecutionGrant；
- update transition 只有在 candidate grant 与 candidate bytes 都 exact match 时才切换
  package/InstallRecord；切换成功后该 grant 才成为 active；
- ExecutionGrant store 最多保留 current + 一个 candidate；取消、stale 或失败的
  candidate 可安全清理；
- 用户未确认或 update 未成功前，旧 snapshot/InstallRecord/ExecutionGrant 是唯一
  current runtime；
- 切换后 drain/cancel 旧 runtime；
- 运行中的 operation pin exact version、definition digest、grant 和 principal，
  不能被更新重绑。

### I.5 Uninstall

卸载顺序：

```text
stop accepting new operations
  -> drain/cancel runtime
  -> commit removal decision
  -> remove installed metadata/static package
  -> remove InstallRecord and ExecutionGrant
  -> converge companion and cache orphans
```

HTTP MCP uninstall 只删除 Convax registration 和本地 credential，不暗示删除第三方
SaaS 服务或账号。

## J. 持久化

建议布局：

```text
Electron userData/
  marketplace-sources/
    index-v1.json

  marketplace-source-security/
    <source-key>.json

  marketplace-cache/
    <source-key>/

  marketplace-installations/
    index-v1.json

  marketplace-provisioning-decisions/
    index-v1.json

  marketplace-runtime-preferences/
    index-v1.json

  marketplace-transitions/
    <transition-id>.json

  marketplaces/
    local-v1/
      sources/
        <source-instance-id>/
          marketplace.json
          index-v1.json
          packages/
            plugin/<identity>/<local-revision>/
            skill/<identity>/<local-revision>/
            mcp-server/<identity-key>/<local-revision>/
          staging/

  mcp-servers/
    <identity-key>/

  mcp-server-companions/
    <identity-key>/<version-key>/

  mcp-server-execution-grants/
    <identity-key>/
```

说明：

- 用户添加的 Network source 才写 `marketplace-sources/index-v1.json`。
- Builtin、Official 和 Local 由产品/Host 声明，不写入用户可配置来源列表。
- Local storage key 使用随机、校验过的 `sourceInstanceId`，不使用 Marketplace id
  或 MCP raw name 作为 native path。
- `marketplace-source-security/<source-key>.json` 在同一个 canonical record 中保存
  `SourceSecurityState` 与 accepted Catalog sequence/revision/digest；cache 不拥有
  accepted decision。
- cache 可随时丢失；InstallRecord、ExecutionGrant、OwnerBinding、
  ProvisioningDecision、RuntimePreference、SourceSecurityState 和 Transition 才是
  权威状态。
- source removal 不删除其 SourceSecurityState；exact SourceKey re-add 必须继续使用
  旧 sequence/version high-water。
- Plugin、Skill 和现有 authorization 的物理 store 可以保持现状；统一 coordinator
  通过 typed adapter 组合，不要求首版做无价值的大规模目录重命名。

所有权威文件写入继续要求：

- private permissions；
- no-follow open；
- root identity；
- write + fsync + atomic rename + directory fsync；
- revision/CAS；
- schema strict；
- corruption fail closed。

## K. CapabilityTransition

### K.1 每个领域动作一个 transition

每个 `install`、`setup`、`update`、`uninstall` 都各自使用四个阶段：

```text
prepare
  -> publish
  -> decide
  -> converge
```

- `prepare`：下载/复制、校验、生成 rollback information，不暴露新状态。
- `publish`：发布 candidate bytes 和 participant checkpoints。
- `decide`：调用下表唯一 decision owner；envelope 不一定自己写 decision。
- `converge`：根据 decision 收敛所有 participant，清理是 best effort。

Plugin package、standalone Skill、Plugin-owned Skill、Local snapshot、MCP metadata、
InstallRecord 和 companion publication 可以是 install participant。ExecutionGrant
只能是 setup participant，不能被并入 install。

`CapabilityTransition` 是编排 envelope：它携带并组合现有 Plugin package、managed
Skill、OwnerBinding、authorization store 的 recovery checkpoint，并把同一个
previous/next outcome 传播给它们；它不能在 owner 已有 durable decision 之外再写一个
相互竞争的 forward decision。

decision owner 固定为：

| Mutation                                                   | Durable decision owner                                            | Marketplace envelope                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Plugin install/update/uninstall（含 Local 和 owned Skill） | 现有 Plugin package + PluginSkill lifecycle 的 canonical decision | 只保存 Local/InstallRecord dependent checkpoints并跟随 outcome |
| Standalone Skill install/update/uninstall                  | 现有 managed-Skill transaction                                    | 只保存 Local/InstallRecord dependent checkpoints并跟随 outcome |
| MCP metadata install/update/uninstall                      | MCP Marketplace manager 的 CapabilityTransition                   | 自己拥有 decision                                              |
| MCP/Plugin Tool/Hook setup                                 | 对应 ExecutionGrant/authorization store                           | 只编排，不另写竞争 decision                                    |
| Plugin/MCP runtime enable/disable                          | RuntimePreference store                                           | 只改变 runtime gate，不参与 package decision                   |
| Network source add/remove/refresh                          | Marketplace source store                                          | 自己拥有 source decision                                       |
| ProvisioningDecision mutation                              | Provisioning store                                                | 不参与 package decision                                        |

对 Plugin/Skill，Marketplace transition 是逻辑 envelope，不是第二个 canonical package
transaction。

Network refresh 的 source decision 必须是 C.2 定义的 combined
`SourceSecurityState` + accepted Catalog identity commit；不能分别发布高水位和可见
Catalog。add/remove 的来源列表 decision 不删除该 SourceKey 的 canonical 安全状态。

### K.2 Coordinator

所有 manager 使用：

```ts
CapabilityMutationCoordinator.withMutation(
  {
    identity,
    affectedSkillNames,
    localSource,
    mutation: "install" | "setup" | "update" | "uninstall" | "enable" | "disable",
  },
  async (context) => {
    // participant operations
  },
)
```

内部固定锁序：

```text
installed identity
  -> affected managed Skill names（稳定排序）
  -> existing managed-Skill/OwnerBinding coordinator
  -> target Local writer（仅 Local 操作）
  -> InstallationStore writer
```

约束：

- 不跨网络下载持锁；
- 不跨用户确认持锁；
- 不等待 Agent hard refresh 时持 Plugin/MCP mutation lock；
- 同 identity 严格串行；
- 只有 identity、Skill names 和其他 participant namespace 都不相交时才可并发；
- global InstallationStore 使用 revision/CAS，避免 last-writer-wins；
- 单次 Local transaction 只能涉及一个 Local source。

### K.3 Recovery

启动恢复先决定 canonical package/metadata，再恢复依赖状态：

```text
package or MCP metadata bytes
  -> InstallRecord/source binding
  -> OwnerBinding
  -> companion exact bytes
  -> ExecutionGrant
  -> runtime registration
  -> Agent discovery / product actions
```

如果 package rollback rename 失败：

- 不猜测依赖状态；
- 保留 Transition 和 participant checkpoint；
- 释放 process-local locks；
- 返回 recovery-required；
- 由下一次 clean startup 选择 canonical state。

存在 pending transition 的 identity 在收敛前不能进入：

- Renderer inventory；
- Agent Skill discovery；
- MCP registration；
- Tool/service registration；
- background update。

不相关 identity 和其他 Marketplace 继续工作。

active source 不是 runtime participant。Marketplace 被移除或离线后，runtime 继续
依据 immutable installed bytes + InstallRecord + ExecutionGrant 校验；只禁用
list/install/update。重新添加 exact SourceKey 后才恢复更新。

## L. 失败和取消

| 场景                           | 行为                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| Source list 失败               | 只标记该 Marketplace                                                                     |
| Source cache 损坏              | 拒绝从 cache 安装，保留已安装内容                                                        |
| Catalog rollback               | 拒绝新 catalog，保留 last-known-good                                                     |
| same version changed bytes     | 拒绝新 catalog，保留 SourceSecurityState                                                 |
| SourceSecurityState 达到硬上限 | 拒绝新 catalog，不裁剪历史，保留 last-known-good                                         |
| 下载失败                       | 保留当前安装版本                                                                         |
| Builtin bundle 损坏            | 不发布 bundle 内容，保留 early reservation                                               |
| Official preinstall 字节损坏   | 不安装，不 fallback 到 PATH/其他来源                                                     |
| 导入目录选择取消               | 不改变 Local index 或安装状态                                                            |
| 导入复制/校验失败              | 不发布 snapshot/index                                                                    |
| exact duplicate import         | no-op，不增加 revision                                                                   |
| 授权取消                       | 保留静态安装，状态为需要设置                                                             |
| 连接失败                       | 不卸载，状态为需要处理                                                                   |
| InstallRecord 缺失             | 静态 Plugin/Skill 可保留为 legacy-unbound；MCP、Hook、Tool executable 和产品动作全部停用 |
| managed Skill 漂移             | 保留用户字节，阻止覆盖                                                                   |
| Marketplace 被移除             | 已安装内容保留，更新不可用                                                               |
| 已停用后重启或更新             | 保留 RuntimePreference，不启动、不接受新调用                                             |
| runtime update 未确认          | candidate 保持非权威，继续使用旧 current                                                 |
| app crash                      | 根据该 mutation 的唯一 owner decision 收敛 previous/next                                 |

取消必须跨越：

- download；
- Local staging；
- package preparation；
- runtime queue；
- process start；
- OAuth handoff；
- 最终 durable checkpoint。

已经完成的 durable package install 不因后续 setup 取消而回滚；用户会看到“需要设置”。
已经发起的外部 billable operation 遵循对应 Tool 的现有 at-most-once/LRO 契约，不能因
Marketplace UI 关闭而擅自重试。

## M. 安全边界

### M.1 Source 和 transport

- 所有 Network Marketplace fetch 在 Main。
- 专用 add-source 请求可以携带用户粘贴的 descriptor URL；其他 Renderer 请求只包含
  Marketplace id、item ref 或 opaque token。
- 每个 source 独立执行 origin、repository、redirect、sequence 和 byte budget。
- URL parser 后继续检查 scheme、host、port、credentials、path 和 fragment。
- DNS/IP 检查覆盖 IPv4、IPv6、mapped IPv6、private、loopback、link-local、
  multicast、metadata ranges 和混合 A/AAAA。
- redirect 每一跳重新验证。
- 不能用一个预解析 IP 结果代替真实 socket 绑定；任意 host delivery 延后到 transport
  spike 证明通过。
- Artifact cache 命中仍重验 size/SHA-256。

### M.2 Archive 和 filesystem

- 继续使用 Convax `safe-zip`。
- 拒绝 traversal、absolute path、symlink、hardlink、device、overlap、
  local/central-header mismatch、CRC mismatch、zip bomb 和 case collision。
- Local 使用两阶段 inventory/copy/recheck。
- 权威 store 继续执行 no-follow、realpath containment、private permission、fsync 和
  directory fsync。
- Windows drive/UNC、reserved device、ADS、trailing dot/space 和 case folding 必测。

### M.3 Plugin 和 Skill

- 现有 Web Plugin sandbox、Hook authorization、Tool executable binding、
  Plugin-owned Skill publication 和 Canvas broker 不变。
- 新的手动 Tool/Hook Plugin 流程在同一向导先完成静态 install，再执行独立 setup
  mutation；setup 取消保留静态 package，但 Hook/Tool 保持 inert。
- update 改变 Hook/Tool authorization contract 时使用与 MCP 相同的 non-authoritative
  candidate 规则，不能先替换 current package。
- Marketplace membership 不允许绕过任何 Plugin manifest 校验。
- Builtin membership 不等于 trusted native adapter。
- Hook 不能由 preinstall/background flow 静默授权。
- Skill 内容在安装、预览、Catalog refresh 时保持 inert。

### M.4 MCP

- 添加 Marketplace、安装 metadata、预加载 companion 都不能启动或连接。
- HTTP MCP endpoint 和 OAuth policy 必须显式完成设置。
- HTTP MCP 只供 Agent，OpenCode 是 client/OAuth owner；Convax 不代理 tool call。
- managed stdio 由 Desktop 托管，Agent 只接收 authenticated loopback config。
- OAuth token 不进入 Renderer、Registry、InstallRecord 或日志。
- Local executable 必须在设置阶段由用户选择，绑定 real path/size/SHA-256。
- Registry managed companion 必须匹配 exact target，禁止 PATH fallback。
- executable 通过 private launch snapshot、不经 shell、allowlisted environment 启动。
- runtime 变更立即使不匹配的 ExecutionGrant 失效。
- Product actions 只来自 managed stdio，使用固定 Host action schema，不能接受任意
  MCP method 字符串。
- resources/prompts 首版不暴露。
- raw MCP diagnostics、native path、command、header 和 credential 不过 preload。

## N. 旧数据迁移

### N.1 现有安装

迁移不猜来源：

- 能从现有 immutable built-in provenance 或 official installation metadata 精确证明
  来源时，生成对应 InstallRecord。
- 无法精确证明来源时标记 `legacy-unbound`。
- `legacy-unbound` 静态 Plugin/Skill 继续可用但不自动更新；MCP、Hook、本地 Tool 和
  产品动作保持停用，直到 exact source/grant 被显式恢复。
- 现有 exact Tool/Hook executable authorization 只有在 manifest、real path、size 和
  SHA-256 全部不变时，才能机械迁移为 ExecutionGrant；否则进入需要设置，不重复沿用
  旧同意。
- 用户完整卸载后可从任意 Marketplace 全新安装。

### N.2 原本地导入

旧 direct-import 内容继续可用并标记 `legacy-unbound`。

用户再次使用“导入…”时：

- exact installed tree 匹配时，可在一个显式 transition 中绑定默认 Local；
- 内容不同则走正常同 identity update；
- modified managed Skill 不被覆盖；
- 不允许后台扫描或启动时自动认领。

### N.3 canvas-storyboard

- Catalog 来源改为 `convax-builtin`。
- 已安装且 exact tree 匹配时迁移为 Builtin InstallRecord。
- 用户修改过的同名 Skill保持原样并 fail closed，不覆盖、不删除。
- 保持 standalone ownership 和现有展示素材。

### N.4 ffmpeg-tools

- v1/v2 都保持 Plugin kind、id、version 和 artifact identity。
- Product lock 只改变获取与预装方式，不改变运行语义。
- 现有用户安装尊重原卸载/default state。
- 不做 Plugin -> MCP Server kind migration。

### N.5 default-capabilities

`default-capabilities.json` 只作为一次性迁移输入：

- 保留用户主动卸载决定；
- 转换为新的 ProvisioningDecision；
- 新流程不再写入新的“default”概念。
