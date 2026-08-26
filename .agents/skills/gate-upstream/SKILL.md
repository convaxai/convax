---
name: gate-upstream
description: 上游门禁。变更 upstream.json、@deepseek-ai/* 版本、patches/ 清单、Electron 或打包 Node 版本前必读；按清单逐项执行并记录升级 Note。
---

# Gate: 上游依赖

## 规则

- 产品仓库不得包含上游源码、submodule 或 gitlink。可选审计 checkout 固定
  放在同级 `../deepseek-harness`，缺失时不得影响产品构建、测试或打包。
- `upstream.json` 同时记录 source commit 与 npm 运行版本；pin 更新单独成
  提交，与桌面行为变更分开。
- 对上游的本地修补只能以 `patches/` 显式清单存在；每个补丁记录
  产生原因与上游 issue 链接。

## 升级清单

1. **来源复核**：确认仓库内没有 `.gitmodules`、`deepseek-harness/` 或
   gitlink；若使用同级审计 checkout，其 HEAD 必须等于 `upstream.json`
   的完整 source commit。
2. **补丁复核**：列出当前 `patches/` 全部条目；升级后逐条先尝试删除，
   仍需保留的更新其理由与上游 issue 状态。
3. **变更阅读**：读上游 CHANGELOG / breaking notes；rc 之间也可能破坏，
   不因版本号小而跳过。
4. **运行闭包**：根 manifest、桌面 manifest 与 lockfile 中的 DSH 包必须
   使用同一个精确版本；不得从外部 checkout import、link 或补足依赖。
5. **回归**（全部 headless）：
   - 真实启动到 Web 可访问；
   - `dump-config` 与升级前基线 diff，逐行解释非预期变化；
   - 插件生命周期测试全绿；
   - `compatibility` profile 零覆盖可跑；
   - gate-security 清单全项重验（fence、权限、暴露面）；
   - 打包产物在无全局 Node/pnpm/上游 checkout 的机器上启动。
6. **运行时决策复核**：Electron / 打包 Node 升级时重述「独立打包 Node
   而非 ELECTRON_RUN_AS_NODE」的 ABI 理由是否仍成立。
7. **记录**：升级写一篇 Agent Note（日期、版本区间、补丁 diff、回归
   结果、遗留风险），放入 `.agents/notes/`。

## 证据

PR 描述必须包含：source commit/npm 版本变更区间、外部 checkout 校验（如
使用）、补丁清单前后对照、回归结果汇总、Agent Note 链接。
