# Convax 全局 URI 协议

状态：**standalone exact-byte final candidate；只有本文精确摘要被协同 authority
manifest 绑定，且 Main、四份 owner annex、本文与派生 protocol bundle 获得同一组三名
架构评审者无条件 3/3 SIGN 后，才能成为实现依据。**

本文是 Convax 全产品 URI 组件、静态 scheme 分配、语法、规范化和比较算法的唯一
语义权威。它不是 Canvas 私有协议，也不引入全局资源解析器。

规范中的“必须”“禁止”“应当”是强制性约束。

## 1. 目标与非目标

目标：

1. 所有 Convax URI 共享一套可独立发布的解析、序列化、规范化和比较语义。
2. URI 可以同时携带稳定身份、可变展示路径和可选内容摘要。
3. 资源的授权、解析、打开和重新验证仍由资源所属包负责。
4. URI 可以安全进入 Canvas Yjs 元数据、ProjectIndexYDoc、Agent resource 和 IPC。

非目标：

- 不提供 `resolve(uri)`、scheme handler registry、service locator 或动态 Plugin 注册。
- 不把不同 scheme 合并成一个权限模型。
- 不把 URI 字符串本身当作授权凭证。
- 不允许 Plugin 声明新 scheme 或覆盖 Host scheme。
- 不定义 ProjectIndex schema、文件冲突、GC、reset 或 native materialization。

## 2. 所有权

独立包 `@convax/uri` 只拥有：

- `UriComponents`、`ConvaxUri` 和解析错误类型；
- 纯函数 `parse`、`from`、`with`、`toString`、`canonicalize`、`equals`；
- percent-encoding、authority 大小写和 query 排序规则；
- 文档生成使用的静态 Convax scheme allocation data。

`@convax/uri` 不依赖任何其他 Convax 包，不读取磁盘、网络、当前 Project、Plugin、
Workbench 或浏览器状态。它不能拥有 resolver、认证、缓存或全局 mutable registry。

每个 scheme 的业务 owner 继续拥有解析后的语义验证和 I/O：

| Scheme | Owner | Authority |
| --- | --- | --- |
| `convax-project` | `@convax/project` semantic owner；`@convax/project-files` opaque id codec；`@convax/project/node` native adapter | Project entry identity expression；不是授权或 native path |
| `convax-asset` | `@convax/project/node` 与 Desktop protocol adapter | trusted renderer Project resource projection |
| `convax` | Desktop Agent resource adapter | Host-produced read-only structured resources |
| `convax-plugin` | Desktop Plugin asset adapter | exact installed Plugin snapshot |
| `convax-connected-media` | Desktop connected-media session owner | short-lived bearer session |
| `convax-pet-asset` | Desktop Pet platform adapter | exact Pet contribution and grant |

静态 scheme 表只说明语法和 owner 名称，不包含函数、实例、权限或运行时路由。运行时包
不得暴露 scheme/handler registry。

## 3. 组件模型与通用规范化

协议采用与 VS Code `URI` 相同的五组件模型：

```ts
export interface UriComponents {
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string
}
```

通用 ABNF：

```text
convax-uri = scheme ":" [ "//" authority ] path [ "?" query ] [ "#" fragment ]
scheme     = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
authority  = 1*( unreserved / pct-encoded / sub-delims )
path       = *( "/" segment )
segment    = *( pchar )
```

规则：

1. `scheme` 规范化为 ASCII 小写。
2. authority 按本文闭合的静态 per-scheme URI normalization policy 处理。该 policy
   只包含 URI 语法与静态数据，不调用、注入、注册或复制业务 owner codec；opaque、
   大小写敏感的 authority 禁止 lowercase、Unicode fold 或 percent-decoded alias。
3. `path` 是 URI path，不是系统路径。反斜杠、`.`/`..` 段、NUL 和未编码控制字符被拒绝。
4. percent-encoding 使用 UTF-8；未保留字符不得保持 percent-encoded；十六进制必须大写。
5. query 解析为可重复键的列表，canonical serialization 按 key、value 的 UTF-8 bytes
   排序。owner 不得依赖原始 query 出现顺序。
6. fragment 只用于客户端展示定位，不参与持久身份或授权；持久 Project 引用禁止 fragment。
7. 总 URI 不得超过 16 KiB，单组件不得超过 8 KiB，query 不得超过 64 项。解析器必须在
   大分配前执行这些限制。

## 4. `convax-project` 四种规范形式

`convax-project` authority 是大小写敏感的 opaque component，不是 DNS host。
`@convax/uri` 只执行本文闭合的 URI envelope 语法、规范化与 canonical serialization，
并返回 opaque `project-id`、`project-epoch` 与 `entry-id` components。它不导入、注入、
注册或复制任何 Project 业务 codec。

`@convax/project-files` 和 `@convax/project` 必须在消费边界使用各自拥有的业务 codec
重验证这些 opaque components、Project scope 和当前语义。非法业务值必须拒绝，禁止
通过 lowercase、Unicode fold 或 percent alias 修复成另一个合法身份。

只存在以下四种 canonical form：

```text
convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>
convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>?path=<display-hint>
convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>?blob=sha256%3A<64-lowercase-hex>
convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>?blob=sha256%3A<64-lowercase-hex>&path=<display-hint>
```

`blob` 必须排在 `path` 前，分隔 `sha256` 与 digest 的冒号规范化为大写 `%3A`。
不存在其他 query key、重复 key、空 `blob`/`path`、fragment 或 path-only 变体。

三个值有不同语义：

- `projectId + projectEpoch + entryId` 是逻辑 Project entry 身份；
- `path` 是可变的展示与 relink hint，不是身份或 native path authority；
- `blob` 把 entry 固定到一个不可变字节版本；缺少 `blob` 时由 Project owner 解析当前版本。

比较 API 必须显式选择一种模式：

```ts
type ProjectUriComparison = "entry" | "entry-revision" | "canonical-string"
```

- `entry` 比较 projectId、projectEpoch 和 entryId，忽略 `path` 与 `blob`；
- `entry-revision` 比较 entry 身份与 `blob`，忽略 `path`；
- `canonical-string` 比较全部规范化组件。

禁止用普通字符串相等隐式选择业务身份语义。

## 5. Project entry identity ownership seam

`@convax/project-files` 只拥有 opaque Project entry id type 与 codec。
`@convax/project` 拥有 entry 分配、ProjectIndex currentness、内容 family 与引用语义。
`@convax/project/node` 拥有 native path 解析、文件系统约束和字节耐久性。

URI 不分配 ProjectFileId，不选择当前 version/blob，不解析 native path，也不携带权限。
path、hash、inode、watcher 顺序或文件系统枚举都不能替代稳定 entry identity。

Project 的确切 entry、version、resource-reference 和 conflict 语义只由 Project owner
authority 定义；本文只规定这些值如何形成和比较 URI。

## 6. 原子值与 owner 重验证 seam

Canvas 和 ProjectIndex 必须把一个完整 canonical URI 或一个完整 immutable resource
reference 写入单个 Yjs value。禁止把 entry identity、`path` 和 `blob` 分散到可独立并发
覆盖的多个 key，否则可能形成没有任何 writer 写过的混合引用。

URI 是引用表达，不是授权。业务 owner 每次消费时必须重新验证：

1. scheme 与 canonical form；
2. Project scope、epoch、membership 与 caller capability；
3. entry 当前存在且 kind 正确；
4. `path` 只作为 hint，不能选择或越权访问 native path；
5. 指定 `blob` 时，实际字节长度与摘要匹配；
6. owner 的 containment、symlink、size、MIME 与 grant 规则。

native path、inode、fsync evidence、local presence index 和机器墙钟禁止进入 URI、Y.Doc、
typed intent 或 causal frame。

## 7. Breaking cutover seam

本协议是 breaking URI cutover：旧 path-only Project URI、非规范 query 顺序、URI alias、
fragment 持久引用和未声明 scheme 不迁移、不双读、不自动修复。

decoder 必须返回明确的 unsupported/malformed 结果并保留原始 bytes；本文不授权删除、
重写、迁移或 GC Project 数据。Project 是否允许显式 destructive reset、reset 删除集合、
身份保留、epoch 轮换与 crash recovery，只由 Project collaboration authority 定义。

## 8. 可证伪验收

以下任一结果出现即否定本协议：

1. 两个 canonical-equivalent URI 序列化成不同字节，或 malformed percent-encoding 被接受。
2. 任一 runtime 对同一 fixture 得出不同 canonical string 或 comparison result。
3. `convax-project` 接受四种 canonical form 之外的 query key、顺序、重复项或 fragment。
4. `convax-project` authority 被 lowercase、Unicode fold 或 percent decode 为 alias。
5. `blob` 在 `path` 后，或 `sha256:` 的冒号未规范化为 `%3A`。
6. 任一调用方通过 `path` 绕过 entry owner lookup 打开 native 文件。
7. Canvas/ProjectIndex 并发更新产生混合的 entry identity、`path` 与 `blob`。
8. Plugin 能动态注册 scheme/handler，或任一包暴露全局 `resolve(uri)` I/O。
9. URI codec 分配 ProjectFileId、选择当前 blob/version 或读取当前 Project 状态。
10. URI decoder 因 unsupported bytes 自动触发 Project reset、删除、迁移或 GC。
