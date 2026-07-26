# Convax 插件体系分析（LikeC4）

分析快照：2026-07-25

代码基线：`ee06fc27f0`

官方 Registry：`convax.registry/1`，sequence `32`，revision
`c6c1ec55e7ff7f1ff8ef7976f116b7470c765fe3`

配套 LikeC4 模型见 [`diagrams/plugin-system.c4`](diagrams/plugin-system.c4)。模型按
[LikeC4 Tutorial](https://likec4.dev/tutorial/) 的方式组织：先定义元素类型，再建立层级与关系，最后从同一模型投影静态视图、部署视图和动态流程视图。

## 1. 结论

Convax 当前的“插件”并不是一个 Web 扩展机制，而是一个**由声明式 Manifest 驱动、由
Desktop Main 统一授权和编排的多运行平面能力平台**：

- `manifest.json` 是路由、贡献和权限的声明源；
- Desktop Main 是安装、更新、恢复、权限与运行时组合的唯一策略所有者；
- Web、Tool、Skill、Hook、LLM、remote MCP、Service、Pet 是不同信任等级的贡献平面；
- Canvas、Project 和 Agent 的领域语义仍由各自既有服务拥有，插件只通过窄适配器调用；
- 具体插件源码属于 `microvoid/convax-plugins`，本仓库只拥有宿主平台。

整体方向是健康的：它成功避免了“每种集成都在 Desktop 里加一个 provider 分支”，也没有让
iframe、Skill 或 Agent 绕过 Canvas 的单写者和 Project 的路径边界。当前主要问题不在抽象方向，
而在于：

1. Tool sidecar 和 Hook 具有用户进程级执行权，但供应链目前依赖固定 HTTPS 源、Registry
   序列和 Registry 内 SHA-256，尚没有独立的签名信任根；
2. Desktop Main 内的生命周期与兼容逻辑高度集中，理解和修改半径较大；
3. 宿主已经实现 v6、Hook、Project/Canvas broker 等高级能力，但当前官方目录尚未实际采用其中
   多数能力；
4. 当前带 companion 的官方插件都只有 `darwin/arm64` 构建，宿主的跨平台设计尚未转化为目录的
   跨平台可用性；
5. v1 内置包和 JianYing 的 id-gated 原生路径仍是明确的历史债务。

## 2. LikeC4 视图

| View                        | 回答的问题                                                           |
| --------------------------- | -------------------------------------------------------------------- |
| `index`                     | 用中文概览用户、宿主、运行时贡献、能力目录和外部服务。               |
| `plugin_context`            | Convax、插件作者、Registry、Release、外部服务之间的系统边界是什么？  |
| `plugin_platform`           | Renderer、Preload、Main、Canvas、Project、Agent 如何组合？           |
| `contribution_planes`       | Web、Tool、Skill、Hook、Pet 等贡献各自接到哪个宿主适配器？           |
| `capability_authority`      | Web 与 Tool 如何汇合到同一个 principal-bound Canvas broker？         |
| `process_trust_boundaries`  | 哪些代码在 iframe、Renderer、Main、sidecar、OpenCode、互联网中运行？ |
| `install_update_flow`       | 安装/更新如何协调包、Skill、companion、授权收据和恢复日志？          |
| `web_canvas_call`           | 沙箱 Web 插件如何完成一次 Canvas 读写？                              |
| `generation_execution_flow` | UI/Agent/Web 如何复用同一 Tool 执行与资源入库链路？                  |
| `agent_extension_flow`      | Skill、Hook、LLM gateway、remote MCP 为什么是四条不同的信任路径？    |

本地预览：

```bash
npx likec4 serve docs/diagrams
```

校验：

```bash
npx likec4 validate docs/diagrams
```

## 3. 体系分层

### 3.1 发布与安装平面

```text
convax-plugins
  -> Official Registry（元数据、兼容性、sequence、artifact identity）
  -> GitHub Releases（Plugin/Skill ZIP、target companion）
  -> Registry client（固定源、缓存、大小、SHA-256、safe ZIP）
  -> RemoteCapabilityInstaller（跨生命周期协调）
  -> WebPluginManager（按 Plugin id 串行、原子 rename、回滚/恢复）
  -> Electron userData（包、companion、授权、Skill 绑定）
```

关键点：

- Renderer 只提交 catalog id，不提交 URL、路径或 digest。
- Registry 缓存是非权威缓存；安装使用 network-first 视图。
- 包切换与 owned Skill、Tool/Hook authorization、managed companion、Pet provider transition
  组成同一个 publication decision。
- 如果包 rename 无法完整回滚，依赖状态不会被“猜测性回滚”，而是保留 journal 并要求启动恢复。
- 同一 Plugin id 的安装、更新、built-in claim 和卸载被完整串行化。

这是一套偏“数据库事务/日志恢复”风格的插件发布模型，而不是常见的“解压后立即可用”模型。
它的复杂度较高，但和 companion、Hook、owned Skill 的原子一致性要求是匹配的。

### 3.2 运行贡献平面

| 贡献                              | 声明                                            | 实际执行位置                         | 权限来源                                          | 主要隔离                                        |
| --------------------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------------- | ----------------------------------------------- |
| Canvas Web surface                | `entry` + `contributes.canvas.renderer`         | `sandbox="allow-scripts"` iframe     | Manifest capability + 绑定的 frame/node/principal | 无 same-origin、Node、Electron、native path     |
| Canvas toolbar / selection action | `contributes.canvas.*`                          | Host UI + Main executor              | 已验证贡献和当前选择/修订                         | Plugin 不能注册任意 host function               |
| Tool / generation                 | `runtime: mcp-stdio` + `contributes.generation` | 独立 companion 进程                  | 安装时 executable receipt                         | 无 shell、精确 snapshot、有限环境、暂存输入输出 |
| Service                           | `contributes.service`                           | 复用同一 Tool sidecar                | 固定 `service.*` 动作白名单                       | Renderer 只拿有界展示投影                       |
| LLM provider                      | `contributes.llm`                               | sidecar + Main-only loopback gateway | 已授权 companion                                  | URL/key 只进 OpenCode 内存配置                  |
| Plugin-owned Skill                | `contributes.skills`（v4+）                     | OpenCode Skill discovery             | Skill 自身无权限                                  | 与 Plugin 原子发布，但运行时保持普通 Skill      |
| OpenCode Hook                     | 顶层 `hooks`                                    | OpenCode 原生 Plugin 运行时          | 显式安装/更新 + 精确字节授权                      | 私有不可变 snapshot；限制 ESM/import            |
| Agent remote MCP                  | `contributes.agent.mcp`（v6）                   | OpenCode 原生 MCP client             | 已安装 manifest + OpenCode OAuth                  | HTTPS only；Renderer 不见 URL/header/token      |
| Pet provider                      | `contributes.pet`（v5）                         | 沙箱 overlay/settings                | 独立 Pet capabilities                             | 固定 `convax.pet-host/1`，窄原生能力            |

这里最重要的设计判断是：**一个 Plugin 可以声明多种贡献，但贡献之间不继承权限。** 例如：

- owned Skill 不会因为归属于某个 Plugin 就获得 Plugin capability；
- Web surface 的存在不会自动产生 Project-wide Canvas authority；
- Hook 不会因为静态 Web 包可展示就自动被执行；
- remote MCP 的 OAuth 状态归 OpenCode，不归 Manifest 或 Renderer；
- Service 不会让 Renderer 选择任意 MCP tool。

### 3.3 领域能力平面

插件写 Canvas 的路径最终都收敛到：

```text
Plugin transport
  -> principal/scope/capability validation
  -> CanvasApplicationService / CanvasResourceBusinessService
  -> CanvasDocumentRepository
  -> @convax/project/node persistence
  -> revision invalidation
```

这保证了 UI、Agent 和 Plugin 使用相同的业务规则：

- 文档事务要求 `expectedRevision`，非空、命令数受限，并以一次 CAS 持久化；
- Plugin document transaction 明确排除资源 admission/replacement；
- 资源必须走 Project 管理的 `.convax/assets` 入库、检查和失败回滚；
- Renderer 只是 optimistic projection，不是 Main commit 的前置条件；
- 可选 reveal/refresh 失败不能把已经成功的领域写入报告成失败。

### 3.4 Agent 扩展平面

Agent 侧存在四种容易混淆但本质不同的机制：

1. **Skill**：可信工作流说明，选择和编排 typed tools，不是代码权限。
2. **Hook**：OpenCode 原生可执行模块，必须进行精确字节授权。
3. **LLM gateway**：已验证 sidecar 提供的 Main-only 临时 loopback provider。
4. **remote MCP**：OpenCode 自己实现协议与 OAuth，Convax 只注入已验证配置。

`@convax/agent-runtime` 对 Plugin id、owned Skill 绑定和 Desktop 策略保持无感，只消费通用 Skill
目录、Hook file URL、provider config 和 MCP config。这一点很好地维护了 package dependency
方向。

## 4. ABI 演进

| Manifest          | 主要增量                                                                             | 兼容协议                     |
| ----------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| `convax.plugin/1` | 静态 Web Canvas surface、legacy 独立 Skill                                           | `convax.plugin-host/1`       |
| `convax.plugin/2` | `mcp-stdio` executable / generation runtime                                          | `convax.plugin-host/2`       |
| `convax.plugin/3` | declarative models、Agent operation、host-rendered Canvas actions                    | `convax.plugin-host/3`       |
| `convax.plugin/4` | Plugin-owned Skills 原子生命周期                                                     | `convax.plugin-host/4`       |
| `convax.plugin/5` | transport-neutral `convax.plugin-capability/1`、Project/Canvas grants、LLM、Pet      | `convax.plugin-capability/1` |
| `convax.plugin/6` | remote Agent MCP、connected-input metadata、return delivery、direct-incoming binding | `convax.plugin-capability/1` |

v5 是正确的架构转折点：Manifest 版本不再强制产生新的 Web host protocol，而是让不同 transport
适配到同一个 capability protocol。后续版本应继续保持这个方向，把新能力表现为可组合 contribution
和 grant，而不是增加 `plugin-host/N`。

当前代码仍大量使用 `WebPlugin*` 类型名，这是从 Web-only 阶段留下的命名债务。`plugin-api.ts`
已经提供了 `PluginManifest`、`InstalledPlugin` 等传输中立别名，新代码应只依赖这些别名；旧名可在
一次独立的兼容清理中逐步退场。

## 5. 当前官方目录的实际采用情况

从当前固定 Registry 读取到：

- 8 个 active Plugin，12 个 active standalone Skill；
- Plugin schema 分布：
  - v1：2
  - v3：3
  - v4：1
  - v5：2
  - v2 / v6：0
- contribution 使用：
  - Canvas：5
  - generation：3
  - service：2
  - Agent tools：1
  - owned Skills：1
  - LLM：1
  - Pet：1
- 当前没有官方 Plugin 使用：
  - v5 Project/Canvas capability grants；
  - v6 remote Agent MCP；
  - Hook；
  - v6 `return` delivery / `direct-incoming` binding / connected-input metadata。
- `codex-service`、`ffmpeg-tools`、`xiaoyunque-generation` 三个 companion Plugin 的当前 target
  都只有 `darwin/arm64`。

这说明宿主平台的能力面已经明显领先于官方目录的采用面。高级路径虽然有单元测试，但还缺少
Registry 级真实包、发布流水线和多版本升级的端到端证明。

仓库内还有两个 legacy/bootstrap v1 包：

- `jianying-editor`
- `storyai-3d-director-desk`

其中 JianYing 通过 host-authored provenance 和精确 bundle 身份启用 id-gated 原生适配器。
架构文档已明确把它标记为历史债务，而不是新插件的实现范式。

## 6. 设计优势

### 6.1 Manifest 驱动而非 Plugin-id 驱动

运行行为来自经过验证的 contribution、capability 和 executable binding。除明确隔离的 legacy
JianYing 路径外，核心执行不需要知道具体厂商或 Plugin id，因此没有形成第二套 provider registry。

### 6.2 安装授权绑定精确执行身份

Tool Plugin 的授权不是“这个 id 永久可信”，而是绑定：

- normalized manifest fingerprint；
- binding kind；
- real path；
- size；
- SHA-256；
- managed Bun/native 模式。

每次执行还会重新 fingerprint，并从精确 snapshot 启动，显著降低 PATH executable 被普通替换后
继续执行的风险。

### 6.3 Web transport 不是授权根

MessagePort 只证明请求来自某个已绑定 frame。真正的 authority 是 Main 创建的
`PluginPrincipal + PluginProjectScope`，每次调用都重新检查 manifest digest、grant、Project binding
和 Canvas catalog membership。

### 6.4 领域单写者没有被插件体系破坏

Canvas Main application service 仍是唯一 authoritative document state 和持久化写者。Plugin 不能通过
IPC、iframe state、Skill 或 sidecar 直接编辑 `.convax` JSON。

### 6.5 Crash recovery 被当作正常状态机

package staging、replacement backup、uninstall tombstone、owned-Skill journal、authorization receipt 和
companion orphan 都有显式恢复顺序。系统在不确定时 fail closed，而不是选择一个“看起来最新”的目录。

## 7. 风险与架构债务

| 优先级 | 风险 / 债务                                 | 影响                                                                                                                        | 建议                                                                                                                     |
| ------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 高     | Registry 和 artifact 没有独立数字签名信任根 | Registry/Release 发布面一旦同时被控制，Registry 内 SHA-256 只能保证一致性，不能证明发布者身份；sidecar 仍以用户 OS 权限运行 | 为 Registry 元数据和 companion 增加离线根或受保护发布密钥签名；考虑 TUF/Sigstore 风格的过期、轮换和回滚策略              |
| 高     | Tool sidecar / Hook 不是 OS sandbox         | 恶意或被接管的已授权执行代码拥有用户进程权限                                                                                | 优先对 sidecar 做平台 sandbox/profile、最小目录/网络权限和进程级隔离；Hook 继续保持最小 ABI，并考虑独立 worker/process   |
| 高     | 官方 companion 只有 `darwin/arm64`          | Linux、Windows、macOS x64 用户会在安装时 fail closed，跨平台承诺没有产品化                                                  | 在 `convax-plugins` 建立 target matrix、每 target 摘要验证和安装 smoke；目录 UI 提前显示不可用原因                       |
| 中高   | “Plugin”一词覆盖多种风险等级                | 用户可能无法区分静态 iframe、OS-authority sidecar、native Hook 和 remote OAuth MCP                                          | Capability Center 应由 Manifest 自动生成贡献/权限/执行位置/网络/凭据/更新再授权清单                                      |
| 中     | Desktop Main 实现集中                       | 9 个核心文件约 6,775 行；Plugin 相关代码分布在约 144 个 TS/TSX 文件，变更影响面大                                           | 保持 package owner 不变，但在 Desktop 内形成显式 publication、runtime、capability 三个内部 facade 和 conformance harness |
| 中     | v1-v4 兼容面长期存在                        | `WebPlugin*`、四代 host protocol 和 v5 capability protocol 并存，增加每次 ABI 变更的测试矩阵                                | 冻结 v1-v4；安装时规范化成内部 v5-style contribution/principal model；新 schema 不再增加 Web protocol                    |
| 中     | 高级宿主能力缺少真实目录采用                | v6、Hook、Project/Canvas broker 的集成错误可能只在真实包升级/授权时出现                                                     | 发布无厂商语义的 conformance Plugin，覆盖 Web/Tool/builtin 三 transport、更新、取消、恢复、OAuth 状态和跨 Project scope  |
| 中     | legacy built-in 与源码仓分离目标不完全一致  | 两个具体包仍在 Desktop resources；JianYing 仍由 id 控制原生路径                                                             | 将 bootstrap bytes 改为可机械验证产物；把 JianYing 迁移到 verified companion + generic operation contract                |

“无独立数字签名”不是说当前 SHA-256 校验无效。它很好地防止传输损坏、缓存污染和 artifact 与
Registry 声明不一致；剩余问题是**Registry 声明本身的发布者真实性**。

“Desktop Main 集中”也不意味着应立刻增加一个新的公开 package。按当前 ownership contract，
Plugin lifecycle 本来就属于 Desktop。更合适的第一步是 Desktop 内部模块化和接口化，并用 LikeC4
模型测试约束依赖方向；只有出现可独立发布、可由其他 host 消费的稳定 invariant 时，再讨论新 package。

## 8. 推荐演进顺序

### 第一阶段：把信任模型变成产品和发布约束

1. Capability Center 展示 contribution-level 风险，而不只展示 Plugin 名称和 capability 字符串。
2. 给 Registry/companion 建立签名元数据和密钥轮换方案。
3. 对 companion 建立 `darwin-arm64`、`darwin-x64`、`linux-x64/arm64`、`win32-x64/arm64`
   的显式支持矩阵；不支持的 target 在下载前可见。

### 第二阶段：让高级 ABI 经历真实发布

1. 在 `convax-plugins` 发布一个无厂商逻辑的 v6 conformance Plugin。
2. 覆盖 Web frame、Tool reverse-MCP、remote MCP、Hook、owned Skill 的安装、升级、卸载和 crash
   recovery。
3. 把 conformance 包接入 Registry CI，而不只依赖本仓库 synthetic fixture。

### 第三阶段：收敛兼容和实现复杂度

1. 安装后将 v1-v4 manifest 规范化为统一内部 contribution model。
2. 新代码只使用 `Plugin*` 中立类型名。
3. 把 package publication、execution authorization、runtime activation 的状态机边界固化为内部
   facade，并给 LikeC4 模型增加自动规则：
   - Renderer 不得直连 Project/Canvas persistence；
   - Web/Tool transport 必须经 capability broker；
   - executable runtime 必须依赖 authorization；
   - Canvas mutation 必须经 Canvas application/business service。

### 第四阶段：清理 legacy

1. 将 Desktop resources 中的 concrete Plugin 改为来自 `convax-plugins` 的机械生成、摘要固定的
   bootstrap artifact。
2. 把 JianYing 原生行为迁移到通用 verified companion operation；移除运行时 Plugin-id 分支。
3. 迁移 v1-v3 顶层 legacy `skill` 到 v4+ owned Skill，保留严格的 exact-tree ownership transfer。

## 9. 代码依据

- Manifest/贡献/版本：
  [`packages/desktop/src/plugin-contracts.ts`](../packages/desktop/src/plugin-contracts.ts)
- 传输中立别名：
  [`packages/desktop/src/plugin-api.ts`](../packages/desktop/src/plugin-api.ts)
- Web host 与 capability protocol：
  [`packages/desktop/src/plugin-host-protocol.ts`](../packages/desktop/src/plugin-host-protocol.ts)
- Principal-bound Project/Canvas contract：
  [`packages/desktop/src/plugin-capability-contracts.ts`](../packages/desktop/src/plugin-capability-contracts.ts)
- 包发布、序列化和启动恢复：
  [`packages/desktop/src/main/plugin-manager.ts`](../packages/desktop/src/main/plugin-manager.ts)
- Registry 与 artifact 验证：
  [`packages/desktop/src/main/remote-capability-registry.ts`](../packages/desktop/src/main/remote-capability-registry.ts)
- 远程安装事务协调：
  [`packages/desktop/src/main/remote-capability-installer.ts`](../packages/desktop/src/main/remote-capability-installer.ts)
- Tool runtime 与 MCP stdio：
  [`packages/desktop/src/main/generation-plugin-runtime.ts`](../packages/desktop/src/main/generation-plugin-runtime.ts)
- owned Skill 生命周期：
  [`packages/desktop/src/main/plugin-skill-lifecycle.ts`](../packages/desktop/src/main/plugin-skill-lifecycle.ts)
- Canvas capability broker：
  [`packages/desktop/src/main/plugin-canvas-capability-service.ts`](../packages/desktop/src/main/plugin-canvas-capability-service.ts)
- iframe sandbox 与 MessageChannel：
  [`packages/desktop/src/renderer/web-plugin-node-renderer.tsx`](../packages/desktop/src/renderer/web-plugin-node-renderer.tsx)
- Electron Main 组合根：
  [`packages/desktop/src/main/index.ts`](../packages/desktop/src/main/index.ts)

外部数据源：

- [LikeC4 Tutorial](https://likec4.dev/tutorial/)
- [LikeC4 Dynamic views](https://likec4.dev/dsl/views/dynamic/)
- [LikeC4 Deployment model](https://likec4.dev/dsl/deployment/model/)
- [LikeC4 CLI / validate](https://likec4.dev/tooling/cli/)
- [Convax official capability Registry](https://microvoid.github.io/convax-plugins/registry/v1/index.json)
