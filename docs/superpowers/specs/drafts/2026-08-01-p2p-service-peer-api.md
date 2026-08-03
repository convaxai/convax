# Convax P2P Service and Peer Protocol

状态：架构裁决草案。本文是对逐 edit service admission/MMR 方案的替代提案；在三方架构门禁、
protocol/schema digest 和 canonical architecture 同步完成前不得作为已发布协议实现。

本文中的 MUST、MUST NOT、SHOULD、MAY 按 RFC 2119 解释。所有 JSON object 都是 closed schema；
unknown key、非 NFC string、非 canonical decimal uint、重复/乱序集合和非 exact JCS 都 MUST fail
closed。所有 digest 都是 lowercase SHA-256 hex；所有签名都覆盖明确 domain 与 exact JCS bytes。

## 1. 裁决与边界

Convax 团队编辑采用无全局 edit order 的 P2P 协议：

- 每个设备 replica 在每个 Project document 内维护自己的 signed hash chain；
- frame 声明 exact causal base，peer 从 causal closure 重建 base，执行 portable reducer，并验证 Yjs
  delta、closed schema、normalized write-set、业务不变量和 canonical post-state；
- 不同 replica 的合法并发 frame 由 Yjs merge 和 owner-defined deterministic projection 收敛；
- service 只拥有成员、设备 replica、session、PeerJS rendezvous、epoch、checkpoint header publication
  metadata 和短期 holder availability；
- service 不接收、不保存、不解释、不验证 Yjs update、Canvas/ProjectIndex logical state、typed intent、
  frame payload、blob bytes 或 causal reachability；
- service checkpoint publication sequence 只防 API metadata rollback，MUST NOT 进入 Canvas/Project
  conflict rule，也 MUST NOT 被描述为 edit order。

被替代并删除的设计包括：逐 edit admission、document MMR、actor counter abandonment、operation
admission lookup、service route fence 和为每次编辑上传 checkpoint/suffix 的 attester carrier。

### 1.1 唯一 owner

| 能力 | Owner | 禁止拥有 |
| --- | --- | --- |
| membership、replica、session、PeerJS directory/ticket、epoch、checkpoint metadata | `@convax/api` | Yjs/frame/blob payload、edit order、causal/content validity |
| generic frame/JCS/hash-chain/causal-frontier codec 和 accepted/working/candidate kernel | `@convax/collaboration` | Project/Canvas schema、membership policy、PeerJS、native I/O |
| ProjectIndex schema、Canvas route、Project resource/blob reference | `@convax/project` | Canvas semantics、PeerJS transport、service persistence |
| Canvas schema、typed intent、portable reducer、I-confluence/projection rules | `@convax/canvas` | Project membership、network/native persistence |
| PeerJS lifecycle、channel binding、native durable writer、OS vault key adapter | `@convax/desktop` | reusable collaboration semantics或第二份 document state |
| Project collaboration journal/checkpoint/blob native ports | `@convax/project/node` | protocol policy、renderer state |

`@convax/api` 只依赖 `@convax/collaboration` public root 和 browser-safe
`@convax/project/collaboration-protocol`。PeerJS 只能出现在 Desktop composition edge。

### 1.2 明确不保证

- Partition 中的 peer 不可能同时离线编辑又即时得知撤权。撤权使用第 6 节的 causal cutoff；产品
  MUST NOT 宣称基于不可证明的签名墙钟区分“撤权前/后”。
- service-signed checkpoint publication receipt 证明“该 header 曾由当前获权 replica 发布并进入
  metadata catalog”，不证明 payload 正确、可获取或 causal frontier 真实。
- 没有在线 holder 时，现有设备仍可编辑 local fork；新设备 bootstrap 或缺失 payload 获取进入
  `waiting-for-holder`，不能伪造空 Project 或信任未验证 snapshot。
- v1 不容忍恶意多数。一个当前 editor 可发布无效 frame/header并造成自身分支 quarantine 或可用性
  DoS，但不能让其他 peer 把未验证 bytes 当成 canonical team state。

## 2. Canonical primitives 与 digest

```ts
type ProjectIdV1 = string
type Id128V1 = string                  // canonical unpadded base64url, exactly 16 bytes
type PublicKeyV1 = string              // canonical unpadded base64url, exactly 32 bytes
type SignatureV1 = string              // canonical unpadded base64url, exactly 64 bytes
type DigestV1 = string                 // lowercase 64-char SHA-256 hex
type Uint64V1 = string                 // 0|[1-9][0-9]*, <= 2^64-1
type MemberIdV1 = Id128V1
type ReplicaIdV1 = Id128V1
type ReplicaActorIdV1 = string         // canonical unpadded base64url, exactly 32 bytes
type CollaborationRoleV1 = "viewer" | "editor"

interface DocumentScopeV1 {
  docKind: "project-index" | "canvas"
  docId: "project-index" | Id128V1
  shardEpoch: Id128V1
}
```

`docKind="project-index"` 时 `docId` MUST exact 等于 `"project-index"`；`docKind="canvas"` 时
`docId` MUST 是 CanvasId。Project reset 前 `shardEpoch` 不变，checkpoint 不生成 `docEpoch`，也不
重置 replica chain。

Replica actor id 由 service 重新派生，caller 不能选择：

```text
actorIdBytes = SHA-256(
  "convax.replica-actor-id/1\0" ||
  JCS({ projectId, projectEpoch, memberId, replicaId, replicaSigningPublicKey })
)
actorId = base64url(actorIdBytes)
```

本文使用以下 domain：

| 值 | Domain |
| --- | --- |
| membership snapshot digest | `convax.membership-snapshot-digest/2\0` |
| replica mutation request digest | `convax.replica-mutation-request-digest/1\0` |
| membership credential digest | `convax.membership-credential-digest/2\0` |
| replica edit core digest | `convax.replica-edit-core/1\0` |
| replica edit frame digest | `convax.replica-edit-frame/1\0` |
| causal frontier digest | `convax.causal-frontier-digest/1\0` |
| checkpoint header digest | `convax.checkpoint-header-digest/1\0` |
| checkpoint publication receipt digest | `convax.checkpoint-publication-receipt-digest/1\0` |
| holder assertion digest | `convax.checkpoint-holder-assertion-digest/1\0` |
| revocation cutoff manifest digest | `convax.revocation-cutoff-manifest-digest/1\0` |
| checkpoint catalog digest | `convax.checkpoint-catalog-digest/1\0` |

每个 digest 计算 `SHA-256(UTF8(domain) || JCS(exact object))`。Binary frame 的 core/final digest
继续使用 `@convax/collaboration` frozen binary framing 定义，不得出现第二个 JCS 实现。

## 3. Member、replica actor 与 epoch

### 3.1 Principal 分层

`memberId` 是团队 principal，拥有 role 和长期 member signing key。`replicaId` 是某个 Project 内、
某个 member 的持久设备身份；每个 replica 有独立 long-lived replica signing key 和独立 actorId。

MUST NOT：

- 用 memberId、peerId、sessionId 或 Yjs clientId 代替 replica actorId；
- 让同一个 actorId 对应两个 replica key；
- 在 replica key 丢失后复用旧 actorId；
- 让同一 replica 同时持有两个 writer session lease；
- 按 actorId 的随机值或 Yjs clientId 决定业务 winner。

同一 member 的两个设备必须 enroll 为两个 replica，因此它们的合法并发不是 equivocation。Key
rotation 创建新的 replicaId/actorId，并在一个 membership transaction 中撤销旧 replica；rotation
provenance 不连接两条 actor chain。

### 3.2 Epoch 和 sequence

- `projectEpoch`：整个 collaboration universe 的随机 epoch。显式 breaking reset 才改变；改变后所有
 旧 document、frame、checkpoint、replica、session、ticket 和 cutoff 都失效。
- `membershipEpoch`：membership authority/admin-root generation。只有 membership authority recovery
  或显式 rotation 改变；改变会关闭全部 session 并重新签 current member/replica snapshot，但不改变
  Project document bytes。
- `membershipSequence`：当前 membershipEpoch 内的 service uint64 mutation high-water。invite、join、
  member role/revoke、replica enroll/rotate/revoke 每次原子加一。它只排序 authorization mutations，
  MUST NOT 排序 edit。
- `memberAuthorizationEpoch`：member 的随机 access token，只在 member role/state/key 改变时轮换。
- `replicaAuthorizationEpoch`：replica 的随机 access token，只在该 replica revoke/replace 时轮换。

无关 member/replica enrollment 导致 membershipSequence 增长时，其他 active principal 的两个
authorization epoch 不变；它们已经签出的 frame 不得仅因 sequence 旧而失效。

### 3.3 Membership snapshot

```ts
interface MembershipMemberV2 {
  memberId: MemberIdV1
  memberSigningPublicKey: PublicKeyV1
  role: CollaborationRoleV1
  state: "active" | "revoked"
  memberAuthorizationEpoch: Id128V1
}

interface MembershipReplicaV1 {
  replicaId: ReplicaIdV1
  actorId: ReplicaActorIdV1
  memberId: MemberIdV1
  replicaSigningPublicKey: PublicKeyV1
  state: "active" | "revoked" | "replaced"
  replicaAuthorizationEpoch: Id128V1
  enrolledAtMembershipSequence: Uint64V1
  revokedAtMembershipSequence: Uint64V1 | null
  replacesReplicaId: ReplicaIdV1 | null
}

interface MembershipSnapshotV2 {
  format: "convax.membership-snapshot/2"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  membershipSequence: Uint64V1
  documentRegistrySequence: Uint64V1
  documentRegistryDigest: DigestV1
  members: MembershipMemberV2[]
  replicas: MembershipReplicaV1[]
  issuedAtUnixMs: Uint64V1
  trustBundleDigest: DigestV1
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: SignatureV1
}
```

`members` 按 memberId bytes 严格排序；`replicas` 按 replicaId bytes 严格排序。actorId、replicaId 和
replica signing key 在 snapshot 内各自唯一。Active replica 的 member 必须 active。Viewer replica
可以建立 read/replication session，但不能签发新的 edit frame。

Service 必须允许按 digest 获取仍被 current checkpoint catalog、revocation cutoff 或 unexpired session
引用的 immutable snapshot。Snapshot lookup 返回 exact object，不能把 current snapshot 冒充旧 digest。

### 3.4 Replica enrollment、rotation、revoke

Replica mutation 先取得 60 秒 single-use challenge：

```ts
interface ReplicaMutationChallengeV1 {
  format: "convax.replica-mutation-challenge/1"
  purpose: "enroll" | "rotate" | "revoke"
  challengeId: Id128V1
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  memberId: MemberIdV1
  expectedMemberMutationCounter: Uint64V1
  serverNonce: Id128V1
  issuedAtUnixMs: Uint64V1
  expiresAtUnixMs: Uint64V1
  trustBundleDigest: DigestV1
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: SignatureV1
}

interface ReplicaMutationProofV1 {
  format: "convax.replica-mutation-proof/1"
  purpose: "enroll" | "rotate" | "revoke"
  mutationId: Id128V1
  challengeDigest: DigestV1
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  expectedMembershipSequence: Uint64V1
  memberId: MemberIdV1
  memberMutationCounter: Uint64V1
  serverNonce: Id128V1
  currentReplicaId: ReplicaIdV1 | null
  newReplicaId: ReplicaIdV1 | null
  newReplicaSigningPublicKey: PublicKeyV1 | null
  revocationCutoff: RevocationCutoffManifestV1 | null
  memberSignature: SignatureV1
}
```

签名覆盖：

```text
"convax.replica-mutation-proof/1\0" ||
SHA-256(JCS(proof without memberSignature))
```

Exact union：

- enroll：`currentReplicaId=null`，new 两字段非 null，`revocationCutoff=null`；
- rotate：current/new 三字段非 null，cutoff 非 null；
- revoke：current 非 null，new 两字段 null，cutoff 非 null。

Service 在同一 transaction 中验证 challenge、member key/state、exact next member counter、current
membership sequence、scope、new replica/key uniqueness、cutoff；消费 challenge/nonce，派生 actorId，推进
membershipSequence，签 snapshot/receipt，并在 rotate/revoke 时关闭 old replica 的 session。Signer 或
commit 失败时所有 high-water、challenge、session 和 snapshot 都不变。同 mutationId + same request
digest 返回 exact receipt；same mutationId + different digest 返回 equivocation。

## 4. Session 与 PeerJS rendezvous credential

### 4.1 单 writer lease

每个 active replica 最多一个 active session。创建新 session 在同一 transaction 中关闭旧 session；本机
native adapter还必须持有该replica Project-scoped writer lock。这只能防止正常实现重复运行，不能从密码学上
阻止复制了long-lived replica private key的恶意进程双签；后者必须按第5节equivocation规则quarantine。
一个 member 通过不同 replica 支持多设备并发。

Session challenge path 必须含 memberId 和 replicaId；proof 由 long-lived replica key 签名。Session
signing/encryption key 是临时 key，只签 PeerJS handshake、channel、transfer、holder 和 service mutation
transcript；portable edit frame 由 long-lived replica key 签名，才能跨 session 延续同一 actor chain。Replica
private key 只能由 OS vault adapter 使用，不进入 renderer、PeerJS payload 或 Project 文件。

```ts
interface ReplicaSessionChallengeV1 {
  format: "convax.replica-session-challenge/1"
  challengeId: Id128V1
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  memberId: MemberIdV1
  replicaId: ReplicaIdV1
  actorId: ReplicaActorIdV1
  expectedReplicaSessionCounter: Uint64V1
  serverNonce: Id128V1
  sessionId: Id128V1
  leaseId: Id128V1
  peerId: Id128V1
  issuedAtUnixMs: Uint64V1
  expiresAtUnixMs: Uint64V1
  trustBundleDigest: DigestV1
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: SignatureV1
}

interface ReplicaSessionProofV1 {
  format: "convax.replica-session-proof/1"
  challengeDigest: DigestV1
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  memberId: MemberIdV1
  replicaId: ReplicaIdV1
  actorId: ReplicaActorIdV1
  replicaSessionCounter: Uint64V1
  serverNonce: Id128V1
  sessionId: Id128V1
  leaseId: Id128V1
  peerId: Id128V1
  sessionNonce: Id128V1
  sessionSigningPublicKey: PublicKeyV1
  sessionEncryptionPublicKey: PublicKeyV1
  requestedExpiresAtUnixMs: Uint64V1
  replicaSignature: SignatureV1
}

interface MembershipCredentialV2 {
  format: "convax.membership-credential/2"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  membershipSequence: Uint64V1
  membershipSnapshotDigest: DigestV1
  memberId: MemberIdV1
  memberAuthorizationEpoch: Id128V1
  role: CollaborationRoleV1
  replicaId: ReplicaIdV1
  actorId: ReplicaActorIdV1
  replicaAuthorizationEpoch: Id128V1
  replicaSigningPublicKey: PublicKeyV1
  sessionChallengeDigest: DigestV1
  sessionId: Id128V1
  sessionNonce: Id128V1
  peerId: Id128V1
  sessionSigningPublicKey: PublicKeyV1
  sessionEncryptionPublicKey: PublicKeyV1
  leaseId: Id128V1
  issuedAtUnixMs: Uint64V1
  expiresAtUnixMs: Uint64V1
  protocolDigest: DigestV1
  schemaDigest: DigestV1
  canonicalizerDigest: DigestV1
  validationArtifactDigest: DigestV1
  trustBundleDigest: DigestV1
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: SignatureV1
}
```

Session TTL 最大 15 分钟。Credential 对 service endpoint 的授权必须在同一 transaction 中重新读取
current project/member/replica/session，并比较 project/membership epoch、member/replica state、role、两个
authorization epoch、actorId、keys 和 lease。仅验 service signature/TTL 不够。

历史 frame 的 credential 过期或其 transport session 被正常替换，不自动破坏同一 active replica 已签的
team history；frame authority来自 service credential绑定的 replica key和 current membership/cutoff，而非
session key。过期 credential 不能建立新连接、发布 checkpoint metadata、刷新 holder assertion 或签新
网络 transcript。Replica 一旦 revoke/replace，则第 6 节 cutoff覆盖其所有旧 credential。

### 4.2 Rendezvous 和 freshness ticket

Active-peer directory 只返回 current active sessions，按
`{credentialDigest,peerId}` bytes 排序。peerId 仅是 rendezvous routing，不是 principal。

Freshness ticket：

- 由 requester current session key 签 exact request；
- service 在同一 membership transaction 中验证 initiator/responder 都 current active；
- 两个 credential digest 采用 byte-lexicographic canonical order；
- ticket TTL 最大 60 秒，并绑定 current project/membership epoch、snapshot digest 和两个 credential；
- ticket 不授权 Project 之外的 peer，也不证明 checkpoint/frame/blob 内容。

PeerJS control handshake 必须由双方 session key 签同一 transcript：

```ts
interface PeerHandshakeTranscriptV1 {
  format: "convax.peer-handshake-transcript/1"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  freshnessTicketDigest: DigestV1
  initiatorCredentialDigest: DigestV1
  responderCredentialDigest: DigestV1
  connectionId: Id128V1
  initiatorNonce: Id128V1
  responderNonce: Id128V1
  channelContractDigest: DigestV1
}
```

双方必须独立验证 ticket、current snapshot 和另一方签名。peerId、DataConnection metadata 或 WebRTC
DTLS 本身不能替代 application handshake。

## 5. Replica edit hash chain 与 causal base

本文不冻结 Canvas typed-intent schema，但冻结 service/peer 所依赖的 outer identity：

```ts
interface CausalFrameHeadV1 {
  actorId: ReplicaActorIdV1
  actorSequence: Uint64V1
  frameDigest: DigestV1
}

interface CausalBaseV1 {
  checkpointDigests: DigestV1[]        // sorted unique, max 32
  maximalFrameHeads: CausalFrameHeadV1[] // sorted by actorId bytes, max 256
}

interface ReplicaEditCoreV1 {
  format: "convax.replica-edit-core/1"
  purpose: "typed-intent"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  credentialDigest: DigestV1
  memberId: MemberIdV1
  replicaId: ReplicaIdV1
  actorId: ReplicaActorIdV1
  document: DocumentScopeV1
  actorSequence: Uint64V1
  priorActorFrameDigest: DigestV1 | null
  causalBase: CausalBaseV1
  operationId: Id128V1
  requestDigest: DigestV1
  intentKind: string
  protocolDigest: DigestV1
  schemaDigest: DigestV1
  canonicalizerDigest: DigestV1
  validationArtifactDigest: DigestV1
  updateSha256: DigestV1
  normalizedWriteSetDigest: DigestV1
  canonicalPostStateHash: DigestV1
}
```

Final binary frame 包含 exact core、typed intent、base state vector、Yjs delta、replica signature。长期
replica key 对 `convax.replica-edit-signature/1\0 || coreDigestBytes` 签名；session key不得替代。

每 `{projectEpoch, document, actorId}`：

- first frame 的 `actorSequence="1"` 且 `priorActorFrameDigest=null`；
- 后续 sequence exact +1 且 prior digest exact 指向同 actor 上一 frame；
- caller 在 frame whole-envelope 和 local durable head fsync 前不得发送；
- offline provisional intent 不分配 actor sequence、不签 team frame；online rebase 在 exact accepted base
  重新执行后才签 frame，因此不需要 service abandonment/hole；
- 一个已签并 durable 的 team frame 不允许 user discard。若尚未复制，它仍由本机作为 holder 重试；
- same actor/prior/sequence 的两个不同 digest 是 signed equivocation。Peer 必须 quarantine 两个分支，
  不得按 arrival、墙钟、lexicographic hash 或 Yjs clientId 自动选 winner；
- 另一个 actor 依赖 equivocated frame 的后继进入 bounded blocked set；不依赖该 fork 的 causal component
  继续工作。

一个实现若先签名再发现本机validator拒绝，或者不同实现对同一已签frame得出不同validator结果，该actor
chain从该frame起fail closed且不得skip/abandon。Golden canonicalizer/validator vectors和exact digest门禁
因此是协议可用性条件，而不是普通兼容性优化。

Peer 对 frame 的验证顺序：scope/epoch/credential/size -> service credential signature -> replica signature ->
current authorization/cutoff -> chain identity -> causal material completeness -> exact base reconstruction -> pure reducer -> delta
apply in isolated candidate -> normalized writes/schema/bounds/invariants/canonical post-state。仅“Yjs update 可
apply”不构成接纳。

任何跨实体规则若不满足 I-confluence，owner 必须提供 arrival-independent deterministic projection 或拒绝
该并发组合。Yjs convergence 不能替代 delete-wins、creation-group whole invalid、cycle breaker、Plugin
schema 和 resource-reference 规则。

## 6. Revocation causal cutoff

### 6.1 为什么不能使用签名时间

Replica/session 私钥持有者可在 credential 到期或撤权后继续生成看似旧 credential 的签名；peer 无法从
client wall clock 证明签名发生时间。因此协议只承认 service-signed authorization mutation 绑定的 exact
checkpoint set，不声称区分不可观察的现实时间。

### 6.2 Cutoff manifest

Service 维护 bounded document registry。第一个 accepted genesis checkpoint header 注册 document scope；
service 不读取 ProjectIndex 来发现 Canvas。每个 membership snapshot 绑定 registry sequence/digest。

```ts
interface RevocationCutoffDocumentV1 {
  document: DocumentScopeV1
  checkpointDigest: DigestV1
}

interface RevocationCutoffManifestV1 {
  format: "convax.revocation-cutoff-manifest/1"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  priorMembershipSequence: Uint64V1
  documentRegistrySequence: Uint64V1
  documentRegistryDigest: DigestV1
  mutationId: Id128V1
  documents: RevocationCutoffDocumentV1[]
}
```

`documents` 按 canonical document key 严格排序，必须与 service 当前 registered document set exact
coverage；每个 checkpoint digest 必须是同 scope/projectEpoch 的已发布 header。没有新 checkpoint 的
document 也必须显式绑定 genesis checkpoint，禁止 omission 产生实现相关默认。

Replica rotate/revoke、member editor->viewer、member revoke 必须在同一 authorization transaction 中：

1. 验证 exact cutoff manifest 和发起者权限；
2. 持久化 manifest/digest；
3. 推进 membershipSequence 并轮换 target authorization epoch/state；
4. 关闭 target sessions；
5. 签 exact new membership snapshot 和 mutation receipt。

Target holder 不在线或 cutoff payload 未复制不能阻止authorization mutation本身；产品必须警告可能丢失
last checkpoint之后的target-dependent team work。Service 对 header 的存在检查不是 payload
availability/validity证明。Peer无法验证cutoff checkpoint时必须保留本机bytes但把team projection标为
`cutoff-material-unavailable`并fail closed，不能继续接受target frame，也不能声称已安全完成team rebuild。

### 6.3 Peer acceptance rule

Peer 学到更高、有效的 membership snapshot 后必须重建 accepted/working projection：

- current active member+replica 且 authorization epochs/role 与 frame credential 一致：正常按 causal rule
  验证；无关 membershipSequence 增长不使 frame失效；
- target 已 revoke/replace/downgrade：只保留可从该 document cutoff checkpoint 的 validated causal
  closure 到达的 target frame；
- 不可从 cutoff 到达的 target frame进入 quarantine/local fork；
- 任何 causal base 依赖被排除 frame 的其他 actor frame进入 blocked set，必须从 surviving base 由原
  semantic intent 显式 rebase，不能剪掉 dependency 后直接 apply delta；
- 已渲染过被排除 frame 的 peer 从 durable checkpoint/valid suffix rebuild，不尝试从 Y.Doc 反向删除。

这是 causal cutoff，不是 wall-clock cutoff。它可能丢弃诚实但未 checkpoint 的迟到编辑；若产品不能接受
该取舍，就必须引入逐 edit trusted timestamp/admission，与“无在线权威 edit order”目标冲突。

## 7. Checkpoint header publication

### 7.1 Header 是 peer claim，不是 service content certificate

```ts
interface CheckpointPayloadDescriptorV1 {
  byteLength: Uint64V1
  fullUpdateSha256: DigestV1
  stateVectorSha256: DigestV1
  canonicalStateHash: DigestV1
}

interface CheckpointAuthorV1 {
  memberId: MemberIdV1
  replicaId: ReplicaIdV1
  actorId: ReplicaActorIdV1
  credentialDigest: DigestV1
  sessionId: Id128V1
}

interface CheckpointHeaderV1 {
  format: "convax.checkpoint-header/1"
  checkpointId: Id128V1
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  membershipEpoch: Id128V1
  membershipSequence: Uint64V1
  membershipSnapshotDigest: DigestV1
  document: DocumentScopeV1
  parentCheckpointDigests: DigestV1[]
  maximalFrontier: CausalFrameHeadV1[]
  causalFrontierDigest: DigestV1
  payload: CheckpointPayloadDescriptorV1
  protocolDigest: DigestV1
  schemaDigest: DigestV1
  canonicalizerDigest: DigestV1
  validationArtifactDigest: DigestV1
  author: CheckpointAuthorV1
  authorSignature: SignatureV1
}
```

`parentCheckpointDigests` digest-byte sorted unique，最多 32；非 genesis 必须至少一个 parent。Service
只验证 parent header 已发布且 exact 同 document/projectEpoch/schema identity。`maximalFrontier` 按 actorId
bytes 排序、actorId 唯一、最多 256；peer 必须验证每个 head 可达且集合中没有 head 可从另一个 head
到达。Service 不做该检查。

Header author signature：

```text
"convax.checkpoint-header/1\0" ||
SHA-256(JCS(header without authorSignature))
```

`authorSignature` 使用 `author.credentialDigest` 所绑定的current session signing key；发布endpoint必须在
同一transaction中确认该session仍是author replica的active editor session。历史验证允许credential TTL
已过期，但必须同时验证service-signed credential、header signature和publication receipt；正常session替换
不撤销已发布header。该签名只证明author发布了这组metadata，不证明payload或causal claim正确。

Checkpoint digest 覆盖完整 author-signed header。Payload bytes 只通过 PeerJS update channel 传输。

### 7.2 Service publication receipt

```ts
interface CheckpointPublicationReceiptV1 {
  format: "convax.checkpoint-publication-receipt/1"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  document: DocumentScopeV1
  checkpointDigest: DigestV1
  catalogSequence: Uint64V1
  contentStatus: "unverified-peer-content"
  publishedAtUnixMs: Uint64V1
  trustBundleDigest: DigestV1
  serviceKeyPurpose: "checkpoint-catalog"
  serviceKeyId: string
  serviceSignature: SignatureV1
}
```

Service 在一个 document-catalog transaction 中验证 current editor session、header signature/scope/bounds、
exact parent metadata、checkpointId idempotency和rate limit，保存 header，推进 catalogSequence，重算
declared tip set，并签 receipt。Signer/commit失败不改变 catalog。Same checkpoint digest 幂等返回 exact
receipt；same `{author replica,checkpointId}` different digest 是 metadata equivocation并拒绝。

`contentStatus` 必须 exact 固定为 `unverified-peer-content`。UI、peer、日志和 API 文档不得把 receipt
描述为 validated/attested/certified Canvas state。

### 7.3 Declared tips、真实 dominance 与并发

Service 只基于 header parent DAG 维护 `declaredTipDigests`：新 header 成为 tip；它声明的 ancestors 从
tip set移除。这个集合用于 bounded discovery，不是 content-valid frontier。

Peer 证明 checkpoint A content-dominates B 当且仅当：

1. scope/projectEpoch/protocol identity exact 相同；
2. A payload、state vector、canonical state 和完整 causal closure验证通过；
3. B 的每个 maximal frontier head 都可从 A 的 causal closure 到达。

Checkpoint sequence、service publication time、declared parent 或 actor counter 比较都不能替代第 3 条。

若两个 valid checkpoint 互不可达，它们并发，bootstrap/receiver 必须合并两者 causal closure 和 Yjs
updates，再执行 closed-schema/I-confluence validation；不能按 service sequence 或 arrival 选一个。后续
checkpoint 可把两个 digest 都列为 parent，并对 merged maximal frontier 做 peer validation。

一个恶意 invalid child 可在 declared DAG 上覆盖 valid parent，但不能删除 parent。Catalog list 返回 tip
header及其 bounded parent fallback；client 验证 child失败后沿 parent digest回退。Service 永不因 child
publication立即删除 ancestor header/holder metadata。

### 7.4 Catalog snapshot

```ts
interface CheckpointCatalogSnapshotV1 {
  format: "convax.checkpoint-catalog-snapshot/1"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  document: DocumentScopeV1
  catalogSequence: Uint64V1
  declaredTipDigests: DigestV1[]
  fallbackHeaderDigests: DigestV1[]
  catalogDigest: DigestV1
  issuedAtUnixMs: Uint64V1
  trustBundleDigest: DigestV1
  serviceKeyPurpose: "checkpoint-catalog"
  serviceKeyId: string
  serviceSignature: SignatureV1
}
```

两个数组 digest-byte sorted unique；fallback 必须包含每个 tip 向后至少一层 exact parents，并在 response
上限内按 `(distance,digest)` canonical 顺序选取。Client 缓存 per-document catalogSequence/digest
high-water；更低 sequence 或 same sequence different digest 是 rollback/equivocation，fail closed。

### 7.5 Holder assertion

```ts
interface CheckpointHolderAssertionV1 {
  format: "convax.checkpoint-holder-assertion/1"
  projectId: ProjectIdV1
  projectEpoch: Id128V1
  document: DocumentScopeV1
  checkpointDigest: DigestV1
  payload: CheckpointPayloadDescriptorV1
  holderMemberId: MemberIdV1
  holderReplicaId: ReplicaIdV1
  holderActorId: ReplicaActorIdV1
  holderCredentialDigest: DigestV1
  holderSessionId: Id128V1
  holderPeerId: Id128V1
  holderSequence: Uint64V1
  storageClaim: "durable-local-copy"
  issuedAtUnixMs: Uint64V1
  expiresAtUnixMs: Uint64V1
  holderSignature: SignatureV1
}
```

Service验证 current active session、holder exact next sequence、assertion signature、scope、checkpoint header
存在及 payload descriptor exact equality。Assertion TTL 最大 5 分钟且不能超过 session credential TTL；
expired/revoked/closed-session assertion 不出现在 active holder list。`storageClaim` 是 holder 的签名声明，
不是 service 对 fsync 的远程证明。

Service 每 checkpoint 最多保存 64 个 current assertions，每次 list 最多返回 16 个 canonical active
holders。Blob/file holder 与 checkpoint holder 是不同 claim；checkpoint assertion 不证明 referenced blob
已复制。

## 8. Bootstrap 与 anti-stale

新设备 bootstrap 顺序固定：

1. 从 service 取得 current trust bundle、project/membership epoch、membership snapshot 和 document
   registry；
2. 对每个 registered document 取得 current signed checkpoint catalog snapshot；
3. 拒绝低于本机已 durable high-water 的 catalog；新设备以 service current snapshot 为 initial
   high-water，不能让 holder替换；
4. 从 current active holder 通过 PeerJS control 请求 manifest，通过 update channel 获取 header、checkpoint
   payload和必要 causal suffix；
5. exact 验证 header author credential、payload hash/state vector/canonical state、parent/fallback、causal
   closure、frame signatures、typed intents、Yjs writes、schema/invariants；
6. 忽略 invalid tips并沿 retained parents回退；对多个 valid incomparable tips取 causal union并验证 merged
   projection；
7. durable 写 accepted snapshot/journal/head 后才宣布 document ready；blob后台另行同步。

Holder只给旧 valid checkpoint时，service catalog high-water使它可检测为 stale。Service不可达时，已有
device可继续 local fork；没有 durable catalog high-water的新设备不得仅凭一个 seed bootstrap。无 active
holder时状态是 `waiting-for-holder`；结构元数据和普通UI不得伪装成“团队已同步”。

Checkpoint payload或suffix缺失时，client可以尝试 fallback parent+其他holder；不能把未经证明的 peer full
snapshot当作 checkpoint，也不能因Yjs update可apply跳过历史验证。

## 9. PeerJS 三通道协议

同一 authenticated `connectionId` 使用三个独立 PeerJS DataConnection；每个 channel-open transcript 都由
双方 session key签名并绑定第 4.2 节 control handshake。

| Channel | 内容 | 规则 |
| --- | --- | --- |
| `convax-control/1` | inventory、catalog/header/holder 请求、transfer manifest、ACK/NACK、awareness | reliable ordered；单 message 64 KiB；awareness 16 KiB、TTL 30s、coalesce |
| `convax-update/1` | edit frame、checkpoint payload、causal suffix chunks | binary；单 chunk 256 KiB；每 peer 4 inflight transfer；先 manifest 后 bytes |
| `convax-blob/1` | Project file/blob chunks和Merkle proof | binary；单 chunk 1 MiB；每 peer 4 inflight chunks；不得阻塞control/update |

```ts
interface PeerTransferManifestV1 {
  format: "convax.peer-transfer-manifest/1"
  connectionId: Id128V1
  transferId: Id128V1
  channel: "update" | "blob"
  kind: "edit-frame" | "checkpoint" | "causal-suffix" | "project-blob"
  byteLength: Uint64V1
  sha256: DigestV1
  chunkBytes: Uint64V1
  chunkCount: Uint64V1
  subjectDigest: DigestV1
}
```

Receiver 在分配大 buffer/解析JCS/Yjs/媒体前验证 connection、manifest、credential/epoch、owner limit 和
queue capacity。Chunks 必须 exact index/count/size，最终 hash不匹配即丢弃整个 transfer。Backpressure
读取 WebRTC buffered amount；超过高水位暂停发送，不能把未界限 Promise/ArrayBuffer堆在renderer。

Control/update/blob 使用独立队列、取消和strike budget。视频/大blob饱和只能降低blob吞吐，不能阻塞
membership refresh、revocation、edit frame 或 checkpoint inventory。Peer scope/epoch改变、freshness ticket
失败、session关闭或 transcript不匹配时三个channel全部关闭。

## 10. Web API

所有 endpoint 使用 Web Standard Request/Response 和 injected stores/signers/verifiers。除明确的 GET 外，
request 必须是 bounded canonical JSON；API v1/v2 不接受 Yjs/frame/checkpoint/blob binary body。

### 10.1 Endpoint set

| Method/path | Authority | Result |
| --- | --- | --- |
| `GET /api/collaboration/service-trust/bundles/{digest}` | trust bootstrap | exact signed trust bundle |
| `GET /api/collaboration/projects/{projectId}/membership` | current session | current `MembershipSnapshotV2` |
| `GET /api/collaboration/projects/{projectId}/membership/snapshots/{digest}` | current session | exact retained snapshot |
| `POST /api/collaboration/projects/{projectId}/members/{memberId}/replica-mutation-challenges` | member key pre-proof | exact challenge |
| `POST /api/collaboration/projects/{projectId}/members/{memberId}/replicas` | member-signed enroll proof | exact snapshot + receipt |
| `POST /api/collaboration/projects/{projectId}/members/{memberId}/replicas/{replicaId}/rotate` | member-signed rotate proof | exact snapshot + receipt |
| `POST /api/collaboration/projects/{projectId}/members/{memberId}/replicas/{replicaId}/revoke` | member-signed revoke proof | exact snapshot + receipt |
| `POST /api/collaboration/projects/{projectId}/members/{memberId}/replicas/{replicaId}/session-challenges` | replica key pre-proof | session challenge |
| `POST /api/collaboration/projects/{projectId}/sessions` | replica-signed proof | `MembershipCredentialV2` + signaling config |
| `GET /api/collaboration/projects/{projectId}/membership/active-peers` | current session | active credential directory |
| `POST /api/collaboration/projects/{projectId}/membership/peer-tickets` | current session signature | freshness ticket |
| `POST /api/collaboration/projects/{projectId}/members/{memberId}/role` | membership admin + cutoff when authority shrinks | snapshot + mutation receipt |
| `POST /api/collaboration/projects/{projectId}/members/{memberId}/revoke` | membership admin + cutoff | snapshot + mutation receipt |
| `POST /api/collaboration/projects/{projectId}/membership-epoch-rollover-challenges` | membership admin | challenge |
| `POST /api/collaboration/projects/{projectId}/membership-epoch-rollovers` | exact recovery/rotation proof | new epoch snapshot |
| `POST /api/collaboration/projects/{projectId}/epoch-rollover-challenges` | project admin | challenge |
| `POST /api/collaboration/projects/{projectId}/epoch-rollovers` | breaking reset proof | new project epoch receipt |
| `POST /api/collaboration/projects/{projectId}/documents/{docKind}/{docId}/{shardEpoch}/checkpoint-headers` | current editor session | publication receipt |
| `GET /api/collaboration/projects/{projectId}/documents/{docKind}/{docId}/{shardEpoch}/checkpoint-catalog` | current session | signed catalog snapshot |
| `GET /api/collaboration/projects/{projectId}/documents/{docKind}/{docId}/{shardEpoch}/checkpoint-headers/{digest}` | current session | exact retained header+receipt |
| `POST /api/collaboration/projects/{projectId}/documents/{docKind}/{docId}/{shardEpoch}/checkpoint-headers/{digest}/holder-assertions` | current session | exact stored assertion receipt |
| `GET /api/collaboration/projects/{projectId}/documents/{docKind}/{docId}/{shardEpoch}/checkpoint-headers/{digest}/holders` | current session | current active holder assertions |
| `GET /api/collaboration/projects/{projectId}/revocation-cutoffs/{digest}` | current session | exact cutoff manifest |

Invite/join/project create 继续使用独立 admin/invite proof，并最终产生同一 MembershipSnapshotV2；它们不
获得 edit/frame payload authority。

### 10.2 明确删除的 endpoint/DTO

下列 path 返回 404 且 MUST 从 public implemented/remaining endpoint catalog 删除，而不是保留“以后实现”：

```text
POST .../admissions
POST .../counter-abandonments
POST .../operations/{actorId}/{operationId}/lookup
GET  .../frontiers/{docKind}/{docId}/{shardEpoch}
POST .../canvas-genesis-reservations
POST .../checkpoints/epoch-reservations
POST .../checkpoints/{checkpointOutboxDigest}/lookup
POST .../checkpoints/{checkpointOutboxDigest}/published
GET  .../project-index-route-fences/{indexCheckpointDigest}/{canvasId}/{canvasShardEpoch}
```

同时删除 `AdmissionCertificateV1`、`MmrPeakV1`、DocumentMmr store、AdmissionAttester port、actor terminal/
abandonment receipt 和任何 `serverSequence/leafIndex/priorMmrRoot/nextMmrRoot` edit authority。旧 bytes 作为
unsupported protocol 保留到显式 breaking reset，不能解释成新 frame。

## 11. Service durable store 与 bounds

Service durable state仅包括：

- trust bundle publication chain；
- current projectEpoch/membershipEpoch、member/replica records、mutation counters、immutable referenced
  membership snapshots和 exact idempotency receipts；
- active session/challenge、PeerJS directory/ticket replay high-water；
- bounded document registry；
- per-document checkpoint header/receipt parent DAG、catalog sequence/tips/fallback和短期 holder assertions；
- revocation cutoff manifests和 epoch rollover receipts。

Service store MUST NOT contain：Yjs update/state vector bytes、typed intent、edit frame/payload、Canvas/
ProjectIndex canonical state、Project file/blob bytes、causal reachability result、Plugin state或peer awareness。

### 11.1 Hard limits

| Scope | Limit |
| --- | ---: |
| Project members | 256 |
| active replicas per member | 8 |
| active replicas per Project | 512 |
| active editor replicas per Project | 256 |
| retained revoked/replaced replicas per projectEpoch | 4096 |
| active session per replica | 1 |
| active session challenges per replica | 4 |
| registered documents per Project | 4096 |
| checkpoint header JCS | 64 KiB |
| checkpoint maximal frontier heads | 256 |
| checkpoint direct parents | 32 |
| declared tips per document | 32 |
| retained checkpoint headers per document | 128 |
| current holder assertions per checkpoint | 64 |
| active holders returned per list | 16 |
| revocation cutoff manifest | 512 KiB / 4096 documents |
| normal API JSON request | 64 KiB |
| membership snapshot response | 2 MiB |
| checkpoint catalog response | 512 KiB |
| session credential TTL | 15 minutes |
| holder assertion TTL | 5 minutes |
| freshness ticket TTL | 60 seconds |

达到 retired replica、document、checkpoint tip/header 或 cutoff 上限时 fail closed 并要求 checkpoint
consolidation、holder refresh或显式 projectEpoch reset；禁止静默驱逐仍被 current catalog/cutoff/snapshot
引用的 record。

### 11.2 Transactions 与 adapter

- Membership store transaction 原子处理 member/replica mutation、cutoff、snapshot、session close、counter、
  idempotency和签名结果。
- Document catalog transaction 原子处理 header idempotency、parent metadata、tip set、catalog sequence、
  publication receipt。
- Holder transaction 原子验证 current session、推进 holder sequence并替换该 replica 的短期 assertion。
- Signer/clock/random/rate limiter/PeerJS signaling config均为 typed port；adapter异常回滚 transaction。
- Store 可按 `{projectId}` 和 `{projectId,documentKey}` 分片；业务 contract不能导入 Cloudflare SDK、
  Durable Object、database client或deployment secret。

Cloudflare routing worker 只处理 bounded JSON、signature和小型 transactional metadata；不需要几百 MiB
attester carrier、Yjs parser、binary streaming或长 CPU task。Checkpoint/frame/blob payload 全走 PeerJS，
所以部署 adapter 可用 Service Binding/DO/DB 而不改变 portable API semantics。

## 12. Failure、GC 与状态展示

- Service/membership 离线：已有设备继续 durable local fork；不能刷新 session、发现新peer、发布header或
  holder assertion。
- Peer offline：本机继续 local fork；team frame在至少一个remote durable ACK前显示“仅本机”。
- Header已发布但payload不存在：header保留为 unverified candidate；holder list为空，bootstrap回退或等待。
- Holder assertion过期：只移出active availability，不删除checkpoint header。
- Invalid header/payload：peer quarantine bytes和author evidence；service metadata不改写为valid/invalid。
- Catalog ancestor GC：仅删除未被tip、fallback、cutoff、membership snapshot或holder引用且超过retention的
  header；不能因新child声明parent就立即删除。
- Blob/file复制与checkpoint metadata分离；“可完整离线使用”要求所有current resource blob本机完整，
  不是只有Yjs/checkpoint。

## 13. Falsifiable conformance tests

下列任一失败即否决本方案：

1. **无全局 edit order**：两个 replica 对不相交节点各提交 1000 个frame；任一 frame因另一 replica
   提交而必须调用service、取得global sequence或重签无关base，则失败。
2. **多设备 identity**：同member两个enrolled设备获得不同replicaId/actorId并可合法并发；若落到同actor
   counter、Yjs clientId winner或被误判equivocation，则失败。
3. **单replica writer**：第二session issue必须原子关闭第一session；旧session仍能取得ticket、发布header
   或holder assertion则失败。复制long-lived key后双签不能被误称为lease已消除，两个有效fork必须同时
   quarantine。
4. **Rotation**：rotate一次只推进一个membershipSequence，新actor不复用旧chain；old replica cutoff后
   frame不能作为new replica history。
5. **无关membership mutation**：成员B enroll设备后，成员A未变化authorization epochs的历史frame仍可
   验证；仅因snapshot sequence旧被拒绝则失败。
6. **Revocation cutoff**：target frame可从cutoff checkpoint到达则保留；同credential下不可达的later或
   fork frame必须quarantine。使用client timestamp区分则失败。
7. **Dependent block**：另actor frame causal base包含被cutoff排除frame时不得直接apply；删dependency后
   apply delta则失败。
8. **Equivocation**：same actor/prior/sequence双签以相反arrival顺序输入两个peer；两个peer都必须标记fork，
   不能得到不同winner。
9. **Service不验content**：发布hash正确但逻辑无效的checkpoint header，service返回
   `unverified-peer-content` receipt而peer拒绝payload；service若称validated或解析Yjs则失败。
10. **Checkpoint dominance**：A/B valid且不可达时两者保留并合并；较晚publication sequence不得赢。
11. **Invalid-child fallback**：invalid C声明A/B为parents；client拒绝C后仍能按catalog fallback取回A/B，
    service若已删除A/B则失败。
12. **Catalog anti-rollback**：本机durable sequence N后，恶意seed提供N-1 snapshot/header必须拒绝；新设备
    无service current head时不得把seed旧snapshot标为team ready。
13. **Holder诚实边界**：service只验证assertion signature/tuple/TTL；没有payload的恶意holder不能让peer
    通过hash/state/schema验证。
14. **无holder**：current catalog有header但active holder为零时进入`waiting-for-holder`，不能初始化空doc。
15. **Bounds/DoS**：257 frontier heads、33 parents、33 tips、oversized JSON、乱序/重复digest、过期holder、
    unknown key均在Yjs解析和大buffer分配前fail closed。
16. **三通道隔离**：持续大视频blob传输时，control ticket/revocation和update frame仍在各自bounded queue
    前进；blob bufferedAmount不能阻塞另外两个channel。
17. **No hidden server payload**：fake store检查所有commit值；出现Yjs bytes、frame payload、blob bytes、
    causal-valid boolean或MMR leaf即失败。
18. **Crash atomicity**：snapshot/header/holder signer或store commit注入失败后，sequence、nonce、session、tip
    set和idempotency结果全部不变；response-loss exact retry返回同一signed result。
19. **Breaking rejection**：旧admission/MMR/counter-abandonment frame/API body必须unsupported并保留原bytes；
    不能静默迁移、dual-read或reset。
20. **Cutoff material缺失/无效**：authorization mutation可完成，但peer拿不到或拒绝cutoff payload时必须
    进入`cutoff-material-unavailable`且拒绝target后续frame；若继续展示team-ready或用header存在代替内容
    验证则失败。

## 14. 最强反驳、漏洞类型与评分

最强反驳：

1. **撤权的CAP代价**：没有逐edit trusted timestamp，协议只能以checkpoint causal set切断权限；诚实但未
   checkpoint的迟到工作也会被排除。若产品要求“离线不丢且撤权实时精确”，本方案不成立。
2. **签名者可fork**：hash chain防篡改但不防当前key持有者双签。Quarantine避免静默分歧，却可能阻塞
   依赖该fork的后继并被恶意editor用于DoS。
3. **Bootstrap trust仍需本地重验证**：service不验content使其成本和中心权威显著下降，但新peer仍必须从
   holder取得checkpoint/causal material并运行portable validator；缺少material时不能安全捷径。

旧 central admission/MMR 论证的漏洞类型是目标冲突（把provenance sequence变成逐edit在线串行）、隐含
中心可用性假设和部署样本偏差。纯“PeerJS+Yjs自然会合并”的漏洞类型是逻辑跳跃、忽略I-confluence、
忽略撤权CAP和把member误当replica的事实错误。

本提案评分 **8.7/10**。扣分：revocation会舍弃cutoff后的诚实迟到工作；恶意editor equivocation仍能
造成bounded可用性损失；bootstrap依赖至少一个holder提供可验证material。剩余问题在明确威胁模型下不
致命：它们不会产生arrival-dependent canonical winner或伪造service content证明，且失败都转为
quarantine/local-fork/waiting-for-holder，而不是静默数据覆盖。

如果未来证据表明业务不能接受上述撤权损失，唯一诚实替代是重新引入逐edit authority/timestamp；不得
一边保留完全离线接纳，一边宣称service可精确判断现实签名时刻。
