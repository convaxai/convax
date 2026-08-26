# Convax Next 开发契约

本分支（`convax-next`）是基于 DeepSeek Harness（dsh）+ Cordis 的产品重启。
[`PLAN.md`](PLAN.md) 是当前唯一的计划真源；主参考为
[`anywhere-labs/deepseek-harness-desktop`](https://github.com/anywhere-labs/deepseek-harness-desktop)
的仓库拓扑与「桌面即插件」模式。本文件在本分支上取代旧 Convax 契约；
旧契约与旧代码的治理规则随 `main` 分支保留，不适用于新代码。

## 仓库形态（本分支）

| 路径 | 状态 |
| --- | --- |
| `app/` | 新项目代码：`desktop/`（桌面插件）、`plugins/`、`profiles/`（骨架期逐步落地） |
| `upstream.json` | 上游源码 commit 与 npm 运行版本的映射真源 |
| `patches/` | 上游补丁显式清单，默认为空 |
| `PLAN.md` | 计划真源 |
| `.agents/skills/gate-*` | 门禁 skills |
| `.agents/notes/` | Agent Note 决策记录（日期前缀 + 主题；实现后移入 `implemented/`） |
| `packages/`、`apps/`、`docs/` 及其余 legacy 目录 | 冻结区，只读 |

## Legacy 冻结规则

- legacy 目录只读：不修复、不重构、不补测试、不做文档同步。
- 唯一允许的复用是把这四个无依赖内核包当普通库依赖：
  `@convax/collaboration`、`@convax/canvas`（core/collaboration 层）、
  `@convax/bounded-value`、`@convax/uri`。是否复用在画布里程碑（M2）
  决策并记 Agent Note。
- 新代码禁止以相对路径伸进 legacy 目录，禁止复活 `plugin-api`/`plugin-sdk`、
  `marketplace*`、`agent-runtime`、`desktop` 的任何机制或概念。
- 删除 legacy 树是一个显式里程碑，不随手做、不分批夹带。

## 硬规则（新项目）

1. **产品仓库不保存上游源码 checkout。** 可选审计源码只能位于同级
   `../deepseek-harness`；源码 commit 与 npm 版本记录在 `upstream.json`，
   pin 更新与桌面行为变更分开提交。本地修补只能以 `patches/` 显式清单
   存在并留审计记录。
2. **桌面即插件。** Electron bootstrap 归 `app/desktop` 所有且尽量薄；
   窗口、托盘、更新、工作配置以 Cordis 服务暴露，开放给第三方插件的
   服务必须逐项文档化，默认不开放。
3. **兼容模式必须永远可跑**：`compatibility` profile 运行上游默认 client、
   零覆盖。高级呈现（含未来画布）只经桌面自有 Client 插件 + profile
   组合替换文档化 slot。
4. **控制面 token 鉴权不可绕过、不可降级。** 上游 web 自身无认证，
   `auth-fence` 是产品唯一认证层，任何 profile 不得移除；agent 权限
   姿势由产品 profile 显式声明，不继承开发者工具默认。
5. **Renderer 保持 `sandbox` + `contextIsolation` + 无 Node**；导航仅
   允许当次启动的精确 loopback origin。
6. **产品数据永不落上游拥有的目录**（`userData/harness`、会话 JSONL）。
7. **一切产品能力都是 Cordis 插件，组合即配置**；`dump-config` 是组合
   真源；不自建 Plugin Host、Catalog、ActiveSet 或 broker。
8. **配置是纯数据**：无可执行表达式；平台/渠道条件用声明式字段；patch
   按 id 整行覆盖 config，不做深合并。
9. **插件按可信本地代码处理**：信任决策发生在安装/挂载时（integrity
   锁定、用户同意），不假装存在运行时恶意插件隔离。
10. **新增一个普通插件的成本恒定**：安装依赖 + 修改 profile patch，
    一定不改壳。
11. **一切检查 headless-safe**：构建、typecheck、测试、Loader smoke
    不得拉起图形界面；图形启动保持显式。

## 门禁路由

改动前先命中门禁，多个命中时全部执行：

| 改动触碰 | 必读并逐项执行 |
| --- | --- |
| `cordis.yml`、任何 `*.patch.yml`、profile、插件挂载、`provide`/`inject` 服务名 | [`gate-composition`](.agents/skills/gate-composition/SKILL.md) |
| `auth-fence`、preload 暴露面、导航白名单、权限 profile、端口/host 参数、控制面可达性 | [`gate-security`](.agents/skills/gate-security/SKILL.md) |
| `upstream.json`、`@deepseek-ai/*` 版本、`patches/`、Electron / 打包 Node 版本 | [`gate-upstream`](.agents/skills/gate-upstream/SKILL.md) |

## 工作流

1. 动手前读 `PLAN.md` 对应章节与命中的门禁 skill。
2. 架构与流程决策写 Agent Note（`.agents/notes/`）；契约只保留规则，
   理由与取舍进 Note。计划、边界或硬规则变化必须与实现在同一变更内
   更新 `PLAN.md` / 本文件。
3. 大方向变更前先提交；上游 source/npm pin 更新单独成提交。
4. 提交信息用中文 conventional 格式（如 `feat(desktop): 增加健康检查重启`）。
5. 验证以 `app/` 的 package scripts 为准；骨架期最低要求：
   `dump-config` 无意外 diff + 壳测试 + 插件生命周期测试全绿。
