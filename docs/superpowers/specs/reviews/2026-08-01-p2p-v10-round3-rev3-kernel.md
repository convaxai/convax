# P2P v10 Round 3 revision 3 因果内核签署复核

日期：2026-08-01

被评审文件：`2026-08-01-p2p-v10-round3-consensus-candidate.md`

声明 SHA-256：`e5a92156aabae8cbb6d4f5957aafe82bfe3938176fff6f3395ec68b6a5d75fdb`

本地重算 SHA-256：`e5a92156aabae8cbb6d4f5957aafe82bfe3938176fff6f3395ec68b6a5d75fdb`

摘要与 370 行长度均匹配。本轮只复核 rev2 唯一遗留的 cutoff coverage patch、service review 的 coverage/projection patches，以及已通过语义是否回归。

## Rev2 唯一遗留 patch

### Coverage 签名域

**PASS。** `RegistryCutoffCoverageRootV2` 已明确签入：

- `projectId`、`projectEpoch`、唯一 `cutoffId`；
- exact target `memberId/replicaId/actorId` 与 `priorAuthorizationEpoch`；
- before/after membership snapshot digests；
- registry sequence/root；
- fixed `unlistedScopePolicy: "empty-target-frontier"`；
- ordered page digests 与 leaf count。

Authorization mutation 反向绑定 coverage-root digest，并与 root/pages 原子存储和签名。因此 coverage 是一个 exact actor-authorization-instance 的 portable proof，不再依赖服务数据库外键或请求上下文；跨 target、跨 epoch、跨 membership snapshot replay 都有签名字段可拒绝。

一个 member-wide revoke 若包含多个 active replica actors，应对每个 exact target actor instance 产生相应 coverage root，并由同一 before/after membership mutation 绑定；这不改变候选的单 root target 语义，也不让 registry获得 route authority。

### Lazy page 与 non-membership

**PASS。** 缺页现在固定进入 `cutoff-coverage-incomplete`，在证明 leaf inclusion/non-inclusion 前既不接受也不排除 target frame，且不得声称 team-ready rebuild。

`empty-target-frontier` 只有两条合法路径：验证全部 immutable pages 后确认 scope未列，或验证 root-authenticated canonical non-membership proof。v2 若尚未冻结后一 proof DTO，合法实现只能采用“全部 pages”路径，不能自行发明 proof encoding；这不影响当前语义确定性。

Current mutable registry 明确不能替代 cutoff绑定的 pages/root，关闭了 cutoff challenge 后 promotion/abandonment 导致投影漂移的路径。

### State machine、caps 与 failure state

**PASS。** Coverage 对 4096 retained entries形成唯一 identity-sorted leaves、最多8个 immutable pages/4 MiB、root 64 KiB；omission、duplicate、reorder、stale root、target/epoch swap都 fail closed。Entry retry使用 exact `{scopeKey, registrarReplicaId, claimRevision}`，contiguous revision和确定性 fold关闭了 abandonment/retry 后的多解。

Registry依然可以落后 ProjectIndex，absence/promotion不决定 route、edit或bootstrap validity。它只拥有 discovery、quota、anti-rollback 和 target cutoff proof，未回归第二 Project route authority。

### 最强反驳

最大 cutoff 需要验证4 MiB immutable pages；没有冻结 non-membership proof时，一个未登记离线 scope只能等待全页，撤销重建延迟较高。让 current registry或缺页默认代替可以更快，但会重新引入时序依赖和错误 empty projection，因此该成本不是协议漏洞。

### 可证伪测试

1. 在同一 registry root上交换 A/B target coverage、prior authorization epoch 或 before/after snapshot，全部在应用 leaf前拒绝。
2. 随机排列、重复或遗漏 pages，只有完整 canonical set产生同一 coverage digest；缺页保持 incomplete。
3. 对未登记离线 scope，未完成全页/non-membership验证前不应用 empty；完成后所有 Peer一致把 revoked target frames送入 recovery。
4. 在 cutoff生成后 promotion/abandon registry entry，旧 cutoff继续按其 immutable root投影，新 mutable registry不得改变结果。

## Service coverage patch

**PASS。** Service review要求的最大-cap原子 coverage已经完整进入候选：每 retained entry恰好一 leaf、分页和root均有硬 cap、root与authorization mutation绑定并原子提交、Peer按immutable bytes重建同一 per-target projection。Candidate/abandoned leaf只给target empty frontier，不会删除独立 surviving actor frame，也不生成空 Canvas route。

没有新增 service content/route authority：API只验证签名、membership、bounds、sequence/root和事务；ProjectIndex仍是 visibility/current shard唯一事实源。

## Service generation projection patch

**PASS。** Dismissal 的 effective-data 语义已冻结：

- 移除该 generation lifecycle 与 terminal output claim 的 effective competition；
- existing node按原 portable maximum选择剩余 prior/manual claim；
- pending-generation node回退 retained placeholder并显示 `dismissed`；
- owner terminal、resource reference和recovery marker保留为history/audit；
- suppressed success仍是resource-retention root。

因此 dismissal、owner terminal、manual claim、failed-recovery与tombstone的消息排列不会再产生“一个 Peer显示成功资源、另一个回退旧数据”的多解。

Canonical first-loss receipt、single recovery key和 Canvas-owned `GenerationExternalFactContext` 均保留；Project注入verified fact，Canvas没有反向 membership/service依赖。

### 最强反驳

任一 editor可永久隐藏合法成功结果，且 dismissal不可semantic undo；这是一项强产品权限。候选没有伪装它：dismissed不等于failed/cancelled/refunded，外部计费/取消不从Canvas推断。若产品不授予editor该权限，应另改ACL并重新签协议，而不是改变并发 winner。

### 可证伪测试

穷举 dismissal、owner success/failure、manual claim、recovery、node tombstone 与重复 delivery；所有 Peer的 lifecycle、effective-data canonical hash和resource-retention roots必须相同。Remote缺 canonical proof时保持pending，Canvas package import graph不得出现Project/API/membership。

## 已通过语义回归检查

| 语义 | 结果 | 回归检查 |
| --- | --- | --- |
| 双 checkpoint gate | **PASS** | content validity 与 causal floor仍分权；缺任一门槛不可 prune |
| Attester package/privacy boundary | **PASS** | 仅公开 pure verifier；不执行Plugin JS/WASM；payload不持久化 |
| Carrier caps | **PASS** | 256 MiB snapshot aggregate、64 MiB suffix、320 MiB encoded whole相互一致，section maxima无需同时达到 |
| Active-editor coverage | **PASS** | viewer不入floor；membership变化使未完成coverage stale |
| 无 `docEpoch` | **PASS** | Project-owned shardEpoch仍是唯一document incarnation/reset authority |
| Reset trigger | **PASS** | actor sequence rotation与document Lamport reset分开，普通fork不破坏性reset |
| Registry非route authority | **PASS** | 可落后、absence非否定、promotion非acceptance/current pointer |
| Candidate abandonment | **PASS** | retained/auditable、释放slot、retry revision确定性且不覆盖旧claim |
| Generation双事实 | **PASS** | dismissal与failed-recovery分义、single markers、owner terminal不被伪造 |
| Package direction | **PASS** | `project -> canvas -> collaboration`未倒置，native durability仍在Project node adapter |

没有发现 rev3 对已通过条款的语义回退。

## 最强整体反驳、漏洞类型与失效条件

领域专家仍可用三条最强理由反对完整方案：

1. 双 gate同时引入中心内容暴露与全 editor可用性门槛，并不能抵抗双方共同使用的deterministic validator bug。
2. 长期离线/遗失 editor仍可无限阻止prune；admin revoke会把其诚实未同步工作降为recovery。
3. Authorized editor仍可进行bounded registry DoS并dismiss合法生成结果，说明权限模型不能靠CRDT收敛自动解决。

这些是候选已显式声明的 threat-model、availability和product-authority边界，不是事实错误、隐含第二权威或消息到达顺序漏洞。结论在以下任一条件下失效：要求对attester端到端保密且仍必须bounded prune；要求遗失editor不阻塞也不损失离线工作；不允许editor dismissal；或允许Canvas绕过Project route自行reset。

## Exact-digest 决定

对 SHA-256 `e5a92156aabae8cbb6d4f5957aafe82bfe3938176fff6f3395ec68b6a5d75fdb`：**SIGN**。

评分：**8.8 / 10**。

没有发现新的重大缺陷。已检查authority、package direction、causal state machine、aggregate caps、coverage signature/replay、lazy-page failure、registry projection、generation projection、resource retention和可证伪边界。剩余1.2分扣在已公开且不可同时消除的privacy/availability/editor-authority成本；它们不致命，因为每项都有明确fail-closed状态，且不会制造第二业务权威、silent LWW overwrite或arrival-dependent canonical projection。

本签名只覆盖上述精确 digest；后续任何语义修改、删减 threat-model limit 或用实现约定替代签名字段，都必须产生新 digest并重新评审。
