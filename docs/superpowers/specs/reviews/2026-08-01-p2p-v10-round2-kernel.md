# P2P v10 第二轮因果内核裁决

日期：2026-08-01

评审范围：`R2-1` 至 `R2-9`。本轮已完整阅读 Canvas、因果内核、服务三份第一轮 review 及中性 round-2 差异表。本文允许并实际撤回第一轮意见；目标是冻结一套能由三方共享的语义，不保护因果内核草案。

## 第二轮威胁模型与所有权前提

以下裁决只在这个明确威胁模型下成立：

- 服务端是 membership、role、replica enrollment/revoke、registry anti-rollback 和 stable-set coverage 的控制面信任根；它可以拒绝服务或返回旧数据，但不能伪造 replica 签名。
- PeerJS、单个 Peer、单个 editor replica、checkpoint header、holder assertion 和网络到达顺序均不可信。
- 一个 stable checkpoint set 的内容安全假设是：签署它的完整 active-editor replica set 中至少一个 verifier 诚实且运行了冻结 digest 的确定性 validator。若完整 active-editor set 全部串谋或全部被攻破，协议不保证被裁剪历史的业务合法性。
- viewer 没有 portable edit authority，不是旧 base 工作的来源，也不进入 compaction safety quorum。viewer 升级为 editor 前必须先 bootstrap 当前 stable floor，再获得 active editor credential。
- 团队 owner/admin 可以撤销设备并因此把该设备尚未进入 cutoff 的工作送入 recovery；这不是服务器编辑顺序。
- 服务端永不接收 Yjs snapshot、typed intent、causal frame、普通 Project 文件或 blob payload。若未来要求抵抗完整 editor set 串谋，必须新增独立内容 attester 或保留完整 genesis history，并重新做隐私和包边界设计。

所有权固定如下：`@convax/collaboration` 拥有通用 frame、checkpoint、stable-set、floor、journal 和 session undo coordination；`@convax/canvas` 拥有 Canvas reducer、schema、generation/containment 与 semantic inverse；`@convax/project` 拥有 ProjectIndex、Canvas route 和 collaboration scope 的 Project 语义；`@convax/project/node` 拥有 native durability/blob adapter；服务/API 只消费 browser-safe protocol DTO 和签名摘要，不导入或重实现 Canvas reducer。

## R2-1：checkpoint 内容信任

### 可冻结方案

撤回服务内容 attester。checkpoint 分成三个状态，且状态名不得互换：

1. `candidate`：actor-signed checkpoint header 与 holder metadata 已进入服务的有界目录；内容未经服务验证。
2. `validated-local`：某 replica 已取得 exact checkpoint、必要 parent/suffix、schema/validator artifacts，在本机重建 exact closure，验证 canonical state、typed intent、closed diff、state vector 与 snapshot digest，并 durable 保存。
3. `stable-peer-validated`：R2-2 定义的完整 active-editor set 对同一个 `StableCheckpointSetCoreV2` 签名，服务只验证签名、成员覆盖、scope、bounds 和 CAS，发布 `contentStatus: "peer-validation-coverage"` 的 receipt。

服务 receipt 永远不得出现 `content-valid`、`service-validated` 或等价承诺。普通接收者在历史仍存在时必须自己验证；合法裁剪后，新设备依赖 exact stable-set core、全体 ACK、服务 coverage receipt、保留的 checkpoint bytes 和 actor boundaries。这明确采用“至少一个 active editor verifier 诚实”的安全假设。

### 理由与漏洞类型

服务内容 attester 会把 Yjs、Canvas reducer、Plugin validation artifact 和最高 320 MiB 载荷引入 API 边界，违反当前 `future apps/api` 只消费通用 collaboration/project protocol 的方向，也形成集中隐私与 DoS 面。第一轮用 attester 解决“单个恶意 Peer”时，忽略了“所有仍有写权的 replica 联合确认”这一替代信任模型，属于忽略替代方案和包边界泄漏。

### 撤回的第一轮条款

撤回第一轮 C2“服务 transient 验证完整 checkpoint 并签内容证书”的全部条款；同时撤回 C9 中“服务 attester 计算实际 causal frontier”的内容权威。因果内核草案 1.2、7.2 至 7.4 中 attester、content certificate 和 payload carrier 必须删除或重写为 replica validation 与 coverage receipt。

### 最强反驳

全体 active editors 可以串谋签一个从未由合法 intents 产生、但当前 schema 表面合法的 snapshot。历史一旦裁剪，新成员无法发现该伪造；这比独立服务 attester 的拜占庭容错更弱。

反驳成立且不能用措辞消除。本轮选择的理由是：editor set 本来就拥有 Project 内容写权，完整 editor set 串谋不在 v2 威胁模型内；若产品要求防这种串谋，本方案必须整体 REJECT，而不是把 metadata receipt 伪称内容证明。

### 可证伪测试

向服务提交一个签名/header/hash 正确但含 hidden Y.Map 的 checkpoint。服务只能存 unverified candidate metadata，且所有 store/log/trace 中不得出现 payload；一个诚实 editor 必须拒绝签 stable-set core，因此服务不能生成 coverage receipt。模拟全部 active editors 对坏内容签名时，测试必须明确展示新 Peer 会在该威胁模型下接受，确保实现没有虚假声称拜占庭安全。

## R2-2：causal stability 覆盖集合

### 可冻结方案

每个文档的稳定水位由**精确 membership snapshot 中全部 active editor replicas**共同签署；viewer、pending-editor、已撤销或已降级 replica 不参与。

`StableCheckpointSetCoreV2` 至少绑定：完整 document scope、prior stable-set digest/revision、最多 8 个排序唯一 checkpoint digests、各 checkpoint computed frontier digest、合并后的 stable frontier digest、checkpoint actor-head-boundary digest、membership snapshot digest、validator artifact-set digest 和 protocol digest。

每个 `ReplicaStableSetAckV2` 绑定同一个 core digest、replicaId、actorId、actor head at ACK，并断言：

- exact checkpoint set 与 causal closure 已完整验证；
- checkpoint bytes 与 ACK 已 fsync；
- 该 replica 的所有 durable local frames 至少已进入 core 的 stable frontier，或仍在 outbox 时拒绝 ACK；
- signer 已持久安装 monotonic floor，此后新 frame base 必须因果支配该 stable frontier。

服务验证 ACK 恰好覆盖 membership snapshot 的全体 active editors，并以 prior revision 做 CAS。并发 membership mutation 使未完成提案失效。长期离线 editor 无限期阻止 stable advancement；唯一绕过方式是显式 revoke/cutoff。viewer 升级必须先作为 `pending-editor` 完成当前 floor bootstrap/ACK，再原子进入新 active-editor snapshot。

### 理由与漏洞类型

只有仍能签旧 base 帧的主体会破坏 causal stability，因此 viewer validation 与裁剪安全无关。把 viewer 加入 quorum 会让只读访客和离线浏览器无理由阻塞 GC，属于权限能力与数据持有状态混淆。按 actor 而不是 replica 计数又会让同一设备的历史轮换 key 重复投票。

### 撤回的第一轮条款

不撤回第一轮“全部 active editor replica floor ACK”的核心选择；撤回其中把 ACK 仅描述为单 checkpoint certificate 的窄结构，改为签署完整 `StableCheckpointSetCoreV2`。删除任何让 viewer ACK 成为 compaction 前置的条款。

### 最强反驳

viewer 可能是 active editor set 全部失陷后唯一诚实、且持有完整历史的 verifier；排除 viewer 降低内容安全。另一个现实问题是遗失但未撤销的 editor 永久阻塞裁剪。

前者应由显式独立 auditor/attester 角色解决，不能让所有普通 viewer 变成可用性 quorum；后者只能由管理员承担 revoke 的 recovery 后果，禁止 timeout 自动退休。

### 可证伪测试

A/B 为 editor、V 为 viewer。A/B 全部验证并 ACK 后，即使 V 离线也可发布 stable set；B 离线时 A+V 不得发布。B 有一个未包含的 durable outbox frame 时必须拒绝 ACK。V 升级 editor 时，在完成 floor bootstrap 前不得签 edit。恢复 ACK 前的 A 设备副本并签 below-floor successor，所有 Peer 必须判为 fork/invalid，而不是正常 late frame。

## R2-3：actor sequence genesis

### 可冻结方案

首帧 `actorSequence = "1"`、`previousActorFrameDigest = null`；后续为精确无符号 `+1` 并引用同一 actor/document chain 的直接前驱。`"0"` 是非法 frame sequence，但不得用作“absence”序列化值；actor head 不存在始终编码为 `null`。拒绝负数、正号、空串、前导零和超过 u64。u64 耗尽时冻结该 actor chain，轮换为新 actorId，不回绕。

### 理由与漏洞类型

0 和 1 在正确性上没有差异，但三份协议必须只有一个字节级事实。选择 1 是为与两份独立 review 收敛；同时拒绝 service review 把 0 当索引 sentinel 的隐患，absence 仍使用类型化 null。第一轮坚持 0 主要是编码偏好，没有独立安全收益，属于把惯例偏好误当架构约束。

### 撤回的第一轮条款

撤回第一轮 C6 的 `"0"/null` 首帧规则以及因果内核草案 3.2 的同名条款，改为 `"1"/null`。保留严格递增、直接前驱和 canonical decimal 规则。

### 最强反驳

零起点与数组/计数模型更自然，且 nullable head 已消除 sentinel 歧义；改成 1 只是机械 churn。

反驳成立，但当前尚未实现且两份 review 已选 1。协议一致性的收益高于无安全含义的零起点偏好。

### 可证伪测试

Bun、Chromium 与服务 codec 共享 golden：`1/null`、`2/digest(1)` 通过；`0/null`、`1/non-null`、`2/null`、`01`、u64+1 全部在语义解析前失败。任一运行时产生不同签名字节即失败。

## R2-4：document epoch

### 可冻结方案

撤回独立 `docEpoch`。v2 document scope 精确为：

```text
{projectId, projectEpoch, documentKind, documentId, shardEpoch}
```

`projectEpoch` 只在整个 Project collaboration universe 的显式破坏性 reset 时变化。`shardEpoch` 是单文档协同 incarnation：checkpoint、compaction、membership/session 变化均不改变；单 Canvas 的显式内容 reset、不兼容 schema cutover 或不可恢复 corruption 会由 `@convax/project` 通过 ProjectIndex route mutation 创建新随机 shardEpoch，并保留旧 shard bytes 为 unsupported/recovery。Canvas delete/recreate默认创建新 CanvasId；只有显式 reset 才允许相同 CanvasId 配新 shardEpoch。ProjectIndex 自身不可恢复或不兼容时滚动 projectEpoch，因为它是整个 Project catalog 权威。

任何 reset 都必须有 `DocumentShardResetClaimV2` 或 `ProjectResetClaimV2`，绑定旧/new scope、闭合 reason enum、schema/protocol digest、操作者和用户确认 receipt；不得把 reset 当普通 revoke、checkpoint 或错误恢复快捷键。

### 理由与漏洞类型

`shardEpoch` 和 `docEpoch` 若都能重建同一 Canvas 文档，拥有重叠不变量；实现会出现只检查其中一个、ProjectIndex route 指向一个而 collaboration store 使用另一个的分裂。既然 `@convax/project` 已拥有 Canvas route/incarnation，单文档 reset 也应通过该所有者更新 shardEpoch。第一轮保留 docEpoch 受旧全局 cutoff 设计影响，属于重复身份和忽略现有替代方案。

### 撤回的第一轮条款

撤回第一轮 C7“保留 narrow docEpoch”的全部条款；删除因果内核草案所有 `docEpoch`、next-doc genesis 和签名 scope 字段。根 `AGENTS.md` 与 `docs/architecture.md` 中提及 docEpoch rollover 的当前契约也必须在 canonical spec 获得 3/3 签署后作为同一架构变更一起更新，不能让代码与契约分叉。

### 最强反驳

ProjectIndex corruption 只能通过 projectEpoch 重置，故障域比独立 docEpoch 大；Canvas reset 又必须跨 ProjectIndex/Canvas 两个分片协调 route mutation。额外 docEpoch 可以在不碰 route 的情况下局部 fence 历史。

但“不碰唯一 route 权威就替换 route 后的协同宇宙”本身是第二控制源。ProjectIndex 是整个 catalog；其不可恢复损坏本来就不能保证其他路由可信。跨分片 staged reset 比重叠 epoch 更可审计。

### 可证伪测试

普通 revoke/checkpoint 不改变任何 scope。重置 Canvas A 时，先 staged 新 shard genesis，再提交 ProjectIndex route 到新 shardEpoch，再激活；A 的旧帧拒绝，Canvas B 与 ProjectIndex actor chains 不变。模拟崩溃于三阶段每一处，不得同时暴露两个 live shard，也不得丢旧 bytes。任一 wire/schema/路径仍要求 docEpoch 即失败。

## R2-5：协议 bounds

### 可冻结方案

冻结以下 v2 上限，按最终 wire bytes 在大对象分配/Yjs decode 前执行：

| 对象 | 上限 |
| --- | ---: |
| frame JCS/binary header | 64 KiB |
| 完整 canonical typed intent（含 guards） | 512 KiB |
| causal context | 64 KiB |
| base state vector | 64 KiB |
| 单个 Yjs delta | 1 MiB |
| actual write evidence | 256 KiB |
| 完整 causal edit envelope | 2 MiB |
| 单 checkpoint snapshot | 32 MiB |
| checkpoint direct parents | 8 |
| stable checkpoint set | 8 checkpoints |
| checkpoint causal frontier heads | 256 |
| validation suffix | 4096 frames 且 64 MiB |
| replica validation carrier | 320 MiB；其中 parent snapshots 合计 256 MiB |

完整 envelope 上限优先于所有子上限。服务不接收 validation carrier。服务可为 discovery 保留最多 32 个未稳定 candidate tip headers，但它们不是 stable frontier/tips，不得替换 parent 或赋予 prune 权威；每 replica 最多占 4 个 candidate tips，超限返回 backpressure。

### 理由与漏洞类型

512 KiB 是 Canvas 已定义的批量 creation group/Plugin bounded state 需要；把 write evidence 收至 256 KiB 后，`64 + 512 + 64 + 64 + 1024 + 256 = 1984 KiB`，仍受 2 MiB 总 cap 约束。8 个 32 MiB parent snapshots 恰好匹配 256 MiB 聚合上限；32 parents 的理论载荷达到 1 GiB，与 320 MiB validation carrier 自相矛盾。把未验证 candidate backlog 与 stable tip 混为一个 cap 也是语义混淆。

### 撤回的第一轮条款

保留第一轮 512 KiB intent、8 parents/stable tips、2 MiB envelope；撤回“服务 attester carrier”名称，改成纯 Peer/replica validation carrier。补充 complete intent 已包含 guard，避免把独立 256 KiB guard 与 512 KiB intent 相加两次。

### 最强反驳

512 KiB JSON 足以造成主线程卡顿；8 个 parent 使 9 个长期分区必须先额外合并，32 个 candidate headers 又给恶意 editor 留下目录 DoS 空间。

decoder 必须流式/长度优先且验证不在 renderer 主线程。第 9 个 checkpoint 不阻止普通 edit，只要求 holder 在稳定化前建立有界 merge tree；candidate quota 和 Project 总 scope cap 限制授权 editor DoS。

### 可证伪测试

每个子字段 exact limit 通过、超一字节失败；所有子字段合法但 envelope 超 2 MiB 仍失败。构造 9 个并列 checkpoint，必须能以每节点最多 8 parents 的两层 merge tree得到同一 closure；不得丢第 9 支。提交 33 个 candidate tips 或同 replica 第 5 个 tip时，在读取 payload 前拒绝。任何服务 endpoint 接受 320 MiB carrier 即失败。

## R2-6：frontier authority 与 invalid child

### 可冻结方案

内容 frontier 的权威是完整 active-editor set 共同签署的 `StableCheckpointSetCoreV2`，不是服务计算，也不是单个 author 的 declared parents。

服务维护两个严格分离的目录：

- `candidateCheckpointCatalog`：保存有界、签名但内容未验证的 headers、declared parents 与 holders；append-only fallback metadata，不改变 stable frontier。
- `stableCheckpointSet`：保存一个 CAS 版本的、最多 8 checkpoint digests 的 core、全 active-editor ACK digests 和 service coverage receipt。服务只验证签名/覆盖/格式/CAS，不计算 Yjs causality。

每个 editor 在签 ACK 前独立从 exact content 计算 maximal causal frontier，并要求与 core 中 frontier digest 一致，验证 set 覆盖 prior stable set closure 以及该 replica 的 durable local heads。更新 stable set 必须引用 prior stable revision/digest；并发提案只有一个 CAS 成功，失败提案仍是 candidate，随后可与胜出 stable set 合并。该低频 CAS 只排序 compaction metadata，不排序、拒绝或改写 edits。

candidate child 无论 declared 何种 parents，都不能移除 parent header、holder 或 stable entry。invalid child 无法获得至少一个诚实 editor 的 ACK，因此不能进入 stable set；若完整 editor set 串谋，则落入 R2-1 已公开的威胁模型边界。

### 理由与漏洞类型

无服务内容解析时，服务不可能独立证明 causal dominance。单个 author 声明 parents 同样不可信。把全 editor 的确定性验证结果绑定成一个 stable-set core，既保持服务边界，又给合法 compaction 一个清晰的联合授权。第一轮让服务 attester 计算 Max 依赖已撤回的信任模型。

### 撤回的第一轮条款

撤回第一轮 C9“服务 verifier 计算 actual frontier、invalid child 不获 certificate”的条款。改为所有 active editors 计算并签同一 frontier digest；删除 content certificate/maximum-frontier anchor，替换为 candidate catalog 与 stable-set coverage receipt。

### 最强反驳

服务 CAS 的先后决定哪个并发 checkpoint set 先成为裁剪水位，且完整 editor set 可共同谎报 dominance；这看起来像换了名字的在线顺序和分布式 attester。

CAS 不改变 edit DAG，也不让失败 proposal 丢失，下一提案必须合并，因此只序列化 GC safety state。联合 validator 确实是分布式 content attester；本轮明确承认而不是否认，并把完整串谋列为不覆盖的 threat。

### 可证伪测试

发布 valid A/B 和 invalid C（C 声明 A/B parents）。candidate catalog 必须保留 A/B/C；诚实 editor 拒签 C，因此旧 stable set 不变。创建 valid merge D 后，全 editors 对同一 core 签名，stable set 才前进。交换 candidate 到达顺序不改变 Peer 验证结果；并发 D/E stable proposals 中 CAS loser 不丢 payload/header，后续 merge F 必须包含二者 causal closure。

## R2-7：服务 document discovery

### 可冻结方案

采用 grow-only、非路由语义的 `CollaborationScopeRegistryV2`。它在一个 projectEpoch 中包含 ProjectIndex scope 及每个曾声明的 Canvas `{documentKind, documentId, shardEpoch}`，最多 4096 项；不含 title、URI、live/staged/closed、activeCanvas 或 current route 字段。

ProjectIndex scope 在创建 collaboration membership 时登记。Canvas 由 current editor 的 `DocumentRegistrationClaimV2` 登记，claim 绑定 exact scope、genesis checkpoint header digest、ProjectIndex causal-dependency digest、actor/replica、membership snapshot 和 protocol/schema digest。服务只验身份、签名、格式、cap 与幂等，不验证 payload。相同 scope/digest 重放成功；同 CanvasId 的新 shardEpoch 只接受 R2-4 的 Project-owned reset claim；条目在 projectEpoch 内不删除。

registry 以 sequence+digest 签名，客户端持久 high-water；降序或同序不同 digest fail closed。它只回答“哪些协同 scope 可能有数据”和“cutoff 必须覆盖哪些 scope”。Canvas 是否可见及哪个 shardEpoch live，只由已验证 ProjectIndex 决定。cutoff 对无可用稳定 checkpoint 的登记 scope 可以记录 empty target frontier，使目标 actor 全部该 scope 工作 recovery-only；授权撤销不因恶意空 scope 永久阻塞。

### 理由与漏洞类型

从 certified ProjectIndex 派生 inventory 依赖已撤回的服务 content attester；让服务信任 ProjectIndex header 又会把未验证内容变路由权威。grow-only security/discovery superset 有独立、较弱且可测试的不变量，不是第二 Project catalog。第一轮把“服务需要 scope coverage”直接等同于“服务需读 ProjectIndex”属于逻辑跳跃。

### 撤回的第一轮条款

撤回第一轮 C10“服务只从 certified ProjectIndex checkpoint 派生 `DocumentScopeInventoryV2`”的条款。采用 current-editor-signed unverified scope registration，但明确删除任何 `accepted genesis`、route state 或注册即 live 的措辞。

### 最强反驳

恶意 editor 可在 4096 cap 内注册大量假 scope，消耗目录和 cutoff 工作；服务也不能证明 genesis 与 ProjectIndex dependency 真实存在。grow-only 垃圾在 projectEpoch 内无法删除。

这是授权 editor 的有界 DoS，不是静默内容篡改。需加每 actor candidate/registration rate quota、管理审计和显式 project reset；若产品要防授权 editor 的全部 DoS，就必须引入内容 attester或 admin-only Canvas creation，超出本轮威胁模型。

### 可证伪测试

离线创建 Canvas 后先经 Peer 同步，再恢复服务并注册；registry 收敛但 UI 在 ProjectIndex route 验证前不显示它。删除 route 后 registry 保留且 UI/Agent 不可见。伪造 genesis 可占一个有界 metadata entry但永远不能成为 live route/stable checkpoint。遗漏任一 registry scope 的 cutoff receipt 必须拒绝；同序不同 digest 必须触发 anti-rollback quarantine。

## R2-8：generation owner 丢失

### 可冻结方案

采用 Canvas-owned grow-only dismissal，不引入 membership cutoff proof，也不允许跨设备伪造 owner terminal。

Canvas v2 root 新增 `generationDismissals`，按 `generationId` 再按 `actorId` 的预定义 actor slot 存 immutable `GenerationDismissalV2`。新增 closed intent `canvas.generation.dismiss/2`，仅 current editor 可提交，必须在 exact base 中观察到对应 immutable begin，并绑定 begin digest、generationId、dismissal actor/stamp 和 bounded reason enum。

任一合法 dismissal 的存在即把该 generation 投影为 `dismissed`，抑制其 lifecycle active 状态和 generation output；它不伪造 terminal、不删除 begin/terminal bytes、不删除手工 data claim，也不触发退款/取消外部任务的隐式副作用。owner terminal 仍只能由 begin 的长期 actor 创建。dismissal 与 terminal 并发或先后到达均由 dismissal 胜出；node tombstone 仍压过全部 generation 状态。撤销 actor 的 dismissal 是否进入团队历史继续由普通 causal cutoff 决定，Canvas 不读取 membership proof。

### 理由与漏洞类型

cutoff-proof `FAILED_RECOVERY` 把 membership 事实注入 Canvas schema/verifier，倒置 `canvas -> collaboration` 的依赖语义，并把“停止展示等待状态”冒充“另一设备确认工具失败”。完全不处理则会永久 active。dismissal 是用户可见、单调、可审计的 Canvas intent；editor 本来就有删除/修改该节点的能力，却不能伪造外部成功。

### 撤回的第一轮条款

撤回第一轮 C14 的“非 owner 可凭 cutoff proof 写 `FAILED_RECOVERY` terminal actor slot”全部条款。改为独立 dismissal claim；保留 flat containment、确定性删环、owner-only terminal、begin-time output priority、delete-wins 和 creation-group whole invalidation。

### 最强反驳

任一 editor 都可抢先 dismissal 一个稍后成功的合法生成，隐藏团队可能想保留的结果；服务若仍在计费，Canvas dismissed 也不代表外部任务取消。

editor 已有删除节点的等价破坏权限，dismissal 又比伪造 terminal 更可审计。UI 必须把 `dismissed` 与 `failed/cancelled/refunded` 分开；外部取消是 Plugin/Agent 独立副作用及结果，不由 Canvas projection 推断。

### 可证伪测试

owner begin 后永久离线，另一 editor dismissal，所有 Peer 结束 active 状态。随后以所有到达顺序送达 owner success，输出仍 suppressed，但 terminal bytes 保留；手工 data claim 不被 dismissal 删除。非 owner terminal 必须拒绝。离线/撤销 actor 的 dismissal 走普通 C3 cutoff，不得因 Canvas 查询 membership 获得不同结果。

## R2-9：undo coordinator

### 可冻结方案

`@convax/collaboration` 的 transient `SessionUndoCoordinator` 是本地 session undo/redo cursor 的唯一所有者；它保存当前文档的 durable local root operation ids，不是 Y.Doc/domain truth，进程重启、full rebuild、project/shard reset 时清空。远端 frames 不进入、不排序、不清空 stacks。

本地 root 只有在 causal frame durable commit 后入 undo stack；新的 root 清空 redo。undo 读取栈顶 root，调用 `@convax/canvas` semantic-history/inverse port 在最新 replicaDoc 上生成闭合 inverse intent，经 isolated candidate 验证并 durable 提交后，coordinator 才原子地把 root 从 undo 移到 redo。redo 同理生成 forward intent；需要重建实体时使用新 identity。stale guard、missing blob/artifact、取消、崩溃或 fsync 失败均不移动 stacks。

`Y.UndoManager` 只可作为非权威的本地 capture/分组实验；raw inverse update 永不进入 authoritative doc、journal 或 wire，且实现不得依赖未公开的 stack mutation。若公共 API spike 不能证明非变异 peek 与 commit-after-fsync，则 v2 完全不实例化 UndoManager。

### 理由与漏洞类型

Y.UndoManager 没有协议级“两阶段 peek → candidate validate → fsync → commit stack move”，直接在 live doc 上 undo 会越过 candidate barrier。第一轮说“UndoManager 选择但不应用 raw update”没有给出可实现的原子转移，属于隐藏实现假设。session cursor 是选择状态，不是第二份 Canvas 数据。

### 撤回的第一轮条款

撤回第一轮 C15“Y.UndoManager 在 replicaDoc 上跟踪并选择 durable local root”的权威表述。保留 semantic inverse/forward frame、remote 不清栈、commit 后移栈、失败不移栈与不跨重启规则。

### 最强反驳

这明显弱化了“undo/redo 交给 Yjs”的原始产品倾向，并增加一套自有栈；semantic inverse 覆盖所有 intent 的工程量也高于 CRDT 原生 undo。

Yjs 仍是唯一 durable 数据源，但它不能替代 Canvas 业务不变量。若 public API spike 证明 UndoManager 可在隔离 shadow doc 上可靠提供分组/选取，可把它作为 coordinator 内部实现；不能让库偏好改变提交原子性。

### 可证伪测试

本地 A1、远端 B1、本地 A2 后，undo 只选 A2且 B1 保留。先让 inverse stale，栈与 doc 均不变；随后在非冲突 base 成功，只有 fsync 后 root 才移至 redo。对 object/outbox/journal/head 每一崩溃点做注入，重启后 stack 清空且 durable doc 不出现 raw undo transaction。Monkey-patch/trace Y.Doc，任何 authoritative origin 来自 UndoManager 即失败。

## 第二轮完整 clause set

本评审签署以下不可拆分语义集合：

1. 服务不接触 collaboration content；checkpoint 先本机验证，只有完整 active-editor set 的联合签名与服务 coverage/CAS 才产生可裁剪 stable set。
2. stable coverage 只包含当前 active editor replicas；viewer 不参与，pending editor 必须先跨过当前 floor。
3. actor sequence 从 `"1"` 开始，absence 用 `null`，`"0"` 不作为 frame 或 sentinel。
4. v2 无 `docEpoch`；Project reset 使用 projectEpoch，单文档 incarnation/reset 使用 Project-owned shardEpoch。
5. typed intent 512 KiB、frame 2 MiB、snapshot 32 MiB、direct parents 8、stable set 8；candidate discovery backlog 与 stable tips 分离。
6. candidate checkpoint DAG 是不可信 discovery metadata；stable frontier 是全 active editors 对同一 core 的联合验证声明，服务只验证覆盖和 CAS。
7. 服务 scope registry 在 projectEpoch 内 grow-only、无 route state；ProjectIndex 是 Canvas live/tombstone/current shard 的唯一权威。
8. generation owner 丢失由 Canvas grow-only editor dismissal 收敛；不伪造 terminal、不读取 membership、dismissal 抑制 lifecycle/output。
9. SessionUndoCoordinator 拥有 transient root cursor；undo/redo 是最新 base 上的 semantic intents，UndoManager 不具权威。

## 最强整体反驳

领域专家否决该完整 clause set 最有力的三条理由是：

1. **联合 editor 签名不是独立内容证明。** 完整 editor set 串谋可伪造被裁剪历史，新成员无法重放发现；本方案的安全等级低于独立 attester或永不裁剪。这个威胁模型若不被产品明确接受，整套方案应被否决。
2. **一个遗失 editor 可无限阻止 compaction。** 显式 revoke 是唯一逃生口，但会把其未同步工作变成 recovery；“长期离线、无损自动合并、有界历史”仍不能三者兼得。
3. **v2 仍是一套分布式数据库。** canonical codecs、Yjs traversal、Canvas reducer、Plugin artifact、URI、stable-set CAS 和 blob proofs 任一漂移都会分裂历史。没有跨 Bun/Chromium/service golden、模型测试、消息全排列和 crash injection，文档一致不等于工程可行。

漏洞类型分别是：受限威胁模型、不可兼得的隐含产品承诺，以及跨运行时确定性的事实风险。它们已被显式化，但没有消失。

## 可证伪的整体验收门槛

- 对同一 edit/checkpoint/stable-set/registry/URI bytes，Bun、Chromium 和服务 codec 的 canonical bytes、digest 与签名输入逐字节一致。
- 三至九个 Peer 做消息全排列、重复、丢包、断线重连、崩溃恢复、revocation、below-floor fork、invalid checkpoint child 和无 holder bootstrap，accepted canonical hash 与预期 recovery 状态一致。
- 服务持久库、对象存储、日志和 trace 的自动取证证明 collaboration payload 为零；向任一服务 endpoint 发送 payload carrier 在读取/解析内容前失败。
- package-boundary、pack clean-consumer 和 import scan 证明 API 未导入 Canvas reducer，Canvas 未导入 membership/service，renderer 未持有 durable authority。
- generation dismissal 与 semantic undo 的 shadow/live Y.Doc instrumentation 证明没有到达顺序 winner、跨设备 terminal forgery 或 raw UndoManager authoritative transaction。

## 第二轮签署决定

**SIGN** 上述完整 round-2 clause set，架构评分 **8.3 / 10**。

扣分点：完整 active-editor set 串谋不在安全范围（-0.7）；遗失 editor 阻塞 compaction 或被 revoke 后损失 team visibility（-0.5）；无 holder 时新设备不可 bootstrap（-0.3）；跨运行时 validator 与 Undo public-API 可行性仍需 spike（-0.2）。

评分超过 7 的原因不是这些问题很小，而是它们已经成为显式权限、可用性和 threat-model 边界，不再产生 arrival-dependent winner、静默 LWW 覆盖、第二业务权威或本机证据上 wire。若产品要求抵抗完整 editor set 串谋、无限离线仍不阻塞 GC、或无 holder 永远可恢复，当前 SIGN 自动失效，必须改成 **REJECT** 并引入新的服务内容/存储架构。
