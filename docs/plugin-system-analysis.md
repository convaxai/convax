# Convax v8 插件体系分析

本文只描述当前破坏性切换后的 v8 架构，不是历史兼容说明。规范性边界以
[`architecture.md`](architecture.md)、根目录 `AGENTS.md`、`@convax/plugin-api`
和 `@convax/plugin-sdk` 的源码与生成产物为准。配套模型见
[`diagrams/plugin-system.c4`](diagrams/plugin-system.c4)。

## 1. 架构结论

Convax 是一个由声明式贡献驱动、由 Desktop Main 统一授权和编排的插件平台。
宿主提供 Skill、MCP、Agent、Tool 和 Canvas 能力；插件可以注册 Skill、MCP、
Agent Tool、已验证 Tool、Hook、Canvas node renderer、command、menu、toolbar
和 host-rendered action，也可以调用 Catalog 中明确声明的 Host API。

当前只有三份运行契约：

| 契约                         | 唯一所有者           | 责任                                                                |
| ---------------------------- | -------------------- | ------------------------------------------------------------------- |
| `convax.plugin/8`            | `@convax/plugin-sdk` | Manifest、贡献、Plugin-to-Plugin export/import、版本范围和值 schema |
| `convax.plugin-host/8`       | Desktop Host         | 沙箱 iframe 的固定 MessagePort ABI                                  |
| `convax.plugin-capability/3` | Desktop Host         | transport 到 Main 的 exact-principal 调用协议                       |

Host API 不随 Manifest 或 transport 升级。`@convax/plugin-api` 的独立 SemVer
Catalog 是 API id、参数、返回值、权限、受众、引入版本和废弃信息的唯一来源。
类型、validator、客户端 metadata、人类参考和 Skill 参考都从 Catalog 与 TSDoc
确定性生成；手写文档不能成为另一份规范。

## 2. 不变量

### 2.1 声明不等于授权

`contributes`、`hostApi` 和 Plugin-to-Plugin `exports`/`imports` 相互正交：

- contribution 只声明宿主应注册什么；
- `hostApi.required`/`optional` 只声明插件可能调用哪些基座 API；
- export/import 只声明插件间的 typed capability binding；
- Skill 只编排能力，不获得隐式 Plugin、Canvas、文件或网络权限；
- iframe、Renderer、sidecar、Hook 和 remote MCP 不共享 authority。

运行行为必须由已验证的贡献、grant、schema 和 exact principal 推导，绝不能根据
具体 Plugin id、厂商、模型名或字段猜测进入特殊分支。

### 2.2 Main 是唯一策略与执行路由

Renderer 和 Preload 只运输可克隆数据。Web Plugin 的每次 Host API 调用都在 Main：

```text
iframe
  -> convax.plugin-host/8
  -> renderer transport adapter
  -> convax.plugin-capability/3
  -> Main Host API router
  -> exact principal / API declaration / grant / scope / availability
  -> owning domain service
```

Main 签发并重检
`{activeRevision, activeSetDigest, snapshotDigest, manifestDigest, pluginId,
pluginVersion, runtime}`。Renderer 不能提供 principal、provider、原生路径、凭据、
授权 URL 或可执行入口。Canvas 写入走 `CanvasApplicationService` 的 revision/CAS；
Project 文件发布走 Project owner；Agent 与 Tool 复用各自已有的 typed port。

有副作用的操作使用 Host 签发的 operation identity，传播取消，并在最后不可逆边界
重新检查 exact principal、作用域与修订。文件发布成功但 Canvas commit 失败属于明确的
partial success，不能伪装成完整回滚。

### 2.3 发布的是完整不可变闭包

安装先验证并发布一个 content-addressed complete closure。闭包包含：

- v8 Plugin package；
- Plugin-owned Skills；
- 已授权 Hook 的精确私有快照；
- managed companion 的精确字节和授权绑定；
- 规范化贡献与权限声明。

运行时只读取 immutable closure 和 validated descriptor。全局可见集合由一次
ActivePluginSet compare-and-swap 切换；不得扫描多个可变目录重建“当前状态”。
正在执行的调用持有 exact ActiveSet/snapshot lease，长期 owner 使用 bounded durable
pin。更新可以使新调用转向新集合，但不能替换已经租赁的旧字节。

缓存、staging 和孤儿 closure 都不是 authority。摘要漂移、身份歧义、缺失字节或
unsupported schema 一律 fail closed。

### 2.4 Plugin-to-Plugin 是独立 Broker

插件互调不是 Host API 的别名，也不是 renderer-selected provider：

```text
caller declared import
  -> published ActiveSet binding plan
  -> Host-mediated typed broker
  -> exact caller/provider pair lease
  -> provider export schema + version range
  -> same verified sidecar execution owner
  -> output schema validation
```

Broker 固定一个 exact provider snapshot，联合租赁 caller/provider，限制并发、深度、
重入和 request size，并传播取消。callee 不继承 caller 的 Host grants。required
dependency cycle 在发布前拒绝。禁止直接对象、MessageChannel、raw MCP、service
locator 或“第一个 provider 胜出”。

sidecar 发起嵌套 Plugin 调用或反向 Host API 时，authority 绑定当前 invocation 的
operation、immediate consumer、provider 和 historical ActiveSet lease。租约结束或
取消后重放必须失败；它不能放宽普通 current-principal resolver。

### 2.5 可执行集成只有一个边界

Tool、generation、service 和 generic operation 复用同一 verified sidecar owner。
只有安装时验证并授权的 managed companion 可以启动：

- 命令必须与 v8 Manifest runtime 完全一致；
- Host 从私有 immutable snapshot 启动并重新 fingerprint；
- 参数不是 shell command；
- 输入输出在 Host 分配的有界 staging 中；
- dispose/cancel 终止完整进程树；
- 凭据、供应商轮询和网络调用留在 sidecar；
- Host 不发现或回退到 closure 外部的可执行文件，也不存在 vendor registry 或
  Plugin-id 分支。

Agent 使用 DSH MCP Plugin；Convax 只注入已验证的配置和薄
status/auth 调用，不实现第二套 MCP transport、OAuth 或 tool proxy。

## 3. 贡献平面

| 贡献                        | 运行位置                         | 宿主责任                                              | 不授予                        |
| --------------------------- | -------------------------------- | ----------------------------------------------------- | ----------------------------- |
| Canvas node renderer        | `sandbox="allow-scripts"` iframe | 静态资源、frame/node binding、Main Host API transport | Node/Electron、同源、原生路径 |
| command/menu/toolbar/action | Host UI                          | 从 Manifest 投影、当前 selection/revision gate        | 任意 host function 注册       |
| Tool/generation/service     | verified sidecar                 | receipt、snapshot、staging、取消、结果校验            | shell、PATH、Host 凭据        |
| Plugin-owned Skill          | DSH Skill Plugin discovery       | 与 closure 原子发布、直接从 leased closure 解析       | Plugin/Host capability        |
| Hook                        | legacy bytes only                | DSH 拒绝旧 ABI；新 ABI 单独治理                       | 未声明依赖、动态 loader       |
| Agent MCP                   | DSH MCP Plugin                   | loopback Host MCP；远程 guarded transport 后续接入    | Renderer token、local command |
| Agent Tool                  | Agent runtime bridge             | typed adapter 到同一领域/Tool executor                | 独立业务实现                  |

Canvas、Project、Workbench 和 Agent 的所有权不因 Plugin 而改变。插件代码不能直接
读写 `.convax` JSON，不能以 renderer state 作为正确性来源，也不能复制领域规则到
Skill、IPC adapter 或 sidecar。

## 4. API 可用性与生成文档

插件在调用前使用 Catalog 生成的 `supports`/availability 能力判断，而不是：

- 比较 Convax 应用版本；
- 检测某个对象字段是否存在；
- 捕获“方法未定义”后猜测；
- 根据 Plugin id 或 runtime surface 选择私有入口。

availability 由 Main 结合 Catalog 版本、API 的 `since`、受众、声明、grant、setup、
disabled/recovering 状态和实时上下文计算。required API 不可用时安装或激活失败；
optional API 不可用时插件必须走声明过的降级路径。

新增或变更 Host API 的唯一流程：

1. 在 `@convax/plugin-api` Catalog 定义 typed contract、TSDoc、`since`、audience、
   grant、限制和失败语义；
2. 生成 validator、types、client metadata、人类参考和 Skill reference；
3. `@convax/plugin-sdk` 消费生成的 Catalog，不手写第二份 API 列表；
4. Main 实现通用 handler，并增加 conformance、取消、stale scope、版本和不可逆边界测试；
5. CI 校验生成产物无 diff、公共 API 可打包并从 clean external consumer 使用。

文档或 Skill 与 Catalog 不一致是构建错误，不是允许手动补丁的理由。

## 5. Plugin-to-Host 变更治理

具体 Plugin、Plugin-owned Skill、standalone Skill、MCP server 和 companion 源码属于
`convaxai/convax-plugins`。Plugin 实现任务可以只读检查 Host 的公共 Catalog/SDK，
但不得修改、建分支、提交或发起本 Host 仓库的 PR。

缺失能力时只能在 Plugin 仓库提交
[`plugin-host-change-governance.md`](plugin-host-change-governance.md) 定义的结构化请求，
说明 use case、通用 contract、替代方案、authority、side effect、兼容性和可证伪
acceptance tests，然后停止。只有人类明确批准后，才创建独立 Host 任务。Host
maintainer 可以拒绝请求、指出已有 API，或实现通用 Catalog/SDK 能力。

以下绕过全部禁止：

- private import、直接 IPC 或 raw MCP；
- renderer 选择 provider；
- Plugin-to-Plugin 直连或 service locator；
- 修改生成文件规避 Catalog；
- 在 Host 中添加具体 Plugin id、厂商或模型分支。

这条治理约束必须同时存在于根/包级 `AGENTS.md`、Plugin authoring Skill 和 CI
boundary/conformance 检查中，防止“文档建议”退化为自觉约定。

## 6. 主要风险与可证伪检查

| 风险              | 失败证据                                                | 必须通过的检查                                                            |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| authority TOCTOU  | 更新/卸载或 scope 切换后仍发生文件、Canvas 或外部调用   | 在准备与最终不可逆边界之间切换 ActiveSet/Project/revision，副作用必须为零 |
| closure 漂移      | leased invocation 读取到新包、旧 Hook 或不同 companion  | 更新并发测试证明旧 lease 只执行旧 digest，新调用只执行新 digest           |
| P2P 权限继承      | callee 能使用 caller grant 或选择未绑定 provider        | 双 principal/schema 测试、cycle/reentry/depth/concurrency 测试            |
| Renderer 越权     | IPC 能提交 principal/provider/path/token                | schema fuzz 与 cross-sender/frame theft 测试全部拒绝                      |
| 文档漂移          | reference/Skill 中 API、since 或 schema 与 Catalog 不同 | 重新生成后 `git diff --exit-code`，external-consumer typecheck            |
| 具体集成污染 Host | runtime 根据 id/vendor 分支                             | AST/`rg` policy 与 package-boundary tests 无例外通过                      |

若任一测试只能依赖 sleep、当前目录扫描、PATH、mutable global 或具体 Plugin fixture
才能通过，说明架构边界仍未真正成立。

## 7. LikeC4 视图与验证

模型提供以下视图：

| View                      | 说明                                                |
| ------------------------- | --------------------------------------------------- |
| `index`                   | 当前 v8 平台总览                                    |
| `runtime_contracts`       | 三份 ABI、Catalog 和生成 reference                  |
| `contribution_planes`     | Skill/MCP/Agent/Tool/UI 贡献如何接入                |
| `authority_and_execution` | Main Host router、领域服务和 verified sidecar       |
| `p2p_broker`              | exact pair lease、schema/version binding 和嵌套调用 |
| `installation_flow`       | closure publication、ActiveSet CAS、lease/pin       |
| `web_host_call`           | Web transport-only Host API 调用                    |
| `plugin_host_request`     | 缺失 API 的人审治理                                 |

本地校验：

```bash
npx likec4 validate docs/diagrams
```

## 8. 代码依据

- API Catalog 与生成器：[`packages/plugin-api`](../packages/plugin-api)
- Manifest、互调 schema 与 reference 生成输入：
  [`packages/plugin-sdk`](../packages/plugin-sdk)
- Host transport：[`packages/desktop/src/plugin-host-protocol.ts`](../packages/desktop/src/plugin-host-protocol.ts)
- Main Host router：
  [`packages/desktop/src/main/plugin-host-api-service.ts`](../packages/desktop/src/main/plugin-host-api-service.ts)
- ActiveSet/closure runtime：
  [`packages/desktop/src/main/plugin-installation-runtime.ts`](../packages/desktop/src/main/plugin-installation-runtime.ts)
- P2P broker：
  [`packages/desktop/src/main/plugin-capability-broker.ts`](../packages/desktop/src/main/plugin-capability-broker.ts)
- verified sidecar owner：
  [`packages/desktop/src/main/generation-plugin-runtime.ts`](../packages/desktop/src/main/generation-plugin-runtime.ts)
- Canvas authoritative application service：
  [`packages/canvas/src/application/service.ts`](../packages/canvas/src/application/service.ts)
