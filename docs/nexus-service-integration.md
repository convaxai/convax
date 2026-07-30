# Nexus Service 接入方案

状态：MVP 核心链路已实现，并已完成本地打包应用、全新用户注册和真实 OpenRouter
推理的端到端验收。本方案同时记录当前实现基线和后续正式发布要求；Nexus 仍然不是
Convax 的内置依赖。

关联文档：

- `docs/architecture.md`
- Nexus `docs/HOSTED_AUTH.md`
- Nexus `docs/TECHNICAL_ARCHITECTURE.md`
- Nexus `packages/contracts/data.openapi.yaml`

## 1. 核心决策

Convax 把 Nexus 展示为一个与内置 OpenCode Service 并列的已安装 **Service**。具体集成由 `microvoid/convax-plugins` 仓库中的官方 Plugin 和经过验证的 Companion 实现；Convax 主仓只提供任何 Service 都可以复用的通用宿主能力。

Nexus Service 负责：

- 通过 Nexus Hosted Auth 登录用户；
- 把 Nexus 支持的 LLM 模型目录接入现有 Agent 模型选择器；
- 展示已连接账号、凭据状态、剩余额度和用量；
- 展示 Nexus 返回的当前 Plan、订阅状态和允许购买的 Plan；
- 通过宿主管理的固定 Checkout 操作在系统浏览器完成升级；
- 运行一个仅 Main 进程可见的本地 OpenAI-compatible Gateway；
- 获取短期 Nexus Data Token，并将其附加到 Gateway 请求；
- 确保 Nexus 凭据和上游 Provider 凭据不会暴露给 Renderer、OpenCode、Canvas 文档、Project 文件或日志。

Nexus 始终是可选的已安装 Service。内置 OpenCode Service 继续独立工作。

## 2. 产品体验

现有的 Settings > Services 页面是该能力的唯一产品入口。安装 Nexus Plugin 后，Service 列表中新增一张 Nexus 卡片。

连接成功后的布局沿用现有卡片结构：

```text
Nexus · OpenRouter               Connected        Free
通过 Nexus 安全访问 OpenRouter 模型。

ACCOUNT                         CREDENTIAL
Convax                          Configured · verified

PLAN                            SUBSCRIPTION
Free · monthly                  No active subscription

CREDITS                         USAGE
剩余 0.9988 USD                 已用 0.0012 USD

Capabilities
LLM

Models
OpenRouter 当前可用模型…

                         [Upgrade to Pro] [Sign out]
```

Plan、订阅和可升级目录全部来自 Nexus 的权威 User API。Convax 不通过额度单位、账号名称或模型名称
推断套餐，也不持有价格、Provider Product ID 或支付凭据。

### 2.1 未连接状态

卡片展示：

- Service 名称和说明；
- `Disconnected` 或“需要登录”状态；
- `LLM` 能力；
- 一份有界的模型目录；未登录时可以禁用；
- 一个 `Sign in with Nexus` 操作。

用户选择登录后，系统浏览器打开：

```text
https://nexus.microvoid.io/workspace/convax/auth/sign-in
```

正式产品流程不提供 Renderer 内嵌登录表单，也不提供手工填写 API Key 的输入框。

### 2.2 已连接状态

卡片只接受破坏性升级后的 `convax.plugin-service-status/2` 投影：

- `account.displayName`：Nexus 账号邮箱或显示名称；
- `credential.configured`：本地是否存在可用的 Refresh Grant；
- `credential.verification`：最近一次有界的验证结果；
- `credits.remaining`：当前剩余 AI Budget，以 USD 展示；
- `usage.consumed`：当前周期已使用 AI Cost，以 USD 展示；
- `plan`：Nexus 当前有效 Plan 的 Key、名称和月付/年付周期；
- `billing.subscriptionStatus`：可选的权威订阅状态；
- `billing.checkout.plans`：当前 Workspace 配置允许购买的有界 Plan 目录；
- `billing.checkout.pending`：当前 Checkout 的有界状态；
- `state`：`connected`、`attention`、`disconnected` 或 `unknown`。

`service.status` v1 不再兼容；仍返回 v1 的旧插件会被宿主拒绝。Nexus Companion 从当前
ProviderConnection 的 `/models` 读取 OpenRouter 运行时目录，模型 ID 保持不透明。Agent Runtime
刷新配置后，同一目录同时出现在 Nexus Service 卡片和现有 Agent 模型选择器中。Manifest 中的
`deepseek/deepseek-v4-flash` 仅作为运行时目录暂不可用时的静态回退项。

### 2.3 需要关注的状态

卡片至少需要区分以下场景，但不能直接向 Renderer 转发上游原始诊断信息：

| 场景                       | Service 状态   | 用户操作           |
| -------------------------- | -------------- | ------------------ |
| Refresh Grant 过期或被撤销 | `attention`    | 重新登录           |
| WorkspaceAccess 被暂停     | `attention`    | 联系支持或管理账号 |
| Quota 耗尽                 | `attention`    | 等待重置或升级套餐 |
| Nexus 暂时不可用           | `unknown`      | 重试               |
| 用户已退出登录             | `disconnected` | 登录               |

首版可以使用固定错误类别关联的宿主本地化文案表达具体原因。不能把 Sidecar 返回的任意错误文本直接传给 Renderer。

### 2.4 Plan 与 Hosted Checkout

用户点击 `Upgrade to {Plan}` 后只把经过 v2 状态目录验证的 `planKey` 传给固定
`service.checkout` Tool。Nexus 从 User Access Token 推导 Workspace、WorkspaceAccess、
BillingConnection、Product Mapping 和固定 Success URL；客户端不能覆盖这些参数。

Sidecar 返回的 Checkout URL 仅进入 Desktop Main。Main 严格校验
`convax.plugin-service-checkout/1`、Checkout ID 和规范 HTTPS URL，再用系统浏览器打开；
Preload 和 Renderer 都看不到 URL。相同 Access/Plan 的未完成尝试持久化同一个
Idempotency-Key，避免进程重启或网络重试产生重复 Checkout。

支付结果只能由 Nexus 的签名 Webhook 投影改变 Access/Plan。浏览器完成页和 Convax 返回前台后的
刷新只读取状态，不能提前授予套餐。

## 3. 目标与非目标

### 3.1 目标

- Convax 用户可以直接从 Desktop 通过 Nexus 完成认证。
- 复用一个全局唯一的 Nexus Workspace Slug：`convax`。
- 每个用户拥有独立授权的 `WorkspaceAccess` 和 Quota。
- Agent LLM 流量通过 Nexus ProviderConnection 转发。
- 保持流式传输、背压和取消语义。
- 所有长期或短期 Nexus 凭据均不进入 Renderer 和 OpenCode。
- 具体 Nexus 行为留在 Convax 主仓之外。
- OpenCode 和 Nexus 两个 Service 可以同时存在。

### 3.2 非目标

- 在 Convax 中嵌入 Nexus Management Key。
- 允许 Desktop 创建 Organization、Workspace、Plan 或 Provider Secret。
- 为每个 Convax 用户创建一个 Nexus Workspace。
- 允许 Desktop 向 Nexus 传入客户端选择的上游 Host。
- 在 Convax 中实现模型映射、Fallback、定价或路由逻辑。
- 将 Nexus Token 持久化到 Project、Canvas 文档或普通 Preferences。
- 替换现有 OpenCode Service。
- 在 Convax 内部实现 Nexus Hosted Auth。

## 4. 职责归属

### 4.1 Nexus 仓库

Nexus 负责：

- 全局唯一的 Workspace Slug `convax`；
- Hosted Auth 页面和 Authorization Code + PKCE；
- Redirect URI 的注册和校验；
- Better Auth 用户身份；
- `WorkspaceAccess`、Plan、QuotaPeriod 和 Billing 状态；
- User Access Token、轮换的 Desktop Refresh Token 和 Data Token；
- ProviderConnection 的 Workspace 归属校验；
- Gateway 授权、Quota Reserve 和 Usage Settlement；
- Hosted Checkout 和签名 Billing Webhook 投影。

Nexus 是“用户身份到 Access 绑定关系”和 Quota 的事实来源。Convax 不能根据本地状态重建这些授权事实。

### 4.2 Convax 仓库

Convax 只负责通用平台能力：

- 已安装 Service 和 LLM Contribution 的校验与生命周期；
- 适用于 OAuth Loopback 的通用外部浏览器授权 Broker；
- Plugin 级安全凭据库；
- 固定、Renderer-safe 的 Service 操作和有界状态投影；
- Service 凭据变化后刷新存活的 Agent 配置；
- Services 页面和 Agent 模型选择器。

任何 Convax 核心模块都不能根据 Nexus Plugin ID、Nexus 域名、Nexus 错误码或 Nexus 模型名称进行分支。

### 4.3 Convax Plugins 仓库

`microvoid/convax-plugins` 仓库负责：

- Nexus Service Plugin Manifest 和资源；
- 经过验证的 Nexus Companion 可执行文件；
- PKCE 生成和 OAuth Transaction 状态；
- Nexus Token Exchange 和 Refresh 编排；
- Data Token 获取；
- 本地 OpenAI-compatible Gateway；
- 将 Nexus 特有错误收敛为固定 Service 状态；
- OpenRouter 运行时模型目录与静态回退模型。
- Service Status v2 的 Plan/Checkout 投影与可重试 Checkout 尝试。

建议的包结构：

```text
packages/plugins/nexus-service/
packages/tools/nexus-mcp/
```

这些名称仅作为方案建议，创建包时仍需单独评审。

## 5. 身份与配置

接入涉及以下标识和凭据：

| 值                           | 所有者                | 敏感性         | 首版来源           |
| ---------------------------- | --------------------- | -------------- | ------------------ |
| Workspace Slug `convax`      | Nexus                 | 公开           | Plugin 配置        |
| Hosted Auth Origin           | Nexus                 | 公开           | Plugin 配置        |
| Gateway Origin               | Nexus                 | 公开           | Plugin 配置        |
| ProviderConnection ID        | Nexus Workspace       | 公开但有作用域 | Plugin 配置        |
| OAuth State 和 PKCE Verifier | Companion             | 敏感、临时     | 进程内存           |
| Authorization Code           | Nexus/Companion       | 敏感、一次性   | Loopback Callback  |
| User Access Token            | Companion             | 敏感、短期     | 进程内存           |
| Desktop Refresh Token        | Nexus 用户授权        | 敏感、长期     | Companion 凭据文件 |
| Data Token                   | Nexus WorkspaceAccess | 敏感、短期     | 进程内存           |
| 本地 Gateway Key             | Companion             | 敏感、进程级   | 进程内存           |
| Provider API Key             | Nexus Workspace       | 敏感           | 仅 Nexus 保存      |
| Management Key               | Nexus Control Plane   | 敏感           | 永不进入 Convax    |

MVP 不在 Plugin 中硬编码 ProviderConnection ID。Companion 在登录后通过
`GET /user/v1/provider-connections` 读取当前 `convax` Workspace 中可用的连接，并选择服务端返回的
OpenRouter 连接。ProviderConnection ID 只负责在 Token 所属 Workspace 内选择上游；它不能替代授权，
也不能允许客户端指定任意上游 URL。

当前本地 MVP 将 Refresh Token 保存到
`~/.config/convax/service-credentials/nexus-service.json`（目录权限 `0700`、文件权限 `0600`，原子替换）。
文件不包含 Provider API Key、Management Key、Data Token 或本地 Gateway Key。正式发布前仍应迁移到
操作系统 Credential Vault。

## 6. 认证与 Token 流程

### 6.1 依赖的 Nexus 契约

当前实现使用以下 Nexus Hosted Auth 与 User API 契约：

```text
GET  /workspace/{workspaceSlug}/auth/sign-in
GET  /workspace/{workspaceSlug}/auth/sign-up
POST /workspace/{workspaceSlug}/auth/authorize
POST /workspace/{workspaceSlug}/auth/token
POST /workspace/{workspaceSlug}/auth/revoke

GET  /user/v1/me/access
GET  /user/v1/me/quota
GET  /user/v1/provider-connections
POST /user/v1/data-tokens
POST /user/v1/billing-checkouts
GET  /user/v1/billing-checkouts/{checkoutId}
```

Desktop 使用带 PKCE `S256` 的 Authorization Code。Callback 必须是精确注册的 Loopback Redirect，例如：

```text
http://127.0.0.1:{ephemeralPort}/oauth/callback
```

Nexus 必须根据 Desktop Public Client 策略校验完整 Redirect URI。Companion 必须校验 `state`、只兑换一次 Code，并在完成后关闭 Listener。

### 6.2 登录时序

```text
用户
  -> Convax Services：选择 Sign in with Nexus
  -> Nexus Companion：创建 State、Verifier、Challenge 和 Loopback Listener
  -> Convax Main：校验 Hosted Auth URL，并使用系统浏览器打开
  -> Nexus Hosted Auth：认证用户并授权 convax Workspace
  -> Companion Loopback：接收 Code 并校验 State
  -> Nexus Token Endpoint：使用 Code + Verifier 换取 Token
  -> Companion 凭据库：只持久化轮换的 Refresh Token
  -> Nexus User API：读取 Access 和 Quota
  -> Convax Service 卡片：进入 Connected 状态
  -> Agent Runtime：刷新配置并连接 Nexus LLM Provider
```

如果用户取消、超时、Plugin 发生变化或应用退出，Main 必须取消授权，Companion 必须关闭 Callback Listener。中断的授权不能留下部分凭据。

### 6.3 Token 使用

- 只有在需要刷新 User Access Token 时，才从 Companion 凭据库读取 Refresh Token。
- User Access Token 和 Data Token 只保存在 Companion 内存中。
- Companion 对并发 Refresh 执行 Single-flight。
- Nexus 在签发或刷新 Data Token 前，重新校验 WorkspaceAccess 和当前 Quota 策略。
- Companion 可以在收到认证过期响应后最多重试一次；不能重试 Quota 失败或任意 Provider 错误。

### 6.4 退出登录

```text
用户
  -> Convax Services：选择 Sign out
  -> Companion：撤销 Nexus Refresh Grant
  -> Companion 凭据库：删除 Plugin 凭据
  -> Companion：清除内存中的 User Access Token 和 Data Token
  -> Companion：停止本地 Gateway
  -> Agent Runtime：刷新配置
  -> Convax Service 卡片：进入 Disconnected 状态
```

即使远端撤销暂时不可用，本地删除也必须完成；但状态不能错误地声称远端撤销已经成功。

## 7. Convax 通用宿主扩展

### 7.1 现有浏览器授权流程为什么不能复用

当前 `convax.plugin-service-browser-authorization/1` 流程被有意限制为：在隔离的 Electron Session 中，从一个规范 HTTPS Origin 捕获明确 Allowlist 的 Cookie。

Nexus Hosted Auth 使用系统浏览器、Authorization Code、PKCE 和 Loopback Callback。强行复用 Cookie 契约会混淆两种不同的信任模型，并削弱双方的安全约束。

### 7.2 外部浏览器授权

新增一个独立版本的通用授权请求，暂定为：

```text
convax.plugin-service-external-authorization/1
```

Sidecar 只能返回以下有界字段：

```json
{
  "schema": "convax.plugin-service-external-authorization/1",
  "authorization_id": "opaque-bounded-id",
  "authorization_url": "https://nexus.microvoid.io/workspace/convax/auth/sign-in?...",
  "timeout_seconds": 300
}
```

必须满足以下约束：

- 已安装 Manifest 显式声明允许的 HTTPS Authorization Origin；
- Main 在打开 URL 前校验规范 URL 和精确 Origin；
- Renderer 永远不会收到该 URL；
- Sidecar 返回请求前必须已经启动 Loopback Listener；
- PKCE Verifier、State、Callback Code 和 Token 都不能跨过 Preload；
- Completion Method 必须是进程内的一次性 Closure，并绑定到精确的 Plugin Manifest、可执行文件快照和 MCP Client；
- 取消操作固定且由宿主管理；
- Plugin 被替换、更新或卸载时，当前 Transaction 立即失效。

Completion 调用只携带 Authorization Transaction ID。Loopback Response 和 Code Exchange 都由 Sidecar 负责，Main 和 Renderer 不接触 Authorization Code。

这是一项通用扩展。其他经过验证的 Service 也可以使用它，不需要增加 Provider 特有的宿主逻辑。

### 7.3 Plugin 级 Credential Vault

Desktop Main 应提供一个由操作系统 Credential Store 支持的通用凭据库端口。

每条记录的作用域包括：

- 当前应用；
- 精确的已安装 Plugin Principal；
- 有界、由宿主管理的 Record Name；
- 当前本地用户。

该能力只提供固定的 `get`、`set` 和 `delete` 操作，并限制 Value 大小。Value 永远不能跨过 Preload，也不能被其他 Plugin 读取。

Plugin 发布内容变化时，不能未经显式兼容策略和重新授权，就把旧凭据静默交给新的可执行代码。

明文 JSON 文件、Project Storage、`localStorage` 和普通 Preferences 都不能用于保存 Refresh Token。

### 7.4 Agent 配置刷新

Plugin 安装变化已经会调用 `agentRuntime.refreshConfiguration()`。以下凭据生命周期变化也必须调用：

- `authorize` 成功；
- `reauthorize` 成功；
- `signOut` 完成；
- Service Host 检测到凭据失效。

刷新行为属于通用 Service 生命周期组合，不能通过检查 Nexus Plugin ID 实现。

## 8. Nexus Companion

### 8.1 Contribution

Plugin 同时贡献一个 Service 和一个 LLM Provider：

```text
service:
  actions: authorize, reauthorize, authorization.cancel, checkout, sign_out

llm:
  provider: Nexus · OpenRouter
  modelCatalog: runtime
  models:
    - id: deepseek/deepseek-v4-flash
      name: DeepSeek V4 Flash
```

`models` 保留一个静态回退项。`modelCatalog: runtime` 明确要求 Host 通过通用
固定 Tool 获取运行时目录；这不是 Nexus Plugin ID 特判。模型 ID 仍保持不透明，
Host 只做数量、长度、字符和重复项边界校验，不做映射、价格解析、路由或 fallback。

### 8.2 固定 MCP Tool

Companion 实现现有固定 Service Tool 和 LLM Gateway 启动 Tool：

```text
service.status
service.authorize
service.reauthorize
service.authorization.complete
service.authorization.cancel
service.checkout
service.sign_out
llm.models.list
llm.gateway.start
```

不能把任意 OAuth Method、Token Payload 或 Checkout URL 暴露为 Renderer 操作。

`service.checkout` 只接受 `{ "plan_key": "..." }`，且该 Key 必须存在于最近一次 v2 Status
公布的可购买 Plan 中。返回值固定为：

```json
{
  "schema": "convax.plugin-service-checkout/1",
  "checkout_id": "opaque-bounded-id",
  "checkout_url": "https://checkout-provider.example/session/..."
}
```

结果只由 Main 校验和消费。Main 打开系统浏览器后立即刷新 Status；应用重新获得焦点时再次刷新，
从而观察 Webhook 投影后的当前 Plan。

`llm.models.list` 无输入，返回：

```json
{
  "schema": "convax.llm-model-catalog/1",
  "models": [{ "id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4" }]
}
```

Companion 使用当前短期 Data Token 访问
`{gatewayBaseUrl}/models`。Nexus 继续按普通 Provider Path 代理到 OpenRouter，
目录响应不携带 Provider Key。Convax Main 将目录限制为最多 2048 个模型，并把
验证后的结果同时提供给 OpenCode 内存配置和 Nexus Service 卡片；Renderer 不接收
Gateway URL、Data Token 或上游凭据。

### 8.3 本地 OpenAI-compatible Gateway

`llm.gateway.start` 返回一个仅 Main 可见的 Descriptor，其中包含：

- 随进程生成的随机 Bearer Key；
- 一个 `127.0.0.1` OpenAI-compatible Base URL。

本地 Server 必须：

- 只绑定 Loopback；
- 使用 Constant-time Comparison 校验随机本地 Key；
- 接受 Agent Runtime 所需的 OpenAI-compatible Path；
- 将不透明的 Method、Query 和 Request Body 转发到：

  ```text
  https://gateway.nexus.microvoid.io/providers/{providerConnectionId}/{providerPath...}
  ```

- 使用短期 Data Token 替换本地 Authorization Header；
- 保留支持的响应状态、Content-Type 和 Streaming 行为；
- 将取消信号传播到上游；
- 移除 Hop-by-hop Header 和内部 Header；
- 对 Header 和 Body 设置上限；
- 不记录 Prompt、Completion、Cookie 或 Token。

OpenCode 只能得到本地 Base URL 和随机本地 Key，不能得到 Nexus Token 或上游 Provider Secret。

## 9. 错误收敛

Companion 在向 Convax 返回状态前，将 Nexus 响应映射为固定内部类别：

| Nexus 场景                 | Companion 类别              | Convax 行为                |
| -------------------------- | --------------------------- | -------------------------- |
| Refresh Token 无效或被重用 | `reauthentication_required` | 停止 Gateway，提示重新登录 |
| Access 被暂停或过期        | `access_unavailable`        | 停止新推理，展示 Attention |
| Quota 耗尽                 | `quota_exhausted`           | 不重试，展示 Attention     |
| ProviderConnection 不可用  | `provider_unavailable`      | 展示服务不可用             |
| Nexus Timeout/5xx          | `temporarily_unavailable`   | 有界重试或由用户重试       |
| Provider 4xx/5xx           | `provider_response`         | 保留安全的 API 语义        |

未知错误默认关闭能力。上游原始响应 Body 不能作为 Service Status 诊断信息，也不能跨过 Preload。

## 10. 分阶段实施

### Phase 0：内部 Gateway 验证（已完成代码）

目标：验证传输兼容性，但不声称已经具备正式登录流程。

- 配置 `convax` Workspace、Plan 和一个 ProviderConnection。
- 在可信 Admin 环境为测试用户创建专用 WorkspaceAccess。
- 在生产 UI 之外，将其 Inference Key 写入测试机器的 OS Credential Store。
- 使用一个固定 ProviderConnection 和静态模型目录实现 Nexus Plugin 本地 Gateway。
- 验证 Streaming、取消、Quota Header 和错误传播。

Plugin 永远不使用 Management Key。该阶段只用于内部验证，正式发布前必须删除 Inference Key Bootstrap。

### Phase 1：Nexus Hosted Auth（已完成代码）

- 实现并发布 Hosted Auth 和 User API 契约。
- 配置 `convax` Workspace、Redirect Policy 和默认 Free Plan。
- 实现轮换的 Desktop Refresh Token 和短期 Data Token。
- 验证 Access 暂停、Quota 耗尽、退出登录和 Token 重用检测。

### Phase 2：Convax 通用授权支持（已完成代码）

- 增加 External-browser Authorization 契约和 Electron Adapter。
- 增加 Companion 隔离凭据存储；正式发布前迁移到 Plugin 级 OS Credential Vault。
- 在凭据生命周期变化后刷新 Agent 配置。
- 补充契约、Main、Preload 隔离和生命周期测试。

### Phase 3：正式 Nexus Service（MVP 已实现并完成本地真实验收）

- 使用 Hosted Auth 替换内部 Key Bootstrap。
- 发布 Nexus Service Plugin 和经过验证的 Companion。
- 接入 Status、Quota 和 Account 展示。
- 已完成 Packaged Desktop 和真实 Provider 验证；跨平台 Credential Store 验证仍属于正式发布要求。

### Phase 4：Billing 和动态目录（已完成代码）

- Service Status 破坏性升级到 v2，所有 Service 插件必须显式返回 `plan` 和 `billing`。
- 增加固定、由宿主管理的 `checkout` 操作；URL 只在 Main 中校验和打开。
- Nexus Hosted Auth 配置选择 BillingConnection 和允许购买的 Plan。
- User Checkout 只接受 Plan Key 和 Idempotency-Key，其他支付参数由 Nexus 推导。
- Nexus Companion 动态读取当前 OpenRouter 模型目录。

正式发布前仍需补充支付 Provider Test Mode 的完整人工验收、Webhook 延迟/乱序场景和跨平台
系统浏览器回跳验证。

## 11. 验证

### 11.1 Convax Core

- 如果 External Authorization URL 的精确 HTTPS Origin 未被已安装 Plugin 声明，则拒绝打开。
- URL、Callback Code、Verifier 和 Token 不会进入 Preload 或 Renderer。
- Authorization Completion 绑定到精确的已安装 Plugin 快照。
- 取消、超时、Plugin 更新和应用退出都会关闭 Transaction。
- 不同 Plugin 的 Credential Record 相互隔离。
- `authorize`、`reauthorize` 和 `signOut` 会刷新 Agent 配置。
- OpenCode 和 Nexus 是两个相互独立的 Service Catalog Entry。
- Core Source 不根据 Nexus Plugin ID 进行分支。
- Status v1 被明确拒绝；Status v2 缺少 Plan/Billing 或包含额外字段时失败关闭。
- Renderer 只能选择 Status v2 公布的 Plan Key，不能传入 Checkout URL 或支付参数。
- Checkout URL 只在 Main 中按固定 Schema 和规范 HTTPS 规则校验并打开。

### 11.2 Nexus Companion

- 本地 Gateway 只绑定 `127.0.0.1`，并要求随机 Key。
- PKCE 使用 `S256`；State 不匹配和重放默认失败。
- Refresh 和 Data Token 请求执行 Single-flight。
- 只有 Refresh Token 可以持久化。
- Data Token 不会返回给 OpenCode 或 Renderer。
- Streaming、背压和取消可以端到端工作。
- 认证过期最多重试一次。
- Quota 和 Provider 失败不会被错误重试。
- 日志中不包含 Prompt、Completion、Token、Cookie 或 Provider Secret。
- Checkout 重试复用同一 Idempotency-Key，持久化记录不包含 Access Token 或 Checkout URL。
- 当前 Plan 与可购买 Plan 只来自 Nexus 的复合 Access 响应。
- AI Budget 优先读取 Nexus 的 `availableUsd`/`consumedUsd`；滚动升级期间仅将旧
  micro-USD Units 字段换算为 USD，不直接展示原始整数。

### 11.3 Nexus

- 两个 Convax 用户在同一个 `convax` Workspace 中获得不同的 WorkspaceAccess 和 Quota 状态。
- Authorization Code 一次性使用，并绑定 Client、Redirect URI 和 PKCE。
- Refresh Token 轮换和重用检测会撤销 Grant。
- Data Token 生命周期短，并绑定预期 WorkspaceAccess。
- Hosted Auth 被禁用或 Access 被暂停后，不能继续签发新 Token。
- ProviderConnection 必须属于 Token 对应的 Workspace。
- Gateway Reserve 和 Settlement 继续以 PostgreSQL 为权威来源。
- Hosted Auth 配置中的 BillingConnection 和 Checkout Plan 必须属于同一 Workspace。
- User Checkout 不能接收 WorkspaceAccess、BillingConnection、Product、金额或 Success URL。
- Checkout 状态只能读取当前 User Access Token 所属 Access 的 Session。

### 11.4 端到端验收

- 新用户不需要输入 API Key，即可从 Convax 完成登录。
- Nexus 卡片进入 Connected 状态，并显示有界的账号和 Quota 状态。
- 不重启 Convax，Nexus 模型即可出现在 Agent 模型选择器中。
- 用户可以完成一次 Streaming Agent 请求，也可以中途取消。
- 第二个用户不能消耗第一个用户的 Quota 或读取其凭据。
- Quota 耗尽后拒绝新推理，并显示可操作的 Service 状态。
- Free 用户可以看到 Nexus 返回的 Pro Plan，点击 Upgrade 后由系统浏览器打开 Hosted Checkout。
- 浏览器先返回时仍显示 Processing；只有签名 Webhook 投影完成后当前 Plan 才变更。
- Checkout 失败、取消、过期或重复点击不破坏现有 Access，也不创建重复支付会话。
- 退出登录会删除本地凭据，并使 Nexus 模型不可用。
- 重启 Convax 后，可以恢复仍有效的登录状态，且凭据不会暴露给 Renderer；正式发布包还要验证
  OS Credential Vault 迁移。

## 12. 首版建议决策

如果产品需求没有变化，首版实现采用：

- Workspace Slug：`convax`；
- 一个 Nexus OpenRouter ProviderConnection；
- OpenRouter 运行时模型目录，`deepseek/deepseek-v4-flash` 仅作为静态回退；
- 系统浏览器 + Loopback Callback；
- Service Status v2 是唯一受支持的状态契约，不兼容 v1；
- Nexus User API 返回当前 Plan、Quota、订阅状态和允许购买的 Plan；
- Checkout 由固定宿主操作打开系统浏览器，支付结果由 Nexus Webhook 投影；
- 客户端不包含 Management Key，也不提供生产环境手工 API Key 输入框；
- ProviderConnection 由 Nexus User API 按 Workspace 授权返回。

Nexus Hosted Auth、User API、Data Token、Convax 通用外部浏览器授权、Service Status v2、
Hosted User Checkout 和 Nexus Companion 的核心代码均已实现。真实 OpenRouter 请求、全新用户注册
和打包桌面环境已经完成此前本地验收。Hosted Checkout 的支付 Provider Test Mode 人工流程、
OS Credential Vault、跨平台构建，以及 Webhook 延迟/乱序、多用户隔离等逆向场景仍是正式发布前的验收项。

## 13. 当前实现落点

三个仓库的职责和代码落点如下：

| 仓库             | 实现                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `nexus`          | Hosted Auth、复合 Access/Plan API、User Checkout、配置 Allowlist、Data Token、Billing 投影            |
| `convax`         | 通用 Status v2/Checkout Host、External-browser Broker、Electron Adapter、Service UI、Agent 配置刷新   |
| `convax-plugins` | Nexus Manifest/Companion、PKCE/Loopback、Token 轮换、Plan 投影、Checkout 重试、本地 Gateway、模型目录 |

本地联调时，由 Nexus Bootstrap 从标准输入读取 OpenRouter Provider Key，通过既有 Provider Secret
加密路径保存，并创建或轮换 `convax` Workspace 的 OpenRouter ProviderConnection。Key 不写入命令行、
源码、Git、日志、Plugin、Convax Preferences 或 Companion 凭据文件。

端到端验收顺序：

1. 启动空的本地 Nexus PostgreSQL/PGlite，并按顺序执行所有 Migration。
2. 启动 Nexus API 与 Gateway。
3. 通过标准输入运行本地 Bootstrap，创建 `convax` Workspace、Free/Pro Plan、Hosted Auth 配置、
   Hosted BillingConnection、Plan Mapping 和 OpenRouter ProviderConnection。
4. 构建、校验并打包 `nexus-service` Plugin 与 `nexus-mcp` Companion。
5. 启动 Convax，安装 `Convax Account` Plugin，在 Settings > Services 选择 `Nexus · OpenRouter`。
6. 使用系统浏览器完成一个全新用户注册和 PKCE Loopback 回调。
7. 确认 Service 为 Connected，显示当前 Free Plan、可升级 Pro Plan，并列出 OpenRouter 运行时模型。
8. 选择该模型发起对话，确认请求路径为
   `Convax → 本地 Companion Gateway → Nexus Gateway → OpenRouter`，并收到流式响应。
9. 检查 Nexus Invocation/Usage 记录中的模型 ID 保持
   `deepseek/deepseek-v4-flash`，且任何日志和仓库文件都不包含 Provider Key。
10. 点击 Upgrade，确认系统浏览器打开 Hosted Checkout；完成支付后等待签名 Webhook 投影，
    返回 Convax 确认当前 Plan 和 Quota 已刷新。

### 13.1 本地端到端验收结果

本地验收已经证明以下链路：

- 打包后的 Convax 可以安装 Nexus Service，并在重启后恢复登录状态；
- 全新用户可以通过系统浏览器完成注册、PKCE 回调和 Token Exchange；
- Services 页面显示 `Nexus · OpenRouter` 为 Connected；此前真实验收使用
  `DeepSeek V4 Flash`，当前实现会优先列出 OpenRouter 运行时目录；
- Agent 模型选择器可以明确选择该 Nexus 模型；
- 一次真实 Agent 对话通过 Nexus Gateway 调用
  `deepseek/deepseek-v4-flash`，Nexus Invocation 结果为 `SUCCEEDED`；
- 对应 Quota Reservation 为 `SETTLED`，Usage Event 已写入 PostgreSQL；
- Provider Key 只存在于 Nexus 加密存储，三个仓库的凭据模式扫描均无命中。

本次 Status v2 与 Hosted Checkout 变更完成自动化验证，但尚未声明已经完成真实支付 Provider 的
人工购买；该步骤必须在 Test Mode 使用专门测试凭据执行。
