# DSH Desktop + Cordis 新项目（v3）

## 总结

在本仓 `convax-next` 分支重启，不迁移旧 Convax 代码（legacy 冻结规则见根
[`AGENTS.md`](AGENTS.md)）。

主参考改为社区桌面项目
[`anywhere-labs/deepseek-harness-desktop`](https://github.com/anywhere-labs/deepseek-harness-desktop)：
固定版本的上游 DeepSeek Harness 以 npm 闭包运行；源码 commit 只作为外部
审计参考记录，不进入产品仓库；
**桌面本身也是一个 DSH 插件**——窗口、托盘、更新、工作配置由桌面插件的
Host/Client 双面提供，与第三方插件用同一套 Cordis 组合机制。
[官方 examples](https://github.com/deepseek-ai/deepseek-harness/tree/master/examples)
继续作为插件编写范式参考。

```text
Electron bootstrap（app/desktop 拥有，尽量薄）
  ├── 生成一次性鉴权 token
  └── 启动 DSH 运行时（固定 npm 运行闭包）
        └── Cordis Context（同一棵树）
              ├── 上游内置插件（原样）
              ├── app/desktop Host 面（窗口/托盘/更新/工作配置服务）
              ├── auth-fence（token 鉴权，P0）
              ├── 产品插件（runtime / ui …）
              └── 用户插件

Electron Renderer（sandbox，无 Node）
  └── 加载 http://127.0.0.1:<random-port>（preload 注入 token）
        ├── 兼容模式：上游默认 Web Client，零覆盖
        └── 高级模式：桌面自有 Client 插件按 profile 替换文档化 slot
```

画布不进入骨架；未来作为桌面自有 Client 插件经 profile 组合加入，
兼容模式永远保留为退路（见「风险验证」）。

## 参考映射

| 参考仓库要素 | 本项目采用 |
| --- | --- |
| `upstream.json` source/npm pin + 可选同级源码 checkout | 采用。产品仓库不带上游源码；pin 更新与行为变更分开提交 |
| `dsh-plugin-desktop/`（桌面即插件：Host/Client 双面 + Electron bootstrap + 打包） | 采用为 `app/desktop` 的形态基线 |
| `patches/` 显式上游补丁清单 | 采用，默认为空；每次升级逐条验证可否删除 |
| 兼容模式规则（上游默认 client 零覆盖必须可跑） | 采用为硬规则；高级呈现只经桌面自有 Client 插件 + profile 组合 |
| 工作配置（profile 管理、packaged fallback） | 采用最小形状：`compatibility` 与 `default` 两个 profile 起步 |
| `.agents/notes/` Agent Note 决策记录 + headless 检查门 | 采用（见「门禁与 Agent Notes」） |
| `dsh-community-market` 开放 Schema 插件市场 | 不自建市场；M3 评估直接接入其数据源 Schema |
| 手机远控、多语言 README、赞助体系 | 不采用 |

| 官方示例 | 参考用途 |
| --- | --- |
| `web-schedule` | overlay 插件 backend/client 双面 + `--patch` 挂载范式 |
| `headless-agent` | 纯 `cordis.yml` 声明式组合范式 |
| `jsonrpc-agent` | SDK/JSON-RPC 程序化驱动，自动化测试通道 |
| `web-cordis` | 插件树自省，`dump-config` 实现参考 |
| `mcp-memory` | 经官方 `dsh-mcp-client` 挂 MCP 服务器的配置范式 |
| `acp-agent` | 备选控制面，暂不采用 |

## 仓库拓扑（本分支）

```text
app/
  desktop/          桌面插件：Electron bootstrap + Host 面 + Client 面 + 打包
  plugins/
    auth-fence/     token 鉴权 fence（P0）
    runtime/        ctx.appRuntime：应用名称、版本、运行模式
    ui/             最小品牌标记 Client 插件（证明装载成功）
    test-consumer/  inject=['appRuntime'] 的测试消费插件
  profiles/         compatibility / default 两个工作配置
patches/            上游补丁清单（默认为空）
upstream.json       npm 运行版本与外部源码 commit 映射
.agents/
  skills/gate-*/    门禁 skills
  notes/            Agent Note 决策记录
PLAN.md  AGENTS.md
packages/ apps/ docs/ …  legacy 冻结区
```

- 外层用一个包管理器（跟随参考仓库用 Yarn + `nodeLinker: node-modules`，
  或统一 Bun，M1 前以打包验证结果定夺并记 Agent Note）；可选的同级上游
  checkout 保持自己的 pnpm workspace，只经根部 `upstream:*` 脚本进入。
- 固定依赖：上游 npm 版本与 source commit 同时记录于 `upstream.json`；
  Electron `43.4.0`；打包 Node
  `24.9.0`（独立打包而非 `ELECTRON_RUN_AS_NODE`，原因是上游原生模块
  ABI 需求；禁止「顺手优化」掉，决策记 Agent Note）。

## 实现方案

### 桌面插件（app/desktop）

- Electron bootstrap 尽量薄，且归桌面插件所有：
  - 创建 `userData/launch-root` 与 `userData/harness`
  - 生成本次启动的一次性鉴权 token
  - 分配随机 `127.0.0.1` 端口并启动上游运行时（组合见下节）
  - 健康检查、日志、崩溃重启、退出与子进程回收
  - 重启后向 Renderer 广播新 origin 并触发自动重连导航
  - 启动失败页
- Host 面以 Cordis 服务暴露桌面能力（窗口、托盘、更新、工作配置读取/
  切换）；哪些服务开放给第三方插件必须逐项文档化，默认不开放。
- Renderer 开启 `sandbox`、`contextIsolation`，关闭 Node；导航仅允许
  当次精确 loopback origin（重启后由 bootstrap 更新白名单）。
- Preload 只暴露：失败页的重试/查看日志/退出 + 当前 origin 与 token 的
  只读注入。
- 预留「native affordance 窄 typed IPC 缝」（拖出 Finder、系统菜单、
  剪贴板、deep link），当前空实现；禁止散点打洞。

### 安全边界（P0，进 M1 验收）

- 上游 web 控制面无内建鉴权（上游讨论 #853/#2829；browser-trust fence
  不是认证层），任何本机进程可驱动 agent 执行命令。因此：
  - `auth-fence` 插件校验每个 HTTP/WebSocket 请求的 token header，无效
    即 403；token 由 bootstrap 每次启动生成，只经 preload 注入。
  - 验收：无 token 的本机请求被拒；持 token 请求正常。
- Agent 权限姿势在产品 profile 中显式声明保守组合：工作区限定、危险
  命令需审批；禁用或 fence 拦截 `commands/execute` 类静默提权入口。

### Cordis 组合与工作配置

- 组合即配置：产品插件经 profile 的 patch 挂载；不自建 Plugin Host、
  Catalog、ActiveSet 或 broker。
- 两个起步 profile：
  - `compatibility`：上游默认 client，零覆盖，永远可跑——这是升级排障
    与画布赌注的退路；
  - `default`：兼容模式 + 产品插件（auth-fence 必挂，任何 profile 不得
    移除）。
- 配置是纯数据：无可执行表达式；平台/渠道条件用声明式字段；patch 按
  id 整行覆盖 config。
- 开发态支持热重载；生产态必需插件异常进入失败页，不静默跳过。
- `dump-config` 输出最终插件树，作为组合真源（参考 `web-cordis`）。

### 数据边界

- 产品文档数据永不落上游拥有的目录（`userData/harness`、会话 JSONL）；
  产品插件自管数据目录。上游升级可自由重建 harness 目录。

### 文件与未来画布边界

- 后端文件能力直接用上游 `ctx.fs`；不在 Electron 层新增文件 API。
- 需要 UI 的插件自己提供 backend/client 双面（范式对齐 `web-schedule`），
  不经过 Electron 转发。
- 画布为独立 `@app/canvas` bundle：Node 入口注册 `ctx.canvas`，Client
  入口按 profile 替换文档化 slot，Agent 操作注册 `ctx.tools`；加入画布
  只改插件依赖与 profile，不改壳。是否复用 legacy 四内核包
  （`@convax/collaboration`、`@convax/canvas` core、`@convax/bounded-value`、
  `@convax/uri`）在 M2 决策并记 Agent Note。

## 风险验证（M1 后立即执行）

1. **画布级 UI 在 Client 插件缝内的 spike**：整窗编辑器、React Flow 量级
   依赖、手势与渲染性能。退路已结构化：兼容模式永远可跑，画布模式只是
   一个 profile；若 slot 承载不了，验证 harness 自控独立路由方案。
2. **单进程崩溃域评估**：用户插件崩溃对 UI 与画布数据的影响；画布落地
   时决定是否独立进程。

## 路线图

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| M0（本次） | 契约、计划、门禁 skills、Agent Notes 约定 | 文档齐备，门禁可路由 |
| M1 | 骨架：source/npm pin、桌面插件、auth-fence、两个 profile、dump-config | 「测试与验收」全绿 |
| M1.5 | 两个风险 spike | 证据文档（Agent Note），非功能 |
| M2 | `@app/canvas` 首版（单机、无协作）；内核包复用决策 | 画布可创建/编辑/持久化 |
| M3 | 插件安装 UX：评估接入 dsh-community-market 开放 Schema 数据源 | 用户可装第三方插件 |
| M4 | 打包签名/公证、自动更新、Windows x64 | 双平台可分发 |

## 门禁与 Agent Notes

- 门禁路由表见 [`AGENTS.md`](AGENTS.md)；命中即读，多个命中全部执行。
- 架构与流程决策写入 `.agents/notes/`（日期前缀 + 主题），实现后移入
  `implemented/`；契约（AGENTS.md/PLAN.md）只保留规则，理由与取舍进
  Note——对齐参考仓库的分工。

## 测试与验收

- Cordis 生命周期：配置顺序无关启动；缺服务时 consumer `PENDING`；
  provider 卸载回收 consumer 的事件/计时器/注册；恢复后重新激活。
- 桌面壳：仅监听随机 loopback 端口；无 token 请求被拒（P0）；readiness
  超时/崩溃/重启/退出/日志路径正确；kill -9 后自动重启且 Renderer 重连
  新 origin、无产品数据丢失；外部 URL 交系统浏览器；Renderer 无 Node，
  非当次 origin 导航被拒。
- 组合：`dump-config` 包含 desktop Host 面、auth-fence、runtime、ui；
  `compatibility` profile 零覆盖可跑；test-consumer 成功调用
  `ctx.appRuntime`。
- 集成：真实上游启动到 Web 可访问；打包产物在无全局 Node/pnpm/上游
  checkout 的机器上可启动；升级回归入口自动化（真实启动 + dump-config
  基线 diff + 生命周期 + fence 重验 + patches 逐条复核）。
- 全部检查 headless-safe：构建、typecheck、测试、Loader smoke 不拉起
  图形界面（对齐参考仓库）。
- M1 验收：
  - 一条命令进入开发工作流并打开 DSH UI
  - 用户可添加目录并启动 Agent，权限为产品 profile 声明的保守组合
  - Electron bootstrap 不含产品文件操作、画布逻辑或插件间转发
    （native affordance 预留缝除外，当前为空）
  - 新增一个普通插件只需安装依赖并修改 profile patch

## 假设与默认值

- 首版仅骨架：不含画布、旧数据迁移、协作协议、自建市场、自更新、移动端。
- Cordis 插件按可信本地代码处理，不承诺恶意插件隔离；控制面鉴权与保守
  权限姿势不因此豁免——它们防的是插件体系之外的本机进程与模型行为。
- 先 macOS ARM64，后 Windows x64；不同架构分别安装依赖与打包。
- 上游 npm 运行版本与 source commit 精确映射，源码 checkout 不进入产品
  仓库；本地修补只存在于 `patches/` 显式清单；升级必须走 gate-upstream
  门禁全程。
