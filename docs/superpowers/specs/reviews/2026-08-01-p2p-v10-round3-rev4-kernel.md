# P2P v10 Round 3 revision 4 因果内核签署复核

日期：2026-08-01

被评审文件：`2026-08-01-p2p-v10-round3-consensus-candidate.md`

声明 SHA-256：`ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`

本地重算 SHA-256：`ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`

摘要与 384 行长度匹配。本轮只验证 service revision-3 提出的 closed-target/full-page patch，并检查 revision 3 已签语义是否回归。

## Closed cutoff target

### 决定

**PASS。** `RegistryCutoffTargetV2` 已成为闭合 discriminated union：

- replica target 固定 `kind: "replica"`、`action: "revoke"`，绑定 member/replica/actor 及 member、replica 两层 prior authorization epoch；
- member target 固定 `kind: "member"`、`action: "revoke" | "downgrade-to-viewer"`，绑定 prior member authorization epoch 与完整 pre-mutation active-editor replica actor set；
- member actor set 按 replicaId bytes 严格排序、唯一、最多 8 项，每项绑定 replicaId、actorId 和 prior replica authorization epoch。

Coverage root 与 authorization mutation 都绑定同一个 closed target/action、before/after membership snapshots 和 coverage-root digest。Service 还必须证明 member target set 精确等于 before snapshot 的 active-editor replicas。错误 kind、漏 actor、重复、epoch mismatch、replica/member root 互换和 cross-target replay 都有 portable bytes 可拒绝，不再依赖数据库外键或实现约定。

Member leaf 的 certified frontier 明确定义为所列 actor frames 的 causal union；empty 同时排除完整 listed set。Replica revoke 只影响一个 exact actor instance，member revoke/downgrade覆盖完整 active editor set，不再有 target cardinality 多解。

### Authority 与 package boundary

Target union 属于 `@convax/project/collaboration-protocol` 的 authorization/cutoff DTO；API只验证 membership snapshot、签名、caps与原子 mutation。它没有 route、Canvas visibility或edit winner权力。ProjectIndex仍是 route唯一权威，generic collaboration仍只消费经过验证的 cutoff事实。

### 最强反驳

Member mutation为每个 scope计算最多8个actor的union frontier，扩大coverage载荷和服务校验复杂度；若before snapshot本身被错误签发，closed union也无法补救。前者受既有8 actors/member、4096 leaves/4 MiB caps约束；后者属于已声明的membership control-plane信任边界。

### 可证伪测试

建立一个 member含3个editor replicas的fixture：replica revoke只排除R1；member downgrade/revoke必须覆盖R1/R2/R3。删掉R2、重复R1、交换actorId、使用旧replica epoch、把replica root挂到member mutation，全部在应用任何leaf前拒绝。随机页面顺序不得改变actor-union frontier。

## Full-page unlisted proof

### 决定

**PASS。** Revision 4 删除了未定义的 compact non-membership proof路径。v2中，只有全部 ordered immutable pages都按root验证后，某scope才能判为unlisted并应用 `empty-target-frontier`。

任一缺页固定为 `cutoff-coverage-incomplete`；在complete前不接受也不排除target frames，不声明team-ready rebuild，current mutable registry不能代替bound pages。语义、wire requirement和failure state现在只有一条路径。

### Caps 与 state machine

最多8页/4096 leaves/4 MiB，使full-page requirement有严格上限。Mutation、coverage root和pages原子持久化；Peer可任意顺序获取页面，但必须完成exact set验证后才从incomplete转为可投影。无timeout、部分页empty或current-registry shortcut。

### 最强反驳

为了证明一个离线未登记scope不存在，Peer最坏需要取回全部4 MiB coverage；compact proof本可降低延迟。删除未定义快捷方式是正确取舍：未来可用新冻结codec添加proof，v2不能允许各实现自创证明语言。

### 可证伪测试

提供7/8页且目标scope未出现在已取页中，状态必须仍为incomplete；第8页验证后才可empty。遗漏、重复、reorder、page digest mismatch、leaf count mismatch全部fail closed。交换页面到达顺序，最终target surviving projection必须相同。

## Revision 3 已签语义回归

| 已签语义 | 结果 | 核对结论 |
| --- | --- | --- |
| 双 checkpoint gate | **PASS** | content validity与active-editor causal floor仍分权；缺任一门槛不可prune |
| Attester边界与caps | **PASS** | public pure verifier、无Plugin JS/WASM、payload-zero；256/64/320 MiB caps未改变 |
| 无 `docEpoch` | **PASS** | Project-owned shardEpoch仍是唯一document incarnation/reset authority |
| Reset state machine | **PASS** | narrow reset triggers、actorId rotation、pre-CAS-only abandonment未变 |
| Registry非route authority | **PASS** | 可落后、absence非否定、promotion非acceptance/current pointer |
| Registry retry/fold/caps | **PASS** | immutable revision identity、deterministic Max fold、abandonment与64 MiB claim cap未变 |
| Coverage target/root/failure | **PASS** | revision 4只关闭target cardinality和proof language，没有扩大service content/route authority |
| Generation projection | **PASS** | dismissal fallback、retained resource root、single recovery marker与Project-injected Canvas port未变 |
| Offline/cutoff语义 | **PASS** | independent actors保留，excluded target work recovery-only，缺coverage fail closed |

没有发现 revision 4 对 revision 3 已签条款的回归。

## 最强整体反驳、漏洞类型与失效条件

完整架构仍有三条最强反驳：

1. 双 checkpoint gate同时带来中心内容暴露与all-editor可用性门槛，并共享deterministic-validator common-mode defect。
2. 遗失editor可无限阻止prune；admin revoke必然把其未进入cutoff的诚实离线工作送入recovery。
3. Authorized editor仍可消耗bounded registry并dismiss合法生成结果，这是强产品权限而非CRDT必然行为。

本轮检查过的旧漏洞类型——authorization subject cardinality omission、undefined proof language、第二route authority、projection多解、cap算术冲突和package dependency倒置——均未再出现。

结论在以下条件下失效：要求attester端到端不可见但仍必须bounded prune；要求遗失editor既不阻塞也不损失离线工作；不允许editor dismissal；或允许Canvas绕过Project route自行reset。

## Exact-digest 决定

对 SHA-256 `ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`：**SIGN**。

评分：**8.9 / 10**。

没有发现重大缺陷。Closed target与full-page semantics已消除最后的authorization projection多解，且未增加业务权威或回归已签语义。剩余1.1分全部来自候选已公开的privacy、offline-compaction availability与editor product-authority成本；它们有明确fail-closed/recovery边界，不造成silent overwrite或arrival-dependent canonical state。

本签名只覆盖上述精确digest；任何语义修改都必须产生新digest并重新评审。
