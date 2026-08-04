# Convax 多 Marketplace 实施说明

状态：随
[主方案](2026-07-27-multi-capability-marketplace-design.md)
一起待最终确认。本文只供开发排期和依赖审阅使用。

工程协议见
[工程附录](2026-07-27-multi-capability-marketplace-engineering-appendix.md)。

## 1. 仓库归属

Convax：

```text
packages/marketplace/                 # @convax/marketplace
packages/marketplace-kit/             # @convax/marketplace-kit
packages/create-convax-marketplace/   # create CLI
```

`convax-plugins`：

```text
packages/plugins/*
packages/skills/*
packages/mcp-servers/*
catalogs/*
```

原则：

- Convax 拥有协议、validator、host 和通用 authoring tooling。
- `convax-plugins` 拥有具体 Plugin、Skill、MCP Server、Official Registry 和 Builtin
  bundle。
- Official 仓 dogfood 发布后的 Kit，不复制 schema、validator、ZIP writer 或
  Registry builder。
- 第三方生成仓只直接依赖 `@convax/marketplace-kit`。

工具依赖方向：

```text
@convax/marketplace -> no Convax package
@convax/marketplace-kit -> @convax/marketplace
create-convax-marketplace -> @convax/marketplace-kit
```

## 2. npm 复用

开发时优先评估并 exact pin：

| 能力 | 候选 |
| --- | --- |
| JSON Schema | `ajv` |
| Canonical JSON | `canonicalize` |
| CLI 参数 | `cac` |
| IP 分类 | `ipaddr.js` |
| 既有 Plugin/Skill SemVer | `semver` |

使用门禁：

- schema 由 Host/Kit 固定，不编译 Marketplace 下载的任意 schema；
- Ajv strict，关闭 coercion/default/removeAdditional；
- MCP Server version 遵循官方 schema，不引入 SemVer range；
- CLI 同时支持完整非交互参数和 CI；
- 复核 license、provenance、维护状态、安全公告、Bun/Node/Electron 兼容和
  postinstall/native addon；
- 依赖写入对应 workspace package 和 lockfile，不能依赖 hoist。

仅在 spike 通过后采用：

| 候选 | 限定用途 |
| --- | --- |
| `cacache` + `ssri` | 非权威 artifact/showcase cache |
| `tuf-js` | Future signed Marketplace |
| `undici` custom dispatcher | Future arbitrary same-origin delivery |
| `pacote` + `ssri` | Future exact npm artifact delivery |
| prompt library | CLI 确实需要 TTY 向导时 |

现有确定性 ZIP writer 与 Desktop `safe-zip` 首版保留。通用 archive 解包 API 不处理
Desktop 不可信输入。

以下始终由 Convax 拥有：

- source trust 和 repository/origin policy；
- safe extraction；
- Local immutable snapshot；
- authoritative fsync/CAS persistence；
- CapabilityTransition；
- Plugin-owned Skill ownership；
- ExecutionGrant；
- verified launch/process-tree ownership；
- cross-Marketplace conflict。

## 3. Scaffold

作者命令：

```text
npx create-convax-marketplace
bun marketplace add <directory>
bun marketplace new plugin|skill|mcp-server
bun marketplace add-target <mcp-directory> --target <platform-arch> --file <binary>
bun marketplace check
git push
```

普通分支/PR 只 check。只有扩展 version 变化的提交合入默认分支才触发 CI release；
流水线生成 tag、Registry、Showcase 和 Release artifact。

生成仓至少包含：

- 作者选择的一种 starter；
- add/new/check scripts；
- HTTP-only MCP 默认模板；managed-stdio 才使用 add-target；
- frozen lockfile；
- 最小权限 CI；
- Pages 与 Release workflow；
- README、CONTRIBUTING、SECURITY、LICENSE。

供应链门禁：

- install 忽略 lifecycle scripts；
- package 内容始终作为 inert bytes；
- GitHub Actions 固定完整 commit SHA；
- 最小 permissions；
- PR job 不读取 secrets；
- 禁止 `pull_request_target` 执行 PR checkout/content；
- 发布使用 protected branch/tag/environment；
- 高权限发布 job 只消费低权限 job 已验证的 exact digest artifact；
- repository、Pages、Release 和 API URL 全部参数化；
- 不出现未替换的旧仓库身份硬编码。

`add-target` 是第三方 managed-stdio companion 的唯一输入方式。它把已构建、已校验
的 regular file 收入 scaffold-owned
`.marketplace/companion-inputs/<host-generated-item-key>/<target>/<command>`；作者不
手写或维护该目录。Kit 将这些 inert bytes 排除在静态 MCP package ZIP 外，生成独立
Release asset，并独占生成 target URL、size 和 SHA-256。PR/check 不执行 binary。

## 4. 实施顺序

1. Convax：建立 `@convax/marketplace`，固定 schema、refs、聚合和来源冲突。
2. Convax：建立 Kit/create CLI，并以临时仓库做端到端测试。
3. `convax-plugins`：接入 Kit，生成 Registry v2、Official v1 projection 和
   Builtin bundle。
4. Convax Desktop：接入 Builtin、Official、第三方 Network 和 Local adapters。
5. Convax Desktop：统一 Catalog、Settings、导入、InstallRecord 和来源锁。
6. Convax Desktop/Agent Runtime：接入 HTTP MCP，并完成 socket outbound-policy gate。
7. Convax Desktop：接入 managed stdio、setup、loopback 和恢复。
8. 两仓：接入 storyboard、product lock 和 ffmpeg 预装。
9. 完成打包、迁移、跨平台和 crash-injection 验收。

每一步独立审阅，不把协议、UI、Local、MCP runtime 和发布流水线塞进一个提交。

## 5. 架构 admission

开发必须同步修改：

- 根 `AGENTS.md`；
- `docs/architecture.md`；
- `packages/desktop/AGENTS.md`；
- `packages/agent-runtime/AGENTS.md`；
- `packages/marketplace/AGENTS.md`；
- `packages/marketplace-kit/AGENTS.md`；
- `packages/create-convax-marketplace/AGENTS.md`；
- package boundary checker；
- persistence map；
- Desktop protocol version 和 compatibility tests。

三个新增 package 都必须具备：

- package-local build/clean/typecheck/test/prepack/prepublishOnly；
- compiled `dist` exports；
- 无 Desktop/Electron/monorepo-private import；
- real tarball external-consumer smoke；
- 显式、最小 runtime dependencies。

Kit/create CLI 是 authoring-time Node/Bun 工具，不进入 Desktop 或 Renderer runtime。
Kit 需要真实 tarball external-consumer smoke；create CLI 需要从 packed tarball 启动的
临时目录 CLI/scaffold smoke。三个 package 都进入 boundary checker 和 pack check。

## 6. Repository gates

Convax：

- affected package `bun typecheck`；
- affected package `bun test`；
- root `bun check`；
- package boundary check；
- external-consumer pack smoke；
- Desktop build；
- packaged smoke。

`convax-plugins`：

- frozen install；
- workspace build/typecheck/test；
- validate；
- companion build；
- pack/build-index；
- immutable bundle；
- scaffold temporary-repository end-to-end test。
