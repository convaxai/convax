# Convax 多 Marketplace 设计

> 历史方案：其中产品锁、固定 Official 与默认安装设计已退役，不是当前架构或实现依据。当前契约以 `docs/architecture.md` 和 `docs/plugin-skill-platform.md` 为准。

状态：已按人工意见收敛，待最终确认。确认前不进入代码开发。

本文只保留产品与架构决策。协议、持久化、恢复、安全和详细验收见
[工程附录](2026-07-27-multi-capability-marketplace-engineering-appendix.md)。

## 1. 最终方案

用户只需要理解一条路径：

```text
扩展 -> 安装 -> 必要时完成设置 -> 可用
```

Plugin、Skill、MCP Server 是扩展的类型 badge，不是三套产品流程。Marketplace 是
扩展的来源，只在 Settings、详情和来源冲突时出现。

首版固定：

- 同时支持 Plugin、standalone Skill、MCP Server。
- 同时挂载 Builtin、Official、第三方和内部 Imported 四类来源。
- Catalog 聚合所有来源，相同 `{类型,id}` 只显示一张卡。
- 已安装扩展锁定原 Marketplace；禁止跨来源更新、覆盖或换源。
- Settings 支持添加、移除和刷新第三方 Marketplace。
- 用户原有本地导入由 `userData` 下透明的 Local Marketplace 承载。
- Local 数据模型支持多个，首版产品只创建一个。
- `canvas-storyboard` 以 standalone Skill 放入 Builtin Marketplace。
- `convax-plugins` 是 Official Marketplace，也是具体扩展的唯一源码与发布仓。
- Builtin immutable bundle 首版只包含 `canvas-storyboard`。
- Official 预装列表可配置，首版只有 Plugin `ffmpeg-tools`。
- `ffmpeg-tools` 本期保持 Plugin，只预装 `darwin-arm64`。
- Convax 用一个 product lock 固定 bundle、Registry 和预装 artifact 的全部字节。
- MCP Server 使用标准 `server.json`；普通 HTTP MCP 不需要 Convax 扩展。
- HTTP MCP 首版只供 Agent 使用。
- Convax 产品动作只允许 Desktop 托管的 managed-stdio MCP Server。
- 首版不做扩展之间的自动依赖解析。
- 第三方作者只直接使用一个 npm Kit；push 后由 CI 发布 Registry v2。
- Official 额外生成 v1 兼容投影，第三方不用理解 v1/v2 双轨。

既有 Plugin 可以继续把 MCP runtime 作为自己的内部实现，类型仍是 Plugin；新的可复用
纯工具优先发布为 MCP Server。Skill 只描述工作流，不内嵌或启动 MCP Server。

## 2. 用户模型

### 2.1 来源

| 用户看到的来源     | 内部类型            | 用户是否管理     |
| ------------------ | ------------------- | ---------------- |
| Convax 内置        | Builtin             | 否               |
| Convax Official    | Network Marketplace | 只查看状态和刷新 |
| 第三方 Marketplace | Network Marketplace | 添加、移除、刷新 |
| 已导入             | Local Marketplace   | 否               |

预装和离线镜像不是新来源：

- 预装只是安装策略；
- 离线镜像仍保留原 Marketplace 身份；
- Marketplace membership 不等于本地执行权限或 native trust。

因此预装的 `ffmpeg-tools` 仍显示来源 Convax Official。

### 2.2 Catalog

Catalog 默认展示全部扩展，类型和来源都是次级筛选。

相同 `{类型,id}` 的多来源条目聚合成一张卡。展示代表的规则固定为：

1. 已安装时使用已安装来源的 presentation。
2. 未安装时依次选择 Builtin、Official、最早添加的第三方来源。
3. 同层再按 marketplace id 稳定排序。

展示代表不等于安装来源。存在多个来源时，用户点击安装后只选择一次来源；系统不预选
隐式 winner。

安装后：

- 卡片始终展示当前安装来源；
- 其他来源折叠为“其他来源”；
- 明确提示“需要先卸载当前版本”；
- 不合并不同来源的版本、权限、摘要或信任。

用户选定来源后，确认页切换为该来源自己的名称、说明、版本、setup 和权限摘要，
然后才签发安装 token。浏览卡片的 presentation representative 不能替代 exact source
确认。

### 2.3 安装和设置

`install` 与 `setup` 是两个独立领域动作：

```text
install
  -> 静态扩展已安装
  -> 无额外要求：可用
  -> 有额外要求：需要设置

setup
  -> 登录 HTTP MCP 服务，或确认本地组件
  -> 可用
```

一个向导可以连续完成两步，但授权取消不能回滚已经成功的静态安装。

唯一判定规则：

- 纯静态 Plugin/Skill 安装后直接可用；
- 任何首次 HTTP MCP/业务网络连接都必须 setup；
- 任何首次本地进程执行都必须 setup；
- OAuth 只是 HTTP setup 的可选步骤，匿名 HTTP MCP 也必须先确认 endpoint。

既有带 Tool executable 或 Hook 的 Plugin 也遵循这条规则：同一向导可以串联 install
和 setup，但底层是两个 mutation。

所有扩展统一使用四种稳定状态：

| 状态     | 含义                             |
| -------- | -------------------------------- |
| 需要设置 | 已安装，还需要登录或本地执行授权 |
| 可用     | 当前功能可使用                   |
| 已停用   | 用户主动停用连接或本地执行       |
| 需要处理 | 登录失效、组件变化或运行失败     |

“正在连接”只是进度，“有更新”只是 badge。Marketplace 离线是来源状态，不把已经
安全安装且可运行的扩展错误标成“需要处理”。

四状态是唯一的 `InstalledCapability` UI contract。各 manager 只负责映射，
Renderer 不按 kind 建立三套生命周期。

“已停用”是持久的用户选择：重启、刷新 Marketplace 或同源更新都不能自动重新启用；
只有用户点“启用”或卸载后重新安装才会重置这项选择。

MCP 卡片直接显示“用于 Agent”或“用于 Agent 和 Convax”；用户不需要通过
HTTP/managed-stdio 推断作用范围。

### 2.4 一个导入入口

用户只看到：

```text
导入…
```

Main 严格检查根标记：

| 根标记          | 类型       |
| --------------- | ---------- |
| `manifest.json` | Plugin     |
| `SKILL.md`      | Skill      |
| `server.json`   | MCP Server |

必须恰好匹配一种；零种或多种都拒绝并给出明确原因。Main 始终路由默认 Local
Marketplace，Renderer 不提交 Local id 或 native root。成功后来源显示“已导入”。

### 2.5 Settings

Settings 页面名称为 Marketplace，只展示 Official 和第三方来源；Builtin 与 Local
不占用不可操作的设置项。

添加流程：

```text
粘贴 Marketplace URL
  -> Main 验证
  -> 预览名称、发布者、仓库和内容数量
  -> 确认添加
```

专用 `addMarketplace` IPC 是 Renderer 提交 URL 的唯一例外。Registry、artifact、
redirect、MCP endpoint、header、command、native path 和 digest 都由 Main 推导，
不能由 Renderer 提交。

添加或刷新只获取 Marketplace metadata 和展示素材；不会下载 package/companion，
也不会连接扩展声明的 MCP/业务服务、触发 OAuth 或启动进程。

移除 Marketplace 不卸载扩展。已安装扩展继续依据 immutable installed snapshot
运行，但不能更新；重新添加完全相同的来源身份后才恢复更新。

## 3. 作者模型

作者主路径只有：

```text
创建 -> 添加目录 -> 检查 -> 合入默认分支
```

推荐命令：

```text
npx create-convax-marketplace
bun marketplace add <directory>
bun marketplace check
git push
```

`add` 使用与产品导入相同的严格根标记识别。需要空模板时才使用：

```text
bun marketplace new plugin
bun marketplace new skill
bun marketplace new mcp-server
```

普通分支和 PR 只运行 check。扩展 version 变化的提交合入默认分支后，CI 自动校验、
打包并发布；没有 version 变化时不发布。作者不创建发布 tag，也不运行本地
`publish`。

### 3.1 三种源码

- Plugin：`manifest.json`。
- Skill：`SKILL.md`。
- MCP Server：标准
  [`server.json`](https://modelcontextprotocol.io/registry/about)。

对 MCP Server：

- `server.json.name` 就是 Convax id；
- `server.json.version` 就是安装版本；
- HTTP 类型必须恰好解析出一个首版支持的固定 HTTPS entry；用户只确认 endpoint，
  不选择 `remotes[]` entry、transport、URL 变量或自定义 Header；
- 首版 HTTP entry 不支持 URL template variables 或 custom headers；认证只走标准
  MCP OAuth，匿名服务无需额外输入；
- 满足上一条时，无 Convax 扩展即可供 Agent 使用；
- 只有 unsupported `packages[]`、没有受支持 HTTP/managed-stdio profile 的条目不进入
  普通 Catalog。

可选 `convax-mcp.json` 只服务高级 managed-stdio 场景：

- 声明固定本地启动策略；
- 把明确的 MCP tool 映射到固定 Convax 产品动作；
- 声明所需 Host grants。

它不重复 id、version、digest 或 MCP input schema，不携带 executable、secret、Hook、
Skill 或任意 Web UI。HTTP MCP 不允许声明 Convax 产品动作。

首版一个 MCP Server 只选择一种运行方式。HTTP MCP 包不能包含
`convax-mcp.json`；同时声明 HTTP entry 与该文件时整项拒绝，避免同一张卡出现两套
启动、授权和更新语义。

HTTP 是默认模板。只有发布 managed-stdio 时，作者才额外执行：

```text
bun marketplace add-target <mcp-directory> --target <platform-arch> --file <binary>
```

Kit 把已构建 binary 收入 scaffold 管理的 companion input，生成独立 Release artifact
及 URL、size、SHA-256。作者不编辑 Registry、Release metadata 或 digest。

### 3.2 一个 Kit

第三方仓只直接依赖：

```text
@convax/marketplace-kit
```

Kit 和 create CLI 由 Convax 仓库拥有；`convax-plugins` 只消费它们并发布具体内容。
Kit 自动生成确定性 ZIP、Registry、Showcase、digest、Pages 和 Release workflow。

第三方只发布 Registry v2。Official 使用同一 Kit 发布 v2，并由 CI 生成严格 v1
兼容投影。

## 4. 产品交付

### 4.1 Builtin

`convax-plugins` 是 Builtin 内容的唯一源码与 bundle 发布仓。Convax 不保留可独立
修改的第二份 Skill 源码。

Builtin bundle 首版只有：

```text
convax-builtin / skill / canvas-storyboard
```

迁移保持 id、version、`SKILL.md` 字节、展示素材和 standalone ownership；不覆盖用户
修改过的同名 Skill。

### 4.2 Official 预装

预装 policy 首版只有：

```text
convax-official / plugin / ffmpeg-tools
target: darwin-arm64
setup: automatic
```

`ffmpeg-tools` 是单独锁定的 Official artifact，不进入 Builtin bundle。本期不把它
拆成 MCP Server，也不在其他平台回退 PATH。自动设置仍通过独立、可恢复的 setup
transition 写入 ExecutionGrant，但不启动进程；只允许 product lock 精确固定的
managed Tool companion，遇到 PATH fallback、Hook、Service、额外 Plugin capability、
credential/secret 输入或 source/version/target 漂移时 fail closed。

用户卸载预装扩展后写入持久化 `ProvisioningDecision`，后续启动尊重该决定，不能因
policy 仍存在而重新安装。

### 4.3 一个 product lock

Convax 只维护：

```text
marketplaces.lock.json
```

它包含：

```text
policy    # sources、preinstalledPackages、targets、setup
resolved  # 所有 build input 和 artifact 的 immutable URL、size、SHA-256
```

`policy.preinstalledPackages` 是预装列表的唯一配置入口：

```text
bun marketplace:configure  # 显式改 policy
bun marketplace:lock       # 显式刷新 resolved
bun package                # 只消费并校验 lock
```

lock 必须固定 Builtin bundle、Official descriptor、Registry、Showcase、package、
owned Skill 和 target companion 的全部输入字节；不在打包时读取“最新版本”。

## 5. 架构边界

| Owner                   | 责任                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `@convax/marketplace`   | refs、聚合、公开 schema 和严格校验                              |
| `@convax/agent-runtime` | Host 注入的 HTTP MCP 配置、OpenCode 状态和认证操作              |
| `@convax/desktop`       | source adapters、Local、安装、设置、native runtime、IPC/UI      |
| Convax tooling          | `@convax/marketplace-kit` 和 create CLI                         |
| `convax-plugins`        | 具体 Plugin/Skill/MCP Server、Official Registry、Builtin bundle |

首版不新增 `@convax/mcp-server`。Metadata 属于 Marketplace 协议，HTTP MCP 属于
Agent Runtime，安装和 native process 属于 Desktop；当前没有独立 package owner。

### 5.1 HTTP MCP

- 首版只供 Agent。
- OpenCode 是真实 HTTP MCP client 和 OAuth owner。
- Convax 不代理 tool call，也不为 HTTP MCP 提供 Canvas/Toolbar 直调。
- Agent Runtime 必须证明可在真实 socket 边界强制 outbound policy，包括 redirect、
  DNS、IPv4/IPv6、private/metadata address 和 rebinding。
- 该 gate 未通过时，来自 Builtin、Official、第三方和 Local 的所有 HTTP MCP 都不得
  执行；不能用 Marketplace membership 或 Desktop URL 预检冒充 socket 级防护。

### 5.2 Managed stdio MCP

- Desktop 拥有 executable、process tree、MCP client 和 lifecycle。
- Agent Runtime 只接收 Main 提供的认证 loopback Streamable HTTP 配置。
- Agent Runtime 和 Renderer 永远不接收 stdio command、argv、cwd 或 native path。
- `convax-mcp.json` 提供固定 bare command 和常量 argv；不允许用户输入动态 argv。
- cwd 使用 Host 私有空目录，environment 使用 Host allowlist。
- 首版不向 managed-stdio 注入 secret、credential env 或 credential payload；依赖此
  能力的 Server 直接标记为不支持。
- Registry companion 绑定 platform、arch、URL、size、SHA-256，禁止 PATH fallback。
- Local executable 由用户在 setup 中选择，并绑定 real path、size、SHA-256。
- Convax 产品动作仅允许此 Desktop-owned runtime，并继续调用固定 typed business
  capabilities。

### 5.3 安装、设置和来源

- `install` 与 `setup` 分别使用独立 `CapabilityTransition`。
- 同一 `CapabilityMutationCoordinator` 负责一致性，但不把授权并入安装原子性。
- 需要重新 setup 的更新在确认前只是非权威 candidate；旧 snapshot/record/grant
  继续作为唯一 current runtime，不能先切新版再声称旧版仍可用。
- source graph 只用于 list/install/update。
- runtime 依据 immutable installed snapshot、`InstallRecord` 和 `ExecutionGrant`
  重新校验，不要求原 Marketplace 当前在线或仍被添加。
- InstallRecord 缺失时，静态 Plugin/Skill 可保留为 `legacy-unbound`；MCP、Hook、本地
  Tool 和产品动作必须停用。
- Coordinator 必须同时串行 installed identity 与受影响的全局 Skill names；只有
  participant namespaces 不相交的 mutation 才能并发。
- 外层 transition 组合现有 Plugin/Skill recovery checkpoint，不建立相互竞争的
  第二个 forward decision。

## 6. V1 边界

| 本期包含                         | 本期不包含                                |
| -------------------------------- | ----------------------------------------- |
| 多 Marketplace 与来源隔离        | 跨来源换源或 adoption                     |
| Plugin、Skill、MCP Server        | 同 identity 多版本并存                    |
| Builtin、Official、第三方、Local | 自动依赖解析                              |
| 一个 Catalog、一个导入入口       | Capability Pack                           |
| Settings 添加第三方来源          | WASM/WASI                                 |
| HTTP MCP 供 Agent 使用           | HTTP MCP 产品直调                         |
| 固定 HTTPS endpoint 与标准 OAuth | HTTP URL 变量、自定义 Header/API Key 表单 |
| Desktop-managed stdio MCP        | npm/PyPI/NuGet/OCI/MCPB 执行              |
| MCP tools                        | MCP resources/prompts                     |
| immutable bundle/product lock    | 任意公网/私网 Registry transport          |
| npm-first scaffold/Kit           | Marketplace 付费、排名、账号、推荐        |

Registry 每个 revision 对每个 `{kind,id}` 只广告一个 current version。历史版本只在
已安装记录和 immutable artifact 中存在，不进入 Catalog，也不需要 latest/range
resolver。

## 7. 开发门禁

最终确认后，开发必须同步更新：

- 根 `AGENTS.md`；
- `docs/architecture.md`；
- `packages/desktop/AGENTS.md`；
- `packages/agent-runtime/AGENTS.md`；
- 新 package 的 `AGENTS.md`；
- package dependency boundary checker；
- persistence map、Desktop protocol version 和 compatibility tests。

同时完成：

- 固定并提交审阅后的官方 `server.json` schema bytes/SHA-256；
- 验证 npm namespace、license、provenance 和 Bun/Node/Electron 兼容；
- 验证 Agent Runtime/OpenCode 的真实 socket outbound-policy gate；
- 在 Convax 与 `convax-plugins` 两个 worktree 分别通过真实构建、打包和恢复验收。
