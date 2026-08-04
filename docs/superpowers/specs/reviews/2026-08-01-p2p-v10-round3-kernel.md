# P2P v10 Round 3 因果内核 red-team

日期：2026-08-01

被评审候选：`2026-08-01-p2p-v10-round3-consensus-candidate.md`

声明 SHA-256：`4e97fff4045b1877434f7f3a94232ae4ddb264f62dc200dd484ba3455e95393f`

本地重算 SHA-256：`4e97fff4045b1877434f7f3a94232ae4ddb264f62dc200dd484ba3455e95393f`

字节身份匹配。本评审只判断这个精确 digest，不把候选的主方向正确等同于文本已经可冻结。

## 总体结论

对该精确 digest：**REJECT**。

双 checkpoint 门槛不是重复权威：content certificate 证明 checkpoint 符合冻结的业务/CRDT 规则，all-editor floor 证明仍有写权的离线 replica 已跨过裁剪水位。两者解决不同问题，少一个都不能同时得到恶意 checkpoint 防护与 long-offline 安全裁剪。

`docEpoch` 也没有遗漏一个独立不变量，前提是规范坚持“任何单文档 collaboration universe 替换都必须表现为 Project-owned shard incarnation/route transition”。在这个封闭前提下，另一个 docEpoch 只会成为第二 reset authority。

拒绝原因集中在四个可局部修正、但会改变 wire/state-machine 语义的缺口：attester carrier 上限算术遗漏 proposal snapshot；registry 对未登记离线 scope 的 revoke 默认规则未定义且 promotion 可能被误作第二准入权威；candidate 没有可恢复的 abandonment 状态；generation recovery 的“唯一 marker”与 proof-digest 动态 key、以及 Project-to-Canvas permit 方向不一致。

## R3-1：checkpoint trust 与双门槛

### Authority 审查

候选的 authority 分离成立：

- `CheckpointContentCertificateV2` 只证明 exact content、causal closure、reducer、schema/invariant 与摘要一致，不证明所有未来 writer 已跨过该 base。
- `ReplicaCausalFloorAckV2` 证明一个仍有写权的 replica 已验证、durable 保存并安装单调 floor，不独立代表服务 attester 正确。
- `PrunableCheckpointSetCertificateV2` 只在两类证明都存在时授权 prune；service CAS 只排序 GC metadata，不排序 edit DAG。

因此“双门槛是否重复”的答案是：**不重复，且在候选 threat model 下都必要**。如果删除 attester，完整 editor set 变成唯一内容信任根；如果删除 floor，长期离线 editor 仍可合法产生无法重建 exact base 的帧。

但 `contentStatus: "service-validated-and-all-editors-acknowledged"` 应理解为两个证明的 conjunction，不能被任何 API/UI 简化为“团队共识”或“所有成员批准业务结果”。

### Package boundary 审查

包方向原则上成立，但需要一条不可省略的闭合规则：`@convax/project/collaboration-protocol` 的 composite verifier 只能组合 `@convax/canvas` 与 `@convax/project` 的公开、纯、browser-safe validators；Plugin validation artifact 必须是冻结格式的声明式 schema/data，不得是 Plugin JavaScript、WASM、动态 import 或服务端安装 Plugin closure 的借口。API attester 只能依赖该公开 export，不能复制 reducer。

若 Plugin 规则只有可执行代码才能验证，则该 checkpoint 不具备 attestation eligibility，状态必须是 `attestation-unavailable` 并保留 genesis history；禁止跳过 Plugin state 或在服务执行插件。

### State machine 审查

主链应冻结为：

```text
candidate
  -> content-certified
  -> awaiting-editor-floors
  -> prunable
```

attestation 失败不否定普通 causal frames，只否定该 candidate 的裁剪资格。membership snapshot 在收集 ACK 期间变化，旧提案进入 `floor-membership-stale`，新提案必须基于新 snapshot 重收全量 ACK；不得把旧、新 snapshot 的部分 ACK 拼接。

候选中“Failure states ... None is team-ready/prunable”范围过宽。`awaiting-editor-floors`、`attestation-unavailable` 和 `history-retention-required` 只说明 checkpoint pipeline 不可裁剪；已有 seeded replica 的 team editing 仍可正常工作。只有 fresh bootstrap 所需 payload 缺失时，相关副本才不是 team-ready。

### Caps 审查

当前 caps 有直接算术歧义：最多 8 个 parents，每个 snapshot 最多 32 MiB，再加 proposal snapshot 32 MiB 和 suffix 64 MiB，理论 carrier 是 `8 * 32 + 32 + 64 = 352 MiB`，不是 320 MiB。

可以保留 320 MiB，但必须把它精确定义为：

```text
proposal snapshot + all parent snapshot bytes <= 256 MiB
suffix bytes <= 64 MiB and suffix frames <= 4096
whole carrier <= 320 MiB
```

这意味着单 snapshot 32 MiB、parent count 8 都是独立 ceiling，并不保证两者可同时取满。所有 cap 必须在 allocation/decompression/Yjs decode 前检查，压缩包还需限制解压后尺寸、嵌套深度和条目数。

### Failure-state 审查

保留候选列出的七个状态，但按所有者拆分：checkpoint pipeline 可产生前六个；`checkpoint-payload-unavailable` 是 holder/bootstrap 状态。任何状态都不得自动 reset、降级为 metadata-only certificate 或阻止已 accepted 的普通 edit 继续 P2P 同步。

### 最强反驳

双门槛把中心内容/隐私面与全 editor 可用性障碍叠加：attester 受攻击可看到内容，一个遗失 editor 又可永久阻塞 prune；而两侧运行同一 validator 时，所谓独立验证可能只是假独立。

这条反驳没有被消除。独立部署只抵抗密钥/流程 compromise，不抵抗共同 deterministic bug；候选已承认后一边界。若内容不能暴露给 attester，唯一诚实模式仍是禁用裁剪并保留完整历史。

### 可证伪测试

1. bad attester 签隐藏 Y.Map，但一个 editor 拒签，系统不得产生 prunable certificate。
2. 所有 editors ACK 合法 checkpoint，但缺 service content certificate，仍不得 prune。
3. membership 在第 N-1 个 ACK 后变化，旧 ACK 集必须整体作废。
4. 320 MiB 边界按“proposal+parents 256、suffix 64”通过，任一分项或总量超一字节在大分配前拒绝。
5. attester store、object storage、logs、traces、retry queue 和 crash dump 均找不到 payload；Plugin executable artifact 必须被拒绝。
6. `awaiting-editor-floors` 时已有 replica 仍能提交/复制 edit，但 UI 不显示 prunable。

### 本项裁决

**REJECT AS WRITTEN**：authority 方案通过，carrier 算术和 failure-state 范围必须按最小 patch 修正。

## R3-2：无 `docEpoch` 与 epoch ownership

### Authority 审查

无 `docEpoch` 在本候选中成立，因为两个保留 epoch 有不重叠 owner：

- `projectEpoch` 标识整个 Project catalog/collaboration universe。
- `shardEpoch` 标识 Project route 指向的某一个文档协同 incarnation。

Canvas collaboration history 的 schema reset、破坏性重建或不可恢复损坏会改变该 route 所指 incarnation，因此必须由 `@convax/project` 通过 ProjectIndex staged transition 完成。若另设可在不改 Project route 时滚动的 `docEpoch`，同一个 route 会有两套“当前文档”判定，形成独立 reset authority。

所以“无 docEpoch 是否遗漏独立 invariant”的答案是：**没有遗漏；候选通过把所有 document-universe reset 收敛为 Project-owned shard transition，明确拒绝了那个独立 invariant。** 未来若产品要求“route 完全不变但协同历史可独立重生”，这项结论立即失效，必须重新引入并定义 docEpoch，而不能偷用本机 generation。

### Package boundary 审查

`DocumentScopeV2`、reset claim 与 route transition 属于 `@convax/project/collaboration-protocol`；generic collaboration 对 scope opaque；Canvas 只验证自己接收到的 schema/root，不决定 shard 是否 current。这个方向符合 `project -> canvas -> collaboration`。

根 `AGENTS.md` 和 `docs/architecture.md` 当前仍含 docEpoch 语义。候选获得 3/3 后，必须把 contract、boundary checks、public DTO、store key 与 tests 作为同一架构提交更新；只改 wire type 会让文档和实现互相否决。

### State machine 审查

staged genesis → ProjectIndex route CAS → new shard activation 是唯一合法切换。CAS 前 old shard 唯一 live；CAS 后 new shard 唯一 current，若本机未装载 genesis则进入 recovery/holder wait，不能回退显示 old shard 为 live。旧 bytes 保留为 recovery/unsupported，不被 route CAS 删除。

候选的 reset reason 仍略宽：普通 actor sequence u64 exhaustion 可通过新 actorId/key chain 轮换解决，普通 actor equivocation可通过 quarantine/revoke/rebuild解决，二者不应默认重置整个 shard。只有 document-wide Lamport exhaustion，或无法从任一受信 checkpoint 重建的 corruption/equivocation，才允许 shard reset。

### Caps 审查

64 KiB reset claim 足够，但必须同时受 closed reason enum、最多一个 staged genesis digest、一个 ProjectIndex operation digest、固定数量 actor/admin/confirmation receipts 约束。不得用任意 JSON evidence 在 64 KiB 内扩展新的 reset authority。

### Failure-state 审查

候选五个 failure states 可区分 CAS 前后。需要明确 `shard-reset-recovery-required` 不自动重试第二次 reset、不生成另一 new shardEpoch；恢复必须继续同一个 reset claim，或显式放弃未 CAS 的 staged shard。CAS 已成功后不得“放弃”并恢复 old live route。

### 最强反驳

ProjectIndex 一旦损坏，单 Canvas reset 无法取得 route CAS；而独立 docEpoch 可以更快隔离 Canvas 历史。ProjectIndex 自身 reset 又迫使整个 projectEpoch 变化，故障域更大。

反驳成立，但这是唯一 route authority 的直接代价。若 ProjectIndex 已不可验证，就没有可信依据声称某 Canvas route 仍 current；局部 docEpoch 只会掩盖 catalog 不可信。

### 可证伪测试

1. revoke、checkpoint、Plugin update、session renewal 全部保持 scope 字节不变。
2. Canvas A reset 的三阶段 crash permutation 中，任何时刻至多一个 route live；B 不变；old A bytes 不丢。
3. actor sequence 耗尽只轮换 actorId，不触发 shard reset；Lamport document-wide exhaustion才走 reset。
4. 普通 equivocation 先 quarantine/cutoff/rebuild；只有无受信 base 可重建时 reset。
5. import/path/wire scan 不得出现 docEpoch，Canvas 与 collaboration 不得调用 route CAS。

### 本项裁决

**SIGN WITH NORMATIVE CLARIFICATION**：no-docEpoch 的核心语义可冻结；counter/equivocation reset trigger 必须收窄，否则实现会滥用破坏性 reset。

## R3-3：candidate registry 是否成为第二权威

### Authority 审查

“registry 不含 route state，ProjectIndex 决定 visibility/current shard”是必要条件，但当前文本还不足以证明 registry 不是第二权威：

1. 离线 editor 可以先在 ProjectIndex 创建合法 Canvas，之后才向服务登记，因此 registry 在任意时刻可能**落后**于真实 ProjectIndex，不能准确称为 Project scopes 的 superset。
2. 若 `dual-validated` promotion 被 fresh bootstrap、frame acceptance 或 route validity 当作额外门槛，registry 就成为第二准入权威。
3. revoke 只“exact-covers every registry entry”时，未登记离线 scope 没有 cutoff 语义，旧 target credential 可能借新 scope 绕过撤销。

可冻结的 authority 必须是：registry 是 grow-only **registered-scope discovery index**，不是实际 route 的 complete superset；entry absence 和 candidate/promotion 状态都不能否定一个由 exact ProjectIndex causal proof 加 R3-1 content/floor proof验证的 scope。`dual-validated` 只是服务可验证的派生缓存和 discovery priority。

target revoke 是 actor/authorization-global fence。对 cutoff manifest 未列出的任意 scope，包括从未登记的离线 scope，默认 target frontier 为 empty；只有 manifest 中显式列出的 certified closure 能让 target 旧帧存续。这样 registry coverage 是 anti-rollback/枚举检查，不是撤销安全的完整性根。

### Package boundary 审查

DTO/digest 归 `@convax/project/collaboration-protocol`，API 只管序列、签名、quota、CAS，ProjectIndex route 归 `@convax/project`，方向正确。API/UI 不能提供 `registryEntry.state === dual-validated` 即“Canvas live”的便捷方法；Project client 必须先重建 ProjectIndex。

### State machine 审查

当前只有 `registered-candidate -> dual-validated`，存在永久占槽：错误或丢失 payload 的 honest candidate 永远无法 promotion，也无法释放每 replica 4 个 outstanding slots。

最小状态机应为：

```text
registered-candidate -> dual-validated
registered-candidate -> abandoned
```

`abandoned` 条目仍永久保留，永不 route-visible，cutoff 使用 empty target frontier，但释放 outstanding slot。只有原 registering replica 或 Project admin 可签 `DocumentRegistrationAbandonmentV2`；已 dual-validated 不可退回/abandon。相同 scope 的后续真实注册必须创建新的 claim revision/digest，不能覆盖旧 claim。

promotion 只绑定 immutable genesis promotion proof；后续 checkpoint/prunable-set 演进不重写 registry entry，否则 grow-only registry 会变成 checkpoint current pointer。

### Caps 审查

64 KiB claim、4 outstanding candidates/replica、1024 entries/member、4096/project、512 KiB/page 是闭合上限。还需对 entries page count、claim nesting/string length、同 CanvasId reset-chain length和 project-wide candidate bytes设置解析前 cap；否则 4096 个接近64 KiB claims可形成约256 MiB metadata。

建议冻结 project registry claims 总 payload 64 MiB；达到上限后只允许 promotion、abandonment、cutoff 和 explicit project reset，不允许新 registration。

### Failure-state 审查

`scope-unroutable` 应是 Project client 根据 ProjectIndex 得出的 projection 状态，不是 API registry entry 状态；API 只能报告 candidate/dual-validated/abandoned 和 proof availability。`scope-capacity-exceeded` 不得阻止现有 ProjectIndex Canvas 在已 seeded peers 间同步，只阻止新的服务 discovery registration。

### 最强反驳

允许 registry 缺失时仍信任 P2P 获得的 ProjectIndex scope，会削弱服务的 anti-DoS/发现保证；target-global empty default 又可能把合法但未登记的 revoked editor 离线工作全部送入 recovery。

这是离线 Canvas creation 与即时 revoke 的不可避免边界。让 registry 成为强制前置即可避免缺失，但会直接取消无服务离线创建；候选已选择离线协同，因此必须采用安全 empty default和 recovery。

### 可证伪测试

1. 服务离线时 A 创建 Canvas，B 通过 Peer 验证 ProjectIndex 和 genesis；两者必须可用，registry absence 不得拒绝。
2. A 在登记前被 revoke；该未登记 scope 对 A 默认 empty frontier，A frames recovery-only，不能绕过 cutoff。
3. fake candidate 与 real candidate 并发，registry 都不产生 route visibility；real proof promotion只改变 discovery metadata。
4. 连续创建4个不可验证 candidate 后，签 abandonment 释放一个 slot；旧条目/claim仍可审计且不能复活。
5. dual-validated entry 后 ProjectIndex tombstone，Canvas立即不可见；registry不得复活。
6. registry 回滚、同序不同 digest、4097项、总 claim bytes 超 cap均在分配前 fail closed。

### 本项裁决

**REJECT AS WRITTEN**：必须加入“registry 可落后、absence 非否定、target-global empty default、promotion 非准入权威”和 candidate abandonment，才能证明它不是第二 authority。

## R3-4：dismissal 与 failed-recovery

### Authority 审查

两种事实并不语义冲突：

- dismissal 是 editor 的显式内容编辑，表示不再投影该 generation/output；它不声称外部任务失败。
- recovery failure 是由外层 authorization/cutoff 证明支持的事实，表示 owner actor 已无法合法终止该 begin。

`tombstone > dismissal > owner terminal > recovery failure > active` 的 precedence 使并发到达收敛。保留两者有产品价值：离线时可 dismissal；联网并完成 revoke 后可记录正式 owner-unavailable。删除其中任一都会损失可用性或事实精度。

但当前 wire/key 还不闭合。路径 `generationRecoveryFailures/<generationId>/<cutoffProofDigest>` 允许多个不同 proof digests，而 caps 又宣称每 generation 只有一个 valid marker。后续 membership cutoffs 都可能再次证明 actor 已 revoked；若全部合法，集合可无界增长且“one marker”是事实错误。

必须冻结唯一 owner-loss proof：服务对 exact `{projectId, projectEpoch, beginActorId, beginAuthorizationEpoch}` 只产生一个 canonical transition receipt/digest，代表该 authorization instance 首次从 active editor 变为 revoked/replaced。Canvas 使用单 key：

```text
generationRecoveryFailures/<generationId>
```

value 绑定 exact begin digest、begin actor/authorization epoch 和 canonical owner-loss cutoff digest。因为 proof 唯一，所有并发 claimant 写完全相同 bytes；actor/message/stamp 不进入 marker，审计身份留在 causal frame。后续 cutoff 不能生成第二 marker。

### Package boundary 审查

候选让 `@convax/project/collaboration-protocol` “提供 permit”，但 `@convax/canvas` 不能反向依赖 Project type。精确方向应是：

- Canvas 公开并拥有一个 headless `GenerationExternalFactContext` port，查询 exact `{generationId, beginDigest, proofDigest}` 是否已有 verified owner-loss fact。
- `@convax/project` 的 composite verifier先验证 MembershipCutoff/authorization receipt，再以只读 context 实现该 Canvas port。
- local non-serializable permit只存在于 Project composition/application call context，不进入 typed intent/Y.Doc/frame；wire intent 与 stored marker只含 canonical proof digest。
- remote validator缺 proof artifact 时进入 `recovery-proof-unavailable` pending，不得把结构正确当授权正确。

Canvas 不导入 Project/membership，不调用服务，也不能公开一个任意 caller 可自行构造的“verified=true”对象。

### State machine 审查

以下状态转换闭合：

- active + owner terminal → succeeded/failed；
- active/terminal + dismissal → dismissed；
- active + verified canonical owner-loss fact → failed-recovery；
- failed-recovery + dismissal → dismissed；
- node tombstone → hidden。

owner terminal outside cutoff 不进入团队 history。若 owner terminal 位于 cutoff survival closure，recovery intent必须失败；若 terminal 与 recovery基于同一未决 cutoff 并发，outer cutoff 先决定 terminal 是否 survive，再执行上述 projection，不能由消息到达顺序决定。

### Caps 审查

固定单 dismissal marker和单 recovery marker后，每 generation 为 O(1)。原始 claims/frames仍受 normal history/compaction retention，不在 Canvas root 建 actor/proof 无界 map。proof artifact走 collaboration artifact cap，不得塞入512 KiB Canvas intent；intent只携带64-hex digest和固定字段。

### Failure-state 审查

保留候选五个 command failures，并补充 `recovery-proof-noncanonical`：一个能证明 owner 已失权、但不是该 authorization instance canonical first-loss receipt 的 proof必须拒绝，避免同一事实多 marker。

`dismissed` 绝不映射为 failed/cancelled/refunded，`failed-recovery` 也只表示 authoring owner unavailable，不推断外部任务真实执行/计费结果。

### 最强反驳

两条终止路径增加用户与 Plugin 的认知负担：editor dismissal 后再出现 retained success 或 failed-recovery fact，UI 很容易错误显示退款/失败；canonical first-loss receipt又加强了服务 membership 控制面。

反驳成立。若产品只需要“别再显示 loading”，单 dismissal 更简单；候选保留 recovery 的唯一理由是 Agent/UI确实需要可验证地区分“用户隐藏”与“owner 被撤销无法终止”。UI contract 和 telemetry 必须用不同枚举，禁止合并文案。

### 可证伪测试

1. dismissal/owner success所有到达排列均投影 dismissed，terminal/blob retention不变。
2. owner terminal在 cutoff内 survive 时 recovery拒绝；在 cutoff外时 canonical proof接受，迟到 terminal recovery-only。
3. 同一 canonical owner-loss proof由两个 editors并发提交，Canvas root只有一个完全相同 marker。
4. 后续 membership cutoff或非 canonical proof返回 `recovery-proof-noncanonical`，不新增 key。
5. Project proof缺失时 remote frame pending，补齐 exact proof后才验证；Canvas package import graph不出现 Project/API/membership。
6. dismissal、failed-recovery、failed、cancelled、refunded telemetry/string枚举互不别名。

### 本项裁决

**REJECT AS WRITTEN**：dismissal + failed-recovery 的双语义可以签，但 marker 唯一性和 permit 依赖方向必须先按最小 patch闭合。

## 最小语义 patch

以下修改足以把本评审从 REJECT 变为 SIGN；不要求改动候选未涉及的 round-2 一致条款。

1. **R3-1 carrier 与状态：**把 320 MiB carrier 明确定义为 `proposal snapshot + all parent snapshots <= 256 MiB` 且 `suffix <= 64 MiB/4096`；把“None is team-ready”改为“None authorizes pruning；只有缺失 bootstrap-required payload使新副本不 team-ready”。声明 executable Plugin artifacts 不具 attestation eligibility。
2. **R3-2 reset reason：**把 `logical-counter exhaustion` 收窄为 document-wide Lamport exhaustion；actor sequence exhaustion轮换 actorId。把 equivocation收窄为“无法从任何受信 checkpoint重建”的 document corruption；普通 fork走 quarantine/revoke。
3. **R3-3 registry authority：**把“discovery/security superset”改为“可能落后 ProjectIndex 的 registered-scope discovery index”；明确 absence/promotion都不决定 route/content validity；target cutoff 对 manifest 未列出的所有 scope默认 empty frontier。
4. **R3-3 recovery：**增加 retained terminal `abandoned` 状态和签名 abandonment claim以释放 outstanding slot；promotion只绑定 immutable genesis proof；增加 project registry claim total 64 MiB cap，并把 `scope-unroutable`归于 client projection。
5. **R3-4 marker：**为 begin actor authorization instance定义唯一 canonical first-loss cutoff receipt；recovery root改成每 generation单 key/固定值，非 canonical后续 proof拒绝。
6. **R3-4 port：**由 Canvas拥有 `GenerationExternalFactContext` port，Project composite verifier验证 cutoff后注入；permit不可序列化且不作为 Canvas对 Project的依赖，remote缺 proof进入 pending。

## 最强整体反驳

领域专家否决候选最有力的三条理由是：

1. **双门槛叠加了两套成本却共享同一个 bug 域。** attester 与 editors 多半运行同一 validator，不能宣称真正独立的实现多样性；只增加隐私、算力和离线阻塞。
2. **registry 仍可能悄悄成为 authoritative admission list。** 一旦 bootstrap、cutoff 或 UI把 absence/candidate当 invalid，离线创建和 ProjectIndex唯一权威立即失效。
3. **generation 两种非 owner 结束方式会被产品层混为一谈。** dismissal、owner failure、外部 task failure/cancel/refund如果没有严格枚举，会造成错误计费和资源回收。

漏洞类型分别是：共同模式失效的隐含假设、派生索引升级为第二权威、以及相邻状态的语义混淆。上述最小 patch能关闭 authority 漏洞，但不能消除双 gate 的成本或 P2P 无 holder 的可用性取舍。

## 可证伪的最终签署门槛

- 双 gate 分别可被单独置坏：坏 certificate + honest editor、合法 certificate + 缺 floor都必须禁止 prune。
- 所有 caps存在 exact-limit/over-one/decompression fixtures，carrier算术与 parent/snapshot组合没有不可表达的隐含例外。
- 离线未登记 Canvas可由已有 Peer协作；revoke后未列 scope默认 empty target frontier；registry永远不能使 ProjectIndex route live/closed。
- Canvas reset crash全排列不产生双 live shard；普通 actor fork/sequence exhaustion不触发破坏性 shard reset。
- generation双路径全排列只有一个 recovery marker；Project proof缺失fail closed；Canvas import graph保持向下依赖。
- 服务全路径取证证明 payload-zero durable storage，attester临时存储在正常完成、超时、取消、OOM和进程崩溃后均按明确机制清理。

## 评分与精确 digest 决定

当前精确候选评分：**7.2 / 10**。

超过 7 的原因是双 gate、Project-owned shard reset、ProjectIndex唯一 route权威和 dismissal/recovery语义分离的主干没有重大方向错误；剩余问题可由六条局部 patch关闭，不要求重建因果协议。

扣分点：carrier cap自相矛盾（-0.5）；registry对离线未登记 scope的 cutoff缺口和第二 authority歧义（-1.0）；candidate无 abandonment/backpressure恢复（-0.3）；generation marker/permit未闭合（-0.7）；reset trigger过宽（-0.3）。

对 SHA-256 `4e97fff4045b1877434f7f3a94232ae4ddb264f62dc200dd484ba3455e95393f` 的最终决定：**REJECT**。

只有候选按“最小语义 patch”产生新字节与新 digest后，才可请求本 reviewer重新签署；不得把这些修改作为非规范注释附加到旧 digest。
