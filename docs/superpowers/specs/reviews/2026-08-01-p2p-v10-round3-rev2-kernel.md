# P2P v10 Round 3 revision 2 因果内核复核

日期：2026-08-01

被评审文件：`2026-08-01-p2p-v10-round3-consensus-candidate.md`

声明 SHA-256：`a9e69fe85310bb9a86db4acbe7bca2953674e51990e939272a28bb248492ae72`

本地重算 SHA-256：`a9e69fe85310bb9a86db4acbe7bca2953674e51990e939272a28bb248492ae72`

摘要一致。本文只对这一精确字节序列投票。

## 上一轮六条最小 patch 复核

| 上一轮阻塞项 | rev2 结果 | 证据性结论 |
| --- | --- | --- |
| R3-1 carrier 算术、team-ready 范围、executable Plugin artifact | **PASS** | proposal+parents 合计 256 MiB、suffix 64 MiB、whole 320 MiB 已闭合；failure state 只禁止 prune；JS/WASM-only validator 明确不可 attestation |
| R3-2 reset reason 过宽 | **PASS** | actor sequence exhaustion 改为 actorId rotation；普通 fork 走 quarantine/revoke；只有 document-wide Lamport 或所有 trusted checkpoint 均不可恢复才 reset |
| R3-3 registry 可落后、absence 非否定、未列 scope 默认 empty | **PASS** | 已明确 registry 不是 complete set/route catalog，promotion 非 acceptance gate，unlisted scope 对 target 使用 empty frontier |
| R3-3 abandonment、immutable genesis proof、64 MiB 总 claim cap、projection owner | **PASS** | candidate 可 retained-abandon 并释放 slot；promotion 不变成 current pointer；`scope-unroutable` 归 ProjectIndex client |
| R3-4 canonical first-loss 与单 recovery key | **PASS** | exact authorization instance 只有 canonical receipt，root 每 generation O(1)，非 canonical/second receipt 明确拒绝 |
| R3-4 Canvas-owned external-fact port | **PASS** | Canvas 定义 headless port，Project 验证并注入，permit 不进入 Canvas public/wire state，缺 proof 保持 pending |

上一轮因果内核提出的六项修补均已落入 rev2，没有发现遗漏或回退。

## R3-1 复核

### Authority 与 package boundary

**PASS。** Content attester 与 all-active-editor floor 仍是两个不同证明：前者证明 checkpoint semantic validity，后者证明仍有写权的 replica 已跨过 causal floor。双门槛必要而非重复。

Attester 只消费公开 browser-safe composite verifier，Canvas/Project 保留 validator owner，executable-only Plugin artifact fail closed；没有新增 private import、Plugin execution 或 payload durable authority。

### State machine、caps 与 failure state

**PASS。** `candidate -> content-certified -> awaiting-editor-floors -> prunable` 可从 normative steps 唯一还原。256 MiB proposal+parent snapshot pool、64 MiB suffix、320 MiB aggregate 不再算术冲突；独立 ceiling 不保证同时取满也已明确。membership stale、payload unavailable 和 history retention 均不再错误否定 seeded replica 的正常编辑。

### 最强反驳

服务与 editors 运行相同 validator 时，双门槛无法抵抗 common-mode bug，却同时承担内容暴露和全 editor 在线成本。候选已准确把它列为 threat-model limit；这不是本 digest 新增的收敛漏洞。

### 可证伪测试

分别破坏 attester、单 editor floor、membership snapshot 和 carrier 每个边界；任一门槛不满足都不能 prune。对 attester 正常、取消、超时、OOM、崩溃做 payload-zero 持久化取证，并对 Bun/Chromium/attester 跑 exact digest golden。

### 本项决定

**SIGN。**

## R3-2 复核

### Authority 与 package boundary

**PASS。** `projectEpoch` 是整个 Project universe，Project-owned `shardEpoch` 是单 route/document-history incarnation；没有剩余独立 invariant 需要 `docEpoch`。Canvas/collaboration 不能自行 rollover，ProjectIndex route transition是唯一 reset authority。

### State machine、caps 与 failure state

**PASS。** staged genesis、route CAS、activation/recovery 的 crash 边界清楚；只有 pre-CAS staged shard 可 abandon。64 KiB closed reset claim不承载内容。actor sequence exhaustion与 document-wide Lamport exhaustion已分离，普通 fork不会触发破坏性 shard reset。

### 最强反驳

ProjectIndex 损坏时，Canvas 无法用局部 epoch快速自救。允许那条捷径会产生 Project route之外的第二 current-history authority，因此这是单一所有权的已知恢复延迟，不是遗漏字段。

### 可证伪测试

对 reset 三阶段注入崩溃；任何时刻只能一个 route live，旧 bytes保留，兄弟 Canvas不变。全仓 wire/path/import scan不得有 `docEpoch`；actor sequence耗尽只能轮换 actorId。

### 本项决定

**SIGN。**

## R3-3 与 service coverage patch 复核

### Authority 与 package boundary

Registry 主体语义已通过：它可以落后 ProjectIndex，absence/promotion 不决定 route、frame 或 bootstrap validity；ProjectIndex仍是唯一 visibility/current-shard authority。API拥有 metadata transaction，Project protocol拥有 portable DTO/digest，方向正确。

Service review要求的 bounded immutable coverage vector/pages/root 已基本落入：4096 leaves、每页512 leaves/512 KiB、最多8页/4 MiB、root 64 KiB，且与 authorization mutation原子持久化。它解决了原先“最大 registry 无法原子 cutoff”的 bounded-state omission。

### 仍阻塞的 wire authority 缺口

`RegistryCutoffCoverageV2` 当前只明确绑定 registry sequence/root、ordered page digests和 leaf count，没有明确把以下事实签进 root：

- exact revoked/downgraded authorization subject；
- prior authorization epoch 与 mutation/cutoff identity；
- membership snapshot/authorization mutation；
- unlisted-scope policy 是 `empty-target-frontier`。

“service atomically stores/signs root, pages and authorization mutation”是本地事务描述，不等于 portable cryptographic cross-binding。没有这些字段，同一 registry root上的 A-target coverage可能被错误附到 B-target mutation，或在 authorization epoch轮换后重放。

第二个相关缺口是 lazy page语义：root只绑定 page digests，没有定义 non-membership proof。Peer只拿到部分 pages时，不能区分“scope确实未列，应 empty”与“scope leaf在尚未下载页中”。若不同实现分别把缺页当 empty或 pending，会产生不同 target surviving projection。

这不是 registry route authority问题，而是 cutoff security object没有闭合签名域与缺页状态。

### State machine、caps 与 failure state

candidate/dual-validated/abandoned state machine、quota和64 MiB claim cap均通过。Coverage page cap也通过。

缺少一个必要 failure state：`cutoff-coverage-incomplete`。在不能证明 leaf inclusion/non-inclusion时，Peer必须 pending/fail closed；不得套用 empty default、不得宣称 team-ready rebuild。这个状态只阻塞相关 cutoff projection，不把 registry升级为 route权威。

### 最强反驳

authorization mutation与 coverage在服务端原子写入，工程实现可以天然把两者关联，另加签名字段和non-membership规则似乎只是 DTO细节。

这是不可接受的隐含假设。P2P replica在脱离原服务事务上下文后只看到 portable bytes；如果关系没有进入签名 preimage，不同实现无法验证“这组 pages属于哪个 target/cutoff”，重放攻击与缺页分歧都是真实协议行为。

### 可证伪测试

1. 对同一 registry root分别构造 target A/B cutoff，交换 coverage root/pages；必须在应用任何 leaf前拒绝。
2. 重放 prior authorization epoch的 coverage到新 epoch；必须拒绝。
3. 只提供 root和不含目标 scope的第一部分 pages；Peer必须进入 `cutoff-coverage-incomplete`，不能将该 scope判为 unlisted empty。
4. 补齐全部 pages并验证 scope确实不存在后，所有 Peer才应用 empty target frontier。
5. omission、duplicate、reorder、page digest mismatch与同序不同 registry root全部 fail closed；independent actor frame不得被 empty-target rule删除。

### 本项决定

**REJECT AS WRITTEN。** Registry不再是第二 route authority，但 coverage签名域与lazy absence仍未闭合。

## R3-4 与 service projection patch 复核

### Authority 与 package boundary

**PASS。** Dismissal是editor visibility action；failed-recovery是canonical authorization fact；两者不冒充owner terminal。Canvas-owned external-fact port和Project-injected verification context保持正确依赖方向。

### State machine、projection、caps 与 failure state

**PASS。** Service review提出的projection patch已经完整落入：dismissal从effective data competition移除该generation lifecycle/terminal output，existing node重新选择remaining portable max，pending node回退retained placeholder，suppressed resource继续作为history retention root，recovery marker在dismissal下为dormant audit。

单 dismissal key与单 canonical recovery key使Canvas root O(1)；`recovery-proof-noncanonical`和remote proof pending已覆盖错误路径。Precedence不再允许不同实现保留或移除成功输出时产生不同canonical projection。

### 最强反驳

任一editor仍可永久隐藏一个合法成功结果，且dismissal不可semantic undo；产品层很容易把dismissed、failed-recovery、external failed/cancelled/refunded混用。候选已明确权限与枚举边界，若产品不接受该editor权力则必须另改ACL，而不是CRDT winner。

### 可证伪测试

穷举dismissal、manual claim、owner terminal、recovery、tombstone到达排列；要求lifecycle、effective-data、resource-retention hash一致。两个editors使用同一canonical proof并发提交时只能得到一个固定marker；Canvas import graph不得出现Project/membership。

### 本项决定

**SIGN。**

## 仍阻塞的唯一最小 patch

对 R3-3 增加一个闭合的 portable cutoff coverage root，其他 R3语义不改：

> `RegistryCutoffCoverageRootV2` 的service-signed preimage必须绑定 exact `projectId`、`projectEpoch`、唯一 `cutoffId`、target authorization subject、prior authorization epoch、before/after membership snapshot digests、registry sequence/root、固定 `unlistedScopePolicy: "empty-target-frontier"`、ordered page digests和 total leaf count；对应 authorization mutation必须绑定该 coverage-root digest。Coverage pages/leaves继续使用rev2 caps并保持immutable。
>
> Peer只有在验证root中的target/epoch/snapshot字段与authorization mutation逐项一致，且mutation签名preimage绑定该root digest后，才能使用leaf。已验证某scope的leaf inclusion即可应用该leaf；把某scope判为unlisted并套用empty frontier前，Peer必须验证全部 coverage pages，或验证由root签名的canonical non-membership proof。在此之前状态固定为 `cutoff-coverage-incomplete`，不得接受/排除target frames，也不得声称team-ready rebuild。

这是唯一仍要求的语义修改。它不增加服务route权威、不改变edit顺序、不要求服务读取ProjectIndex或collaboration payload。

## 最强整体反驳与漏洞类型

即使补丁完成，领域专家仍可用三条理由否决整套架构：

1. 双 checkpoint gate同时承担中心内容暴露与全 editor availability cost，并共享deterministic validator common-mode bug。
2. 遗失editor可无限阻止prune；admin revoke会把其诚实未同步工作降为recovery。
3. Authorized editor仍可消耗bounded registry并dismiss合法生成结果；这是产品权限面，不是CRDT自动消解的问题。

Rev2唯一新增阻塞属于**签名域不完整**与**缺页状态隐含假设**。上一轮的重复authority、cap算术、projection歧义、无界marker和反向package dependency均已关闭。

## Exact-digest 决定与评分

对 SHA-256 `a9e69fe85310bb9a86db4acbe7bca2953674e51990e939272a28bb248492ae72`：**REJECT**。

评分：**8.2 / 10**。超过7分是因为rev2已关闭上一轮全部六项阻塞，双gate、epoch、registry route ownership和generation projection主干可冻结；剩余问题局限于一个coverage wire object，不要求重构架构。扣分主要来自未绑定target/epoch的coverage replay风险（-0.5）和lazy page non-membership分歧（-0.3）；其余扣分是候选已公开的privacy/availability/product-authority成本。

只有上述唯一最小 patch产生新字节与新 digest后才可重新请求签署；不得用服务端数据库外键、实现约定或非规范注释补足当前 digest。
