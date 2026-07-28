# Convax 多 Marketplace 验收计划

状态：随
[主方案](2026-07-27-multi-capability-marketplace-design.md)
一起待最终确认。

规范性不变量见
[工程附录](2026-07-27-multi-capability-marketplace-engineering-appendix.md)。

## 1. Source graph

- 同时挂载 Builtin、Official、一个 Local 和两个第三方 Network Marketplace。
- 每个来源都能列出 Plugin、Skill、MCP Server。
- Settings 不出现 Builtin 和 Local。
- 一个 source timeout/invalid/rollback 不影响其他 source。
- cache/high-water 按 SourceKey 隔离。
- 同 id、同版本、同 artifact 但不同 SourceKey 仍冲突。
- source identity 改变后不能更新旧安装。
- Catalog 在确认后变化返回 stale selection。
- 新增 Builtin 成员不改变旧成员 SourceKey。
- 相同 marketplaceId + 相同 SourceKey 是 no-op。
- 相同 marketplaceId + 不同 SourceKey 被拒绝。
- remove 后 re-add exact SourceKey 仍拒绝更低 sequence。
- 后续 sequence 复用同 `{kind,id,version}` 但改变 bytes/digest 时拒绝。
- version contract 累积到 16,384 条或 canonical state 将超过 8 MiB 时，整个 refresh
  fail closed，不裁剪 high-water，last-known-good 仍可用。
- crash injection 覆盖 immutable Catalog snapshot 与 combined
  SourceSecurityState/accepted-Catalog decision 的前后边界；恢复只能看见 previous 或
  next，不能看见无 high-water 的新 Catalog。

## 2. Catalog 和 UI

- 默认 Catalog 不按 Marketplace 分组。
- 同 `{kind,id}` 多来源只显示一张卡。
- presentation representative 符合 Builtin、Official、最早添加第三方的稳定规则。
- 安装前明确选择来源，不把 presentation representative 当默认安装 winner。
- 选源后确认页切换到 exact source 的 presentation/version/setup/权限摘要。
- 安装后使用已安装来源，其他来源提示先卸载。
- 所有扩展只展示四种稳定状态。
- 静态 Skill/Plugin 安装后直接可用；有 runtime 的 Plugin/MCP 进入需要设置。
- Marketplace health 与 installed runtime health 分离。
- MCP 卡片直接显示“用于 Agent”或“用于 Agent 和 Convax”。
- 添加 Marketplace 只输入 URL 并显示安全预览。
- 添加/刷新只取 metadata/展示素材，package/companion 下载数和 runtime 进程数为零。
- 移除 Marketplace 不卸载扩展，并明确提示无法更新。
- 用户只看到一个“导入…”。

## 3. Install、setup 和 update

- 三种 kind 从所有合法 source 安装成功。
- install 成功、setup 取消后保留静态安装并显示需要设置。
- 匿名 HTTP MCP 首次连接也必须 setup；OAuth 只作为可选子步骤。
- setup 使用独立 CapabilityTransition。
- “停用”写入 RuntimePreference；重启、source refresh 和同源更新后仍不连接、不启动。
- preference disabled 始终显示“已停用”；grant/完整性异常只显示“启用前需处理”的
  次级提示，不能覆盖用户选择。
- “启用”前重验当前 grant/endpoint/executable；失效时不能绕过重新设置。
- uninstall 删除 RuntimePreference；之后全新安装恢复默认，静态 Skill 不创建该记录。
- 需要重新 setup 的 update 在确认前不发布 candidate package/InstallRecord。
- candidate grant inert；update 失败时旧 current runtime 继续可用。
- 同源更新成功。
- 跨源同 id 更新拒绝。
- 不同 identity 仅在 participant namespaces 不相交时并发。
- Plugin-owned Skill 与同名 standalone Skill 严格串行并冲突。
- modified standalone/owned Skill fail closed。
- source record 与 package publication 对 crash 收敛。
- 用户卸载预装扩展后生成 ProvisioningDecision，启动不重装。
- policy revision 变化不能静默清除用户决定。
- 无关 policy revision 变化保持相同 policyEntryDigest 的 ProvisioningDecision。
- 同 item policyEntryDigest 变化也必须显式清除决定。
- 手动 Tool/Hook Plugin install 的 setup 取消后，静态 package 保留但 executable
  contribution inert。
- Tool/Hook update 改变 authorization contract 时旧 current 继续可用。
- 现有 exact Tool/Hook authorization 迁移只在 manifest/path/size/SHA 全匹配时成功。

## 4. Builtin 和 storyboard

- 完全离线列出并安装 `canvas-storyboard`。
- 仍为 standalone Skill。
- id/version/`SKILL.md` tree 和展示素材不变。
- Convax 仓不存在可漂移的第二份 storyboard 源码。
- modified same-name Skill 不被覆盖。
- bundle 损坏时第三方 same id 仍不能抢占。

## 5. Official 和 ffmpeg

- Builtin bundle 不含 `ffmpeg-tools`。
- product policy 只有 `convax-official/plugin/ffmpeg-tools` 预装项。
- 首版 target 只有 `darwin-arm64`。
- package、owned Skill、companion 摘要完全匹配。
- 缺 target、yanked artifact、size/digest mismatch 使打包失败。
- 预装后自动通过独立 setup transition 写入 ExecutionGrant，首次使用已可用。
- 自动设置不启动 companion，重启幂等，失败 transition 可恢复并重试。
- PATH fallback、Hook、Service、额外 Plugin capability、credential/secret 输入
  或 source/version/target 漂移均 fail closed。
- 其他平台显示不兼容，不 PATH fallback。
- 网络更新只走 `convax-official`。
- Official 刷新不能为不同版本或不同授权面静默换 grant。
- 修改 preinstalled policy 后，未刷新 resolved 时打包失败。
- 显式刷新后 exact closure 可复现。

## 6. Product lock

- Builtin bundle、Official descriptor、Registry、Showcase、package、owned Skill 和
  companion 都有 immutable URL/size/SHA-256。
- policy 与 resolved 一一对应。
- lock 工具不自动增加 preinstalled item。
- packaging 不访问“latest”。
- 相同 Convax commit/lock 重复打包得到相同 Marketplace bytes。

## 7. Local

- headless 测试同时创建两个 Local source。
- 两个 Local 有独立 SourceKey、revision、degraded/recovery/GC。
- clean profile 只创建一个 Local。
- Renderer 无法枚举或选择 Local source。
- 一个 Local 损坏不影响另一个。
- root 丢失且仍被引用时不生成新 sourceInstanceId。
- 三种根标记严格检测 0/1/N。
- Plugin/Skill/MCP Server 一步导入和更新。
- exact duplicate no-op。
- 导入取消、磁盘不足、TOCTOU、symlink、Windows 名称全部 fail closed。
- crash injection 覆盖 snapshot、package、InstallRecord 和 decision。
- 无引用 snapshot 才能 GC。
- Local MCP executable/script 不随 metadata snapshot 执行。

## 8. HTTP MCP

- 含支持的 HTTPS entry 的标准 `server.json` 无 extension 也可在 Agent 使用。
- HTTP profile 经校验必须恰好一个支持的 HTTPS entry；零个不进入 Catalog，多个整项
  拒绝，用户和 Host 都不选择 entry/transport。
- URL template variable、placeholder 或 custom header 使该 entry unsupported；首版
  不出现 URL variable、Header 或 API Key 表单，只支持标准 MCP OAuth 或匿名连接。
- HTTP MCP package 包含 `convax-mcp.json` 时整项拒绝；HTTP 与 managed-stdio
  不能混合为一个安装项。
- HTTP MCP product action declaration 被拒绝。
- OpenCode/Agent Runtime 在真实 socket 强制 outbound policy。
- gate 覆盖 redirect、DNS、IPv4/IPv6、private/metadata address 和 rebinding。
- gate 不通过时所有来源的 HTTP MCP execution 保持关闭。
- OAuth token 不进入 Renderer、Registry、InstallRecord 或日志。
- endpoint/policy 更新需要重新 setup。
- HTTP MCP 禁止 companion。
- source/definition/extension/runtime entry 任一变化时
  `authorizationContractDigest` 变化，旧 grant 不可复用。
- Marketplace 移除后，已安装 HTTP MCP 依据 installed snapshot/records 运行。
- InstallRecord/ExecutionGrant 缺失时连接停用。
- install/update/uninstall 触发 Agent hard refresh 时不持 mutation lock；已运行 prompt
  完成，新 prompt 等待新 generation，session 不丢失。

## 9. Managed stdio MCP

- extension 是必需启动声明。
- Registry target 恰好匹配一个 companion。
- Registry declared command 与 normalized extension command exact match。
- Local executable basename 按平台规则匹配 extension command。
- path separator、Windows reserved command 和动态 argv 拒绝。
- Registry-managed companion 禁止 PATH fallback。
- Desktop 拥有 process、MCP client 和 lifecycle。
- Agent Runtime 只收到 authenticated loopback config。
- Renderer/Agent 不收到 command、argv、cwd、env 或 native path。
- argv 是 extension 固定常量，cwd/environment 由 Host 生成。
- managed-stdio host-injected secret/credential env 首版拒绝。
- Local executable 变化使 ExecutionGrant 失效。
- exact launch snapshot、不经 shell和 process-tree cancellation 通过。
- Product tools 不超过 extension allowlist、Host action schema 和 grants。
- dynamic `tools/list` 不能扩权。
- runtime update 未确认时旧 snapshot 继续可用。

## 10. Registry

- 固定 official `server.json` schema bytes/digest。
- `server.json.name/version` 与 Registry ref exact match。
- raw namespaced name 不进入 native path。
- raw version 不进入 native path；包含 `/`、`..`、Windows reserved name、ADS 或
  trailing dot/space 的合法 schema version 也只能映射为稳定 `versionKey`。
- runtime `serverInfo` 不改变安装 identity。
- 每个 revision 对每个 `{kind,id}` 只有一个 current version。
- duplicate current entry 拒绝。
- unsupported `packages[]` 条目不进入普通 Catalog。
- v1 parser/enum 不变。
- Official v1 projection 不包含 MCP Server。
- 选中 v2 后不自动降级 v1。

## 11. Scaffold

- 从空目录创建 Marketplace。
- create 只生成选中的一种 starter。
- add 自动识别 Plugin、Skill、MCP Server。
- new 分别创建三种模板。
- 作者仓只直接依赖 `@convax/marketplace-kit`。
- MCP starter 默认只有 `server.json`。
- managed-stdio 只通过 `add-target` 导入已经构建的 target binary；不存在手写
  Registry/URL/size/SHA-256 的第二入口。
- companion input 使用 host-generated item key 和固定 target/command 布局，Kit
  将其作为 inert bytes、排除出静态 package ZIP，并生成独立 Release artifact。
- 缺 target input、同 target 多 input、command mismatch 和 symlink 全部使 check
  失败；PR job 不执行 companion。
- 相同输入产生相同 ZIP、Registry 和 digest。
- 第三方输出只有 v2。
- Official CI 生成严格 v1 projection。
- 普通分支/PR 只 check；默认分支 version 变化才发布。
- 无官方仓库硬编码。
- workflow 满足最小权限和 inert-content 要求。

## 12. Recovery 和 security

- crash 前后只出现 previous 或 next 完整状态。
- canonical package 未确定时不恢复依赖 record。
- outer transition 不与现有 package/Skill decision 竞争。
- rollback rename 失败进入 recovery-required。
- pending identity 不进入 inventory/discovery/runtime。
- 缓存损坏不删除安装。
- source removal 保留安全 runtime、禁止更新。
- static legacy-unbound 可保留；MCP/Hook/Tool/product action fail closed。
- cache hit 和 launch 前重复 exact artifact verification。
- URL/DNS/redirect/private address adversarial fixtures 通过。
- archive/path/Windows/symlink/TOCTOU fixtures 通过。
- OAuth token、raw URL/header/command/path 不过 preload。
