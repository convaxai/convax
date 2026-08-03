# Convax P2P Causal Collaboration Kernel

状态：**架构裁决草案，未进入 canonical contract**。本文件提出一个 breaking v2 协议；只有在三方
架构评审通过、更新 `AGENTS.md`、`docs/architecture.md`、package boundary 和 golden artifacts 后，
才可替代 2026-07-31 的 service-admission/MMR 方案。实现不得同时兼容两个协议，也不得把本草案的
类型加入当前 v1 parser。

本文中的“必须”“禁止”“仅”是 normative 要求。未知字段、未知 token、非 canonical 编码和超过
上限的值一律 fail closed。

## 1. 裁决

### 1.1 选择 P2P causal DAG，否决 per-edit service admission

每个编辑由设备 actor 签名并形成一个 causal frame。不同 actor 的 frame 没有全局 sequence、没有
全局 leaf、没有服务器 winner；Peer 只按 causal dependency 验证，Yjs 负责合并，Project/Canvas
canonicalizer 负责确定性业务投影。

服务端只拥有以下协同权限：

1. Project membership、role、membership epoch 和每设备 actor credential；
2. session、Peer rendezvous 和 freshness ticket；
3. 低频 checkpoint 的**验证与 frontier anchor**；
4. membership revocation/cutoff。

服务端禁止接纳单个 edit、分配 edit sequence、保存 Yjs update/typed intent/Project 文件 blob，或用
HTTP 到达顺序改变业务投影。服务端 checkpoint attester 可以在一次有界请求中短暂读取 snapshot 和
causal validation carrier；验证完成后只持久化 certificate、digest、actor boundary 和最大 frontier
antichain，禁止持久化 payload bytes。

### 1.2 为什么 checkpoint 服务角色不可再删

安全 bootstrap、历史 compaction、拒绝恶意 Yjs delta 三者不能同时由一个未经验证的 Peer snapshot
提供。若服务端也不验证 checkpoint，则 v2 只能二选一：

- 新设备从 Project genesis 重放全部 frame；或
- 明确把任意一个 editor Peer 当作可信 snapshot authority。

本草案拒绝第二项，也不接受无限历史作为产品承诺。因此 checkpoint attester/anchor 是必要的低频
信任边界；它证明某一 snapshot 对应一个有效 causal closure，但不为 closure 内的 edit 排序。

### 1.3 Owner

| Concern | Sole owner |
| --- | --- |
| generic binary envelope、causal DAG kernel、replica/candidate lifecycle、bounded ports | `@convax/collaboration` |
| ProjectIndex schema、Project/Canvas route dependency、membership/checkpoint wire DTO | `@convax/project` |
| Canvas schema、typed intent、closed diff、canonical projection、concurrency invariants | `@convax/canvas` |
| native journal/object/outbox/inbox/ACK/checkpoint/recovery storage | `@convax/project/node` |
| PeerJS、credential acquisition、runtime composition、renderer invalidation | `@convax/desktop` |
| membership/session/rendezvous/checkpoint attestation/frontier anchor/cutoff service | `@convax/api` |

Renderer、Agent 和 Plugin 只能提交 closed typed intent。它们不能提交 frame、Yjs update、actorId、
operationId、Lamport 值、frontier、credential 或 document-wide version。

## 2. Terms and canonical state

### 2.1 `replicaDoc`

`replicaDoc` 是本设备对一个 shard 的唯一 durable logical authority：一个或多个已验证 anchored
checkpoint snapshot，加上其后的已验证 causal frame closure。它可以在没有在线 Peer 和没有可用
服务端时接受本地 edit。

“accepted”仅表示 frame 已在**本设备**验证并 durable，不表示全团队共识。产品必须区分：

- `saved-locally`：本机 replica durable head 已包含 frame；
- `replicated`：至少一个其他当前成员设备返回并持久化了有效 durable ACK；
- `fully-offline`：当前结构引用的所有 blob 也已在本机 durable。

### 2.2 `candidateDoc`

每个 UI/Agent/Plugin command 在进入 shard commit mutex 后，从最新 `replicaDoc` 隔离 clone 一个
`candidateDoc`。一个 candidate 只应用一个 bounded typed intent 和一个 Yjs transaction。candidate
永不直接替换 `replicaDoc`；只有 exact signed frame 完成 native durable barrier 后，才可把其 delta
应用到内存 replica。

### 2.3 不再存在 `workingDoc` 与 team/local 双轨

离线 edit 与在线 edit 使用同一种最终 causal frame。v2 没有 provisional local fork、没有重连后
重新申请 admission、没有 `certifiedTeamDoc + workingDoc` 的双轨 authority。尚未完成手势的 React
Flow 状态仍是 transient UI state；一旦形成 command，就必须走 candidate/frame barrier。

### 2.4 Causal closure

一个 frame 的 causal closure 是其 `baseFrontier` 中每个 head 的递归 ancestor 并集。frame 自身不在
自己的 base closure 中。一个 checkpoint 的 closure 是其 manifest frontier 的 causal closure。

`F <= G` 当且仅当 `F` 中每个 head 都位于 `G` 的 causal closure 中。`Max(F)` 删除 `F` 中被另一
head 因果支配的项。合法 frontier 必须等于自身的 `Max(frontier)`。

## 3. Identity, device actors and logical clocks

### 3.1 每设备 actor

`memberId` 是团队成员身份；`actorId` 是一个 Project membership epoch 内的设备签名主体。一个成员
可以有多个 active actor，但两个设备禁止共享 actor private key 或 actorId。

```ts
type ActorIdV2 = string       // canonical unpadded base64url, exactly 32 bytes
type RandomId128V2 = string   // canonical unpadded base64url, exactly 16 bytes
type Uint64V2 = string        // canonical decimal, 0..2^64-1

interface DeviceActorCredentialV2 {
  format: "convax.device-actor-credential/2"
  projectId: string
  projectEpoch: RandomId128V2
  membershipEpoch: RandomId128V2
  membershipSnapshotDigest: string
  memberId: RandomId128V2
  actorId: ActorIdV2
  actorSigningPublicKey: string
  role: "viewer" | "editor"
  cutoffDigest: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: string
}
```

每个 Project 最多 256 个 active actor，每个 member 最多 8 个；总量上限优先。key rotation 分配新
actorId。actor credential 是 offline edit authority；短期 session/peer ticket 只授权 transport，不能
让 session TTL 否定已在当前 membership epoch 内创建的离线 edit。

### 3.2 Actor chain scope

Actor chain 的 scope 固定为：

```text
{projectId, projectEpoch, membershipEpoch, docKind, docId, shardEpoch, docEpoch, actorId}
```

每个 scope 的首帧 `actorSequence="0"`、`previousActorFrameDigest=null`。后续帧必须 sequence 精确
加一，并引用该 actor 的前一帧 digest。不同 shard 不共享 sequence，避免一个丢失 Canvas frame 阻塞
整个 Project。

### 3.3 Causal frontier and Lamport

```ts
interface CausalHeadRefV2 {
  actorId: ActorIdV2
  actorSequence: Uint64V2
  lamport: Uint64V2
  frameDigest: string
}

type CausalFrontierV2 = CausalHeadRefV2[]
```

Frontier 按 actorId decoded bytes 严格排序，actorId 唯一，最多 256 项。任一项都不能是另一项的
ancestor。frame 的 `previousActorFrameDigest` 必须位于 base frontier closure；否则 actor 在未观察
自己前一帧的 base 上写入，frame 无效。

首个 frame 的 `lamport="1"`。其他 frame：

```text
lamport = 1 + max(baseFrontier[*].lamport)
```

overflow 永久冻结该 document epoch，必须 rollover。Project/Canvas business stamp 使用
`(lamport, actorId decoded bytes, operationId decoded bytes, writeOrdinal)`；禁止使用 Peer 到达顺序、
Yjs clientId、服务端 anchor revision 或机器墙钟作为业务胜负。

## 4. Binary protocol

### 4.1 Envelope

v2 是 breaking protocol，不读取 v1：

| Offset | Length | Field |
| ---: | ---: | --- |
| 0 | 8 | ASCII `CVXCOLL2` |
| 8 | 2 | unsigned big-endian major，固定 `2` |
| 10 | 1 | kind |
| 11 | 1 | flags，固定 `0` |
| 12 | 4 | unsigned big-endian canonical JCS header length |
| 16 | 8 | unsigned big-endian payload length |
| 24 | 32 | SHA-256(header bytes) |
| 56 | 32 | SHA-256(payload bytes) |
| 88 | variable | header bytes then payload bytes |

Kind 固定为：

| Code | Kind | Scope |
| ---: | --- | --- |
| 1 | `causal-edit` | network + durable object |
| 2 | `replica-checkpoint` | network + durable object |
| 3 | `replica-durable-head` | local only |
| 4 | `replica-durable-ack` | network + local ACK store |
| 5 | `frontier-anchor` | service signed, network + local store |
| 6 | `membership-cutoff` | service signed, network + local store |
| 7 | `replica-journal-record` | local only |
| 8 | `recovery-manifest` | local only |

未知 major/kind/flags、length overflow、hash mismatch、trailing bytes、非 canonical JCS 一律拒绝。Header
上限 64 KiB。JCS 使用唯一 `@convax/collaboration` codec：NFC scalar strings、RFC 8785 UTF-16 key
ordering、finite JSON number；禁止 accessor、symbol、non-enumerable property、sparse/decorated array、
cycle、`undefined`、NaN、Infinity、lone surrogate 和非 plain JSON object。

### 4.2 Causal edit core and final header

```ts
interface CausalEditCoreHeaderV2 {
  format: "convax.causal-edit-core/2"
  purpose: "typed-intent"
  projectId: string
  projectEpoch: RandomId128V2
  membershipEpoch: RandomId128V2
  membershipSnapshotDigest: string
  actorCredentialDigest: string
  doc: {
    kind: "project-index" | "canvas"
    id: string
    shardEpoch: RandomId128V2
    docEpoch: RandomId128V2
  }
  actor: {
    memberId: RandomId128V2
    actorId: ActorIdV2
    actorSequence: Uint64V2
    previousActorFrameDigest: string | null
    lamport: Uint64V2
  }
  operationId: RandomId128V2
  requestDigest: string
  intentKind: string
  intentSchema: "convax.typed-intent/2"
  causalContextDigest: string
  causalContextCount: string
  baseStateVectorHash: string
  baseCanonicalStateHash: string
  updateSha256: string
  changedPathsDigest: string
  writeSetDigest: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
}

interface CausalEditFrameHeaderV2 {
  format: "convax.causal-edit-frame/2"
  core: CausalEditCoreHeaderV2
  coreDigest: string
  actorSignature: string
}
```

`actor.memberId/actorId`、role、epochs、artifact digests 和 signing key 必须逐字段等于 exact
`DeviceActorCredentialV2`。frame 不携带 session identity；session 不能成为离线 edit 内容的一部分。

构造顺序固定为：

1. 编码 exact core payload；
2. 编码不含 digest/signature 的 exact core header；
3. `coreDigest = SHA-256("convax.causal-edit-core/2\0" || u32be(coreHeaderLength) ||
   coreHeaderBytes || corePayloadBytes)`；
4. actor key 对 `"convax.causal-edit-signature/2\0" || decodedCoreDigest` 做 Ed25519 signature；
5. final header 包含 exact core、coreDigest 和 actorSignature；
6. 编码 kind 1 envelope；
7. `frameDigest = SHA-256("convax.causal-edit-frame-digest/2\0" || exactEnvelopeBytes)`。

signature、frameDigest 不参与 coreDigest，禁止 self-hash。相同
`{chain scope, actorSequence}` 或相同 `{chain scope, operationId}` 必须唯一映射到一个
`{requestDigest,coreDigest,frameDigest}`。

### 4.3 Causal edit payload

Payload 是五个连续 length-prefixed section：

```text
u32be intentLength              + exact typed-intent JCS
u32be causalContextLength       + exact CausalContextV2 JCS
u32be baseStateVectorLength     + exact Yjs base state vector
u32be deltaLength               + exact Yjs update
u32be actualWriteEvidenceLength + exact ActualWriteEvidenceV2 JCS
```

所有 section 总长必须精确等于 envelope payload length。

```ts
interface CausalContextV2 {
  format: "convax.causal-context/2"
  baseFrontier: CausalFrontierV2
  projectIndexDependency: ProjectIndexCausalDependencyV2 | null
}

interface ActualWriteEvidenceV2 {
  format: "convax.actual-write-evidence/2"
  changedPaths: string[]
  writes: Array<{
    entityKind: string
    entityId: string
    field: string
    valueDigest: string
  }>
}
```

`changedPaths` 与 `writes` 使用 owner closed codec、严格排序且不得重复。`changedPathsDigest` 和
`writeSetDigest` 分别对两个 exact array 做 domain-separated digest，不能把同一 wrapper hash 伪装成
两个证明。`causalContextCount` 等于 frontier 长度的 canonical uint。

Digest domains 固定为：

| Field | Exact preimage after domain bytes |
| --- | --- |
| `requestDigest` | `JCS(exact typed intent)` |
| `causalContextDigest` | `JCS(exact CausalContextV2)` |
| `baseStateVectorHash` | raw state-vector bytes |
| `baseCanonicalStateHash` | owner canonical base JCS bytes |
| `updateSha256` | raw delta bytes |
| `changedPathsDigest` | `JCS(exact changedPaths array)` |
| `writeSetDigest` | `JCS(exact writes array)` |

每项使用 `SHA-256("<field-specific convax domain>/2\0" || preimage)`。digest 固定 64 lowercase hex，
signature/public key 固定 canonical unpadded base64url，uint64 禁止 JSON number。

## 5. Exact validation and causal base reconstruction

### 5.1 Structural admission pipeline

收到 kind 1 frame 后，Peer 必须按以下顺序处理：

1. bounded decode envelope/JCS/sections，重算所有 hash/digest；
2. 取得并验证 service-signed membership snapshot 和 actor credential；
3. 要求 frame membership/doc epoch 等于当前 replica epoch；
4. 验证 actor Ed25519 signature；
5. 查 operation index 与 actor sequence index；
6. 解析 base frontier，检查排序、唯一、antichain 和 Lamport；
7. 若 dependency 缺失，exact frame 进入 durable pending inbox，不进入 `replicaDoc`、不发 ACK；
8. dependency 齐全后重建 exact causal base；
9. 运行 owner schema、typed-intent equivalence、closed diff 和 canonical validation；
10. durable append 后才把 delta 应用到内存 `replicaDoc` 并发送 ACK。

签名正确只证明来源，不证明 Yjs update 合法。任何一步失败都不能进入 replica head。

### 5.2 Reconstruct exact base

为 frame `X` 重建 base：

1. 从本地选择一个 anchored checkpoint `C`，其 closure 必须是 `X.baseFrontier` closure 的子集；
2. 若不存在，使用该 document epoch 的 exact genesis；
3. 取 `baseFrontier` closure 中、但不在 `C` closure 中的全部 frame；
4. 验证每个 frame 的 dependency 后，按
   `(lamport unsigned, actorId decoded bytes, actorSequence unsigned, frameDigest bytes)` 拓扑排序；
5. 从 `C` snapshot clone，逐个应用 exact delta；
6. 要求最终 `Y.encodeStateVector(baseDoc)` 与 payload base state vector byte-for-byte 相等；
7. 重算 `baseStateVectorHash` 与 owner `baseCanonicalStateHash`。

拓扑排序只使验证/测试稳定，禁止把它用于业务 winner。对同一 causal closure，任一合法到达顺序必须
产生相同 Yjs state vector 和 canonical projection。

本地已 compaction 且不存在满足第 1 项的 checkpoint/history 时，状态是 `base-pruned`，不是 invalid。
Peer 必须请求 history witness 或等待包含该 frame 的新 anchored checkpoint；禁止在较新的 snapshot 上
假装验证旧 semantic guard。

### 5.3 Intent-to-delta equivalence

Remote verifier 禁止要求重新执行 reducer 后产生 byte-identical Yjs delta；Yjs clientID/struct clock 不是
业务 ABI。它必须：

1. 在 reconstructed base 上应用收到的 delta 到 isolated document；
2. 遍历完整 Yjs root/type inventory，拒绝 unknown root、unknown nested shared type、unknown key、非法
   actor slot、schema decoration 和超限值；
3. 从 base/candidate 的完整 closed schema 计算 actual changed paths/writes，要求与 payload evidence 完全
   相等；
4. 用同一 typed-intent materializer 在另一个 base clone 上执行 intent；
5. 比较 expected/received candidate 的 canonical logical state、write set、semantic guard 和 operation
   receipts，而不是比较 Yjs update bytes；
6. 验证 delete、creation group、containment cycle、resource guard、Plugin schema 等 owner invariants。

最终 projection 相同但包含隐藏 Y.Map/Y.Array 或多写一个未投影 actor slot 的 delta 必须拒绝。

### 5.4 Pending inbox

缺 membership artifact、actor predecessor、base frontier frame、ProjectIndex dependency 或 schema artifact
时，frame 以 exact bytes 持久化在 pending inbox。Pending item 包含缺失 digest 集合和首次本地接收
ordinal；ordinal 仅用于本地调度。

Peer 按 digest 请求缺失对象。dependency 齐全后重新从第 1 步验证，不能从中间状态继续。invalid
frame 移入 quarantine；`base-pruned` frame 保留并请求 checkpoint/history；artifact 不兼容 frame 保留
为 `unsupported`，不得 ACK。

### 5.5 Equivocation isolation

以下任一情况是 actor equivocation：

- 同 chain scope + actorSequence 出现不同 frameDigest；
- 同 chain scope + operationId 出现不同 request/core/frame digest；
- actor chain predecessor/sequence 不连续但签名有效；
- 同一 derived portable identity 的 origin 不同。

Peer 必须保留双方 exact bytes 和签名证据，冻结该 actor 从首个 fork sequence 开始的两个分支，并递归
冻结所有因果依赖这些分支的 descendant。禁止 first-seen winner 和 lexicographic-digest winner；前者不
收敛，后者允许攻击者 grinding。

如果任一冻结 frame 已进入 `replicaDoc`，Main 必须从最近一个不包含 fork 的 anchored checkpoint
重建 replica，排除全部 tainted closure。不能尝试用逆 Yjs update 删除。未受 taint 的其他 actor frame
继续可用，整个 Project/Canvas 不因单 actor fork 永久 quarantine。

equivocation evidence 发送 membership service。服务端冻结该 actor 的后续 credential/checkpoint
publication，并通过第 9 节 cutoff 轮换 epoch。服务端不得替 actor 选择一个业务分支。

## 6. Local commit, replication outbox and durable ACK

### 6.1 Local commit barrier

在 shard commit mutex 内：

1. 读取最新 `replicaDoc`、replica frontier、actor head 和 membership epoch；
2. Main 分配 operationId、actorSequence 和 Lamport；
3. clone candidate，执行一个 typed intent，验证并生成 delta/evidence；
4. 构造并签名 exact causal frame；
5. 将 frame object 以 digest-addressed `create-new + file fsync + directory fsync` 持久化；
6. 写 durable replication-outbox reference 并 fsync；
7. append replica journal record，CAS durable head，file fsync + directory fsync；
8. 才把 exact delta 应用到内存 `replicaDoc`、提交 session semantic undo selection、发布 projection
   invalidation，并向 caller 返回 `saved-locally`。

任一步失败都不得更新内存 replica。第 5 步后 crash 留下的 orphan object 可在验证无任何 durable ref
后 GC；第 6 步后 crash 必须从 outbox 完成第 7 步或明确 quarantine，禁止先发送未被本机接受的 frame；
第 7 步后 crash 通过 journal/head replay 恢复，不重复分配 operationId。

Outbox 是 replication queue，不是第二份文档状态。它只引用 replica journal 已接受的 exact frame
object；本地 edit 在没有任何在线 Peer 时仍可继续，直到 bounded outbox 达到背压上限。

### 6.2 Remote receive barrier

接收端先 durable 保存 exact frame 到 inbox/object store。验证成功后 append replica journal/head；只有
head 和引用 object 都 fsync 完成，才可签 durable ACK。ACK 前 crash 等于没有复制，发送端重发同
frameDigest。

重复 frameDigest 是幂等成功；same operation/sequence different digest 走 equivocation，不能用幂等
掩盖。

### 6.3 Durable ACK

```ts
interface ReplicaDurableAckCoreV2 {
  format: "convax.replica-durable-ack-core/2"
  projectId: string
  projectEpoch: RandomId128V2
  membershipEpoch: RandomId128V2
  doc: {
    kind: "project-index" | "canvas"
    id: string
    shardEpoch: RandomId128V2
    docEpoch: RandomId128V2
  }
  frameDigest: string
  receiverMemberId: RandomId128V2
  receiverActorId: ActorIdV2
  receiverActorCredentialDigest: string
  receiverDurableHeadDigest: string
  receiverFrontierDigest: string
}
```

kind 4 header 包含 exact core、coreDigest 和 receiver actor signature，空 payload。ACK digest 是完整
kind 4 envelope 的 domain-separated SHA-256。ACK 证明接收设备承诺已 durable，不证明它永远在线。

发送端验证并先 durable 保存 ACK，随后才从 outbox projection 移除该 peer target。至少一个非本机、
当前 active actor 的 ACK 才显示 `replicated`。新增 Canvas blob 引用还要求相应 blob durable ACK；Yjs
ACK 不能替代 blob ACK。

### 6.4 Response loss

P2P edit 没有 admission response 和 operation lookup。Caller response 丢失时，Main 以本地
`{actorId,operationId}` index 返回同一 frame result。Peer ACK 丢失时重发同 frame，接收端幂等返回
新的或已存 ACK。禁止重新执行可能产生新 identity 的 intent。

## 7. Checkpoint DAG and service frontier anchor

### 7.1 Replica checkpoint

Checkpoint 是 actor-signed snapshot node，不是 edit，也不获得业务顺序。

```ts
interface ReplicaCheckpointCoreHeaderV2 {
  format: "convax.replica-checkpoint-core/2"
  projectId: string
  projectEpoch: RandomId128V2
  membershipEpoch: RandomId128V2
  doc: {
    kind: "project-index" | "canvas"
    id: string
    shardEpoch: RandomId128V2
    docEpoch: RandomId128V2
  }
  checkpointId: RandomId128V2
  proposerMemberId: RandomId128V2
  proposerActorId: ActorIdV2
  proposerCredentialDigest: string
  parentCheckpointDigests: string[]
  manifestDigest: string
  frontierDigest: string
  actorHeadsDigest: string
  stateVectorHash: string
  canonicalStateHash: string
  fullUpdateHash: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
}

interface ReplicaCheckpointManifestV2 {
  format: "convax.replica-checkpoint-manifest/2"
  parentCheckpointDigests: string[]
  frontier: CausalFrontierV2
  actorHeads: CausalHeadRefV2[]
}
```

kind 2 payload：

```text
u32be manifestLength + exact manifest JCS
u32be snapshotLength + exact Yjs full update
```

Final header 包含 exact core、checkpoint core digest 和 proposer actor signature。`checkpointDigest` 是
完整 kind 2 envelope 的 domain-separated SHA-256。`actorHeads` 对 snapshot closure 中每个 actor 恰好
一项，按 actorId 排序；它允许 compaction 后验证后续 actor-chain predecessor。`frontier` 是 closure
的 exact maximal antichain。Parent checkpoint 按 digest bytes 排序、唯一且最多 8 个。

### 7.2 Checkpoint validation carrier

提交服务端的 carrier 包含：

- proposal checkpoint exact bytes；
- 每个 parent 的 service certificate 和 exact checkpoint bytes；
- parent closure 之外、proposal frontier 以内的 exact causal frame DAG；
- 所需 membership/trust/schema artifacts；
- 若某个 suffix frame 的 base 早于 parent closure，则额外提供一个可验证的 older anchored checkpoint
  与 exact history witness。

Carrier 本身不是 authority。Attester 必须用第 5 节相同 verifier 重建每个 frame 的 exact base、验证
全部签名/intent/diff/invariant，合并 parent snapshots，重放 suffix，并要求结果 state vector、canonical
state 和 full update 与 proposal 三个 hash 一致。

单次 carrier 超过第 11 节上限即拒绝，不能跳过验证。服务端在 transaction commit 后立即丢弃
snapshot/frame/intent/update bytes；日志禁止记录 payload。

### 7.3 Checkpoint certificate

```ts
interface CheckpointCertificateV2 {
  format: "convax.checkpoint-certificate/2"
  projectId: string
  projectEpoch: RandomId128V2
  membershipEpoch: RandomId128V2
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: RandomId128V2
  docEpoch: RandomId128V2
  checkpointDigest: string
  parentCheckpointDigests: string[]
  frontierDigest: string
  actorHeadsDigest: string
  stateVectorHash: string
  canonicalStateHash: string
  fullUpdateHash: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: string
  serviceSignature: string
}
```

Certificate 签名覆盖除 `serviceSignature` 外的完整 JCS。服务端保存 certificate 和 checkpoint DAG
metadata，但不保存 kind 2 bytes。

### 7.4 Maximum frontier antichain anchor

每个 exact document epoch 有一个 service durable anchor：

```ts
interface FrontierAnchorV2 {
  format: "convax.frontier-anchor/2"
  projectId: string
  projectEpoch: RandomId128V2
  membershipEpoch: RandomId128V2
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: RandomId128V2
  docEpoch: RandomId128V2
  anchorRevision: Uint64V2
  checkpointCertificateDigests: string[]
  maximumFrontier: CausalFrontierV2
  maximumFrontierDigest: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: string
  serviceSignature: string
}
```

收到已验证 checkpoint `P` 后，service 计算：

```text
nextFrontier = Max(current.maximumFrontier union P.frontier)
```

并保留 checkpoint DAG 中 frontier 不被另一 retained checkpoint frontier 完全因果支配的全部
certificates；这组 checkpoint-node maximal antichain 的 snapshot closure 并集必须覆盖
`nextFrontier`。被 P 完全支配的旧 certificate 必须移除；与 P 并发或仅部分重叠的 certificate 必须
同时保留。这里禁止用有多解的 set-cover 优化。`checkpointCertificateDigests` 按 digest bytes 排序且
最多 8 项；将产生第 9 项的并发 proposal 被拒绝，并要求 proposer 先从所有当前 checkpoint
snapshots 构造一个 merge checkpoint。

这个集合运算必须满足交换律、结合律和幂等性。`anchorRevision` 只用于 service CAS/rollback protection；
禁止进入 frame Lamport、Project/Canvas canonicalizer、conflict winner 或 Yjs state。

服务端只发布 checkpoint 时更新 anchor，因此 anchor 可以落后于在线 P2P edits。落后不阻止 edit、
sync 或 ACK。

### 7.5 Bootstrap

新设备：

1. 验证 service trust bundle、current membership snapshot、actor credential；
2. 获取并验证 current `FrontierAnchorV2`；
3. 从在线数据持有 Peer 按 certificate digest 获取 anchor 引用的全部 exact checkpoint bytes；
4. 验证 kind 2 envelope、checkpoint digest 与 certificate 每个字段；
5. 把最多 8 个 snapshot full update 合并成 `replicaDoc`；
6. 要求合并后 frontier 精确等于 anchor maximum frontier，actor heads 无 equivocation，schema 与
   canonical projection 有效；
7. durable 写 checkpoint objects/head 后，再请求 anchor 之后的 causal frames 和 blob；
8. 所有当前引用 blob 到齐后才显示 `fully-offline`。

服务端不保存 snapshot，所以 bootstrap 与缺失 blob 获取要求至少一个数据持有 Peer 在线。这是明确
产品约束，不得伪装成服务端云备份。一个 Peer 缺少某 certificate 对应 snapshot 时，必须继续向其他
Peer 请求，不能用自己较新的未 attested snapshot 替代。

### 7.6 Compaction

本地只可删除某 frame payload，当：

1. 至少一个本地 durable、service-certified checkpoint closure 包含它；
2. 对应 checkpoint exact bytes、certificate、anchor、actorHeads 和 durable head 已 fsync；
3. 至少一个其他 active Peer durable ACK 了 checkpoint bytes；
4. frame 不被 pending base reconstruction、equivocation evidence、recovery manifest 或未完成 ACK 引用。

Compaction 只删除 causal-past payload object；operation index、actor boundary、checkpoint DAG metadata、
semantic history 和 content-addressed digest 保留到 document epoch 退休。Journal append ordinal 不能变成
业务 sequence。

收到一个 base 早于所有 retained checkpoint 的晚到 frame 时，本机不得盲目应用。它请求 history
witness；若没有任何 Peer 保留 witness，则由仍持有该 frame/semantic intent 的设备提交一个经 attester
验证的新 merge checkpoint，或由用户从 recovery branch 重新发出新 intent。服务端 certificate 不能
凭 digest 把未经验证的 frame“洗白”。

## 8. ProjectIndex to Canvas causal dependency

```ts
interface ProjectIndexCausalDependencyV2 {
  format: "convax.project-index-causal-dependency/2"
  projectIndexShardEpoch: RandomId128V2
  projectIndexDocEpoch: RandomId128V2
  frontier: CausalFrontierV2
  frontierDigest: string
  stateVectorHash: string
  canonicalStateHash: string
  canvasId: RandomId128V2
  canvasShardEpoch: RandomId128V2
  canvasDocEpoch: RandomId128V2
  routeDigest: string
  routeState: "staged" | "live" | "closed"
}
```

ProjectIndex frame 的 `projectIndexDependency` 必须为 null。普通 Canvas edit 必须绑定 exact
ProjectIndex causal base，remote Peer 必须先重建该 Index frontier 并验证 route 为 `live`，canvas/shard/
doc epoch 与 frame 相同。缺 Index dependency 的 Canvas frame 进入 pending，不得 ACK。

Canvas tombstone 是 ProjectIndex grow-only route state。一个在 tombstone 并发分支上、仍观察到 live
route 的 Canvas frame 可以通过历史验证并保留 bytes，但合并后的 ProjectIndex projection 隐藏/关闭
Canvas，不能自动复活。观察到 closed route 后创建的新 Canvas frame 无效。

Canvas 创建顺序固定为：

1. ProjectIndex `create-route` 产生 `staged` route；
2. Canvas genesis checkpoint 依赖 exact staged Index frontier；
3. ProjectIndex `activate-route` 依赖 Canvas genesis certificate digest；
4. 后续 Canvas edit 只依赖 `live` route。

这是一条有向 cross-shard causal chain，不是把业务连线称作 parent，也不允许 ProjectIndex/Canvas
相互等待形成循环。

## 9. Membership revocation, cutoff and recovery

### 9.1 没有可信墙钟顺序

离线 actor 在 revocation 前还是后创建 frame，其他节点无法从机器时间判断。因此 membership mutation
必须建立 explicit causal cutoff；禁止 LWW timestamp 和“credential 当时可能还没过期”的推测。

### 9.2 Cutoff transaction

角色变更、member/actor revoke 或 membership key rotation 前，service 必须：

1. transient 验证一个 current ProjectIndex checkpoint；
2. 从其 live/staged route 集合枚举所有 Canvas shard；
3. 为 ProjectIndex 和每个 shard 固定一个 current maximum frontier anchor；
4. 生成每个 document 的 next docEpoch，并 transient 验证一个由 cutoff snapshot-set 唯一派生的
   next-epoch genesis checkpoint；
5. 至少一个仍 active 的数据持有设备 durable 保存每个 next genesis checkpoint 并返回 ACK；
6. 原子发布 `MembershipCutoffV2`、全部 next genesis certificates、新 membership snapshot 和新 actor
   credentials。

```ts
interface MembershipCutoffDocumentV2 {
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: RandomId128V2
  priorDocEpoch: RandomId128V2
  nextDocEpoch: RandomId128V2
  frontierAnchorDigest: string
  maximumFrontierDigest: string
  nextGenesisCheckpointDigest: string
  nextGenesisCheckpointCertificateDigest: string
}

interface MembershipCutoffV2 {
  format: "convax.membership-cutoff/2"
  projectId: string
  projectEpoch: RandomId128V2
  priorMembershipEpoch: RandomId128V2
  nextMembershipEpoch: RandomId128V2
  documents: MembershipCutoffDocumentV2[]
  nextMembershipSnapshotDigest: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: string
}
```

Documents 按 `(docKind,docId decoded/UTF-8)` 严格排序。cutoff signature 覆盖完整 closed object。任何
遗漏 live/staged Canvas、anchor epoch 不匹配或 certificate 不完整都使 mutation 失败；不能只 rollover
ProjectIndex 留下旧 Canvas authority。

### 9.3 Rebuild rule

收到有效 cutoff 后：

- prior epoch 中位于 cutoff anchor closure 内的状态进入 next docEpoch genesis snapshot；
- prior epoch 中未包含的 frame 和其 descendants 不进入团队 replica；
- current replica 若已应用这些 frame，必须从 cutoff snapshots 重建，不能用 inverse update；
- next epoch frame 只接受新 credential，并从 `actorSequence="0"` 重新开始；
- revoked actor 没有 next credential，不能发布恢复 edit。

Cutoff 胜过未同步旧 epoch edit，这是无可信时间且不引入 edit authority 的唯一确定性 fence。它可能
排除真实的离线工作，产品必须显示 recovery 而不能声称自动合并。

### 9.4 Local recovery

被 cutoff、equivocation 或 history-pruned 排除的 exact frames、typed intents、Project file/blob references
写入 kind 8 `RecoveryManifestV2` 指向的只读 branch。它不是 `local-fork`、不叠加到 `replicaDoc`、不被
Peer 同步、不能自动复活 Canvas。

用户可以：

- 导出 recovery branch；
- 打开只读 projection；
- 在仍有 editor authority 时，显式选择 owner 提供的“重新应用”为新 operation/new identities；
- 丢弃 branch。

自动重放禁止沿用旧 operationId、actorSequence、derived entity id 或 resource guard。依赖旧 derived id
的一组 intent 需要 owner 提供显式 identity-remap plan；没有 plan 时只能导出，不能部分重放造成孤立
Plugin creation group。

## 10. Native persistence

所有目录名使用 `NativeStoreKeyV2` 的 domain-separated SHA-256 派生值。projectId、actorId、operationId、
docId、URI/path、Plugin id 和用户文本禁止直接进入 native path。

```text
<project>/.convax/collaboration-v2/
  documents/<document-native-key>/
    objects/
      frames/<digest-native-key>.bin          exact kind 1 envelope
      checkpoints/<digest-native-key>.bin     exact kind 2 envelope
      acks/<digest-native-key>.bin            exact kind 4 envelope
      anchors/<digest-native-key>.bin         exact kind 5 envelope
      cutoffs/<digest-native-key>.bin         exact kind 6 envelope
    replica/
      snapshot-set.bin                        refs to anchored checkpoint objects
      journal/<segment-key>.bin               chained kind 7 records, local append order only
      durable-head.bin                        exact kind 3 envelope
    ingress/
      pending/<frame-native-key>.ref           missing-dependency exact frame ref
      unsupported/<frame-native-key>.ref       valid envelope, unknown artifact
    egress/
      replication/<frame-native-key>.ref       frame awaiting remote durable ACK
      checkpoint/<checkpoint-native-key>.ref   checkpoint awaiting service/peer publication
    recovery/<recovery-native-key>/
      manifest.bin                             exact kind 8 envelope
      refs/                                    immutable excluded object refs
    quarantine/<evidence-native-key>.bin       bounded invalid/equivocation evidence
  blob-replication/                            separate resumable blob channel state
```

`objects` 是 immutable content-addressed bytes；同 digest 的不同 bytes 是 corruption。Journal record 只
引用已 durable object，并记录 `accepted-local|accepted-remote|checkpoint-installed|ack-recorded|quarantined`
转换。Journal segment ordinal、durable head generation 和 filesystem mtime 都不是 causal/business order。

### 10.1 Reopen

Project open 必须：

1. 验证 durable head、journal hash chain 和所有 object digest；
2. 验证 snapshot-set 的 service certificate/anchor；
3. 从 snapshot set 重建 replica，再按 causal dependency 而非 journal ordinal 应用 accepted frame；
4. 重建 actor/operation/frontier index；
5. 重扫 pending/outbox/ACK refs；
6. outbox 已 durable 但 journal 未接受的 local frame，在重新完整验证后完成 accept；
7. journal 已接受但内存未应用的 frame 通过 replay 恢复；
8. ACK durable 但 egress ref 未清理时幂等清理；
9. 任一 ambiguity 进入 read-only recovery，禁止猜 durable winner。

Reopen 不恢复跨重启 UndoManager；semantic history 已作为普通 typed intent 写入 replica。

### 10.2 Legacy cutover

以下 v1 路径和语义全部删除，不能 dual-read/dual-write：

- `certified-team/`、`certifiedTeamDoc`、contiguous admitted journal；
- `local-fork/`、`localForkJournal`、`workingDoc` provisional overlay；
- `admission-outbox/`、`abandonment-outbox/`、旧 `checkpoint-outbox/`；
- `AdmissionCertificateV1`、actor abandonment、operation lookup；
- per-document MMR、leaf reservation、server edit high-water/sequence；
- document-wide version/revision conflict path。

v1 collaboration bytes 和 legacy JSON Project 都是 unsupported portable bytes。Project open 必须保留并
要求用户显式 reset；开发阶段 reset 可以删除全部旧 Canvas/collaboration 内容，但不得把旧 bytes 当 v2
hydrate。普通 Project 文件是否删除由 reset UI 的明确选择决定，不能被协议检测静默删除。

## 11. Hard limits and backpressure

| Item | v2 limit |
| --- | ---: |
| active actors per Project | 256 |
| active actors per member | 8 |
| causal frontier refs | 256 |
| frame/checkpoint JCS header | 64 KiB |
| typed intent JCS | 256 KiB |
| causal context JCS | 64 KiB |
| base state vector | 64 KiB |
| one Yjs delta | 1 MiB |
| actual write evidence | 512 KiB |
| complete causal edit envelope | 2 MiB |
| changed paths / writes / operation receipts | 2,048 / 2,048 / 512 |
| full Yjs checkpoint snapshot | 32 MiB |
| checkpoint parents / anchor checkpoint certificates | 8 / 8 |
| checkpoint suffix frames | 4,096 frames and 256 MiB |
| transient service validation carrier | 320 MiB |
| pending inbox per document | 4,096 frames and 256 MiB |
| pending inbox per remote actor | 512 frames and 32 MiB |
| replication outbox per document | 4,096 frames and 512 MiB |
| durable ACKs retained per frame | 32 |
| quarantine per Project | 1,024 objects and 128 MiB |
| recovery branch | 1 GiB before write freeze/export required |

每项同时执行 count/byte 两个上限。可信本地 outbox/recovery 达上限时必须阻止新的 durable mutation 并
显示 backpressure/recovery，不得删除未复制/未导出的用户工作。远端 pending/quarantine 达上限可拒绝
新 untrusted bytes 并断开对应 Peer，不能影响已 durable replica。

Checkpoint carrier 320 MiB 是 v2 明确上限，不是目标大小。超过说明 checkpoint 太晚或 history witness
不足，必须先由持有数据的 Peer 生成更近 checkpoint；服务端不得接受 digest-only shortcut。

Blob/video/audio 使用独立 PeerJS channel、chunk Merkle/hash 和限流；任何 blob transfer 都不能阻塞
causal frame、awareness 或 ACK channel。Yjs 只持有 fileId/URI/blob hash/current register。

## 12. Failure semantics

| Failure | Required result |
| --- | --- |
| no service / no Peer online | current-epoch local edit durable 成功；checkpoint/bootstrap/replication unavailable |
| missing causal dependency | durable pending，不投影、不 ACK |
| invalid signature/digest/schema | quarantine exact evidence |
| unsupported Plugin/schema artifact | unsupported pending；只读 projection，不写回旧 schema |
| local fsync/head CAS failure | candidate discarded；reopen recovery；不返回 saved |
| ACK response loss | retransmit exact frame，幂等 ACK |
| checkpoint service response loss | 按 checkpointDigest 查询 certificate/anchor；不得重做 snapshot 为另一 digest |
| anchor has concurrent checkpoints | bootstrap merge all referenced snapshots；service 不选 winner |
| base history was compacted | request witness or wait for attested merge checkpoint；不假验证 |
| actor equivocation | isolate actor fork + tainted descendants；rebuild；membership cutoff |
| membership cutoff excludes local work | read-only local recovery branch；不自动复活 |
| ProjectIndex tombstones Canvas | Canvas bytes retained recovery，route/projection remains closed |
| blob unavailable | structure remains editable；offline playback unavailable |

## 13. Falsifiable conformance tests

以下任一结果出现即否决实现或本方案对应声明：

1. 两个 Peer 断网各提交 100 个不同节点/字段 edit，任一 commit 需要 service、global leaf 或 document
   rebase。
2. 同一 member 的两台设备使用不同 actorId 并发编辑被判 actor equivocation。
3. 同 actor/sequence 的两份不同 signed frame 只按 first arrival 或 lexicographic digest 选择 winner。
4. 已应用 fork 后不 rebuild replica，导致不同到达顺序保留不同恶意分支。
5. 缺 base/Index dependency 的 frame 进入 projection 或收到 durable ACK。
6. frame signature 正确但 delta 多写 hidden Y.Map/actor slot 仍通过 closed diff。
7. Remote verifier 要求 reducer 生成 byte-identical Yjs delta，或 Yjs clientId 参与业务 winner。
8. `(lamport,actorId,operationId,ordinal)` 以外的 service revision、Peer arrival 或 wall clock 改变
   containment、delete、creation-group、file conflict 的 canonical result。
9. local frame object/outbox/journal/head 任一 fsync crash point 后，reopen projection 与 durable replay
   不同或 operation 被重复分配。
10. 接收端 ACK 后立即 crash，reopen 找不到 exact frame 或 durable head。
11. ACK 尚未 fsync，发送端 UI 已显示 `replicated`。
12. 服务器为普通 edit 分配 sequence/admission，或无服务时 P2P edit 不能同步。
13. 两个 concurrent checkpoint 到达服务端的顺序改变 maximum frontier/checkpoint set，或 service 静默
    丢掉一个 incomparable checkpoint。
14. `anchorRevision` 改变 Yjs/canonical projection。
15. checkpoint attester 未重放 exact causal base，仅比较 snapshot digest 就签 certificate。
16. 服务端 durable store、log、trace 或 analytics 保留 Yjs snapshot/update/typed intent/blob payload。
17. 新设备在没有 certificate、没有 genesis replay、也没有显式 trust-on-peer 模式时接受任意 Peer
    snapshot。
18. bootstrap 合并 anchor 的 concurrent snapshots 后，任一 arrival permutation 产生不同 state vector
    或 canonical projection。
19. compaction 删除仍被 pending base、equivocation、recovery 或未 ACK outbox 引用的 frame。
20. base 已 pruned 的晚到 frame 被直接应用到较新 snapshot 并声称 semantic guard 已验证。
21. membership revoke 使用机器时间决定旧 frame 胜负，或旧 membership epoch frame 自动进入 next
    epoch replica。
22. cutoff 遗漏任一 live/staged Canvas，或只 rollover ProjectIndex。
23. cutoff/rebuild 后被排除的本地工作被静默删除、自动复活或用旧 identity 自动重放。
24. Canvas frame 未精确绑定可重建的 live ProjectIndex route，或 Canvas tombstone 被迟到 frame 复活。
25. staged route、Canvas genesis、activate route 形成 cross-shard dependency cycle。
26. actorId/operationId/docId/URI/path 直接成为 native filename，或 padding/NFC/case alias 产生碰撞。
27. 达到 pending/quarantine 上限的恶意 Peer 能删除、阻塞或改写已 durable replica。
28. Project/Canvas Plugin schema mismatch 的 Peer ACK 或写回它不能验证的 state。
29. UndoManager 捕获 remote/rebuild transaction，或跨重启恢复旧 session undo stack。
30. UI、Agent、Plugin 仍提交 whole document、raw update、actor/frontier 或 expected document version。

Golden fixtures 必须在 Bun、Chromium 和 service attester 中逐字节匹配：CVXCOLL2 prefix、JCS、core
payload lengths、每个 digest domain、Ed25519 signature、frame digest、frontier `Max`、Lamport、checkpoint
certificate、concurrent anchor union、cutoff 和 durable ACK。

## 14. 最强反驳、证伪门槛与评分

### 最强反驳

1. **Checkpoint attester 仍是中心信任边界。** 它虽不排序 edit，但错误或被攻破可签恶意 snapshot。
   必须使用独立纯 verifier、Host-pinned purpose key、跨 Bun/Chromium/service golden 和 payload-zero
   durable audit；否则“P2P”只是隐藏了中心 authority。
2. **Compaction 与无限期离线编辑存在根本张力。** 历史被所有节点删除后，晚到旧-base frame 无法
   独立重建 semantic base。本方案选择 pending/新 checkpoint/显式 recovery，而不是伪称永远自动
   合并；产品若要求无限期透明合并，就必须保留无限历史或增加可验证计算证明。
3. **Equivocation 回滚具有大爆炸半径。** 一个 actor fork 会 taint 依赖它的其他 actor descendants，
   需要从安全 checkpoint rebuild。若实现为了体验选择 first-seen winner，将直接破坏收敛与安全。

### 可证伪门槛

在实现前必须先有三个 executable spikes：

- 10,000 frames、256 actors 的 causal closure/frontier/pending/rebuild 基准满足本文件 caps；
- malicious Yjs delta corpus 证明 closed diff 拒绝 hidden shared types，而合法 delta 不依赖 clientID
  byte reproduction；
- 两个 concurrent checkpoint + 一个 late pre-compaction frame 的 service attester/bootstrap fixture，
  证明 anchor 交换律、payload-zero durable store 和明确 `base-pruned` recovery。

任一 spike 失败，必须回到架构评审，禁止靠放宽 validator、增加隐式 server order 或静默 LWW 修补。

### 评分

本方案 **8/10**。扣 1 分给 checkpoint service 的剩余中心信任，扣 1 分给 compaction 后晚到旧-base
frame 不能保证透明自动合并。两项不致命的条件是：产品接受“至少一个数据持有 Peer 在线”的 bootstrap
约束、接受显式 recovery，并且 checkpoint attester 保持低频、无 edit order、无 payload durable
storage。若删除 attester 却仍宣称安全 bounded bootstrap，评分降为 **4/10**。
