# Media Tool Plugin boundary

本文不再定义某个具体媒体工具插件的产品、Manifest 或命令实现。具体 Plugin、
Plugin-owned Skill、companion、发布配置、许可证材料与 target smoke tests 属于
`convaxai/convax-plugins`。当前 Host contract 见
[`plugin-system-analysis.md`](plugin-system-analysis.md) 和生成的
`@convax/plugin-api` / `@convax/plugin-sdk` reference。

媒体处理集成必须使用与所有 Tool Plugin 相同的 v8/v9 通用边界：

- portable Manifest 必须是闭合的 `convax.plugin/8` 或 `convax.plugin/9`；v8 单
  Service 身份和行为保持不变；
- operation、generation、service、Agent Tool 和 Plugin-to-Plugin export 复用同一
  verified sidecar execution owner；
- managed companion 必须是 closure 中摘要固定、安装时授权、运行前重新验证的精确字节；
- Host 分配有界输入 staging 与输出位置，禁止 shell、任意原生路径、运行时下载和
  外部可执行回退；
- 取消必须终止完整进程树；输出经 Project 准入后，Canvas 只通过 authoritative
  application/business service 提交；
- node、menu、toolbar 和 host-rendered action 只由 validated contributions 投影，
  Host 不根据具体 Plugin id、工具名、厂商或媒体实现分支；
- Agent、Web、Toolbar 和 Plugin callers 进入同一个 Main executor，不暴露 raw MCP、
  native output directory 或 sidecar credentials。

如果某个媒体操作无法用当前 Catalog/SDK 表达，Plugin 开发任务不得修改 Host、增加私有
IPC 或直接调用 Canvas persistence。它只能在 Plugin 仓库按
[`plugin-host-change-governance.md`](plugin-host-change-governance.md) 提交通用能力请求，
等待人类判断是否创建独立 Host 任务。

任何具体实现还必须自行满足对应工具和依赖的许可证、源码提供、构建可复现性、
SBOM/provenance、target matrix、摘要固定及取消/输入输出隔离测试；这些要求不能通过
在 Host 中硬编码集成语义来满足。
