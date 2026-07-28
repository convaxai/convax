# Convax 多 Marketplace Future

状态：非首版，不阻塞
[主方案](2026-07-27-multi-capability-marketplace-design.md)。

本文件只记录后续方向，不在首版 schema 中预留半成品字段。

## 1. 自动依赖

未来如引入 Plugin/Skill -> MCP Server requirement：

- 使用完整 source-qualified ref；
- 默认同 Marketplace；
- 不跨源 fallback；
- 安装前展示完整计划；
- OAuth/执行授权逐项确认；
- 不伪造跨包原子性；
- SemVer range 只有在版本策略单独确认后再加入。

## 2. Capability Pack

用于“一键选择多个独立扩展”，但 Pack 本身：

- 不安装；
- 不执行；
- 不获得权限；
- 不绕过成员的来源锁和显式设置。

## 3. WASM/WASI

只有完成 capability-based filesystem、network deny-by-default、resource limit、
process ownership 和跨平台 runtime spike 后，才增加 WASM/WASI MCP profile。

## 4. Signed Marketplace

第三方需要抗 rollback/freeze、key rotation 和离线签名时，优先评估 TUF，不自研
签名协议。每个 source 必须有独立 trust root。

## 5. 更多 delivery

任意 `static-same-origin`、npm、PyPI、OCI 等 delivery 都必须单独完成 transport、
integrity、lifecycle、sandbox 和 recovery 设计；不能仅因 `server.json packages[]`
存在就自动支持。

## 6. HTTP MCP 动态输入

`server.json` 的 URL template variables、custom headers 和 API Key 表单只有在完成
secret storage、redaction、更新重确认、endpoint 重绑定和无 Renderer 泄漏设计后才
加入。首版只支持固定 HTTPS endpoint，以及标准 MCP OAuth 或匿名连接。
