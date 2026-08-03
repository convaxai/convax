# Convax Collaboration Yjs Schema

状态：架构门禁草案。schema、canonicalizer 和 protocol digest 是 wire admission 的一部分；
任何不兼容修改都必须显式 bump，而不是宽松读取。

## 1. 版本轴

版本独立：

| Axis                 | v1 token                            | Meaning                                           |
| -------------------- | ----------------------------------- | ------------------------------------------------- |
| wire frame           | `convax.collaboration-frame/1`      | Binary envelope and signature fields              |
| Project index schema | `convax.project-index-yjs/1`        | Shared root names and value schemas               |
| Canvas schema        | `convax.canvas-yjs/1`               | Nodes, edges, generation and Plugin state         |
| typed intent         | `convax.typed-intent/1`             | Closed ProjectIndex and Canvas semantic mutations |
| canonicalizer        | SHA-256 digest                      | Exact pure projection/validation artifact bytes   |
| checkpoint           | `convax.collaboration-checkpoint/1` | Attested snapshot and MMR prefix                  |
| peer cipher          | `convax.peer-cipher/1`              | Mutual proof, KDF, channel envelope and replay    |
| Plugin state schema  | `convax.plugin-state-schema/1`      | Closed portable bounded value schema dialect      |

未知 token/digest 必须 fail closed。schema compatibility 不能靠 duck typing。
`convax.typed-intent/1` 是 v1 唯一合法 intent token；`convax.canvas-intent/1` 从未发布，必须作为
unknown token 拒绝，不能作为 alias 接受或 canonicalize。

## 2. Binary frame

网络和本地 journal 使用同一个 length-prefixed binary envelope。固定 88-byte prefix 后是 JCS UTF-8
final header 和 binary payload：

| Offset |   Length | Field                                                                                                                                                                                   |
| -----: | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|      0 |        8 | ASCII `CVXCOLL1`                                                                                                                                                                        |
|      8 |        2 | unsigned big-endian protocol major；v1 为 `1`                                                                                                                                           |
|     10 |        1 | kind：`1=certified-intent-frame`、`2=snapshot`、`3=durable-head`、`4=local-fork-record`、`5=admission-outbox`、`6=checkpoint-outbox`、`7=abandonment-outbox`、`8=certified-abandonment` |
|     11 |        1 | flags；v1 必须为 `0`                                                                                                                                                                    |
|     12 |        4 | unsigned big-endian JCS header length                                                                                                                                                   |
|     16 |        8 | unsigned big-endian payload length                                                                                                                                                      |
|     24 |       32 | SHA-256(header bytes)                                                                                                                                                                   |
|     56 |       32 | SHA-256(payload bytes)                                                                                                                                                                  |
|     88 | variable | JCS header then payload                                                                                                                                                                 |

未知 major/flag、length overflow、hash mismatch 和 trailing bytes fail closed。JCS 中只允许 JSON
primitive/array/object；digest 固定为 64-char lowercase hex，signature/public key 固定为 unpadded
base64url，uint64 固定为 decimal string。final/core/certificate header 不使用 JSON number。typed intent
中的 geometry 只能使用 owner 限定范围内的 finite number 并按 JCS 编码。JCS 中禁止 `Uint8Array`、
`undefined`、NaN、Infinity 和非 NFC string。

### 2.1 无循环的构造顺序

Intent frame 必须按以下顺序构造：

1. 构造不含 core digest、client signature、admission certificate 和 final frame digest 的
   `IntentCoreHeaderV1`。
2. 编码 binary core payload。
3. `coreDigest = SHA-256("convax.intent-core/1\0" || u32be(coreHeaderLength) ||
coreHeaderBytes || corePayloadBytes)`。
4. session private key 对
   `"convax.intent-client-signature/1\0" || coreDigestBytes` 做 Ed25519 signature。
5. admission service 把 `coreDigest` 作为 append-only MMR leaf 的业务输入并签发 certificate。
6. final JCS header 写入 exact core object、coreDigest、clientSignature 和非空 admission certificate。
7. 88-byte prefix 的两个 hash 只校验 final header/payload bytes；`finalFrameDigest` 是完整 prefix +
   final header + payload 的 SHA-256，用于 journal chain，不进入自身 header。

因此修改 certificate 会改变 final envelope，但不会改变 coreDigest/MMR leaf；certificate 不可能参与
自己的 leaf/hash。

### 2.2 Intent core

```ts
interface IntentCoreHeaderV1 {
  format: "convax.intent-core/1"
  purpose: "typed-intent"
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  credentialDigest: string
  leaseId: string
  sessionNonce: string
  sessionSequence: string
  doc: {
    kind: "project-index" | "canvas"
    id: string
    shardEpoch: string
    docEpoch: string
  }
  projectIndexFrontier: ProjectIndexFrontier
  actor: {
    memberId: string
    actorId: string
    sessionId: string
    logicalCounter: string
  }
  operationId: string
  requestDigest: string
  intentKind: TypedIntentV1["kind"]
  intentSchema: "convax.typed-intent/1"
  baseCheckpointDigest: string
  baseNextLeaf: string
  baseMmrRoot: string
  baseStateVectorHash: string
  updateSha256: string
  changedPathsDigest: string
  writeSetDigest: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
}

interface CollaborationFrameHeaderV1 {
  format: "convax.collaboration-frame/1"
  core: IntentCoreHeaderV1
  coreDigest: string
  clientSignature: string
  admission: AdmissionCertificateV1
}
```

ProjectIndex frame 的 `projectIndexFrontier` 必须精确等于它自己的 prior durable frontier 且 `route`
为 null；Canvas frame 必须绑定一个已 attested 且 route 为 live 的 ProjectIndex frontier：

```ts
interface ProjectIndexFrontier {
  shardEpoch: string
  docEpoch: string
  checkpointSequence: string
  checkpointDigest: string
  mmrNextLeaf: string
  mmrRoot: string
  canonicalStateHash: string
  route: {
    canvasId: string
    shardEpoch: string
    routeDigest: string
    state: "staged" | "live" | "closed"
  } | null
}

interface CertifiedDocumentFrontierV1 {
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  docEpoch: string
  checkpointDigest: string
  mmrNextLeaf: string
  mmrRoot: string
  stateVectorHash: string
  canonicalStateHash: string
  projectIndexFrontier: ProjectIndexFrontier
}
```

Core payload：

```text
u32be intentLength
intentLength bytes JCS typed-intent
u32be baseStateVectorLength
baseStateVectorLength bytes Yjs state vector
u32be deltaLength
deltaLength bytes Yjs update
u32be actualWriteSetLength
actualWriteSetLength bytes JCS actual changed paths/write-set
```

所有 length 总和必须精确等于 prefix payload length。typed intent 和 write-set JCS bytes 的 digest
必须匹配 core header。

限制：

- service 对 `{projectEpoch, actorId, operationId}` 只允许一个 admitted coreDigest；
- local provisional operation 不等于 admitted frame。重连必须先查询该 operation 是否已经 admitted：
  已 admitted 则获取 exact frame；未 admitted 才在新 base/docEpoch 上重新执行并申请 admission；
- `logicalCounter` 是无符号 64-bit decimal string；不使用 JavaScript number；
- local offline mutation 不构造 `CollaborationFrameHeaderV1`，而是写 `LocalForkRecordV1`；certified frame
  的 admission 永不为空。docEpoch/base 已变化时必须从 semantic intent 重新执行生成新 delta；
- 接纳时必须重算 core payload fields、coreDigest、client signature、admission、final envelope hash 和
  intent-to-update equivalence；
- 一个 frame 恰好一个 typed intent 和一个 Yjs transaction。禁止 batch 多个不相关 intent。
- same `{actorId, operationId}` + same requestDigest 返回已有 receipt；不同 digest 使 shard quarantine。

### 2.2.1 Wire identity registry

wire identity 必须先通过 owner codec，不能接受再“规范化”别名：

```ts
type RandomId128V1 = string // canonical unpadded base64url of exactly 16 bytes
type ProjectIdV1 = string // canonical owner id: ^[a-z0-9][a-z0-9_-]{0,95}$
type MemberIdV1 = RandomId128V1
type InviteIdV1 = RandomId128V1
type LeaseIdV1 = RandomId128V1
type CanvasIdV1 = RandomId128V1
type EpochIdV1 = RandomId128V1
type SessionIdV1 = RandomId128V1
type PeerIdV1 = RandomId128V1
type ChallengeIdV1 = RandomId128V1
type Nonce128V1 = RandomId128V1
type ActorIdV1 = string // canonical unpadded base64url of exactly 32 bytes
type OperationIdV1 = RandomId128V1
type IdentityOrdinalV1 = string // canonical uint32 decimal, 0..65535
type WriteOrdinalV1 = string // canonical uint32 decimal, 0..2047 or receipt sentinel 65535
type ServiceIdV1 = `svc_${string}` // suffix is 64 lowercase SHA-256 hex
type RootKeyIdV1 = `rk_${string}` // suffix is root public-key identity digest
type ServiceKeyIdV1 = `sk_${string}` // suffix is service public-key identity digest

interface OperationIdentityV1 {
  actorId: ActorIdV1
  operationId: OperationIdV1
}

interface PortableIdentityOriginV1 extends OperationIdentityV1 {
  identityOrdinal: IdentityOrdinalV1
}

interface PortableIdentityInputV1 extends OperationIdentityV1 {
  format: "convax.portable-identity-input/1"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  ordinal: IdentityOrdinalV1
  identityKind:
    | "project-file"
    | "project-directory"
    | "project-entry-version"
    | "conflict-reservation"
    | "canvas-node"
    | "canvas-edge"
    | "canvas-relation"
    | "canvas-creation-group"
    | "canvas-generation"
    | "canvas-route-deletion"
    | "canvas-node-incarnation"
    | "canvas-edge-incarnation"
  parentIdentity: string | null
}
```

```text
identityInputBytes = JCS(PortableIdentityInputV1)
identityDigest =
  SHA-256(
    "convax.portable-identity/1\0" ||
    u32be(identityInputBytes.length) ||
    identityInputBytes
  )
```

ProjectFileId、ProjectDirectoryId、ProjectVersionId、nodeId、edgeId、relationId、creationGroupId、
generationId 和 deletionId 分别使用 `pf_`、`pd_`、`v_`、`n_`、`e_`、`r_`、`cg_`、`g_`、`del_`
加 64-char lowercase identityDigest；incarnation 直接使用 digest。Main collaboration kernel 是
operationId 的唯一 allocator；UI、Agent、Plugin 不得提供或复用。一个 intent 的 ordinal 由其封闭
schema semantic output slot 决定，不能依赖对象枚举、Yjs clientId 或到达顺序。attester 重新派生全部
identity，任一不匹配即拒绝。

UI/Agent/Plugin transport 只能提交 domain command，不得出现 operationId、logicalCounter、派生 id 或
ordinal 输入。Main 进入 per-shard final-commit mutex 后分配 scoped counter、CSPRNG operationId 和所有
schema ordinal，再构造 exact TypedIntentV1。journal durable 前检测到本地 operationId collision 可以
重新生成；durable 后 operation identity 永不替换。成功结果可返回 operationId 供查询，但它不是后续
mutation authority。

```ts
type ProjectFileId = `pf_${string}`
type ProjectDirectoryId = `pd_${string}`
type ProjectEntryId = ProjectFileId | ProjectDirectoryId
type ProjectVersionId = `v_${string}`
```

所有持久 id 字段必须在 wire identifier registry 中声明 canonical codec、byte limit、allocator owner 和
native-key policy；缺任一项不得加入 v1 schema。相同派生 id 已存在但
PortableIdentityOriginV1 不同属于 hash-collision/equivocation，整个 shard quarantine。

| Identifier family                                                        | Canonical codec / allocator                                                              | Native policy                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------- |
| projectId                                                                | Project owner canonical lowercase ASCII id；new allocator is at least 128-bit CSPRNG     | only closed NativeStoreKey    |
| memberId/inviteId/canvasId/mutationId                                    | unpadded base64url 16 random bytes；service challenge/reservation/application/Main owner | only closed NativeStoreKey    |
| projectEpoch/membershipEpoch/shardEpoch/docEpoch                         | unpadded base64url 16 random bytes；service-owned，solo Project initial epoch excepted   | only closed NativeStoreKey    |
| challengeId/serverNonce                                                  | unpadded base64url 16 random bytes；service CSPRNG                                       | never direct                  |
| clientNonce/sessionNonce                                                 | unpadded base64url 16 random bytes；Main CSPRNG                                          | never direct                  |
| sessionId/leaseId/peerId                                                 | unpadded base64url 16 random bytes；session challenge service                            | never direct                  |
| messageId/grantId/inventoryId/syncRequestId                              | unpadded base64url 16 random bytes；Peer transport CSPRNG，connection ephemeral          | never direct                  |
| actorId                                                                  | unpadded base64url 32 random bytes；create/join challenge service                        | paired with operationId       |
| operationId and bootstrap/begin/terminal/target operation fields         | unpadded base64url 16 random bytes；Main collaboration kernel only                       | paired with actorId then hash |
| serviceId                                                                | `svc_` + 64 lowercase hex；service bootstrap bound to Host-configured expected id        | never native                  |
| rootKeyId/serviceKeyId                                                   | `rk_`/`sk_` + domain-separated SHA-256 of decoded Ed25519 public key                     | never native                  |
| Project/entity/version/relation/group/incarnation/generation/deletion id | prefixed/full SHA-256 derived by PortableIdentityInputV1                                 | only closed NativeStoreKey    |
| Plugin/tool/model/agent semantic ids                                     | NFC, 1–256 UTF-8 bytes, owner schema；never authority/native path                        | never direct                  |

同 family 未来若需要不同 codec，必须新增字段/token，不能扩大现有 parser。
任何持久 `*Id` 字段都必须引用本 registry 的 codec 或明确的 owner semantic-id codec；新增裸、未登记 id
使 schema artifact build 失败。`bootstrapOperationId` 是普通 Main-owned OperationId，不属于 epoch family。

### 2.3 Membership credential 和 admission

member long-term Ed25519 public key 是 membership principal 的一部分；membership-admin capability
不能代替 member proof-of-possession。

Host release 固定一组 offline service root public keys。Project 首次启用 collaboration 时必须验证并
持久化：

```ts
interface ServiceTrustBundleV1 {
  format: "convax.service-trust-bundle/1"
  serviceId: string
  sequence: string
  previousBundleDigest: string | null
  notBeforeUnixMs: string
  notAfterUnixMs: string
  keys: Array<{
    serviceKeyId: string
    publicKey: string
    purpose: "membership" | "admission" | "checkpoint" | "peer-ticket"
    notBeforeUnixMs: string
    notAfterUnixMs: string
  }>
  rootKeyId: string
  rootSignature: string
}

interface ServiceTrustBootstrapV1 {
  format: "convax.service-trust-bootstrap/1"
  serviceId: string
  activeBundleDigest: string
  activeBundleSequence: string
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  rootKeyId: string
  rootSignature: string
}

interface ServiceTrustBootstrapPageRequestV1 {
  format: "convax.service-trust-bootstrap-page-request/1"
  serviceId: string
  targetBootstrapDigest: string | null
  afterBundleSequence: string
  afterBundleDigest: string | null
  maxBundles: "8"
}

interface ServiceTrustBootstrapResponseV1 {
  format: "convax.service-trust-bootstrap-response/1"
  bootstrapPageRequestDigest: string
  bootstrap: ServiceTrustBootstrapV1
  bundles: ServiceTrustBundleV1[]
  complete: boolean
}
```

bundle keys 按 serviceKeyId UTF-8 排序且 id/publicKey 唯一；每个 purpose 必须有 1–2 把 key，总数
4–8。rootSignature 由 Host-pinned root 对
`"convax.service-trust-bundle/1\0" || SHA-256(JCS(bundle without rootSignature))` 签名。rotation 必须
`sequence = highWater + 1`、previousBundleDigest 等于已固定 bundle digest且有效期重叠；unknown root、
rollback、断链、过期 key 或 purpose 不匹配 fail closed。所有 service-signed object 都携带并绑定
`trustBundleDigest` 与 `serviceKeyPurpose`，不能只靠 HTTPS 或 serviceKeyId 字符串。
bundle JCS 上限 64 KiB；超过即拒绝。
Project 按 digest immutable 保存 current checkpoint、retained suffix 和 live credential 引用的 bundles；
验证 historical object 时要求 object.issuedAtUnixMs 落在 bundle/key 有效期内。引用消失后 bundle 可
GC；active bundle head 的 sequence/digest high-water 不得回退。

ServiceTrustBootstrapV1 由 Host-pinned root 使用其 format domain 签名，TTL 不超过 5 分钟。bootstrap
只通过 closed page request 获取：首次/无 cache 使用 `{targetBootstrapDigest:null,
afterBundleSequence:"0",afterBundleDigest:null}`；已有 high-water 使用其 exact sequence/digest。
首个 response 固定一个 root-valid target bootstrap，后续 request 的 targetBootstrapDigest 必须等于
该 digest；bootstrapPageRequestDigest 必须等于 exact request digest。每页 bundles 从 after+1 连续、首项 previous
digest 等于 after digest、最多 8 个，按 sequence 升序；非末页 complete=false，下一 request 逐字段使用
本页末项 sequence/digest。complete=true 当且仅当末项（或空页的 after）等于 target bootstrap 的 active
sequence/digest；只有 complete 后才原子推进 local active high-water。分页期间 target 过期或服务轮换
不允许换 head，客户端从原 durable high-water 重新开始新 target。root-valid 的跳号/回退仍拒绝。
按 digest 获取 historical bundle 只能验证已引用 object，不能推进 active high-water；只有上述连续 page
flow 可以推进。TLS、HTTP status/header 和 response wrapper 只是 carrier，不是 trust authority。

service-signed format 到唯一 key purpose 的矩阵固定为：

| Required purpose | Formats                                                                                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `membership`     | `IdentityChallengeV1`、`MembershipCredentialV1`、`MembershipSnapshotV1`、`ProjectInviteV1`、`ProjectInviteRevocationReceiptV1`、`MembershipMutationReceiptV1`、`ProjectEpochRolloverChallengeV1`、`ProjectEpochRolloverReceiptV1`、`BootstrapRecoveryChallengeV1`、`BootstrapRecoveryReceiptV1` |
| `admission`      | `AdmissionCertificateV1`、`ActorCounterAbandonmentV1`、`OperationLookupReceiptV1`                                                                                                                                                                                                               |
| `checkpoint`     | `CanvasGenesisReservationV1`、`CheckpointEpochReservationV1`、`GenesisCheckpointCertificateV1`、`RolloverCheckpointCertificateV1`、`ProjectIndexRouteFenceV1`、`CheckpointFrontierReceiptV1`                                                                                                    |
| `peer-ticket`    | `PeerRendezvousDirectoryV1`、`PeerFreshnessTicketV1`                                                                                                                                                                                                                                            |
| Host root only   | `ServiceTrustBundleV1`、`ServiceTrustBootstrapV1`                                                                                                                                                                                                                                               |

所有 service-signed interface 都必须携带与矩阵相同的 literal `serviceKeyPurpose`。validator 同时检查
format→purpose、key purpose、trustBundleDigest、issuedAt 位于 bundle/key 有效期；禁止尝试其他 purpose
key。decoded public key 跨 purpose 重复也使 bundle 拒绝。

create/join/session 先取得 service-signed single-use challenge：

```ts
interface IdentityChallengeBaseV1 {
  format: "convax.identity-challenge/1"
  challengeId: ChallengeIdV1
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  projectIndexShardEpoch: EpochIdV1
  projectIndexDocEpoch: EpochIdV1
  memberId: MemberIdV1
  actorId: ActorIdV1
  serverNonce: Nonce128V1
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

type IdentityChallengeV1 =
  | (IdentityChallengeBaseV1 & {
      purpose: "create-project" | "join"
    })
  | (IdentityChallengeBaseV1 & {
      purpose: "session"
      sessionId: SessionIdV1
      leaseId: LeaseIdV1
      peerId: PeerIdV1
    })

interface ProjectCreateProofV1 {
  format: "convax.project-create-proof/1"
  bootstrapOperationId: OperationIdV1
  challengeDigest: string
  projectId: string
  projectEpoch: string
  projectIndexShardEpoch: string
  projectIndexDocEpoch: string
  memberId: string
  memberSigningPublicKey: string
  adminCapabilityDigest: string
  clientNonce: string
  genesisFullUpdateHash: string
  genesisStateVectorHash: string
  genesisCanonicalStateHash: string
  genesisReceiptRoot: string
  genesisCheckpointOutboxDigest: string
  signature: string
}
```

create request binary payload 是
`u32be(fullUpdateLength)+fullUpdate+u32be(stateVectorLength)+stateVector+
u32be(receiptIndexLength)+emptyReceiptIndexJcs`。client 必须先 durable staging
这些 exact bytes；service attester 验证 ProjectIndex meta/empty catalog/schema、三个 byte/state hash
和 receiptRoot，再创建
membership 和 genesis certificate。service 不 durable 保存 bytes，后续 bootstrap 从 holder 取得。
ProjectCreateProof signature 使用 memberSigningPublicKey 对
`"convax.project-create-proof/1\0" || SHA-256(JCS(unsigned proof))` 签名，且所有 identity proof 的
challengeDigest 必须等于 exact signed `IdentityChallengeV1` 的规范 digest。
Main 在发 create 前生成 32-byte membership-admin secret、先 durable 保存到 OS credential vault，并把
domain-separated digest 写入 proof；service 只保存 digest。response-loss 不会丢失 admin authority，
service 不在恢复 response 中回传或重置 bearer secret。

join 与 session 的规范 JCS proofs：

```ts
interface MemberJoinProofV1 {
  format: "convax.member-join-proof/1"
  challengeDigest: string
  inviteId: string
  inviteDigest: string
  inviteSecretDigest: string
  projectId: string
  projectEpoch: string
  memberId: string
  serverNonce: string
  memberSigningPublicKey: string
  clientNonce: string
  requestedRole: "viewer" | "editor"
  signature: string
}

interface MemberSessionProofV1 {
  format: "convax.member-session-proof/1"
  challengeDigest: string
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  memberId: string
  memberCounter: string
  clientNonce: string
  serverNonce: string
  requestedExpiresAtUnixMs: string
  sessionId: SessionIdV1
  leaseId: LeaseIdV1
  peerId: PeerIdV1
  sessionNonce: Nonce128V1
  sessionSigningPublicKey: string
  sessionEncryptionPublicKey: string
  signature: string
}
```

`signature` 分别覆盖
`Ed25519("convax.member-join-proof/1\0" || SHA-256(JCS(unsigned object)))` 和
`Ed25519("convax.member-session-proof/1\0" || SHA-256(JCS(unsigned object)))`。service 要求 invite/nonce
单次使用、memberCounter 精确等于 service high-water + 1、TTL 不超过 15 分钟、key 为规范长度，并验证
signature 对应 membership 中的长期 public key。session private keys 只存在 Main/OS credential vault。

Membership credential 是 service-signed JCS object：

```ts
interface MembershipCredentialV1 {
  format: "convax.membership-credential/1"
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  membershipSequence: string
  membershipSnapshotDigest: string
  memberId: string
  actorId: string
  role: "viewer" | "editor"
  sessionChallengeDigest: string
  sessionId: SessionIdV1
  sessionNonce: Nonce128V1
  peerId: PeerIdV1
  sessionSigningPublicKey: string
  sessionEncryptionPublicKey: string
  leaseId: LeaseIdV1
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  latestProjectIndexCheckpointSequence: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: string
}

interface MembershipSnapshotV1 {
  format: "convax.membership-snapshot/1"
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  membershipSequence: string
  members: Array<{
    memberId: string
    actorId: string
    memberSigningPublicKey: string
    role: "viewer" | "editor"
    state: "active" | "revoked"
  }>
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: string
}

interface ProjectInviteV1 {
  format: "convax.project-invite/1"
  mutationId: RandomId128V1
  adminCounter: string
  adminCapabilityDigest: string
  inviteId: InviteIdV1
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  membershipEpoch: EpochIdV1
  inviteSecretDigest: string
  invitedRole: "viewer" | "editor"
  inviteSequence: string
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

interface MembershipAdminRequestCommonV1 {
  format: "convax.membership-admin-request/1"
  mutationId: RandomId128V1
  adminCounter: string
  adminCapabilityDigest: string
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  membershipEpoch: EpochIdV1
}

type MembershipAdminRequestV1 =
  | (MembershipAdminRequestCommonV1 & {
      mutation: "create-invite"
      expectedInviteSequence: string
      inviteSecretDigest: string
      invitedRole: "viewer" | "editor"
      requestedExpiresAtUnixMs: string
    })
  | (MembershipAdminRequestCommonV1 & {
      mutation: "revoke-invite"
      expectedInviteSequence: string
      inviteId: InviteIdV1
      inviteDigest: string
    })
  | (MembershipAdminRequestCommonV1 & {
      mutation: "change-role"
      expectedMembershipSequence: string
      expectedMembershipSnapshotDigest: string
      targetMemberId: MemberIdV1
      nextRole: "viewer" | "editor"
    })
  | (MembershipAdminRequestCommonV1 & {
      mutation: "revoke-member"
      expectedMembershipSequence: string
      expectedMembershipSnapshotDigest: string
      targetMemberId: MemberIdV1
    })

interface ProjectInviteRevocationReceiptV1 {
  format: "convax.project-invite-revocation-receipt/1"
  mutationId: RandomId128V1
  adminCounter: string
  adminCapabilityDigest: string
  inviteId: InviteIdV1
  inviteDigest: string
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  membershipEpoch: EpochIdV1
  inviteSequence: string
  state: "revoked"
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

interface MembershipMutationReceiptCommonV1 {
  format: "convax.membership-mutation-receipt/1"
  mutationId: RandomId128V1
  adminCounter: string
  adminCapabilityDigest: string
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  membershipEpoch: EpochIdV1
  membershipSequence: string
  targetMemberId: MemberIdV1
  priorRole: "viewer" | "editor"
  membershipSnapshotDigest: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

type MembershipMutationReceiptV1 =
  | (MembershipMutationReceiptCommonV1 & {
      mutation: "change-role"
      nextRole: "viewer" | "editor"
      nextState: "active"
    })
  | (MembershipMutationReceiptCommonV1 & {
      mutation: "revoke"
      nextRole: "viewer" | "editor"
      nextState: "revoked"
    })

interface PeerFreshnessTicketRequestV1 {
  format: "convax.peer-freshness-ticket-request/1"
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  membershipEpoch: EpochIdV1
  initiatorCredentialDigest: string
  responderCredentialDigest: string
  requesterCredentialDigest: string
  requesterSessionNonce: Nonce128V1
  requesterSessionSequence: string
  requesterSignature: string
}

interface PeerRendezvousDirectoryV1 {
  format: "convax.peer-rendezvous-directory/1"
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  membershipEpoch: EpochIdV1
  membershipSequence: string
  membershipSnapshotDigest: string
  activeCredentials: MembershipCredentialV1[]
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "peer-ticket"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

interface PeerFreshnessTicketV1 {
  format: "convax.peer-freshness-ticket/1"
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  membershipSequence: string
  membershipSnapshotDigest: string
  initiatorCredentialDigest: string
  responderCredentialDigest: string
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "peer-ticket"
  serviceKeyId: string
  serviceSignature: string
}
```

challenge 最长 60 秒且 challengeId/serverNonce 单次使用。create/join challenge 预分配随机 32-byte
actorId；session challenge 复制该 member 已绑定 actorId；全部使用 canonical unpadded base64url。一个
member/projectEpoch 只有一个 actorId，reset 才轮换。service、peer、attester 必须要求 core
actorId/memberId 精确匹配 credential；caller key、Plugin、Agent 不能选择或轮换 actor。
MembershipSnapshotV1.members 必须按 memberId UTF-8 排序且 memberId/actorId/public key 各自唯一；
peer freshness ticket 的 initiator/responder credential 顺序必须与握手 role 排序一致。
PeerRendezvousDirectoryV1 最长 30 秒，只包含 service 当前仍 active 且 session 未关闭的 credential，
按 `(credentialDigest UTF-8, peerId UTF-8)` 排序去重；snapshot digest/sequence 必须等于同 response
transaction 的 current membership。caller 必须用 current active credential 读取，directory 只用于
rendezvous，不替代 ticket/handshake proof。
Main 在 create-invite 前生成并 durable 保存 32-byte invite secret 与 mutationId；request 只携带
inviteSecretDigest，service 不保存、返回或恢复 secret。MembershipAdminRequestV1 由 OS vault 中的
membership-admin bearer capability 授权；同 mutationId + 同 membershipAdminRequestDigest 返回 exact
既有 signed result，不同 digest 拒绝为 equivocation。inviteSequence 是 Project scoped service
high-water；create/revoke 都要求 exact expected sequence 并推进一。ProjectInviteV1 是 single-use；
MemberJoinProofV1 的 inviteId/digest/secret digest/requestedRole 必须分别等于 exact live invite。join
原子消费 invite、推进 membershipSequence并返回新的 signed snapshot/credential。role change/revoke
要求 exact expected snapshot/sequence，原子推进 membershipSequence、签新的 snapshot 与
MembershipMutationReceiptV1；change-role 要求 nextRole != priorRole，revoke 的 nextRole 保留 snapshot
中的 priorRole。旧 credential 不能靠未签 HTTP response 推断新 role/state。

PeerFreshnessTicketRequestV1 由 requester credential-bound session key 对 format domain + unsigned JCS
签名，path/body project/epoch 和 requester credential/session 必须一致；service 按规范 digest/peerId
order 重算 initiator/responder，并在同一 current membership transaction 验证双方 active 后签 ticket。
credential 本身或 peerId 不能替代 requester session proof；另一方仍必须在 handshake 中独立签 transcript。

role change/revoke 的 service transaction 同时关闭 target member 的全部 sessions。任何使用
MembershipCredentialV1 的 service endpoint 都必须在处理/签名结果的同一 durable transaction 中读取
当前 membership record，并要求 project/membership epoch、memberId、actorId、public key、state=active
和 credential.role 与当前 record 逐字段一致；只验 credential signature/TTL 不算授权。admission 和
checkpoint request 额外要求当前 role=editor；counter abandonment、operation/checkpoint lookup、
checkpoint publication、frontier/membership read、peer ticket 要求 current active member；revoked
member 一律不能靠旧 credential 调用。role change 后必须新建 session/credential。bootstrap exact
recovery 与 admin capability flow 使用各自显式 proof，不隐式套用 session credential。

create/join 只建立 membership；编辑前必须另走 session challenge。MemberSessionProofV1 的
sessionId/leaseId/peerId 必须逐字段复制 challenge，credential 再逐字段复制 proof 并绑定
sessionChallengeDigest。admission 必须要求 core 的 memberId/actorId/sessionId、leaseId、sessionNonce、
membershipEpoch 和 credentialDigest 分别等于 exact credential；任何一个字段不匹配都拒绝。peerId
只用于 rendezvous，不能替代这些绑定。

已启用 collaboration 的 reset 使用：

```ts
interface ProjectEpochRolloverChallengeRequestV1 {
  format: "convax.project-epoch-rollover-challenge-request/1"
  mutationId: RandomId128V1
  adminCapabilityDigest: string
  projectId: ProjectIdV1
  priorProjectEpoch: EpochIdV1
  priorMembershipEpoch: EpochIdV1
  requestingMemberId: MemberIdV1
  observedMembershipSequence: string
  observedMembershipSnapshotDigest: string
  observedProjectIndexCheckpointDigest: string
  observedProjectIndexCanonicalStateHash: string
  clientNonce: Nonce128V1
  memberSignature: string
}

interface ProjectEpochRolloverChallengeV1 {
  format: "convax.project-epoch-rollover-challenge/1"
  challengeId: string
  challengeRequestDigest: string
  adminCapabilityDigest: string
  projectId: string
  priorProjectEpoch: string
  priorMembershipEpoch: string
  newProjectEpoch: string
  newMembershipEpoch: string
  newProjectIndexShardEpoch: string
  newProjectIndexDocEpoch: string
  requestingMemberId: string
  serverNonce: string
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: string
}

interface ProjectEpochRolloverRequestV1 {
  format: "convax.project-epoch-rollover-request/1"
  bootstrapOperationId: OperationIdV1
  challengeDigest: string
  projectId: string
  observedProjectEpoch: string
  observedMembershipEpoch: string
  observedMembershipSequence: string
  observedProjectIndexCheckpointDigest: string
  observedProjectIndexCanonicalStateHash: string
  resetIntentDigest: string
  genesisFullUpdateHash: string
  genesisStateVectorHash: string
  genesisCanonicalStateHash: string
  genesisReceiptRoot: string
  genesisCheckpointOutboxDigest: string
  newProjectEpoch: string
  newMembershipEpoch: string
  newProjectIndexShardEpoch: string
  newProjectIndexDocEpoch: string
  requestingMemberId: string
  adminCounter: string
  adminCapabilityDigest: string
  clientNonce: string
  trustBundleDigest: string
  memberSignature: string
}

interface ProjectEpochRolloverReceiptV1 {
  format: "convax.project-epoch-rollover-receipt/1"
  bootstrapOperationId: OperationIdV1
  challengeDigest: string
  projectId: string
  priorProjectEpoch: string
  priorEpochFenceDigest: string
  newProjectEpoch: string
  newMembershipEpoch: string
  newProjectIndexShardEpoch: string
  newProjectIndexDocEpoch: string
  genesisCheckpointOutboxDigest: string
  newProjectIndexGenesisCheckpoint: GenesisCheckpointCertificateV1
  activeMembershipSnapshotDigest: string
  rolloverSequence: string
  adminCounter: string
  adminCapabilityDigest: string
  resetIntentDigest: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: string
  serviceSignature: string
}

interface BootstrapRecoveryChallengeV1 {
  format: "convax.bootstrap-recovery-challenge/1"
  flow: "create" | "rollover"
  bootstrapOperationId: OperationIdV1
  projectId: string
  memberId: string
  memberSigningPublicKey: string
  challengeId: ChallengeIdV1
  serverNonce: Nonce128V1
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

interface BootstrapRecoveryProofV1 {
  format: "convax.bootstrap-recovery-proof/1"
  flow: "create" | "rollover"
  bootstrapOperationId: OperationIdV1
  projectId: string
  memberId: string
  memberSigningPublicKey: string
  recoveryChallengeDigest: string
  serverNonce: Nonce128V1
  clientNonce: Nonce128V1
  signature: string
}

interface BootstrapRecoveryReceiptCommonV1 {
  format: "convax.bootstrap-recovery-receipt/1"
  bootstrapOperationId: OperationIdV1
  originalChallengeDigest: string
  projectId: string
  memberId: string
  memberSigningPublicKey: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "membership"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

type BootstrapRecoveryReceiptV1 =
  | (BootstrapRecoveryReceiptCommonV1 & {
      kind: "create"
      projectEpoch: string
      membershipEpoch: string
      genesisCheckpoint: GenesisCheckpointCertificateV1
      membershipSnapshotDigest: string
    })
  | (BootstrapRecoveryReceiptCommonV1 & {
      kind: "rollover"
      rolloverReceipt: ProjectEpochRolloverReceiptV1
    })

interface BootstrapRecoveryResponseV1 {
  format: "convax.bootstrap-recovery-response/1"
  receipt: BootstrapRecoveryReceiptV1
}
```

BootstrapRecoveryProofV1 signature 固定为
`"convax.bootstrap-recovery-proof/1\0" || SHA-256(JCS(proof without signature))`，使用 immutable
bootstrap record 中的 long-term member key。recoveryChallengeDigest 必须等于 exact signed
BootstrapRecoveryChallengeV1，flow/op/project/member/key/serverNonce 逐字段相同；challenge 最长 60 秒且
single-use。response wrapper/HTTP trust links 是 carrier；缺 bundle 时客户端先走独立 closed trust page
flow，权威结果只有 independently membership-purpose signed
BootstrapRecoveryReceiptV1。

ProjectEpochRolloverChallengeRequestV1 的 memberSignature 由 active requesting member long-term key 对
其 format domain + unsigned JCS 签名；HTTP authorization 同时携带 exact Project 的 membership-admin
capability，service 验证 bearer digest、当前 member record、observed frontier 和 request signature。同
mutationId + 同 challengeRequestDigest 在 challenge 未过期时返回 byte-identical challenge，不同 digest
拒绝；过期后 caller 用新 mutationId/clientNonce 请求，challenge issuance 不推进 admin counter。
ProjectEpochRolloverRequestV1 的 memberSignature 由同一 member long-term key 对
`"convax.project-epoch-rollover-request/1\0" || SHA-256(JCS(unsigned request))` 签名。service 原子比较所有
observed frontier，并要求 challengeRequestDigest/admin digest/new epoch ids 精确匹配且 single-use，
要求 adminCounter 等于 Project-scoped membership-admin high-water + 1，消费 clientNonce/counter、
关闭 prior epoch、复制 active member keys/roles并为每个
member 随机分配新 actorId 到新 membership epoch、签唯一 genesis 和 receipt。任何 prior projectEpoch admission/session/ACK 在读取
旧 credential 前即拒绝。新 epoch 的 session 必须重新做 `MemberSessionProofV1`。
membership-admin secret/digest/high-water 属于 stable projectId，不属于 projectEpoch；rollover receipt
逐字段保留同一 adminCapabilityDigest/adminCounter，v1 不轮换 capability。普通 MembershipAdminRequestV1
也必须用 exact bearer digest 与 `adminCounter=high-water+1`；service 原子写 signed result和新 high-water，
same mutationId/request digest 幂等返回既有结果。session memberCounter 与 adminCounter 是两个独立
scope，禁止互相推进或比较。
rollover request 携带与 create 相同形态的 binary genesis payload；native reset 在调用前先 durable
staging exact bytes，service 验证后只签 hash/certificate，客户端把 receipt 与同一 bytes 原子发布。
其他 peer bootstrap 必须从 holder 获取 certificate + exact full update/state vector，不能从 logical
empty ProjectIndex 重新编码出“等价”Yjs bytes。

create/rollover 的 genesis payload 必须先作为 checkpoint outbox durable；proof/request 和独立
checkpoint certificate 都绑定同一个 genesisCheckpointOutboxDigest。service 在同一 transaction 签并
保存 immutable BootstrapRecoveryReceiptV1。response 丢失时，客户端先取得最长 60 秒、single-use 的
BootstrapRecoveryChallengeV1，再用原 long-term member key 签 BootstrapRecoveryProofV1；旧/尚未建立的
session、peerId 和 admin capability 都不是恢复 proof。proof 的 flow/project/member/key/op 必须逐字段
匹配 immutable bootstrap record；replay 只能返回 byte-identical receipt，不能创建第二个 epoch。
create receipt 的 genesis outbox 必须等于 create proof；rollover receipt 中完整
ProjectEpochRolloverReceiptV1 的 operation/challenge/outbox 必须等于 request。native reset 只有 durable
保存 kind=rollover 的完整 receipt 后才能发布新 tree。

### 2.4 Peer mutual proof、KDF 和 cipher envelope

一个 Peer cryptographic session 是 `PeerConnectionBundleV1`：一条 control connection 完成一次
hello/proof handshake，再以该 transcript 派生的独立 channel keys attach 三条 bulk connection。它不是
四次独立 handshake。双方先交换 credential 和 32-byte random
challenge；`credentialDigest` 以 lowercase hex 表示，challenge/session nonce/key 以 unpadded base64url
表示。按 `(credentialDigest UTF-8 bytes, peerId UTF-8 bytes)` 较小者固定为 initiator，避免同时拨号造成
role 分歧。
连接前双方都必须从 current PeerRendezvousDirectoryV1 得到对方 exact credential/peerId。每一 pair
只有 tuple 较小者允许向较大者的 peerId 发起 label=`convax-control-v1` connection，且它同时是 handshake
initiator/第一个 hello sender；较大者只接受该 inbound connection并作为 responder。tuple 较大者的
outbound、tuple 较小者收到的 inbound、directory 中不存在/过期/closed credential 全部在解析 hello 前
关闭。directory refresh 只改变未来连接，不改变已建立 transcript；role 不从“谁先连上”推断。

双方构造同一 JCS transcript：

```ts
interface PeerHandshakeTranscriptV1 {
  format: "convax.peer-handshake-transcript/1"
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  membershipSequence: string
  membershipSnapshotDigest: string
  peerFreshnessTicketDigest: string
  initiatorCredentialDigest: string
  responderCredentialDigest: string
  initiatorPeerId: string
  responderPeerId: string
  initiatorSessionNonce: string
  responderSessionNonce: string
  initiatorChallenge: string
  responderChallenge: string
  initiatorEncryptionPublicKey: string
  responderEncryptionPublicKey: string
}
```

`transcriptDigest = SHA-256("convax.peer-handshake-transcript/1\0" || JCS(transcript))`。initiator 与
responder 分别签
`"convax.peer-handshake-proof/1\0" || roleByte || transcriptDigestBytes`，`roleByte` 为 `0x01` 或
`0x02`。两份 credential、当前 membership snapshot、最长 60 秒且绑定双方 credential 的
PeerFreshnessTicketV1、epoch、TTL、两份 proof 全部验证前，禁止发送 Project inventory/state vector。
连接每 60 秒必须取得并验证更高或相同 membershipSequence 的新 ticket；ticket 过期、sequence rollback、
snapshot digest mismatch 或任一 member revoked 都关闭四个 channel。service 不可用时不能建立或续租
team connection，但 local fork 继续可用。

X25519 public key 解码后必须正好 32 bytes；拒绝 malformed/non-canonical key，计算出的 shared secret
全零也拒绝。密钥派生固定为：

```text
IKM  = X25519(localPrivate, remotePublic)
salt = SHA-256("convax.peer-hkdf-salt/1\0" || transcriptDigestBytes)
info = "convax.peer-channel-key/1\0" || directionByte || channelByte
key(direction, channel) = HKDF-SHA-256(IKM, salt, info, 32)
```

direction `0x01=initiator-to-responder`、`0x02=responder-to-initiator`；channel
`0x01=control`、`0x02=update`、`0x03=awareness`、`0x04=blob`。实现必须独立调用八次 HKDF，禁止把一个
长输出自行切片。

cipher outer envelope：

```text
8 bytes  ASCII "CVXPEER1"
1 byte   direction
1 byte   channel
2 bytes  flags, v1 为 0
8 bytes  u64be sequence
32 bytes transcriptDigest
4 bytes  u32be ciphertextAndTagLength
N bytes  AES-256-GCM ciphertext || 16-byte tag
```

AES-GCM nonce 固定为 `u32be(0) || u64be(sequence)`；AAD 是从 magic 到 length 的前 56 bytes，再追加
`SHA-256(JCS({projectId, projectEpoch, membershipEpoch, initiatorCredentialDigest,
responderCredentialDigest}))`。每 direction/channel 的 sequence 从 `1` 严格递增；receiver 只接受
exact next sequence，重复、gap、回退、length/tag mismatch 都关闭连接。每连接最多 `2^32-1` 个 frame
或 15 分钟，以先到者为准，之后必须重连并使用全新双方 challenge/transcript/key；断线后不能恢复旧
sequence。lease 到期或 epoch/credential/membership snapshot 改变时四个 channel 全部关闭。

handshake 只在 label=`convax-control-v1` 的 reliable ordered binary PeerJS connection 上使用以下未加密
carrier；其他 label/serialization/reliability 组合拒绝：

```text
8 bytes ASCII "CVXHSK01"
1 byte  messageKind: 0x01=hello, 0x02=proof
3 bytes reserved, v1 为 0
4 bytes u32be JCS length
N bytes exact JCS
```

```ts
interface PeerHandshakeHelloV1 {
  format: "convax.peer-handshake-hello/1"
  role: "initiator" | "responder"
  credential: MembershipCredentialV1
  membershipSnapshot: MembershipSnapshotV1
  challenge: string
  encryptionPublicKey: string
}

interface PeerHandshakeProofV1 {
  format: "convax.peer-handshake-proof/1"
  role: "initiator" | "responder"
  transcript: PeerHandshakeTranscriptV1
  freshnessTicket: PeerFreshnessTicketV1
  proofSignature: string
}
```

strict state machine 是 `initiator hello → responder hello → initiator proof → responder proof → encrypted
channel attach`。hello/proof 各方向各一次、JCS 最多 512 KiB、总 handshake 10 秒；unknown key/kind、
重复、乱序、另一 transcript 或任何提前的 `CVXPEER1` 都关闭连接。initiator 收到两份 hello 后用 exact
credential digests 请求 ticket；proof 的 transcript 必须逐字段由两份 hello/credential构造，ticket
必须绑定这两个 digest/current snapshot。双方 proof 全部验证后才 derive channel keys。按规范 role
发现 simultaneous/stale outbound 时只保留规范 initiator 发起的 control connection，另一条关闭。

control proof 完成后 initiator 创建 exact label
`convax-update-v1`、`convax-awareness-v1`、`convax-blob-v1` 的 reliable ordered binary connections。
每个 channel/direction 的第一个 encrypted message 必须是该 channel 的 `PeerChannelAttachV1`；control
channel 同样以 attach 作为 encrypted sequence 1。双方 attach 验证完成前该 channel 不接受其他 message。
awareness 的 best-effort 只表示在加密前 coalesce/drop sender queue；已发送 frame 仍走 reliable ordered
transport，否则 strict sequence 与 nonce discipline 不成立。

每个 `CVXPEER1` plaintext 是一个固定 fragment：

```text
8 bytes  ASCII "CVXFRG01"
1 byte   messageKind
1 byte   flags, v1 为 0
2 bytes  reserved, v1 为 0
16 bytes random messageId
4 bytes  u32be fragmentIndex
4 bytes  u32be fragmentCount
8 bytes  u64be totalPayloadLength
32 bytes wholePayloadHash
4 bytes  u32be fragmentLength
N bytes  fragment bytes
```

plaintext 总长最多 65536 bytes，所以 `N <= 65456`。messageId 是每 connection/channel/direction 唯一的
16-byte CSPRNG value且不进入 native path。logical payload 是：

```text
4 bytes u32be headerJcsLength
headerJcsLength bytes exact closed PeerMessageHeaderV1 JCS
8 bytes u64be rawLength
rawLength bytes raw payload
```

`wholePayloadHash = SHA-256("convax.peer-message/1\0" || channelByte || messageKind ||
logicalPayloadBytes)`。fragmentCount 必须等于 `ceil(totalPayloadLength / 65456)`（零长度 logical payload
禁止），index 从 0 连续；每个非末 fragment 的 fragmentLength 必须正好 65456，末 fragment 等于
`totalPayloadLength - 65456*(fragmentCount-1)`，fragment bytes 必须逐字节等于 logical payload 的
`[index*65456, index*65456+fragmentLength)` slice。同一 channel 不允许 fragment interleave，后一 message 必须等前一 complete、
verified、accepted/cancelled。单 fragment 间隔最长 30 秒、单 message 最长 5 分钟；断线/timeout/hash
失败删除 staging 并关闭 connection。control/awareness 在内存重组；update/blob 大于 1 MiB 使用
content-addressed temporary staging，完整 hash 验证前不可解析/apply。每 channel 同一方向最多一个
incomplete message，从结构上排除无界 fragment-id map。

messageKind 与 channel/header/raw grammar 是封闭 registry：

| Byte | Channel   | Header type                      | Raw bytes                                          |
| ---- | --------- | -------------------------------- | -------------------------------------------------- |
| 0x01 | any       | `PeerChannelAttachV1`            | empty                                              |
| 0x02 | control   | `PeerTicketRenewalV1`            | empty                                              |
| 0x03 | control   | `PeerInventoryPageV1`            | empty                                              |
| 0x04 | control   | `PeerSyncRequestPageV1`          | empty                                              |
| 0x05 | control   | `PeerFlowCreditV1`               | empty                                              |
| 0x06 | control   | `PeerTransferCancelV1`           | empty                                              |
| 0x07 | control   | `PeerReceiptV1`                  | empty                                              |
| 0x08 | control   | `PeerStateVectorHeaderV1`        | exact Yjs state-vector bytes                       |
| 0x09 | control   | `PeerTerminalFrontierPageV1`     | empty                                              |
| 0x20 | update    | `PeerCertifiedRecordHeaderV1`    | exact complete `CVXCOLL1` kind 1 admitted frame    |
| 0x21 | update    | `PeerCheckpointSnapshotHeaderV1` | exact complete `CVXCOLL1` kind 2 snapshot envelope |
| 0x22 | update    | `PeerTerminalRecordHeaderV1`     | exact complete `CVXCOLL1` kind 1 or 8 envelope     |
| 0x30 | awareness | `PeerAwarenessV1`                | empty                                              |
| 0x40 | blob      | `BlobManifestV1`                 | empty                                              |
| 0x41 | blob      | `BlobChunkRequestV1`             | empty                                              |
| 0x42 | blob      | `BlobChunkDataHeaderV1`          | exact chunk bytes                                  |
| 0x43 | blob      | `BlobTransferCancelV1`           | empty                                              |

```ts
interface PeerDocScopeV1 {
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: EpochIdV1
  docEpoch: EpochIdV1
}

interface PeerActorTerminalFrontierV1 {
  actorId: ActorIdV1
  baseHighWater: string
  highWater: string
  terminalRoot: string
}

interface PeerChannelAttachV1 {
  format: "convax.peer-channel-attach/1"
  channel: "control" | "update" | "awareness" | "blob"
  transcriptDigest: string
  senderCredentialDigest: string
}

interface PeerTicketRenewalV1 {
  format: "convax.peer-ticket-renewal/1"
  membershipSnapshot: MembershipSnapshotV1
  freshnessTicket: PeerFreshnessTicketV1
}

interface PeerInventoryPageV1 {
  format: "convax.peer-inventory-page/1"
  inventoryId: RandomId128V1
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  projectIndexCheckpointSequence: string
  pageIndex: string
  pageCount: string
  totalDocuments: string
  documentsDigest: string
  complete: boolean
  documents: Array<
    PeerDocScopeV1 & {
      checkpointDigest: string
      snapshotDigest: string
      mmrNextLeaf: string
      mmrRoot: string
      stateVectorHash: string
      durableHeadDigest: string
      actorTerminalCount: string
      actorTerminalsDigest: string
      frontierReceiptDigest: string
      publicationReceiptDigest: string
      holderMemberId: MemberIdV1
    }
  >
}

interface PeerSyncRequestPageV1 {
  format: "convax.peer-sync-request-page/1"
  syncRequestId: RandomId128V1
  pageIndex: string
  pageCount: string
  totalRequests: string
  requestsDigest: string
  complete: boolean
  requests: Array<
    | (PeerDocScopeV1 & {
        kind: "checkpoint-snapshot"
        checkpointDigest: string
        snapshotDigest: string
      })
    | (PeerDocScopeV1 & {
        kind: "certified-range"
        checkpointDigest: string
        fromLeafInclusive: string
        toLeafExclusive: string
      })
    | (PeerDocScopeV1 & {
        kind: "state-vector"
        expectedStateVectorHash: string
      })
    | (PeerDocScopeV1 & {
        kind: "actor-terminal-range"
        checkpointDigest: string
        actorId: ActorIdV1
        fromCounterInclusive: string
        toCounterExclusive: string
        expectedTerminalRoot: string
      })
    | (PeerDocScopeV1 & {
        kind: "actor-terminal-frontier"
        checkpointDigest: string
        actorTerminalCount: string
        actorTerminalsDigest: string
      })
    | (PeerDocScopeV1 & {
        kind: "checkpoint-holder-proof"
        checkpointDigest: string
        snapshotDigest: string
        frontierReceiptDigest: string
        publicationReceiptDigest: string
        holderMemberId: MemberIdV1
      })
  >
}

interface PeerFlowCreditV1 {
  format: "convax.peer-flow-credit/1"
  grantId: RandomId128V1
  channel: "update" | "blob"
  maxTotalBytes: string
  maxMessages: string
  expiresAfterGrantorControlSequence: string
}

interface PeerTransferCancelV1 {
  format: "convax.peer-transfer-cancel/1"
  channel: "update" | "blob"
  messageId: RandomId128V1
  reason: "superseded" | "no-longer-needed" | "resource-limit" | "shutdown"
}

type PeerReceiptV1 =
  | {
      format: "convax.peer-receipt/1"
      receiptKind: "blob-durable"
      receipt: BlobDurableAckV1
    }
  | {
      format: "convax.peer-receipt/1"
      receiptKind: "replica-durable"
      receipt: ReplicaDurableAckV1
    }
  | {
      format: "convax.peer-receipt/1"
      receiptKind: "checkpoint-publication"
      receipt: CheckpointPublicationReceiptV1
    }
  | {
      format: "convax.peer-receipt/1"
      receiptKind: "operation-lookup"
      receipt: OperationLookupReceiptV1
    }
  | {
      format: "convax.peer-receipt/1"
      receiptKind: "checkpoint-holder-proof"
      frontierReceipt: CheckpointFrontierReceiptV1
      publicationReceipt: CheckpointPublicationReceiptV1
    }

interface PeerTerminalFrontierPageV1 extends PeerDocScopeV1 {
  format: "convax.peer-terminal-frontier-page/1"
  checkpointDigest: string
  actorTerminalCount: string
  actorTerminalsDigest: string
  pageIndex: string
  pageCount: string
  complete: boolean
  actorTerminals: PeerActorTerminalFrontierV1[]
}

interface PeerStateVectorHeaderV1 extends PeerDocScopeV1 {
  format: "convax.peer-state-vector/1"
  stateVectorHash: string
  byteLength: string
}

interface PeerCertifiedRecordHeaderV1 extends PeerDocScopeV1 {
  format: "convax.peer-certified-record/1"
  grantId: RandomId128V1
  leafIndex: string
  finalFrameDigest: string
  byteLength: string
}

interface PeerTerminalRecordHeaderV1 extends PeerDocScopeV1 {
  format: "convax.peer-terminal-record/1"
  grantId: RandomId128V1
  actorId: ActorIdV1
  logicalCounter: string
  operationId: OperationIdV1
  terminal: "admitted" | "abandoned"
  resultDigest: string
  finalRecordDigest: string
  byteLength: string
}

interface PeerCheckpointSnapshotHeaderV1 extends PeerDocScopeV1 {
  format: "convax.peer-checkpoint-snapshot/1"
  grantId: RandomId128V1
  checkpointDigest: string
  snapshotDigest: string
  byteLength: string
}

interface PeerAwarenessV1 {
  format: "convax.peer-awareness/1"
  memberId: MemberIdV1
  awarenessSequence: string
  expiresAfterUnixMs: string
  payload: JsonValueV1
}

interface BlobStructuralFrontierV1 {
  projectIndexCheckpointDigest: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  docEpoch: string
  mmrNextLeaf: string
  admittedCoreDigest: string
  mmrRoot: string
}

interface BlobManifestV1 {
  format: "convax.blob-manifest/1"
  grantId: RandomId128V1
  projectId: string
  projectEpoch: string
  fileId: string
  canonicalUri: string
  blobHash: string
  byteLength: string
  mediaType: string
  chunkSize: string
  chunkCount: string
  chunkMerkleRoot: string
  referencingOperationId: string
  structuralFrontier: BlobStructuralFrontierV1
  credentialDigest: string
  sessionNonce: string
  sessionSequence: string
  signature: string
}

interface BlobChunkRequestV1 {
  format: "convax.blob-chunk-request/1"
  grantId: RandomId128V1
  manifestDigest: string
  blobHash: string
  chunkIndexes: string[]
}

interface BlobChunkDataHeaderV1 {
  format: "convax.blob-chunk-data/1"
  grantId: RandomId128V1
  manifestDigest: string
  blobHash: string
  chunkIndex: string
  chunkLength: string
  chunkHash: string
  merkleProof: Array<{ side: "left" | "right"; siblingHash: string }>
}

interface BlobTransferCancelV1 {
  format: "convax.blob-transfer-cancel/1"
  grantId: RandomId128V1
  manifestDigest: string
  blobHash: string
  reason: "no-longer-referenced" | "resource-limit" | "shutdown" | "verification-failed"
}

interface BlobDurableAckV1 {
  format: "convax.blob-durable-ack/1"
  projectId: string
  projectEpoch: string
  peerMemberId: string
  credentialDigest: string
  sessionNonce: string
  structuralFrontier: BlobStructuralFrontierV1
  referencingOperationId: string
  fileId: string
  canonicalUri: string
  blobHash: string
  durableIndexDigest: string
  ackSequence: string
  signature: string
}

interface ReplicaDurableAckV1 {
  format: "convax.replica-durable-ack/1"
  projectId: string
  projectEpoch: string
  peerMemberId: string
  credentialDigest: string
  sessionNonce: string
  structuralFrontier: BlobStructuralFrontierV1
  durableHeadDigest: string
  blobAckDigests: string[]
  ackSequence: string
  signature: string
}

interface BlobDurableIndexV1 {
  format: "convax.blob-durable-index/1"
  projectId: string
  projectEpoch: string
  entries: Array<{
    blobHash: string
    byteLength: string
  }>
}

type PeerMessageHeaderV1 =
  | PeerChannelAttachV1
  | PeerTicketRenewalV1
  | PeerInventoryPageV1
  | PeerSyncRequestPageV1
  | PeerFlowCreditV1
  | PeerTransferCancelV1
  | PeerReceiptV1
  | PeerStateVectorHeaderV1
  | PeerTerminalFrontierPageV1
  | PeerCertifiedRecordHeaderV1
  | PeerCheckpointSnapshotHeaderV1
  | PeerTerminalRecordHeaderV1
  | PeerAwarenessV1
  | BlobManifestV1
  | BlobChunkRequestV1
  | BlobChunkDataHeaderV1
  | BlobTransferCancelV1
```

完整 inventory documents 与 sync requests 先按各自 canonical scope/range 排序去重，再分别计算
`documentsDigest = SHA-256("convax.peer-inventory-documents/1\0" || JCS(full documents array))` 和
`requestsDigest = SHA-256("convax.peer-sync-requests/1\0" || JCS(full requests array))`。每页最多 128 项；
total、pageCount=`ceil(total/128)`（零项时 1 页）、pageIndex 从 0 连续，page 只能携带 full array 对应的
contiguous slice，complete 当且仅当 pageIndex=pageCount-1。inventoryId/syncRequestId 在 bundle/direction
内唯一；同类 page 在 page set 完成前不允许另一个 id，最多 33 页/4097 项/32 MiB reassembly。receiver
收到全部页、重算 full digest/total 后才替换 inventory 或执行 sync request；partial/timeout/digest mismatch
整组丢弃并关闭 bundle，不能把子集当 complete。chunkIndexes、blobAckDigests 同样按 index/digest 排序
去重。
actor-terminal-frontier request 返回同 scope/checkpoint 的 PeerTerminalFrontierPageV1；actorTerminals
按 actorId decoded bytes 严格排序，最多 256 项，每页最多 128 项，pageCount/complete/contiguous slice
规则与 inventory 相同。actorTerminalCount 和
`actorTerminalsDigest = SHA-256("convax.peer-actor-terminals/1\0" || JCS(full actorTerminals array))`
必须逐字段等于 inventory locator，收齐并重算前不能发送 terminal-range。baseHighWater 必须
逐 actor 等于 inventory checkpoint snapshot 的 ReceiptIndex highWater（snapshot 中 absent actor 视为
`"0"`），highWater 不得更小且差值最多 4096。terminalRoot =
`SHA-256("convax.peer-terminal-root/1\0" || JCS(exact ordered terminal summaries for counters
baseHighWater+1 ... highWater))`；空 range 使用空 array digest。summary 固定为
`{actorId,logicalCounter,operationId,requestDigest,terminal,resultDigest,finalRecordDigest}`，每个 counter
恰好一项、严格连续。receiver 的 actor-terminal-range request 必须覆盖这个完整 half-open range
`[baseHighWater+1,highWater+1)` 并复制 inventory terminalRoot；v1 不允许任意 subrange。这样 snapshot
ReceiptIndex + terminal range 能重建 exact current ReceiptIndex，abandonment 不需要伪造 MMR leaf。
inventory 只携带 checkpoint holder proof 的两个 digest locator，不内嵌大证书。receiver 先发送
checkpoint-holder-proof request；返回的 frontierReceipt 必须是 holder-confirmed，两个 full receipt 的
digest、scope/checkpoint/snapshot、holderMemberId 必须逐字段等于 inventory/request，
publicationReceipt digest 必须在 frontierReceipt.holderReceiptDigests 中且 holder credential 等于
发送方 current credential；publication 的 snapshot/durableHead 又必须等于 item。只有这条
service-signed receipt → holder-signed publication chain 才证明 sender 可提供 exact snapshot；验证后
receiver 才从 item 的 snapshotDigest 构造 checkpoint-snapshot request，不接受 unsolicited/猜测 digest。
若 publication credential 已不是发送方 current credential，发送方必须先走同-checkpoint publication
renewal CAS 并发布新 frontier receipt；空闲 Project 不需要创建新 checkpoint即可刷新 possession proof。

每次 ticket renewal 必须在旧 ticket 到期前完成，ticket/snapshot sequence 只能持平或增加且 snapshot
digest exact-match；revoked/role-changed local member 或 remote member、rollback、过期都立即关闭四连接。
update/blob 的非 attach message 必须引用尚未过期且余额足够的 opposite-direction grant；sender 在首
fragment 前原子扣除完整 logical bytes/message count，cancel 不退 credit。control logical message 上限
512 KiB，state vector/update record 1 MiB，checkpoint snapshot 256 MiB，awareness JCS 16 KiB且必须单
fragment，blob manifest/request 64 KiB，blob chunk data raw 1 MiB。每方向未消费 credit 上限 8 MiB/
32 messages；snapshot 可由 receiver 单独授予最多 256 MiB/1 message 的 update grant。超过任何上限不
分配内存，发送 signed/closed cancel 后关闭相应 bulk connection；verification failure 关闭四连接。

grantId 在 `{transcriptDigest, grantor→grantee direction, channel}` 内唯一并保留到 bundle 结束；任何
重复 grantId（包括 exact duplicate）都是 protocol violation并关闭四连接。每个 bulk logical message
只能引用并消耗一个 grant；多个 live grants 是各自独立 ledger，不替换、不合并余额。maxTotalBytes 按
完整 logical payload bytes 扣除，maxMessages 每 message 扣一；任一余额不足先拒绝，不能部分扣减。
expiresAfterGrantorControlSequence 指 grantor→grantee control outer sequence；grant 自身 sequence必须小于该值，
receiver 在认证到 sequence >= 该值的 control frame 前先把该 grant 剩余余额归零，记录仍保留防止复用。
相反方向 control sequence 不参与 expiry。

control 每 direction/bundle 的 lifetime hard limit 是 128 MiB logical bytes 与 16384 messages，任一达到
即关闭整个 bundle。除此之外，inventory/sync/state-vector/receipt 使用 Main monotonic clock 的 token
bucket：8 MiB capacity、每秒 refill 2 MiB，128-message burst、每秒 refill 32 messages；不足时立即关闭
bundle。attach/ticket-renewal/flow-credit/transfer-cancel 使用不能被前述 traffic 借用的独立 4 MiB/
512-message reserve，但仍计入 lifetime hard limit。token 只按完整 authenticated logical payload 扣除，
失败消息也扣除；renderer/backpressure 不能放宽。所有 compliant adapter 必须实现相同 bucket参数，时间
只决定连接存活，不进入任何 canonical state/digest。

BlobManifestV1 的 chunk partition 是规范值，不是 adapter hint。所有 decimal strings 必须是 canonical
uint64；byteLength 上限 `68719476736`（64 GiB）。非空 blob 必须满足
`chunkSize="1048576"`、`chunkCount=ceil(byteLength/1048576)` 且 `1 <= chunkCount <= 65536`；
chunk `i < chunkCount-1` 的 exact length 是 1048576，末 chunk exact length 是
`byteLength - 1048576*(chunkCount-1)`。chunk bytes 是完整 blob 的对应连续 slice，按 index concatenate
必须逐字节恢复 byteLength 和 blobHash，禁止 sparse、overlap、short non-final 或 adapter 自选 chunkSize。
零字节 blob 唯一合法 tuple 是
`{byteLength:"0",chunkSize:"0",chunkCount:"0",chunkMerkleRoot:SHA-256("convax.blob-merkle-empty/1\0")}`，
blobHash 还必须等于 raw empty bytes 的 SHA-256，且不允许任何 chunk request/data；receiver 只可从该
唯一值 materialize empty staging file。

非空 chunk Merkle leaf 固定为
`SHA-256("convax.blob-merkle-leaf/1\0" || u32be(chunkIndex) || u32be(chunkLength) || chunkBytes)`；
每层按 index 相邻配对，parent =
`SHA-256("convax.blob-merkle-node/1\0" || left32 || right32)`，奇数末项用自身同时作为 left/right，
直到一个 root。单 chunk root 就是 leaf；proof 从 leaf 到 root，每层恰好一个 sibling，duplicate-last
层把当前 node 作为 left、duplicate 作为 right，因此 sibling 必须等于当前 hash 且 side 必须是
`"right"`。其他层 side 表示 sibling 相对 current node 的真实位置。proof depth 必须恰好
`ceil(log2(chunkCount))` 且不超过 16，禁止多余节点或另一种 odd-node promotion。manifest 在任何 buffer/
temporary file allocation 前验证 tuple/root shape；完整接收后仍必须重算每个 leaf、root、concatenated
blobHash。

BlobChunkRequestV1 indexes 必须小于 manifest chunkCount、严格递增且最多 256。BlobChunkDataHeaderV1 的
chunkLength 等于 rawLength且必须等于上述 index 的 exact partition length；chunkHash、proof、blobHash、manifestDigest、
grant 和 requested index 必须全部匹配。零字节 blob 不允许 chunk request/data。PeerCertifiedRecord
只承载 admitted frame，raw header scope/leaf/digest 必须等于 kind 1 CVXCOLL1 envelope/admission；
snapshot 同理。PeerTerminalRecord raw 为 kind 1 时 terminal/result/final digest 必须逐字段等于 admission
certificate/frame，为 kind 8 时必须逐字段等于 service-signed abandonment；scope/actor/counter/
operation 必须相同。receiver 按 actor counter 连续收齐 range、重算 terminalRoot 后才原子推进
ReceiptIndex；kind 1 与 certified-range 重复到达必须 exact finalFrameDigest 相等并去重，任一分叉进入
service-equivocation quarantine。Main 只有完整 reassembly、
whole hash、closed header、credit、inner envelope/digest/schema 全部通过后才能推进 certified state或
发送 ACK；renderer 永远只转发 outer ciphertext。

四条 connection 中任一条 close/error/sequence failure 都原子关闭整个 PeerConnectionBundleV1；不得只
重 attach 单个 bulk connection。重建必须从新的 control connection、双方 fresh challenges/transcript、
八个新 channel keys 和各 direction/channel sequence=1 重新开始。旧 transcript/grant/messageId/staging
均失效。

### 2.5 MMR

MMR scope 是 `{projectId, projectEpoch, docKind, docId, shardEpoch, docEpoch}`。第 `leafIndex` 个 leaf：

```text
SHA-256(
  "convax.mmr-leaf/1\0" ||
  u64be(leafIndex) ||
  coreDigestBytes
)
```

MMR peak 表示为 `{height:uint32, hash:32-bytes}`。peaks 按从左到右的历史区间排序，等价于
`nextLeaf` 二进制分解的 height 严格递减序列。append leaf 时令 carry height=0；只要最右 peak 与 carry
同 height，就 pop 左 peak 并计算：

```text
SHA-256(
  "convax.mmr-node/1\0" ||
  u32be(height + 1) ||
  leftHash ||
  rightHash
)
```

结果成为 `height+1` 的 carry，最后 append。root 不采用实现相关 bagging：

```text
SHA-256(
  "convax.mmr-root/1\0" ||
  u64be(nextLeaf) ||
  u32be(peakCount) ||
  concat(peaks.map(p => u32be(p.height) || p.hash))
)
```

因此空树 root 是 `SHA-256("convax.mmr-root/1\0" || u64be(0) || u32be(0))`。验证器必须同时检查
peaks height 序列与 `nextLeaf` 一致；禁止接受另一种 peak order/bagging 的同叶集合。

Admission certificate 是 service-signed JCS object：

```ts
interface AdmissionCertificateV1 {
  format: "convax.admission-certificate/1"
  purpose: "typed-intent"
  coreDigest: string
  clientSignatureDigest: string
  credentialDigest: string
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  membershipSequence: string
  membershipSnapshotDigest: string
  memberId: string
  actorId: string
  logicalCounter: string
  role: "editor"
  leaseId: string
  sessionSigningPublicKey: string
  sessionNonce: string
  sessionSequence: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  docEpoch: string
  projectIndexFrontier: ProjectIndexFrontier
  leafIndex: string
  priorPeaks: Array<{ height: string; hash: string }>
  priorMmrRoot: string
  nextPeaks: Array<{ height: string; hash: string }>
  nextMmrRoot: string
  serverSequence: string
  issuedAtUnixMs: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  trustBundleDigest: string
  serviceKeyPurpose: "admission"
  serviceKeyId: string
  serviceSignature: string
}
```

service signature 覆盖除 `serviceSignature` 外的完整 JCS object。`serverSequence`、leaf index 和 MMR
root 只用于 provenance/rollback，portable validator 和 Canvas/Project conflict rule 禁止读取它们。
certificate 中 `leafIndex` 必须等于 prior MMR 的 `nextLeaf`，next MMR 的 `nextLeaf` 隐含为
`leafIndex + 1`；`height` 使用 uint32 decimal string，所有 hash 解码为 32 bytes 后再执行第 2.5 节算法。

service 只有在 portable attester 从请求提供的 certified checkpoint + suffix 重建 core 所声明 exact
base，并验证 client signature、typed intent、delta write-set、schema/invariants/canonical post-state
后才允许 append leaf。验证前的 leaf reservation 有 TTL 且不 durable；失败/超时不会改变 MMR。append
MMR、推进 actor high-water、写 recent receipt 和签 certificate 是一个 durable transaction。

actor counter/high-water 的完整 scope 是
`{projectEpoch, docKind, docId, shardEpoch, actorId}`；docEpoch rollover 不重置它，另一个 Canvas 不共享
它。service 仅接受 `actor.logicalCounter = scopedActorHighWater + 1`，并保存每 scope 最近 4096 个 exact
`{operationId, requestDigest, coreDigest, admissionDigest}` receipts。旧于窗口但不高于 high-water 的
请求返回 `already-committed/reload-projection`；绝不能把 receipt 缺失解释为未提交。
recent admission receipt 还保存完整 `AdmissionCertificateV1`，使 durable outbox 可在 response-loss 后
重建 final frame。只有后续 certified checkpoint/replica ACK 证明至少一个 holder durable 持有该 frame
时才可裁剪 certificate；若原 caller 是唯一 holder且尚未 ACK，receipt 不能仅因窗口大小被驱逐，达到
4096 hard limit 时拒绝该 actor 新 admission并要求 checkpoint/replication。

offline rebase 后某个 local intent guard 失效时，不能留下 counter hole 再提交更高 counter。editor
必须先提交一个无文档 mutation 的 service-signed abandonment：

```ts
interface ActorCounterAbandonmentRequestV1 {
  format: "convax.actor-counter-abandonment-request/1"
  projectId: string
  projectEpoch: string
  membershipEpoch: string
  memberId: string
  actorId: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  logicalCounter: string
  operationId: string
  requestDigest: string
  reason: "guard-stale" | "user-discarded"
  credentialDigest: string
  sessionId: SessionIdV1
  sessionNonce: Nonce128V1
  sessionSequence: string
  sessionSignature: string
}

interface ActorCounterAbandonmentV1 {
  format: "convax.actor-counter-abandonment/1"
  request: ActorCounterAbandonmentRequestV1
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "admission"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

interface OperationLookupRequestV1 {
  format: "convax.operation-lookup-request/1"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  actorId: ActorIdV1
  operationId: OperationIdV1
  requestDigest: string
  credentialDigest: string
  sessionId: SessionIdV1
  sessionNonce: Nonce128V1
  sessionSequence: string
  signature: string
}

interface OperationLookupReceiptCommonV1 {
  format: "convax.operation-lookup-receipt/1"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  actorId: ActorIdV1
  operationId: OperationIdV1
  requestDigest: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "admission"
  serviceKeyId: string
  serviceSignature: string
}

type OperationLookupReceiptV1 =
  | (OperationLookupReceiptCommonV1 & {
      terminal: "not-committed"
      resultDigest: null
      admission: null
      abandonment: null
    })
  | (OperationLookupReceiptCommonV1 & {
      terminal: "admitted"
      resultDigest: string
      admission: AdmissionCertificateV1
      abandonment: null
    })
  | (OperationLookupReceiptCommonV1 & {
      terminal: "abandoned"
      resultDigest: string
      admission: null
      abandonment: ActorCounterAbandonmentV1
    })

interface CertifiedAbandonmentFrameHeaderV1 {
  format: "convax.certified-abandonment/1"
  actorCounterAbandonmentDigest: string
  abandonment: ActorCounterAbandonmentV1
}
```

client 先对
`"convax.actor-counter-abandonment-request/1\0" ||
SHA-256(JCS(request without sessionSignature))` 做 session signature；service 再对完整 request 与
service receipt fields 使用 `convax.actor-counter-abandonment/1` format domain 独立签名。两份签名不能
互换。service 验证 request 的 credential/session binding，并要求 counter 正好为 high-water+1，在一个
durable transaction 中推进 high-water并写 terminal abandonment receipt，不 append MMR leaf。此
operation 永久不能 admission。客户端必须按 counter 顺序逐个 admission 或 abandonment；撤销成员的
本地 branch 不能用 abandonment 推进任何 team actor。

OperationLookupReceiptV1 的 terminal 必须与两个 nullable payload 形成封闭 union：
`not-committed` 两者皆 null/resultDigest null；`admitted` 仅 admission 非 null且 digest 匹配；
`abandoned` 仅 abandonment 非 null且 digest 匹配，并要求 lookup scope/actor/operation/requestDigest
逐字段等于 abandonment.request。它用于 outbox response-loss 恢复，不能把“当前 frontier”冒充 exact
operation result。
kind `8` payload 必须为空，header digest 与完整 abandonment 匹配；它不携带或修改 Yjs update。

OperationLookupRequestV1 使用其 format domain + unsigned JCS digest，由 active credential-bound session
key 签名。HTTP path 的 actorId/operationId、request 的 project/epoch/doc/shard/actor/operation/
requestDigest 和 credential/session binding 必须逐字段一致；service 只按这份 exact request 签
not-committed/admitted/abandoned receipt。缺 doc scope/requestDigest 的 lookup、另一个 actor credential
或拿 current frontier 代替 exact result 都拒绝。

## 3. ProjectIndexYDoc

ProjectIndex 与 Canvas owner schema 共用：

```ts
type JsonValueV1 = null | boolean | string | number | JsonValueV1[] | { [key: string]: JsonValueV1 }

interface ActorStampV1 {
  logicalCounter: string
  actorId: ActorIdV1
  operationId: OperationIdV1
  writeOrdinal: WriteOrdinalV1
}

interface StampedValueV1<T> {
  stamp: ActorStampV1
  value: T
}
```

所有业务可变 scalar/compound field 的 Yjs 物理形态都是
`Y.Map<actorId, StampedValueV1<T>>` 的 actor-slot register。key 必须等于 value.stamp.actorId；
canonical value 取 ActorStamp total order 最大项。total order 为
`(logicalCounter unsigned, actorId decoded bytes, operationId decoded bytes, writeOrdinal unsigned)`。
同 actor 对同 register 的下一次 certified write 必须从包含上一 counter 的 exact base 重建，因此只能
因果覆盖自己的 slot；并发 session/counter、slot key mismatch 或低 counter 覆盖拒绝。不同 actor 各占
独立 key，业务胜负不读取 Yjs clientId、struct clock、到达顺序、locale、墙钟或 server sequence。
tombstone 使用 grow-only `Y.Map<actorId, ActorStampV1>`；route 使用包含同一 stamp 的封闭 deletion
envelope。存在任一 valid tombstone 即永久删除该 incarnation/route/entry。

JsonValueV1 只允许 JCS primitive/array/object；string/key NFC，number finite 且绝对值不超过
Number.MAX_SAFE_INTEGER。它只用于规范明确开放 bounded JSON 的字段，geometry、identity 和 resource
reference 不使用它。

根类型固定：

```text
root: Y.Map
  meta: immutable ProjectIndexMeta
  canvases: Y.Map<canvasId, nested Y.Map conforming CanvasRouteRecord>
  entries: Y.Map<entryId, nested Y.Map conforming ProjectEntryRecordV1>
  contentFamilies: Y.Map<primaryEntryId, Y.Map<versionId, ProjectEntryBlobVersionV1>>
  pluginRequirements: Y.Map<pluginId, immutable PluginRequirementV1>
  operations: Y.Map<operationKey, BoundedOperationReceiptV1>
```

`meta`：

```ts
interface ProjectIndexMeta {
  schema: "convax.project-index-yjs/1"
  projectId: string
  projectEpoch: string
  shardEpoch: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
}
```

ProjectIndex 的 doc id 固定为 `project-index`。`shardEpoch` 在 Project 第一次初始化或显式 reset 时随机
生成，reset 前绝不改变；initial `docEpoch` 在 shard 创建时生成，之后只由 attested checkpoint 推进，
并仅存在于外层 snapshot/head/certificate。Canvas shard 采用相同规则。禁止使用空值或 sentinel epoch。
进入 team history 前，service 必须先为该 shard 的空/初始 snapshot 签 genesis checkpoint；service
不可用时只允许 local provisional intents，不能伪造 genesis frontier。

Canvas route 按 canvasId 使用 nested `Y.Map`。identity/genesis 初始化后不可变；name 是 actor-slot
register，activations/tombstones 是 grow-only map：

```ts
interface CanvasGenesisDescriptorV1 {
  format: "convax.canvas-genesis-descriptor/1"
  canvasGenesisReservationDigest: string
  canvasId: CanvasIdV1
  shardEpoch: EpochIdV1
  docEpoch: EpochIdV1
  fullUpdateHash: string
  stateVectorHash: string
  canonicalStateHash: string
  receiptRoot: string
}

interface CanvasRouteActivationV1 {
  format: "convax.canvas-route-activation/1"
  genesisCheckpointDigest: string
  genesisCheckpointOutboxDigest: string
  activatedBy: ActorStampV1
}

interface CanvasRouteRecord {
  identity: {
    canvasId: string
    shardEpoch: string
    genesis: CanvasGenesisDescriptorV1
    createdBy: ActorStampV1
  }
  names: Map<ActorIdV1, StampedValueV1<string>>
  activations: Map<ActorIdV1, CanvasRouteActivationV1>
  tombstones: Map<
    ActorIdV1,
    {
      deletionId: string
      deletionOrigin: PortableIdentityOriginV1
      shardEpoch: string
      deletedBy: ActorStampV1
    }
  >
}
```

Canvas route 没有 tombstone且无 valid activation 时 state=staged；存在任一 valid activation 时 state=live；
tombstone 永远使 state=closed。activation 必须绑定下述 exact Canvas genesis certificate/outbox/
descriptor，invalid activation 使 ProjectIndex frame 拒绝，不能忽略后投影。Canvas route 的 canonical
bytes 产生 `routeDigest`。Canvas frame 必须绑定含该 live route proof 的
`ProjectIndexFrontier`。receiver 尚未 durable/验证该 Index frontier 时只能把 frame 放入
有界 pending buffer，不能进入 certifiedTeamDoc、workingDoc、projection 或 ACK。若已知更新的 verified Index
frontier tombstone 了该 shard，迟到 frame 进入 quarantine。Canvas CheckpointAttester 使用同一 Index
checkpoint proof；删除团队 Canvas 的顺序固定为：

1. 本地 durable ProjectIndex tombstone；
2. admission + ProjectIndex checkpoint attestation；
3. service 将 exact `{canvasId, shardEpoch}` route 标为 closed 并拒绝后续 Canvas admission；
4. peers durable 新 Index frontier 后停止该 Canvas projection/ACK；
5. lease/grace 完成后再回收 shard bytes。

离线 delete 只进入 local fork，不能在 service/Index attestation 不可用时伪装成已完成的团队删除。

Plugin requirement 是完整原子 JCS value：

```ts
interface PluginRequirementV1 {
  format: "convax.plugin-requirement/1"
  pluginId: string
  snapshotDigest: string
  pluginStateSchemaDigest: string
  descriptor: PortableBoundedValueSchemaV1
}
```

`PortableBoundedValueSchemaV1` 是以下封闭的 discriminated union；descriptor 出现未列出的 key 即拒绝：

```ts
type PortableBoundedValueSchemaV1 =
  | { type: "null" }
  | { type: "boolean" }
  | { type: "string"; maxUtf8Bytes: string; enum?: string[] }
  | { type: "integer"; minimum: string; maximum: string }
  | { type: "array"; maxItems: string; items: PortableBoundedValueSchemaV1 }
  | {
      type: "object"
      maxProperties: string
      required: string[]
      properties: Record<string, PortableBoundedValueSchemaV1>
      additionalProperties: false
    }
  | { type: "union"; variants: PortableBoundedValueSchemaV1[] }
```

所有 string/property key 必须 NFC；required/enum 按 NFC UTF-8 bytes 排序去重，required 必须是
properties 子集；union variants 按各 variant JCS bytes 排序去重；
integer 是 `[-(2^53-1), 2^53-1]` 内十进制规范字符串，payload 中编码为 JCS JSON number。v1 禁止
`$ref`、递归、pattern、format、default、nullable shortcut、任意 additional properties 和非整数
number。

全局 limits 不能被 descriptor 放宽：descriptor JCS <= 64 KiB、schema depth <= 16、总 schema nodes
<= 4096、单 object properties <= 256、union variants <= 16、enum values <= 256；payload JCS <=
256 KiB、value depth <= 32、总 value nodes <= 4096、单 array items <= 1024、单 object keys <= 256、
单 string UTF-8 <= 64 KiB。descriptor 自身声明的 max 必须不超过对应全局 limit。

```text
pluginStateSchemaDigest =
  SHA-256("convax.plugin-state-schema/1\0" || JCS(descriptor))
payloadDigest =
  SHA-256("convax.plugin-state-payload/1\0" || JCS(payload))
```

ProjectIndex bootstrap 先比较 exact snapshot/schema digest；缺失或不一致使整个 Project
observer/read-only。portable validator 和 attester 只解释这个固定 Host dialect，禁止执行 Plugin
validator/migration code。Bun、Chromium、attester 必须共享 valid/invalid descriptor 与 payload golden fixtures。

PluginRequirementV1 在 projectEpoch 内 immutable：相同 bytes 幂等，不同 snapshot/schema 必须进入
observer/read-only 并等待未来显式 Project Plugin migration protocol；v1 不允许用 register/LWW 偷换。

Project entry 按 entryId 使用 nested `Y.Map`。identity 初始化后不可变。primary entry 的 locations 是
actor-slot register、tombstones 是 grow-only map；conflict reservation 不拥有二者，只拥有 immutable
identity 与 append-only promotions map。content version 只在 primary entry 对应的
`contentFamilies[familyEntryId]` 中保存一份；reservation 只引用它：

```ts
interface PrimaryProjectEntryIdentityCommonV1 {
  role: "primary"
  entryId: ProjectEntryId
  origin: PortableIdentityOriginV1
  createdBy: ActorStampV1
}

type PrimaryProjectEntryIdentityV1 =
  | (PrimaryProjectEntryIdentityCommonV1 & {
      entryId: ProjectDirectoryId
      kind: "directory"
      contentPolicy: "none"
    })
  | (PrimaryProjectEntryIdentityCommonV1 & {
      entryId: ProjectFileId
      kind: "file"
      contentPolicy: "immutable" | "conflict-copy" | "overwritable-binary"
    })

interface ConflictReservationIdentityV1 {
  role: "conflict-reservation"
  entryId: ProjectFileId
  familyEntryId: ProjectFileId
  versionId: ProjectVersionId
  origin: PortableIdentityOriginV1
  createdBy: ActorStampV1
}

type ProjectEntryIdentityV1 = PrimaryProjectEntryIdentityV1 | ConflictReservationIdentityV1

interface PrimaryProjectEntryLocationV1 {
  parentDirectoryId: ProjectDirectoryId | null
  basename: string
  state: "present" | "missing"
}

interface ProjectEntryBlobVersionV1 {
  format: "convax.project-entry-version/1"
  versionId: ProjectVersionId
  familyEntryId: ProjectFileId
  blob: `sha256:${string}`
  origin: PortableIdentityOriginV1
  createdBy: ActorStampV1
  supersedesVersionIds: ProjectVersionId[]
  observedFrontier: ProjectIndexFrontier
  size: string
  mediaType?: string
}

interface PrimaryProjectEntryRecordV1 {
  identity: PrimaryProjectEntryIdentityV1
  locations: Map<ActorIdV1, StampedValueV1<PrimaryProjectEntryLocationV1>>
  tombstones: Map<ActorIdV1, ActorStampV1>
}

interface ConflictPromotionV1 {
  format: "convax.conflict-promotion/1"
  sourceFamilyEntryId: ProjectFileId
  sourceVersionId: ProjectVersionId
  newPrimaryEntryId: ProjectFileId
  newVersionId: ProjectVersionId
  promotedBy: ActorStampV1
}

interface ConflictReservationEntryRecordV1 {
  identity: ConflictReservationIdentityV1
  promotions: Map<ProjectFileId, ConflictPromotionV1>
}

type ProjectEntryRecordV1 = PrimaryProjectEntryRecordV1 | ConflictReservationEntryRecordV1

interface ProjectPathClaimProjectionCommonV1 {
  entryId: ProjectEntryId
  canonicalParentDirectoryId: ProjectDirectoryId | null
  canonicalBasename: string
  requestedPath: string | null
  materializationPath: string
  state: "canonical-path" | "sibling-conflict-copy" | "orphan-conflict-copy" | "cycle-conflict-copy"
  siblingWinnerEntryId: ProjectEntryId | null
}

type ProjectPathClaimProjectionV1 =
  | (ProjectPathClaimProjectionCommonV1 & {
      kind: "directory"
      selectedVersionId: null
      blob: null
    })
  | (ProjectPathClaimProjectionCommonV1 & {
      kind: "file"
      selectedVersionId: ProjectVersionId | null
      blob: `sha256:${string}` | null
    })

interface ProjectIndexProjectionV1 {
  primaryEntries: ProjectPathClaimProjectionV1[]
  visibleConflictReservations: Array<{
    reservationEntryId: ProjectFileId
    familyEntryId: ProjectFileId
    versionId: ProjectVersionId
    materializationPath: string
  }>
}
```

location 是稳定 parent identity + basename，不存整条 path。basename 必须是 NFC、UTF-8 1..255 bytes，
不得等于 `.`/`..`，不得包含 `/`、`\`、NUL 或 Unicode general category Cc/Cf；root 下普通 entry 的
basename 禁止 `.convax` 和 `.convax-conflicts`。每个未 tombstone primary 先按 ActorStamp 最大项选择
canonical location；`state:"missing"` 不 materialize，也不能当 parent。parentDirectoryId 非 null 时
必须解析为 live primary directory identity；file、reservation、missing、tombstoned 或不存在的 entry
不能当 parent。

canonicalizer 先在 entry identity 图上工作，不通过 native path 反推 parent。它按以下封闭顺序生成树：

1. 对每个 present directory 建立 `directory -> parentDirectoryId` 边。每个有向 cycle 固定切断 cycle 内
   `(canonical location ActorStamp, entryId UTF-8 bytes)` 最大的那一条边；被切断的 directory 是
   `cycleRoot`，整棵依赖 subtree 的 materialization root 固定为
   `.convax-conflicts/directory-cycles/<cycleRootEntryId>/content`，state=`cycle-conflict-copy`。
2. parent absent、missing、tombstoned、非 directory 或已经归入另一个 conflict root 的 entry 不能占用
   canonical sibling namespace。前四种 orphan 的 subtree root 固定为
   `.convax-conflicts/orphans/<entryId>/content`，state=`orphan-conflict-copy`；引用一个 conflict-root
   directory 的 descendants 跟随其 conflict subtree，不重复改根。
3. 对仍在 canonical tree 中、具有相同 exact
   `(canonicalParentDirectoryId|null, canonicalBasename UTF-8 bytes)` 的 siblings，winner 固定为
   identity.createdBy
   `(logicalCounter unsigned, actorId decoded bytes, operationId decoded bytes, writeOrdinal unsigned,
entryId UTF-8 bytes)` 最小项。winner 在 canonical parent 下 materialize；每个 loser 连同所有以
   loser directory identity 为 parent 的 descendants 形成独立 subtree，root 固定为
   `.convax-conflicts/path-claims/<loserEntryId>/content`，state=`sibling-conflict-copy`。loser 是 file
   时只有该 file，loser 是 directory 时 child 路径保存在这个 subtree 内。
   sibling groups 按 parent projection depth 自 root 起处理，同 depth 按 parentDirectoryId bytes；
   一旦 parent 进入某个 conflict subtree，它的 descendants 只在该 subtree 内按相同 sibling rule
   递归，不再与 canonical root 的同 basename entry 竞争。
4. 在所选 root 内按 parent identity 递归连接 basename，得到 requestedPath/materializationPath；
   requestedPath 只在所有 ancestors 都属于 canonical tree 时为 Project-relative derived path，否则为
   null。任意派生路径超过 4096 UTF-8 bytes 使 Project 进入 portable-invalid/read-only，不截断、不重命名。

因此 file `a` 与 losing directory `a` 的 child `b` 可同时物化为 `a` 与
`.convax-conflicts/path-claims/<directoryId>/content/b`；file 永远不会被误当成 `b` 的 parent。不存在
locale、Yjs clientId、arrival order、native enumeration 或自动数字后缀分支。
ProjectIndexProjectionV1 两个数组分别按 entryId/reservationEntryId UTF-8 bytes 排序。visible content
reservation 仍按下述 version DAG 规则选择，路径固定为
`.convax-conflicts/<reservationEntryId>/content`；path-claim loser 与 content reservation 是不同 identity
和命名空间。canonicalizer 必须从 logical state 纯派生本 projection；它不是 Yjs write。当前 Project URI
的 `path` query 使用 materializationPath，file 的 `blob` query 使用 selected version；version selection
按下述 policy/live DAG 规则，空 family 才允许两个字段均 null。missing entry 不在 primaryEntries 中，
只保留 canonical location 作为非解析性的 display/relink hint。所有 descendants 通过 stable directory
identity 跟随 move；rename/move 是一个 location register 的原子 `{parentDirectoryId,basename,state}`，
不批量改写 descendant，也不把 derived path 复制回 Y.Doc。

`project.entry.write-current` 对 conflict-copy policy 在同一个 ProjectIndex transaction 中：

1. 从 operation identity + schema-defined ordinal 派生一个 versionId；
2. 从同一 operation + 独立 ordinal、parentIdentity=versionId 派生 reservationEntryId；
3. 只向 `contentFamilies[familyEntryId]` 写一份 immutable version；
4. 创建一个只引用 `{familyEntryId, versionId}` 的 conflict-reservation entry。

reservation 不拥有 version map、blob、location 或 tombstone。无并发时隐藏；存在多个 live versions 时 winner 留在
primary，其他 version 通过各自唯一 reservation 投影。reservation 不可直接 write/move/delete；用户要
永久保留或编辑时使用 `project.entry.promote-conflict`，以新 operation 创建新的 primary entry/version。

`supersedesVersionIds` 必须是 intent causal guard 指向的 certified historical frontier 中全部 live
version ids 的 digest-byte 排序去重数组；attester 从该 checkpoint + suffix 重建 frontier，拒绝少报、
多报或不可证明的历史。不能在 latest base 上把 supersedes 改写成当前 live set，否则会把离线并发伪装
成顺序 write。历史 material 已不可用时 local intent 进入 `causal-base-unavailable` blocked state。
version records 不删除 observed version，而是形成因果 DAG；没有被任一 valid newer record supersede
的 version 才 live。顺序 A→B 时
B.supersedes=[A]，只剩 B；从同一 A 离线并发的 B/C 都 supersede A，但彼此不 supersede，因此二者同时
live。后续 D 在看见 B/C 后写入，D.supersedes=[B,C] 并解决冲突。ActorStamp 最小的 live version 留在
primary，其余 version 使用各自 reservation。可见 conflict bytes 的 Project-relative materialization
path 固定为 `.convax-conflicts/<reservationEntryId>/content`；顶层 `.convax-conflicts/` 是
Project-files owner 的保留 namespace，普通 create/move/import 不能占用，但其内容属于普通 Project
文件，reset 不得删除。UI 用原 primary basename 作为 display label，不把 label 当路径。这不是
auto-repair write；projection 只选择已存在 record，禁止凭空发明 entryId 或虚拟条目。

live set 固定为 `all version ids - union(all valid supersedesVersionIds)`；primary winner 顺序为
`(createdBy logicalCounter, actorId bytes, operationId bytes, writeOrdinal, versionId digest)` 的最小项。
A→B 只投影 B；A→B/C 投影 B/C 且只有 loser reservation 可见；B/C→D 只投影 D，旧 reservation
隐藏但 history/blob 没有被复制或删除。arrival order、Yjs clientId 和 admission sequence 不得改变结果。

policy 分支封闭：`immutable` 只允许空 family 的首次 write，后续结果必须新建 fileId；
`conflict-copy` 使用上述 DAG/reservation；`overwritable-binary` 的 current 是 ActorStamp 最大 version，
supersedes 必须为空且不生成 reservation，loser 不是历史，checkpoint 后无引用即可 GC。机器墙钟和
silent arbitrary LWW 禁止。

promote-conflict 在一个 transaction 中验证 reservation 当前可见且精确引用 guard 的 family/version、
sourceVersionDigest/blob/size 和 observed frontier；重算 newPrimaryEntryId/newVersionId；创建一个新的
conflict-copy primary family；写一份复用同一 content-addressed blob、`supersedesVersionIds: []`、
observedFrontier 等于 guard 的新 version；再向原 reservation 的
`promotions[newPrimaryEntryId]` 写 ConflictPromotionV1。reservation 存在任一 valid promotion 后不再
投影。并发 promotion 产生多个独立 primary，不覆盖；原 version record 不复制到新 family，新 family
拥有一份明确的新 version record。

因此每份保留内容都有持久 `ProjectEntryId`、location、blob owner 和 canonical URI；merge、重启、
rename/relink 后身份不变。对 Canvas/Agent 暴露的 Project URI 是从 identity、projectEpoch、projected
location 和 selected blob version 生成的一个原子 value；URI 内 `entryId/path/blob` 不能拆到相邻
Y.Map key。

ProjectIndex 禁止保存：

- active Canvas、selection、layout；
- Canvas nodes/edges/head state vector；
- native path、peerId、presence；
- blob bytes 或 chunk progress。

## 4. CanvasYDoc

根类型固定：

```text
root: Y.Map
  meta: Y.Map
    identity: immutable CanvasIdentityV1
    title: Y.Map<actorId, StampedValueV1<string>>
    description: Y.Map<actorId, StampedValueV1<string | null>>
    tags: Y.Map<actorId, StampedValueV1<string[]>>
  nodes: Y.Map<entityKey, nested Y.Map conforming NodeRecordV1>
  edges: Y.Map<entityKey, nested Y.Map conforming EdgeRecordV1>
  containments: Y.Map<childEntityKey, Y.Map<actorId, ContainmentChoiceV1>>
  semanticHistory: Y.Map<targetOperationKey, Y.Map<actorId, StampedValueV1<SemanticHistoryStateV1>>>
  operations: Y.Map<operationKey, BoundedOperationReceiptV1>
```

规范 primitive 与 closed envelopes：

```ts
interface EntityRefV1 {
  id: string
  incarnation: string
}

interface CanvasPointV1 {
  x: number
  y: number
}

interface CanvasSizeV1 {
  width: number
  height: number
}

interface CanvasIdentityV1 {
  format: "convax.canvas-identity/1"
  schema: "convax.canvas-yjs/1"
  canvasId: string
  shardEpoch: string
}

interface ProjectResourceRefV1 {
  format: "convax.project-resource-ref/1"
  uri: string
  class: "text" | "image" | "video" | "audio" | "file" | "folder"
}

type NodeDataEnvelopeV1 =
  | {
      format: "convax.canvas-node-data/1"
      kind: "resource"
      title: string
      description?: string
      resource: ProjectResourceRefV1
      presentation?: {
        fit?: "contain" | "cover"
        intrinsicWidth?: number
        intrinsicHeight?: number
        durationMs?: string
      }
    }
  | {
      format: "convax.canvas-node-data/1"
      kind: "group"
      title: string
      description?: string
    }
  | {
      format: "convax.canvas-node-data/1"
      kind: "agent"
      title: string
      description?: string
      agentKey?: string
    }
  | {
      format: "convax.canvas-node-data/1"
      kind: "placeholder"
      title: string
      expectedClass: "text" | "image" | "video" | "audio" | "file"
    }

type ResourceNodeDataV1 = Extract<NodeDataEnvelopeV1, { kind: "resource" }>

interface GenerationToolRefV1 {
  pluginId: string
  snapshotDigest: string
  toolId: string
  modelSelectionId?: string
}

interface GenerationIdentityV1 {
  format: "convax.canvas-generation-identity/1"
  generationId: string
  origin: PortableIdentityOriginV1
}

type GenerationStateEnvelopeV1 =
  | {
      format: "convax.canvas-generation/1"
      phase: "active"
      identity: GenerationIdentityV1
      tool: GenerationToolRefV1
      prompt: string
      targetDataDigest: string
      targetPluginDigest?: string
    }
  | {
      format: "convax.canvas-generation/1"
      phase: "succeeded"
      identity: GenerationIdentityV1
      terminalOperation: OperationIdentityV1
      output: ProjectResourceRefV1
    }
  | {
      format: "convax.canvas-generation/1"
      phase: "failed"
      identity: GenerationIdentityV1
      terminalOperation: OperationIdentityV1
      failureCode: string
      publicMessage?: string
    }

interface CanvasEdgeDataV1 {
  format: "convax.canvas-edge-data/1"
  label?: string
}

interface PluginStateEnvelopeV1 {
  format: "convax.plugin-state/1"
  pluginId: string
  snapshotDigest: string
  pluginStateSchemaDigest: string
  payload: JsonValueV1
}

interface CanvasNodeIdentityV1 {
  format: "convax.canvas-node-identity/1"
  node: EntityRefV1
  role: "file" | "agent"
  origin: PortableIdentityOriginV1
  createdBy: ActorStampV1
}

interface CanvasEdgeIdentityV1 {
  format: "convax.canvas-edge-identity/1"
  edge: EntityRefV1
  source: EntityRefV1
  target: EntityRefV1
  origin: PortableIdentityOriginV1
  createdBy: ActorStampV1
}
```

Generation begin 从 origin 重算 generationId；complete/fail 必须逐字节保留同一
GenerationIdentityV1，并让 terminalOperation 等于 terminal intent 的 actorId/operationId。checkpoint
compaction 后也必须能仅从当前 value 重算 generationId；禁止从 terminal operation 重新派生。

tags 是 NFC UTF-8 排序去重的 set projection。resource URI 必须是全局 URI 规范的 canonical
`convax-project` URI，并作为一个 atomic string 写入。`resourceState`、resolved URL/poster、加载错误、
selection、hover、measured size、native path 和非 terminal generation progress 禁止进入 schema。

Node 按 `{nodeId, incarnation}` entity key 寻址。identity/creationGroup 初始化后不可变；每个业务字段
是独立 actor-slot register，compound value atomic，避免并发拼出从未提交过的半个 value：

```ts
interface NodeRecordV1 {
  identity: CanvasNodeIdentityV1
  position: Map<ActorIdV1, StampedValueV1<CanvasPointV1>>
  size: Map<ActorIdV1, StampedValueV1<CanvasSizeV1 | null>>
  data: Map<ActorIdV1, StampedValueV1<NodeDataEnvelopeV1>>
  generation: Map<ActorIdV1, StampedValueV1<GenerationStateEnvelopeV1 | null>>
  plugin: Map<ActorIdV1, StampedValueV1<PluginStateEnvelopeV1 | null>>
  creationGroup?: CreationGroupRefV1
  tombstones: Map<ActorIdV1, ActorStampV1>
}
```

entity key 编码固定为：

```text
n/<base64url(UTF8(NFC(nodeId)))>/<64-lowercase-hex-incarnation>
e/<base64url(UTF8(NFC(edgeId)))>/<64-lowercase-hex-incarnation>
o/<43-char-actorId>/<22-char-operationId>
```

base64url 不含 padding，解析后必须 round-trip 到同一 canonical key；id UTF-8 上限 256 bytes。

Edge identity/source/target/creationGroup 初始化后不可变，data 是 actor-slot register：

```ts
interface EdgeRecordV1 {
  identity: CanvasEdgeIdentityV1
  data: Map<ActorIdV1, StampedValueV1<CanvasEdgeDataV1>>
  creationGroup?: CreationGroupRefV1
  tombstones: Map<ActorIdV1, ActorStampV1>
}
```

业务 edge 不是 parent，可以形成 cycle。structural containment 使用独立多值 relation：

```ts
interface ContainmentChoiceV1 {
  format: "convax.canvas-containment-choice/1"
  relationId: string
  origin: PortableIdentityOriginV1
  child: EntityRefV1
  parent: EntityRefV1 | null
  stamp: ActorStampV1
}
```

relationId 与所有 entity id/incarnation 都按第 2.2.1 节从包含 actorId 的 operation identity 派生。
并发 parent choices 全部保留；canonicalizer 先选择 ActorStamp 最大 choice，再确定性打破 cycle。
不能把 containment 编码成业务 edge。

```ts
interface BoundedOperationReceiptV1 {
  format: "convax.operation-receipt/1"
  actorId: ActorIdV1
  operationId: OperationIdV1
  requestDigest: string
  intentKind: TypedIntentV1["kind"]
  stamp: ActorStampV1
  terminal: "applied"
  resultEntities: EntityRefV1[]
  resultDigests: string[]
}
```

operations 只保留有界幂等 receipt；checkpoint semantic compaction 后可裁剪，不能保存完整 document
或大 result。
resultEntities 精确等于该 intent 新创建的 Canvas node/edge refs，按 canonical entity key 排序；没有创建
则为空。resultDigests 精确等于该 intent 新创建的非 Canvas identity/version/group canonical identity
digests，按 decoded digest bytes 排序；没有则为空。更新或 tombstone 已有 entity 不进入两个 result
数组。两数组都由 reducer 生成，caller 不能选择。这使 delete inverse/creation-group redo 的 fresh refs
可以从 exact prior history receipt 唯一恢复。

## 5. Incarnation 与删除

- entity identity 是 `{id, incarnation}`；
- delete 写 tombstone，旧 incarnation 永久不可重新出现；
- undo delete 创建新 id/incarnation；所有恢复 edge endpoint 重写成新 identity；
- generation state、operationId 和 Plugin creation group 不从旧 incarnation 继承，除非 semantic inverse
  明确创建新的合法状态；
- edge endpoint incarnation 不匹配、endpoint tombstoned 或不存在时，该 edge 不进入 canonical projection；
- delete 与迟到 generation result 并发时，generation guard 需要匹配 node incarnation、operationId 和
  resource content guard；任一不匹配即 delete 胜出。

## 6. Deterministic canonical projection

canonicalizer 是纯函数：

```ts
declare function canonicalize(
  projectIndexSnapshot: unknown,
  canvasSnapshot: unknown,
): {
  projection: CanvasProjectionV1
  rejectedRelations: RejectedContainmentV1[]
  referencedResources: ProjectResourceRefV1[]
}

interface CanvasProjectionV1 {
  format: "convax.canvas-projection/1"
  canvasId: string
  title: string
  description?: string
  tags: string[]
  nodes: ProjectedCanvasNodeV1[]
  edges: ProjectedCanvasEdgeV1[]
  rejectedContainments: RejectedContainmentV1[]
  referencedResources: ProjectResourceRefV1[]
}

interface ProjectedCanvasNodeV1 {
  node: EntityRefV1
  role: "file" | "agent"
  position: CanvasPointV1
  size?: CanvasSizeV1
  data: NodeDataEnvelopeV1
  generation?: GenerationStateEnvelopeV1
  plugin?: PluginStateEnvelopeV1
  structuralParent?: EntityRefV1
  creationGroup?: CreationGroupRefV1
}

interface ProjectedCanvasEdgeV1 {
  edge: EntityRefV1
  source: EntityRefV1
  target: EntityRefV1
  data: CanvasEdgeDataV1
  creationGroup?: CreationGroupRefV1
}

interface RejectedContainmentV1 {
  relationId: string
  reason: "missing-child" | "missing-parent" | "deleted-endpoint" | "cycle"
}
```

输入只能是 Yjs logical content 和固定 artifact bytes。禁止使用：

- 墙钟、locale、随机数、到达顺序、Yjs clientId 数值优先级；
- 本机安装的 Plugin code/version；
- admission server sequence 作为业务胜负；
- renderer measurement 或 React Flow object identity。

canonicalizer 严格验证每个 actor slot key/stamp/counter，再按 ActorStamp 选择。Yjs clientId 只负责
传输层 struct merge，不能直接成为 projected field winner。

canonicalizer 不写 auto-repair transaction。它只排除非法 projection 并报告原因，避免不同 peer
不断生成 repair write。

### 6.1 Structural containment cycle

先过滤不存在/旧 incarnation/tombstoned parent。若剩余 relation 形成 cycle，对每个 strongly connected
component 排除 stable maximal relation：

```text
order = (choice stamp.logicalCounter, choice stamp.actorId, child nodeId, parent nodeId, relationId)
```

logicalCounter 按 unsigned integer，其余按 decoded/UTF-8 bytes 比较；排除最大项后重复，直到无 cycle。
所有 peer 对同一 snapshot 必须得到同一 forest。

### 6.2 Orphan edge

endpoint 不可达的 edge 不进入 projection。Node delete 与 edge create 并发时 delete wins；
物理 Y.Map 记录可留到 checkpoint compaction，但对业务不可见、不可作为生成 input。

### 6.3 Plugin creation group

```ts
interface CreationGroupRefV1 {
  format: "convax.creation-group-ref/1"
  groupId: string
  origin: PortableIdentityOriginV1
  source: EntityRefV1
  pluginId: string
  snapshotDigest: string
  pluginStateSchemaDigest: string
}
```

creation group 的所有 Canvas entities 在一个 intent/transaction/frame 中创建。source endpoint 不可达时，
group 的全部 Canvas nodes/edges 从 projection 排除。不能保留孤立结果。已发布 Project file 不属于
Canvas transaction，保留为无引用文件。
validator 必须从 CreationGroupRefV1.origin 重算 groupId；同一派生 id 具有不同 origin 时 shard
quarantine。组内所有 entity 保存 byte-identical ref，checkpoint 后不依赖 operation receipt 恢复 origin。

PluginStateEnvelopeV1 是不可拆分的 atomic value。envelope identity 必须匹配 ProjectIndex
requirement，payload 必须通过 requirement 中 exact
`PortableBoundedValueSchemaV1`。字段级 CRDT merge、unknown class instance、binary object 和 Plugin code
validation 全部禁止；未知端只能逐字节保留 envelope，不能反序列化后重写。

## 7. Typed intents

v1 intent 是以下封闭 union；任何 unknown kind/key 或 `core.intentKind !== decodedIntent.kind` 都拒绝：

```ts
interface IntentBaseV1<K extends string, G, B> {
  format: "convax.typed-intent/1"
  kind: K
  guard: G
  body: B
}

interface NodeLiveGuardV1 {
  node: EntityRefV1
  requireNotDeleted: true
}

interface EdgeLiveGuardV1 {
  edge: EntityRefV1
  requireNotDeleted: true
}

interface CanonicalValueGuardV1 {
  canonicalDigest: string
}

interface BlobDurableGuardV1 {
  blobHash: string
  byteLength: string
  localDurableIndexDigest: string
}

interface ProjectResourceDurableGuardV1 extends BlobDurableGuardV1 {
  projectIndexFrontier: ProjectIndexFrontier
  fileId: ProjectFileId
  versionId: ProjectVersionId
  canonicalUri: string
}

interface PromoteConflictGuardV1 {
  reservationEntryId: ProjectFileId
  familyEntryId: ProjectFileId
  versionId: ProjectVersionId
  requireVisible: true
  observedFrontier: ProjectIndexFrontier
  sourceVersionDigest: string
  blob: BlobDurableGuardV1
  expectedNewPrimaryAbsent: ProjectFileId
}

interface PromoteConflictBodyV1 {
  reservationEntryId: ProjectFileId
  newPrimaryEntryOrdinal: IdentityOrdinalV1
  newPrimaryEntryId: ProjectFileId
  newVersionOrdinal: IdentityOrdinalV1
  newVersionId: ProjectVersionId
  location: PrimaryProjectEntryLocationV1
}

interface CanvasNodeCreateSpecV1 {
  identityOrdinal: IdentityOrdinalV1
  nodeId: string
  role: "file" | "agent"
  position: CanvasPointV1
  size?: CanvasSizeV1
  data: NodeDataEnvelopeV1
  plugin?: PluginStateEnvelopeV1
}

interface CreationGroupNodeSpecV1 extends CanvasNodeCreateSpecV1 {
  plugin: PluginStateEnvelopeV1
}

interface CreationGroupEdgeSpecV1 {
  identityOrdinal: IdentityOrdinalV1
  edgeId: string
  source: EntityRefV1 | { createdNodeId: string }
  target: EntityRefV1 | { createdNodeId: string }
  data: CanvasEdgeDataV1
}

type CanvasUndoableIntentKindV1 =
  | "canvas.nodes.create"
  | "canvas.nodes.delete"
  | "canvas.nodes.set-geometry"
  | "canvas.nodes.update-data"
  | "canvas.nodes.set-plugin-state"
  | "canvas.nodes.set-structural-parent"
  | "canvas.edges.connect"
  | "canvas.edges.delete"
  | "canvas.metadata.update"
  | "canvas.plugin.creation-group.create"

interface SemanticHistoryTargetV1 {
  targetActorId: ActorIdV1
  targetOperationId: OperationIdV1
  targetRequestDigest: string
  targetReceiptDigest: string
  targetIntentKind: CanvasUndoableIntentKindV1
  requireHistoryRootRetained: true
}

interface SemanticHistoryAppliedRefV1 {
  actorId: ActorIdV1
  operationId: OperationIdV1
  requestDigest: string
  intentKind: CanvasUndoableIntentKindV1 | "canvas.redo.semantic-forward"
}

interface SemanticHistoryStateV1 {
  format: "convax.semantic-history-state/1"
  targetActorId: ActorIdV1
  targetOperationId: OperationIdV1
  targetRequestDigest: string
  targetReceiptDigest: string
  targetIntentKind: CanvasUndoableIntentKindV1
  status: "applied" | "undone"
  currentApplied: SemanticHistoryAppliedRefV1 | null
  lastHistoryOperation: OperationIdentityV1
}

interface SemanticUndoGuardV1 extends SemanticHistoryTargetV1 {
  expectedHistoryStateDigest: string | null
  expectedHistoryStatus: "applied"
  expectedAppliedOperation: SemanticHistoryAppliedRefV1
}

interface SemanticRedoGuardV1 extends SemanticHistoryTargetV1 {
  expectedHistoryStateDigest: string
  expectedHistoryStatus: "undone"
  expectedAppliedOperation: null
}

type CanvasSemanticOperationV1 =
  | {
      op: "node.create"
      guard: { expectedAbsent: EntityRefV1 }
      value: CanvasNodeCreateSpecV1
    }
  | { op: "node.tombstone"; guard: NodeLiveGuardV1; node: EntityRefV1 }
  | {
      op: "node.set-geometry"
      guard: NodeLiveGuardV1 & { expectedGeometryDigest: string }
      node: EntityRefV1
      position: CanvasPointV1
      size?: CanvasSizeV1 | null
    }
  | {
      op: "node.set-data"
      guard: NodeLiveGuardV1 & { expectedDigest: string }
      node: EntityRefV1
      data: NodeDataEnvelopeV1
    }
  | {
      op: "edge.create"
      guard: { expectedAbsent: EntityRefV1 }
      value: CreationGroupEdgeSpecV1
    }
  | { op: "edge.tombstone"; guard: EdgeLiveGuardV1; edge: EntityRefV1 }
  | {
      op: "containment.set"
      guard: { child: NodeLiveGuardV1; parent?: NodeLiveGuardV1; expectedRelationDigest: string | null }
      relationOrdinal: IdentityOrdinalV1
      child: EntityRefV1
      parent: EntityRefV1 | null
    }
  | {
      op: "metadata.set"
      guard: { expectedDigest: string | null }
      field: "title" | "description" | "tags"
      value: string | string[] | null
    }
  | {
      op: "plugin.set-state"
      guard: NodeLiveGuardV1 & { expectedDigest: string | null }
      node: EntityRefV1
      value: PluginStateEnvelopeV1 | null
    }
  | {
      op: "creation-group.create"
      guard: {
        source: NodeLiveGuardV1
        sourceDataDigest: string
        pluginRequirement: {
          pluginId: string
          snapshotDigest: string
          pluginStateSchemaDigest: string
        }
        expectedAbsentNodes: EntityRefV1[]
        expectedAbsentEdges: EntityRefV1[]
      }
      value: {
        groupOrdinal: IdentityOrdinalV1
        source: EntityRefV1
        nodes: CreationGroupNodeSpecV1[]
        edges: CreationGroupEdgeSpecV1[]
      }
    }

type HistoryIdentitySlotV1 =
  | ["node", string, string]
  | ["edge", string, string]
  | ["group", string]
  | ["relation", string]

interface SemanticHistoryPlanV1 {
  mode: "inverse" | "forward"
  sourceIntentKind: CanvasUndoableIntentKindV1
  operations: CanvasSemanticOperationV1[]
}

type TypedIntentV1 =
  | IntentBaseV1<"canvas.nodes.create", { expectedAbsent: EntityRefV1 }, CanvasNodeCreateSpecV1>
  | IntentBaseV1<
      "canvas.nodes.delete",
      { nodes: NodeLiveGuardV1[]; incidentEdges: EdgeLiveGuardV1[] },
      { nodes: EntityRefV1[] }
    >
  | IntentBaseV1<
      "canvas.nodes.set-geometry",
      { nodes: NodeLiveGuardV1[] },
      {
        updates: Array<{
          node: EntityRefV1
          position: CanvasPointV1
          size?: CanvasSizeV1 | null
        }>
      }
    >
  | IntentBaseV1<
      "canvas.nodes.update-data",
      { node: NodeLiveGuardV1; expectedData: CanonicalValueGuardV1 },
      { node: EntityRefV1; data: NodeDataEnvelopeV1 }
    >
  | IntentBaseV1<
      "canvas.nodes.set-plugin-state",
      {
        node: NodeLiveGuardV1
        expectedPluginDigest: string | null
        requirement: {
          pluginId: string
          snapshotDigest: string
          pluginStateSchemaDigest: string
        }
      },
      { node: EntityRefV1; plugin: PluginStateEnvelopeV1 | null }
    >
  | IntentBaseV1<
      "canvas.nodes.set-structural-parent",
      { child: NodeLiveGuardV1; parent?: NodeLiveGuardV1 },
      {
        relationOrdinal: IdentityOrdinalV1
        child: EntityRefV1
        parent: EntityRefV1 | null
      }
    >
  | IntentBaseV1<
      "canvas.edges.connect",
      {
        expectedAbsent: EntityRefV1
        source: NodeLiveGuardV1
        target: NodeLiveGuardV1
      },
      {
        identityOrdinal: IdentityOrdinalV1
        edgeId: string
        source: EntityRefV1
        target: EntityRefV1
        data: CanvasEdgeDataV1
      }
    >
  | IntentBaseV1<"canvas.edges.delete", { edge: EdgeLiveGuardV1 }, { edge: EntityRefV1 }>
  | IntentBaseV1<
      "canvas.metadata.update",
      { canvasId: string; shardEpoch: string },
      { title?: string; description?: string | null; tags?: string[] }
    >
  | IntentBaseV1<
      "canvas.generation.begin",
      {
        node: NodeLiveGuardV1
        expectedData: CanonicalValueGuardV1
        expectedPluginDigest?: string
        expectedGenerationDigest: string | null
      },
      {
        generationOrdinal: IdentityOrdinalV1
        node: EntityRefV1
        tool: GenerationToolRefV1
        prompt: string
      }
    >
  | IntentBaseV1<
      "canvas.generation.complete",
      {
        node: NodeLiveGuardV1
        generationId: string
        expectedGenerationDigest: string
        expectedData: CanonicalValueGuardV1
        outputResource: ProjectResourceDurableGuardV1
      },
      { node: EntityRefV1; outputData: ResourceNodeDataV1 }
    >
  | IntentBaseV1<
      "canvas.generation.fail",
      {
        node: NodeLiveGuardV1
        generationId: string
        expectedGenerationDigest: string
      },
      { node: EntityRefV1; failureCode: string; publicMessage?: string }
    >
  | IntentBaseV1<
      "canvas.plugin.creation-group.create",
      {
        source: NodeLiveGuardV1
        sourceDataDigest: string
        pluginRequirement: {
          pluginId: string
          snapshotDigest: string
          pluginStateSchemaDigest: string
        }
      },
      {
        groupOrdinal: IdentityOrdinalV1
        source: EntityRefV1
        nodes: CreationGroupNodeSpecV1[]
        edges: CreationGroupEdgeSpecV1[]
      }
    >
  | IntentBaseV1<"canvas.undo.semantic-inverse", SemanticUndoGuardV1, SemanticHistoryPlanV1>
  | IntentBaseV1<"canvas.redo.semantic-forward", SemanticRedoGuardV1, SemanticHistoryPlanV1>
  | IntentBaseV1<
      "project.canvas.create-route",
      { expectedCanvasAbsent: string },
      {
        canvasId: string
        shardEpoch: string
        name: string
        genesis: CanvasGenesisDescriptorV1
      }
    >
  | IntentBaseV1<
      "project.canvas.activate-route",
      {
        canvasId: string
        shardEpoch: string
        requireStaged: true
        genesisCheckpoint: GenesisCheckpointCertificateV1
      },
      {
        canvasId: string
        activation: CanvasRouteActivationV1
      }
    >
  | IntentBaseV1<
      "project.canvas.rename",
      { canvasId: string; shardEpoch: string; requireLive: true },
      { canvasId: string; name: string }
    >
  | IntentBaseV1<
      "project.canvas.tombstone",
      { canvasId: string; shardEpoch: string; requireLive: true },
      {
        deletionOrdinal: IdentityOrdinalV1
        canvasId: string
        deletionId: string
      }
    >
  | IntentBaseV1<
      "project.entry.create",
      { expectedEntryAbsent: string },
      { identityOrdinal: IdentityOrdinalV1; location: PrimaryProjectEntryLocationV1 } & (
        | {
            entryId: ProjectDirectoryId
            kind: "directory"
            contentPolicy: "none"
          }
        | {
            entryId: ProjectFileId
            kind: "file"
            contentPolicy: "immutable" | "conflict-copy" | "overwritable-binary"
          }
      )
    >
  | IntentBaseV1<
      "project.entry.move",
      { entryId: ProjectEntryId; requireLive: true },
      { entryId: ProjectEntryId; location: PrimaryProjectEntryLocationV1 }
    >
  | IntentBaseV1<
      "project.entry.write-current",
      {
        familyEntryId: ProjectFileId
        requireLive: true
        contentPolicy: "immutable" | "conflict-copy" | "overwritable-binary"
        observedFrontier: ProjectIndexFrontier
        expectedLiveVersionIds: ProjectVersionId[]
        blob: BlobDurableGuardV1
        expectedReservationAbsent?: ProjectFileId
      },
      | {
          contentPolicy: "conflict-copy"
          familyEntryId: ProjectFileId
          versionOrdinal: IdentityOrdinalV1
          reservationOrdinal: IdentityOrdinalV1
          blobHash: string
          byteLength: string
          mediaType?: string
          supersedesVersionIds: ProjectVersionId[]
        }
      | {
          contentPolicy: "immutable" | "overwritable-binary"
          familyEntryId: ProjectFileId
          versionOrdinal: IdentityOrdinalV1
          blobHash: string
          byteLength: string
          mediaType?: string
          supersedesVersionIds: []
        }
    >
  | IntentBaseV1<"project.entry.promote-conflict", PromoteConflictGuardV1, PromoteConflictBodyV1>
  | IntentBaseV1<"project.entry.tombstone", { entryId: ProjectEntryId; requireLive: true }, { entryId: ProjectEntryId }>
  | IntentBaseV1<"project.plugin.require", { expected: "absent-or-exact" }, { requirement: PluginRequirementV1 }>
```

Node/edge arrays、guard ids、supersedes ids 和 tags 必须按 canonical key/digest bytes 排序去重。
project.entry.write-current 的 guard/body contentPolicy 必须相同；只有 conflict-copy 必须携带并验证
expectedReservationAbsent/reservationOrdinal，其他 policy 禁止这些字段。
project.canvas.create-route 的 body canvasId/shardEpoch/genesis 必须逐字段等于一个当前未过期、
未消费的 CanvasGenesisReservationV1；genesis.canvasGenesisReservationDigest 必须等于该 signed
reservation digest，docEpoch 也必须等于 reservation。create-route 只建立 staged route，不允许携带
checkpoint 或 activation。project.canvas.activate-route 的 guard certificate 必须是该 staged route
descriptor 精确描述的 Canvas genesis：project/doc/shard/docEpoch、fullUpdate/stateVector/canonicalState/
receipt hashes、outbox digest 和 canvas-staged-route binding 全部逐字段匹配；body activation 的两个
digest 必须分别等于该 certificate/outbox，activatedBy 必须等于当前 operation stamp。一个 reservation
只能对应一个 `{canvasId,shardEpoch,docEpoch}`，一个 staged route 只能接受同一 genesis digest 的
幂等 activation；任一不同 activation、过期 reservation 或已 closed route 使整笔 intent 拒绝。
canvas.generation.complete 的 outputData.resource.uri 必须逐字节等于
outputResource.canonicalUri；URI 必须 canonical parse 为本 projectId/projectEpoch、entryId=fileId、
blob=`sha256:<blobHash>`。outputResource.projectIndexFrontier 必须已 certified/durable 且其 exact live
file/version 的 blob/byteLength 与 guard 相同；succeeded generation.output 逐字段等于
outputData.resource。任一 mismatch 使整个 intent 拒绝，不能把 blob durability 与 Canvas resource
reference 分别验证后拼接。
Plugin creation group 的 source 不得属于创建集合；created ids/ordinals 唯一，edge endpoint 只能是
source、base live node 或本 group node。每个 entity 写同一 CreationGroupRefV1；任何一项 invalid 使
整个 intent 拒绝。
每个 CreationGroupNodeSpecV1.plugin 的 pluginId/snapshotDigest/pluginStateSchemaDigest 必须逐字段等于
intent.guard.pluginRequirement 和派生 CreationGroupRefV1；payload 只用该 exact descriptor 验证。v1
不允许一个 creation group 隐式创建另一个 Plugin owner 的节点。
所有 edge create 必须显式携带 CanvasEdgeDataV1；无 label 时调用方写
`{format:"convax.canvas-edge-data/1"}`，reducer 不补隐式 default。CanvasNodeCreateSpecV1.plugin absent
时不产生 plugin write；present 时必须通过 exact Project Plugin requirement。creation-group node 的
plugin 始终 required。
canvas.nodes.delete 的 guard.nodes 与 body.nodes 必须是相同 canonical sorted set；guard.incidentEdges
必须逐项等于 exact base 中 source 或 target 属于该 node set 的全部 live edges，并按 canonical edge key
排序。漏报、多报、stale edge 都拒绝；reducer 在同一 transaction 为完整 node set 和完整 incident edge
set 写 tombstone。caller 不能选择“只删一部分连线”。

所有创建 identity 的 intent 必须显式携带 schema-defined ordinal；attester 不从数组位置或对象遍历
推断 ordinal。一个 node/edge 的 entity id 与 incarnation 共享同一 ordinal，但通过不同 identityKind
隔离；version 的 parentIdentity 是 familyEntryId，conflict reservation 的 parentIdentity 是
versionId，incarnation 的 parentIdentity 是 entity id，其余为 null。creation group 的
groupOrdinal、各 node/edge identityOrdinal 必须在同一 intent 内互不重复。generationOrdinal、
relationOrdinal、deletionOrdinal 和 Project entry identityOrdinal 也参与同一 operation 的全局 ordinal
唯一性检查。

semantic plan 禁止嵌套 history、最多 256 operations/256 entities/2048 writes/256 KiB，且同一 logical
register path 不得重复写。targetActorId 必须等于当前 ReducerContext actorId；v1 不允许撤销其他成员的
operation。target receipt、exact certified/local target frame 和 target 的 exact logical pre/post base
必须仍在当前 docEpoch retained material 中；checkpoint/working rebuild 清空 UndoManager 且禁止跨
docEpoch history target。target frame 的 request/receipt/kind 必须逐字段等于 guard，且 target kind 必须
属于 CanvasUndoableIntentKindV1。

`deriveSemanticHistoryPlanV1(input)` 是 portable reducer 的规范纯函数；input 是下列封闭对象：
`{mode, historyRootIntent, historyRootPreState, historyRootPostState, historyState,
currentAppliedFrame, lastHistoryFrame, currentBase, currentOperationIdentity}`。history root 永远是 guard
中的原始 undoable operation；frame 为 null 还是 exact retained certified/local frame 由下面状态机唯一
决定。函数先从 root pre/post canonical diff 确定被 root 改变的 semantic fields/entities，再结合
currentApplied/last history frame 的 exact operation receipt/resultEntities mapping 按下表生成唯一 plan。
incoming plan 的完整 JCS 必须逐字节等于 derive 结果，不能只验证其中 guards；因此修改无关 metadata、
遗漏 entity 或添加额外 operation 都拒绝。

首次 undo 时 historyState/currentAppliedFrame/lastHistoryFrame 均为 null，current applied ref 就是
SemanticHistoryTargetV1 指向的 root。redo 时 currentAppliedFrame 必须为 null，lastHistoryFrame 必须是
historyState.lastHistoryOperation 指向的 exact inverse frame。redo 后再次 undo 时
currentAppliedFrame 必须是 historyState.currentApplied 指向的 exact redo frame，lastHistoryFrame 与它
相同；函数使用其 resultEntities/group digest 找到当前 fresh refs。任何 required frame/receipt 缺失、
request digest/intent kind/operation identity 不匹配或跨 checkpoint 都拒绝，不能从当前图形相似度猜
mapping。

| History root kind                     | inverse                                                                                             | forward/redo                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| nodes.create                          | tombstone exact created node 和 inverse-base 中它的全部 live incident edges                         | 用当前 history op ordinals 创建 fresh node identity/incarnation                                |
| nodes.delete                          | 从 target pre-state 创建 fresh nodes、direct incident edges 和仍合法 containment；不恢复 generation | tombstone 上一次 inverse 创建的 exact nodes/incident edges                                     |
| nodes.set-geometry/data/plugin/parent | 写 target pre-value，guard 要求 current 等于 target post-value                                      | 写 target post-value，guard 要求 current 等于 inverse result                                   |
| edges.connect                         | tombstone exact created edge                                                                        | 在 endpoints 仍 live 时创建 fresh edge identity/incarnation                                    |
| edges.delete                          | endpoints 仍 live 时按 target pre-state 创建 fresh edge                                             | tombstone 上一次 inverse 创建的 exact edge                                                     |
| metadata.update                       | 写 target pre-value，guard 要求 current 等于 target post-value                                      | 写 target post-value，guard 要求 current 等于 inverse result                                   |
| plugin.creation-group.create          | tombstone shared group 的全部 node/edge 及这些 node 在 inverse-base 中的全部 live incident edge     | 一个 creation-group.create operation，以 fresh group/node/edge identities 原子创建完整新 group |

所有需要新 identity 的 semantic items 先产生 symbolic HistoryIdentitySlotV1。slot 第二项固定为
canonical history-root operation key，最后一项固定为 root pre/post diff 中的 original entity key；
group 用 root creation-group key，relation 用 original child entity key。所有 slot 必须唯一，按 exact
`JCS(slot)` UTF-8 bytes 严格排序，zero-based array index 的规范十进制字符串就是该 slot 唯一
identityOrdinal。没有 slot 的 operation 不占 ordinal。reducer 重建完整 slot array 并验证每个携带 ordinal，
禁止从 input array index、object enumeration、旧 target ordinal 或 arrival order 推断。

semantic operations 的 total order 固定为下列 JCS tuple 的 UTF-8 byte order：
`[op, primaryEntityKeyOrEmpty, secondaryEntityKeyOrEmpty, metadataFieldOrEmpty,
rootOriginalEntityKeyOrEmpty, historyIdentitySlotOrNull]`。primary/secondary entity key 都是
`[id,incarnation]` 的 JCS；metadata operation 必须把 `title|description|tags` 放入第四项，所以多字段
update 不会 tie；creation-group 使用 group key作为第五项。两个 derived operations 若 tuple 相同即
schema-invalid，不允许用 stable sort 保留 input order。单个 creation-group.create 内 nodes/edges 按
derived `[id,incarnation]` JCS bytes 排序。delete undo 与 creation-group redo 必须用当前 history
operation + slot 创建全新 identity/incarnation；禁止移除 tombstone或复用旧 endpoint。

semanticHistory 的 key 是 target actorId + operationId 的 canonical operation key，value 是同 actor
唯一 slot。首次 undo 要求无 state、expectedHistoryStateDigest=null，且
expectedAppliedOperation 逐字段等于 root target ref；它写
`{status:"undone",currentApplied:null,lastHistoryOperation:current}`。redo 要求 exact canonical state
digest/status=undone/currentApplied=null，并写
`{status:"applied",currentApplied:{actorId,operationId,requestDigest,intentKind:"canvas.redo.semantic-forward"},
lastHistoryOperation:current}`。再次 undo 要求 exact applied digest 且 guard.expectedAppliedOperation
逐字段等于 state.currentApplied；它只作用于该 redo frame 当前映射出的 fresh refs，然后重新写
undone/null。target root 字段始终保持原始 operation，不改指向 last history op。state 的
lastHistoryOperation 必须等于当前 operation identity。history state write 与 domain writes 在同一 intent/
transaction/frame；任一 guard 失败整笔 blocked/rejected，因此 create→undo→redo→undo 不会复用已
tombstone identity，delete 也不会被同一 applied ref 恢复两次。

UI、Agent、Plugin 都只能调用这一层。intent guard 校验 role、scope、entity incarnation、Plugin schema、
resource/content guard 和 bounded payload。Main 必须从 Yjs transaction event 计算 actual changed paths/write-set，
不能信任 caller 声明。

```ts
type CanonicalWritePathV1 =
  | ["meta", "title" | "description" | "tags", ActorIdV1]
  | ["nodes", string, "identity"]
  | ["nodes", string, "creationGroup"]
  | ["nodes", string, "position" | "size" | "data" | "generation" | "plugin", ActorIdV1]
  | ["nodes", string, "tombstones", ActorIdV1]
  | ["edges", string, "identity"]
  | ["edges", string, "creationGroup"]
  | ["edges", string, "data", ActorIdV1]
  | ["edges", string, "tombstones", ActorIdV1]
  | ["containments", string, ActorIdV1]
  | ["semanticHistory", string, ActorIdV1]
  | ["canvases", string, "identity"]
  | ["canvases", string, "names" | "activations" | "tombstones", ActorIdV1]
  | ["entries", string, "identity"]
  | ["entries", string, "locations" | "tombstones", ActorIdV1]
  | ["entries", string, "promotions", string]
  | ["contentFamilies", string, string]
  | ["pluginRequirements", string]
  | ["operations", string]

interface ExpectedWriteV1 {
  path: CanonicalWritePathV1
  action: "set"
  valueDigest: string
}

interface ReducerContextV1 {
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  actor: {
    memberId: string
    actorId: ActorIdV1
    logicalCounter: string
  }
  operationId: OperationIdV1
  requestDigest: string
}

interface ReduceResultV1 {
  logicalPostStateDigest: string
  canonicalProjectionDigest: string
  receipt: BoundedOperationReceiptV1
  expectedWriteSet: ExpectedWriteV1[]
}
```

portable reducer 严格解析 intent、验证 guard、按 semantic output slots 派生 identity，并先生成所有
expected logical write paths。包含 ActorStampV1 的非 receipt writes 按 `JCS(path)` UTF-8 bytes 严格
升序分配 writeOrdinal `"0" ... "2047"`；重复 path 或超限拒绝。operation receipt 固定使用
writeOrdinal `"65535"`，`"2048" ... "65534"` 在 v1 保留且禁止使用。wire 中不存在 caller-selected
ordinary writeOrdinal。reducer 随后生成 expected logical state、receipt 和排序 write-set。candidate
transaction 只能执行该 set；
verifier 从 Yjs transaction events 重算 actual path/action/valueDigest，要求与 expected 完全相同，再
比较 logical/canonical digest。receipt 是最后一个 expected write且不包含 writeSetDigest，避免自哈希。
额外 shared type、额外 path、delete、漏写、重复 path 都拒绝。

identity 和 creationGroup 是 immutable create slots：identity 只能在 enclosing record 于 exact base
不存在时，由同一 create intent 从 absent 写为 present；creationGroup 只能在该 record 的同一 create
transaction 写入。已存在 record 的 set/replace/clear/delete、事后补 creationGroup 均拒绝。普通
non-group create 不产生 creationGroup write。

actual write-set 不直接等于 Yjs observer raw paths。verifier 先以 raw transaction events 确定受影响的
closed-schema roots，再对每个 root 的 exact base/post logical leaves 做 canonical diff：actor-slot/
tombstone map 展开到 actor leaf；immutable record 展开到 identity/creationGroup leaf；content family
展开到 version leaf；receipt/requirement/promotion 展开到 atomic leaf。新增 pre-populated nested
Y.Map 必须展开全部 post-state leaves；“先填充后挂载”和“先挂载后填充”产生同一 normalized set。
parent-map integration event 只是 structural carrier，不单独产生 write；同一 leaf 按 canonical path
去重且 valueDigest 必须相同。base/post 相同却发生 container replace、任意 leaf removal、unknown
shared type、无法映射的 raw affected path 或同 path 不同 digest 都拒绝。normalized set 按 canonical
path bytes 排序后才计算 changedPathsDigest/writeSetDigest，并与 reducer exact-match。

网络接收端必须从 `baseCheckpointDigest` 对应的 attested full update 加上当前 docEpoch 连续 certified
frames `0 ... baseNextLeaf-1` 重建 exact base 并验证 MMR root/state vector。
portable pure reducer 从 typed intent 计算 expected logical post-state；verifier 在隔离 Y.Doc 上 apply
exact delta，从 Yjs events 计算 actual write-set，执行完整 schema/bounds/invariant/canonicalization，
并比较 logical/canonical post-state 与 expected result。不得尝试在 attester 重新生成 byte-identical Yjs
update，因为 client id/struct clock 不属于业务协议。compaction 必须保留当前 checkpoint和验证仍被
未 checkpoint frame 引用的 prior checkpoint；holder 缺少完整 base material时进入
`waiting-for-holder`，不能退化成“update 可以 apply 就接受”。仅能 apply 的 raw delta 不够。

v1 owner limits：typed intent JCS 512 KiB、guard 256 KiB、expected write-set 2048；单 intent 256 nodes/
512 edges，creation group 128 nodes/256 edges；node data 64 KiB/depth 16/2048 values；title 4 KiB、
description 16 KiB、64 tags×256 bytes；canonical URI 16 KiB；generation prompt 64 KiB、failure code
128 bytes、public message 1 KiB；receipt result entity/digest 各 256；每 scalar register 最多 256 actor
slots。geometry 必须 finite，`abs(x|y)<=1e9`、`0<width|height<=1e7`。每 content family live versions
最多 256、DAG records 4096，超限进入 conflict-resolution/storage-pressure，禁止驱逐。

checkpoint semantic compaction 创建 fresh docEpoch Y.Doc，只保留 immutable identities、每 register 的
canonical candidate、live tombstones、未解决 version DAG 和 bounded receipts。attester 验证 fresh full
update 与 sealed prior canonical state 等价后才签证书；各端不得自行清理 Yjs。

## 8. Certified team、local fork、working state 与 UndoManager

每个 shard 同时存在但不得混淆的状态：

| State              | Durable input                                                  | May certify/checkpoint/ACK | Purpose                    |
| ------------------ | -------------------------------------------------------------- | -------------------------- | -------------------------- |
| `certifiedTeamDoc` | certified checkpoint + contiguous admitted exact frames        | yes                        | exact team frontier/base   |
| `localForkJournal` | typed intent + request/guard/blob refs + local receipt         | no                         | offline/local durable work |
| `workingDoc`       | deterministic rebuild of team doc plus surviving local intents | no                         | UI/Agent/Plugin projection |
| `candidateDoc`     | isolated clone of current working or certified base            | no                         | one intent validation only |

remote frame 只能从 `certifiedTeamDoc` exact base 验证并推进 team frontier。team frontier 前进后，Main 从
新 team doc 按 `(actorId, logicalCounter, operationId)` replay local intents；guard 失效者进入有界
blocked list。online admission 必须在 certified base 重新执行；成功后先提交 certified frame，再用
operationId retire local record并重建 workingDoc。禁止把 provisional delta apply 进 certified doc，
也禁止向 provisional delta 补 admission。

恢复/重建 active local set 时，先读取 certified snapshot 的同 scope actor high-water 与 recent
receipts：local logicalCounter 小于等于 high-water 时绝不 replay；有 recent receipt 时 requestDigest
必须相同，否则 equivocation quarantine；receipt 已裁剪时标记 `already-consumed` 并以 team projection
为准。显式 retire 只是日志清理，不是去重正确性的唯一依据。因此 certified head durable 后、retire
local record 前崩溃不会双重应用或重复 admission。

UndoManager 只负责当前 working session 的“选中哪一个本地操作”与 capture 分组：

- tracked origins 只包含当前 member/session 已成功进入 workingDoc 的 Canvas intent；
- `captureTimeout = 0`；
- 一个 intent 是一个 undo item；每个事务显式 `stopCapturing()`；Plugin creation group 不能被拆开；
- remote frame、team rebuild、local rebase replay、hydration、canonical projection 和 Awareness 不进入 undo；
- 不要求跨 App 重启保留 undo stack；working rebuild 后清空。

`UndoManager.undo()` 产生的 candidate diff 只能帮助 owner 计算 inverse，不能作为 wire 意图。Canvas
owner 必须把它物化为 `canvas.undo.semantic-inverse`，显式携带 target operationId、新 entity
identity/incarnation、前置 guards 和 bounded inverse operations；redo 同理物化成新的
`canvas.redo.semantic-forward`。这两个意图都由 pure reducer/attester 在任意 exact base 验证，拥有新的
operationId/counter/frame；协议中不存在 `canvas.history.undo|redo`。

结构删除必须先做原型证明：

1. delete node + incident edges；
2. concurrent remote edge/create/generation；
3. local undo；
4. 所有恢复实体获得新 incarnation，旧 endpoint/result 不复活；
5. 每种 interleaving 的 projection 一致。

如果 Yjs UndoManager 无法稳定给出 owner 可物化的 semantic inverse，结构删除不进入 UndoManager
capture；该操作在本 session 标记为不可 undo。禁止发送依赖 sender 私有 UndoManager stack 才能解释的
frame，也禁止为“统一使用 UndoManager”牺牲不变量。

## 9. Snapshot、journal 和 checkpoint

本地 store 把团队认证历史和本地 provisional 分支物理分开：

```text
.convax/collaboration/
  documents/<document-native-stem>/
    certified-team/snapshot.bin
    certified-team/journal/<segment-key>.bin
    certified-team/durable-head
    admission-outbox/<operation-native-key>.bin
    abandonment-outbox/<operation-native-key>.bin
    checkpoint-outbox/<doc-epoch-native-key>.bin
    local-fork/journal/<segment-key>.bin
    local-fork/durable-head
  quarantine/
  blob-replication/
```

任何 wire id 都不得直接成为 native path component：

```ts
interface ProjectNativeScopeV1 {
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
}

type DocumentNativeScopeV1 =
  | {
      docKind: "project-index"
      docId: "project-index"
      shardEpoch: EpochIdV1
    }
  | {
      docKind: "canvas"
      docId: CanvasIdV1
      shardEpoch: EpochIdV1
    }

type NativeStoreKeyInputV1 =
  | {
      format: "convax.native-store-key-input/1"
      namespace: "document"
      project: ProjectNativeScopeV1
      document: DocumentNativeScopeV1
    }
  | {
      format: "convax.native-store-key-input/1"
      namespace: "admission-outbox" | "abandonment-outbox"
      project: ProjectNativeScopeV1
      document: DocumentNativeScopeV1
      operation: OperationIdentityV1
    }
  | {
      format: "convax.native-store-key-input/1"
      namespace: "checkpoint-outbox"
      project: ProjectNativeScopeV1
      document: DocumentNativeScopeV1
      docEpoch: EpochIdV1
    }
  | {
      format: "convax.native-store-key-input/1"
      namespace: "blob-replication"
      project: ProjectNativeScopeV1
      blobHash: string
    }

interface SegmentKeyInputV1 {
  format: "convax.segment-key-input/1"
  storeKind: "certified-team" | "local-fork"
  segmentSequence: string
}

type SegmentKeyV1 = `s1-${string}`
```

`nativeKey = "k1-" + lowercaseHex(SHA-256("convax.native-store-key/1\0" ||
u32be(JCS(input).length) || JCS(input)))`，JCS input 最大 4 KiB。filename 只能是 nativeKey 加固定
`.bin`；不能包含 wire id、用户扩展名、Unicode、percent decode 或 separator。打开后从 envelope header
重算 key；不匹配、同 key 不同 header 或 collision 进入 quarantine。node adapter 还必须 no-follow、
containment/realpath、no-clobber atomic publish 与 directory fsync。

每个 variant 是 closed object；unknown key、namespace/field cross-product、非 canonical id/hash 在
hash 前拒绝。blob-replication 是 Project scope，不伪造 doc scope。segment key 不是 wire id：
`segmentKey = "s1-" + u64be(segmentSequence)` 的 16 lowercase hex。每个 document native key 和
storeKind 独立从 `"0"` 开始，durable head 同时保存互相可解码的 segmentKey/segmentSequence，新
segment 只能 previous+1；overflow read-only。compaction 也分配下一 sequence，不复用、不覆盖。

local fork kind `4` 是每 operation 自包含的封闭状态：

```ts
interface LocalOperationKeyV1 {
  format: "convax.local-operation-key/1"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  memberId: string
  actorId: ActorIdV1
  logicalCounter: string
  operationId: OperationIdV1
  requestDigest: string
}

interface ReplayMaterialV1 {
  intentKind: TypedIntentV1["kind"]
  intentSchema: "convax.typed-intent/1"
  intentDigest: string
  guardDigest: string
  observedCertifiedFrontier: CertifiedDocumentFrontierV1
  requiredBlobHashes: string[]
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
}

type LocalForkRecordV1 =
  | {
      format: "convax.local-fork-record/1"
      state: "replayable"
      operation: LocalOperationKeyV1
      material: ReplayMaterialV1
    }
  | {
      format: "convax.local-fork-record/1"
      state: "blocked"
      operation: LocalOperationKeyV1
      material: ReplayMaterialV1
      reason: "guard-stale" | "causal-base-unavailable" | "plugin-schema-mismatch" | "missing-blob"
    }
  | {
      format: "convax.local-fork-record/1"
      state: "abandonment-pending"
      operation: LocalOperationKeyV1
      abandonmentIntent: {
        format: "convax.abandonment-intent/1"
        reason: "guard-stale" | "user-discarded"
        discardedIntentDigest: string
      }
    }
  | {
      format: "convax.local-fork-record/1"
      state: "retired-admitted"
      operation: LocalOperationKeyV1
      admissionDigest: string
      finalFrameDigest: string
    }
  | {
      format: "convax.local-fork-record/1"
      state: "retired-abandoned"
      operation: LocalOperationKeyV1
      actorCounterAbandonmentDigest: string
    }
```

kind 4 payload grammar 固定为：

```text
state replayable | blocked:
  u32be intentLength
  intentLength bytes exact JCS TypedIntentV1

state abandonment-pending | retired-admitted | retired-abandoned:
  empty payload
```

intentLength 必须为 `1..524288` 且 `4 + intentLength === envelope.payloadLength`；禁止 trailing
bytes。payload 只有一份完整 typed intent，不单独重复 guard；guard 是 decoded intent.guard。
material.intentSchema、intentKind、intentDigest 和 guardDigest 必须分别等于唯一 token、decoded
intent.kind、operation.requestDigest/requestDigest(exact intent) 与 guardDigest(exact intent.guard)。
replayable↔blocked 只改变 header state/reason，payload bytes 和 operation/material identity 必须逐字节
不变。其他三种 state 的任意非空 payload 都拒绝。local-fork compaction 复制 exact payload bytes，
禁止重新编码逻辑等价 intent。

允许迁移只有 `absent→replayable`、`replayable↔blocked`、
`replayable|blocked→abandonment-pending|retired-admitted`、
`abandonment-pending→retired-abandoned`。scope/counter/operation/request/intent digest 不得改变，
terminal 不得退出。

replayable/blocked payload 包含一份 exact typed intent；guard 已封闭地包含在 intent 内并由
guardDigest 单独绑定。abandonment-pending 不再 replay，但
必须保留到 service terminal。requiredBlobHashes 最多 256 个 lowercase digest-byte 排序去重。
compaction 每 operation 写一条自包含最新状态：pending 必须保留；retired-admitted 仅在 exact certified
frame/head durable且 receipt mask 匹配后删除；retired-abandoned 仅在 certified abandonment record
durable且后续 checkpoint ReceiptIndex 覆盖后删除。容量不足进入 read-only，不得驱逐 pending/terminal
proof。

certified team journal 同时允许 kind `1` admitted frame 与 kind `8` exact
ActorCounterAbandonmentV1 terminal record。kind 8 不改变 Y.Doc/MMR leaf，但推进 ReceiptIndex high-water，
通过 PeerTerminalRecord/actor-terminal-range 在 peers 间复制；inventory 从 checkpoint ReceiptIndex
high-water 给出每 actor 的 exact terminal suffix root。checkpoint suffix 必须包含构造 receipt index
所需的全部 terminal record，kind 8 永远没有 leafIndex；kind 1 可同时作为 MMR leaf 与 terminal record，
但 exact frame digest 必须相同。

旧的 action-based append/retire/block/discard header 被删除；出现即拒绝。

online admission 前写 kind `5` outbox：

```ts
interface AdmissionOutboxHeaderV1 {
  format: "convax.admission-outbox/1"
  core: IntentCoreHeaderV1
  coreDigest: string
  clientSignature: string
}
```

payload 与 certified frame core payload 完全相同。outbox whole-envelope fsync 及 parent directory durable
barrier 完成后才可调用 admission；service commit 后 response 丢失时，客户端以
`{actorId, operationId}` 查询完整 AdmissionCertificateV1 并组合 final frame。outbox 只有在 certified
frame/head durable 且 working recovery 已用 scoped high-water 屏蔽 local record 后才可删除。残留
outbox 可幂等恢复，不是 team frontier。

discard/blocked counter 在调用 service 前写 kind `7`：

```ts
interface AbandonmentOutboxHeaderV1 {
  format: "convax.abandonment-outbox/1"
  request: ActorCounterAbandonmentRequestV1
  abandonmentRequestDigest: string
}
```

用户 discard 先 durable `abandonment-pending` 并从 working projection 隐藏，再在当前有效 session 下
构造、fsync abandonment outbox；service commit 后用 outbox + exact certificate 构造 kind 8，
fsync certified journal/head，再写 retired-abandoned，最后删除 outbox。任一 response-loss 通过
OperationLookupReceiptV1 恢复同一 terminal；后续 counter 必须停在最早 pending。revoked member 的
pending branch 只能保留/导出，不能由另一个 actor 推进。
abandonmentRequestDigest 对完整 client-signed request 使用
`convax.actor-counter-abandonment-request-digest/1` domain；kind 7 payload 必须为空。

genesis/checkpoint 请求前写 kind `6` outbox：

```ts
interface ProjectIndexRouteFenceV1 {
  format: "convax.project-index-route-fence/1"
  projectId: string
  projectEpoch: string
  frontier: ProjectIndexFrontier
  route: {
    canvasId: string
    shardEpoch: string
    routeDigest: string
    state: "staged" | "live" | "closed"
  }
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: string
  serviceSignature: string
}

type ProjectIndexBindingV1 =
  | { kind: "project-index-genesis"; frontier: null }
  | {
      kind: "project-index-prior"
      frontier: ProjectIndexFrontier
      indexCheckpoint: CheckpointCertificateV1
    }
  | {
      kind: "canvas-staged-route"
      frontier: ProjectIndexFrontier
      indexCheckpoint: CheckpointCertificateV1
      routeFence: ProjectIndexRouteFenceV1
    }
  | {
      kind: "canvas-live-route"
      frontier: ProjectIndexFrontier
      indexCheckpoint: CheckpointCertificateV1
      routeFence: ProjectIndexRouteFenceV1
    }

declare function projectIndexFrontierFromCheckpoint(
  certificate: CheckpointCertificateV1,
  route: ProjectIndexFrontier["route"],
): ProjectIndexFrontier

interface CheckpointOutboxCommonV1 {
  format: "convax.checkpoint-outbox/1"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  sealedNextLeaf: string
  sealedMmrRoot: string
  newDocEpoch: string
  fullUpdateHash: string
  stateVectorHash: string
  canonicalStateHash: string
  receiptRoot: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  projectIndexBinding: ProjectIndexBindingV1
  projectIndexBindingDigest: string
}

type CheckpointOutboxHeaderV1 =
  | (CheckpointOutboxCommonV1 & {
      kind: "genesis"
      checkpointEpochReservationDigest: null
      priorDocEpoch: null
      priorCheckpointDigest: null
    })
  | (CheckpointOutboxCommonV1 & {
      kind: "rollover"
      checkpointEpochReservationDigest: string
      priorDocEpoch: string
      priorCheckpointDigest: string
    })

interface CanvasGenesisReservationRequestV1 {
  format: "convax.canvas-genesis-reservation-request/1"
  mutationId: RandomId128V1
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  observedProjectIndexCheckpointDigest: string
  observedProjectIndexCanonicalStateHash: string
  credentialDigest: string
  sessionNonce: Nonce128V1
  sessionSequence: string
  signature: string
}

interface CanvasGenesisReservationV1 {
  format: "convax.canvas-genesis-reservation/1"
  mutationId: RandomId128V1
  canvasGenesisReservationRequestDigest: string
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  observedProjectIndexCheckpointDigest: string
  observedProjectIndexCanonicalStateHash: string
  canvasId: CanvasIdV1
  shardEpoch: EpochIdV1
  docEpoch: EpochIdV1
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

interface CheckpointEpochReservationRequestV1 {
  format: "convax.checkpoint-epoch-reservation-request/1"
  mutationId: RandomId128V1
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: EpochIdV1
  priorDocEpoch: EpochIdV1
  priorCheckpointDigest: string
  credentialDigest: string
  sessionNonce: Nonce128V1
  sessionSequence: string
  signature: string
}

interface CheckpointEpochReservationV1 {
  format: "convax.checkpoint-epoch-reservation/1"
  mutationId: RandomId128V1
  checkpointEpochReservationRequestDigest: string
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: EpochIdV1
  priorDocEpoch: EpochIdV1
  priorCheckpointDigest: string
  newDocEpoch: EpochIdV1
  issuedAtUnixMs: string
  expiresAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

interface CheckpointRequestProofV1 {
  format: "convax.checkpoint-request-proof/1"
  projectId: string
  projectEpoch: string
  credentialDigest: string
  sessionNonce: string
  sessionSequence: string
  checkpointOutboxDigest: string
  signature: string
}

interface CheckpointFrontierLookupRequestV1 {
  format: "convax.checkpoint-frontier-lookup-request/1"
  projectId: ProjectIdV1
  projectEpoch: EpochIdV1
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: EpochIdV1
  checkpointOutboxDigest: string
  credentialDigest: string
  sessionNonce: string
  sessionSequence: string
  signature: string
}

interface CheckpointFrontierReceiptCommonV1 {
  format: "convax.checkpoint-frontier-receipt/1"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  checkpointOutboxDigest: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: ServiceKeyIdV1
  serviceSignature: string
}

type CheckpointFrontierReceiptV1 =
  | (CheckpointFrontierReceiptCommonV1 & {
      status: "not-committed"
      checkpointDigest: null
      certificate: null
      projectIndexBindingDigest: null
      boundProjectIndexFrontier: null
      expectedSnapshotDigest: null
      holderReceiptDigests: null
    })
  | (CheckpointFrontierReceiptCommonV1 & {
      status: "awaiting-holder"
      checkpointDigest: string
      certificate: CheckpointCertificateV1
      projectIndexBindingDigest: string
      boundProjectIndexFrontier: ProjectIndexFrontier | null
      expectedSnapshotDigest: string
      holderReceiptDigests: []
    })
  | (CheckpointFrontierReceiptCommonV1 & {
      status: "holder-confirmed"
      checkpointDigest: string
      certificate: CheckpointCertificateV1
      projectIndexBindingDigest: string
      boundProjectIndexFrontier: ProjectIndexFrontier | null
      expectedSnapshotDigest: string
      holderReceiptDigests: string[]
    })
```

genesis 的两个 prior 字段为 null、sealedNextLeaf 为 `"0"`、sealedMmrRoot 为空 root；rollover variant
不允许 null。payload 与 Snapshot payload 完全相同。outbox whole-envelope 和 directory barrier durable 后才可
请求 checkpoint；service durable 保存 certificate/frontier，response-loss 时只接受
CheckpointFrontierLookupRequestV1 并按 path/body 中相同的 checkpointOutboxDigest 返回 exact
CheckpointFrontierReceiptV1，holder 用 staged payload 构造 final snapshot。checkpoint outbox 只有 final snapshot/head
durable 后可删除。非 create/reset 的 checkpoint request 必须携带由当前 editor session key 签名的
CheckpointRequestProofV1；signature 使用其 format domain + unsigned JCS digest。
lookup request 同样由 active session key 对 format domain + unsigned JCS 签名；path project/outbox、
body scope/outbox 和 credential/session 必须逐字段一致。generic latest frontier endpoint 只用于
bootstrap/inventory，不能用于 outbox response-loss。

regular rollover checkpoint 在构造 outbox 前必须先提交 session-signed
CheckpointEpochReservationRequestV1。service 在同一 current-editor/scope/prior-checkpoint transaction
验证后分配 random newDocEpoch，并签最长 5 分钟的 CheckpointEpochReservationV1；same mutationId +
same request digest 幂等返回 exact reservation，不同 digest 拒绝。outbox 的 newDocEpoch 和
checkpointEpochReservationDigest 必须逐字段匹配 reservation；service 只允许第一个对 prior frontier
成功 CAS 的未过期 reservation消费，其他并发 reservation 返回 stale-prior。genesis 的 initial docEpoch
由 create/reset 或下述 Canvas genesis reservation 分配，所以 reservation digest 必须 null。Main、
renderer、Plugin 不能自行选择 service-owned regular newDocEpoch。

首个 Canvas 的 closed lifecycle 不允许 route/checkpoint 互相循环：

1. active editor 以当前 ProjectIndex checkpoint/state hash 请求
   CanvasGenesisReservationV1；service 原子验证 current editor/frontier，分配随机
   `{canvasId,shardEpoch,docEpoch}`，签发最长 5 分钟 reservation。same mutationId + same request digest
   幂等返回 exact reservation，不同 digest 拒绝；
2. Main 用这些 id 构造规范空 Canvas full update、state vector、canonical state、empty ReceiptIndex，
   fsync staged payload，并计算 CanvasGenesisDescriptorV1；
3. `project.canvas.create-route` 把 exact descriptor 写成 staged route；该 ProjectIndex frame durable/
   admitted 后必须完成 ProjectIndex checkpoint；
4. service 针对该 exact signed Index checkpoint 发布 state=staged 的 ProjectIndexRouteFenceV1；
5. Main 用 staged fence 构造 `kind:"genesis"` checkpoint outbox，binding 必须是
   `canvas-staged-route`，fsync 后请求 Canvas genesis certificate并发布 snapshot；
6. `project.canvas.activate-route` 绑定 exact certificate/outbox，ProjectIndex checkpoint 完成后 service
   发布 state=live fence；
7. 只有 exact live fence durable 后，service 才接受该 Canvas 的普通 admission、rollover 或 peer
   inventory 宣告；staged 超时不自动删除，必须由后续显式 ProjectIndex tombstone 关闭。

reservation request 的 observed ProjectIndex checkpoint/state 必须等于 service current durable
ProjectIndex frontier，且该 frontier route 为 null；reservation consumption 以 signed descriptor +
staged route identity 为准。step 3/6 的 response-loss 通过普通 operation lookup 恢复，step 5 通过
checkpoint outbox lookup 恢复。任一步失败都不能跳过下一道 signed fence，也不能把 staged route 当 live。

projectIndexBindingDigest 使用其 format domain + exact binding JCS；binding 最多 48 KiB、outbox header
最多 64 KiB。`projectIndexFrontierFromCheckpoint` 固定复制 certificate 的 shardEpoch、
genesis docEpoch/rollover newDocEpoch、checkpointSequence、signed certificate digest、
canonicalStateHash，并把 mmrNextLeaf 固定为 `"0"`、mmrRoot 固定为 genesis mmrRoot/rollover
newMmrRoot，再附入参数 route；比较只用 exact JCS bytes。

ProjectIndex genesis 只允许 null。ProjectIndex rollover 的 binding frontier.route 必须 null，且等于从
该 shard 当前 durable indexCheckpoint 派生的 frontier。Canvas genesis 只允许
`canvas-staged-route`，Canvas rollover 只允许 `canvas-live-route`。两种 Canvas binding 都必须同时满足：frontier 等于
routeFence.frontier；frontier.route 等于 routeFence.route；又等于从 exact indexCheckpoint +
routeFence.route 派生的 frontier；route 的 canvasId/shardEpoch 等于 outbox doc scope；genesis 的 state
必须是 staged，rollover 的 state 必须是 live。fence project/epoch/checkpoint/routeDigest 等于 service
当前 durable exact-state route-fence record。历史 fence、混搭合法签名对象和先到的 tombstone 均拒绝，
service 不能替换成另一个“当前 frontier”。
任意 ProjectIndexRouteFenceV1（包括 closed record）都要求 frontier.route 与 route exact JCS 相等；
staged 只能绑定一次 exact Canvas genesis，live 才能绑定 Canvas frame/rollover；closed 只能用于
fencing/bootstrap status，不能绑定新的 Canvas frame/checkpoint。

committed CheckpointFrontierReceiptV1 必须让 checkpointDigest 等于 digest(certificate)，receipt scope、
outbox digest、binding digest 和 bound frontier 分别逐字段等于 certificate；expectedSnapshotDigest
等于 service 从 exact staged payload + certificate 计算的 snapshot digest。not-committed 的六个
certificate/publication fields 必须为 null；awaiting-holder 的 holderReceiptDigests 必须为空；
holder-confirmed 必须是按 digest bytes 排序去重的非空数组，且每项对应 service 已验证并 durable
记录的 exact current CheckpointPublicationReceiptV1；最多 16 个不同 holderMemberId，同 member credential
renewal 必须 CAS 替换其旧 digest而不增加数量。第 17 个不同 holder 拒绝，不能驱逐现有 member 来腾位。
违反任一项进入 service-equivocation quarantine。frontier
lookup 只接受 original outbox 的 committed receipt，不得拿 latest result 替代。

Snapshot final JCS header：

```ts
interface CollaborationSnapshotHeaderV1 {
  format: "convax.collaboration-snapshot/1"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  docEpoch: string
  mmrNextLeaf: string
  mmrRoot: string
  fullUpdateHash: string
  stateVectorHash: string
  canonicalStateHash: string
  receiptRoot: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  checkpointCertificate: CheckpointCertificateV1
}
```

Snapshot payload：

```text
u32be fullUpdateLength + Y.encodeStateAsUpdate bytes
u32be stateVectorLength + state vector bytes
u32be receiptIndexLength + bounded JCS receipt/high-water index bytes
```

receipt index 的 doc/shard scope 来自 snapshot header：

```ts
interface ReceiptIndexV1 {
  format: "convax.receipt-index/1"
  actors: Array<{
    actorId: string
    highWater: string
    recentReceipts: Array<{
      logicalCounter: string
      operationId: string
      requestDigest: string
      terminal: "admitted" | "abandoned"
      resultDigest: string
    }>
  }>
}
```

actors 按 actorId、receipts 按 logicalCounter 严格递增；actor 唯一、counter 唯一且最后一项不超过
highWater；非空 recentReceipts 必须是截至 highWater 的连续 suffix，admission/abandonment 都占一个
counter。每 snapshot actors <= 256，每 actor receipts <= 4096。schema/parser 拒绝乱序、重复、gap
和 unknown key。terminal `admitted` 的 resultDigest 必须等于对应 admissionDigest；terminal
`abandoned` 必须等于对应 actorCounterAbandonmentDigest。`receiptRoot` 对 exact full
ReceiptIndexV1 JCS 求摘要。

MMR 的 `nextLeaf` 是叶子数量，不使用 `throughLeaf=-1` sentinel。每个 docEpoch 从空 MMR
`nextLeaf=0` 开始；该 epoch 的连续 suffix 恰好是 leaf `0 ... nextLeaf-1`。

Checkpoint certificate 是 service-signed tagged union。genesis 为一个新 shard/docEpoch 建立唯一空
frontier：

```ts
interface GenesisCheckpointCertificateV1 {
  format: "convax.collaboration-checkpoint/1"
  kind: "genesis"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  docEpoch: string
  checkpointOutboxDigest: string
  projectIndexBindingDigest: string
  mmrNextLeaf: "0"
  mmrRoot: string
  boundProjectIndexFrontier: ProjectIndexFrontier | null
  fullUpdateHash: string
  stateVectorHash: string
  canonicalStateHash: string
  receiptRoot: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  checkpointSequence: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: string
  serviceSignature: string
}

interface RolloverCheckpointCertificateV1 {
  format: "convax.collaboration-checkpoint/1"
  kind: "rollover"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  checkpointOutboxDigest: string
  projectIndexBindingDigest: string
  checkpointEpochReservationDigest: string
  priorDocEpoch: string
  priorCheckpointDigest: string
  sealedNextLeaf: string
  sealedMmrRoot: string
  newDocEpoch: string
  newMmrRoot: string
  boundProjectIndexFrontier: ProjectIndexFrontier
  fullUpdateHash: string
  stateVectorHash: string
  canonicalStateHash: string
  receiptRoot: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
  validationArtifactDigest: string
  checkpointSequence: string
  issuedAtUnixMs: string
  trustBundleDigest: string
  serviceKeyPurpose: "checkpoint"
  serviceKeyId: string
  serviceSignature: string
}

type CheckpointCertificateV1 = GenesisCheckpointCertificateV1 | RolloverCheckpointCertificateV1

interface CheckpointPublicationReceiptV1 {
  format: "convax.checkpoint-publication-receipt/1"
  publicationMutationId: RandomId128V1
  priorHolderReceiptDigest: string | null
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  docEpoch: string
  checkpointOutboxDigest: string
  checkpointDigest: string
  snapshotDigest: string
  durableHeadDigest: string
  holderMemberId: string
  credentialDigest: string
  sessionId: SessionIdV1
  sessionNonce: string
  sessionSequence: string
  signature: string
}
```

genesis `mmrRoot` 和 rollover `newMmrRoot` 都必须等于第 2.5 节空树 root。ProjectIndex genesis 的
`boundProjectIndexFrontier` 为 null；Canvas genesis 必须绑定一个已 attested staged route，只有
genesis certificate 被随后写入 route activation 并经 ProjectIndex checkpoint attested 后，route 才变为 live。genesis
checkpointSequence 固定为 `"0"`；同 shard 每次 rollover 必须精确等于 prior sequence + 1。rollover
attester 从 `priorCheckpointDigest` 对应的 priorDocEpoch snapshot 开始，取得并验证该 epoch leaf
`0 ... sealedNextLeaf-1` 的完整连续 admitted frames，重算 core/signature/certificate/MMR、
intent/delta equivalence 和 canonical state。缺 leaf、重复 leaf、root mismatch、Index proof 过旧或
checkpoint sequence rollback 全部拒绝。

rollover 的 `fullUpdateHash/stateVectorHash/canonicalStateHash/receiptRoot` 是 sealed prior epoch 执行完
上述 prefix 后的状态，也是 newDocEpoch 的 genesis snapshot 内容。new epoch 的第一个 frame 使用
`baseCheckpointDigest = digest(this signed certificate)`、`baseNextLeaf = "0"` 和 empty root；之后只需
从该 snapshot replay leaf `0 ... baseNextLeaf-1`。`sealedNextLeaf/sealedMmrRoot` 永远属于 priorDocEpoch，
不能解释成 newDocEpoch 的 prefix。

`boundProjectIndexFrontier` 避免自引用：ProjectIndex rollover 绑定 checkpoint 前的自身 certified
frontier；签名完成后才由 certificate 构造新的 `ProjectIndexFrontier`，其 `checkpointDigest` 是完整
signed certificate digest、`docEpoch=newDocEpoch`、`mmrNextLeaf="0"`、root=empty、route=null。
Canvas rollover 绑定当前已 attested live Index route。tombstoned route 只能封存旧 checkpoint，不能签
新 live epoch。

RolloverCheckpointCertificateV1.checkpointEpochReservationDigest 必须引用 exact
CheckpointEpochReservationV1；certificate/outbox/reservation 的 Project、doc kind/id、shardEpoch、
priorDocEpoch、priorCheckpointDigest 与 newDocEpoch 必须逐字段相同，reservation 必须未过期且由当前
checkpoint-purpose trust key 签名。service 对 prior checkpoint 做单次 CAS 消费；same outbox digest
幂等返回同一 certificate，任何另一个 reservation 或 outbox 对相同 prior frontier 都返回 stale-prior。

service 对每 doc scope durable 保存 exact
`{checkpointOutboxDigest, checkpointDigest, certificate, projectIndexBindingDigest,
expectedSnapshotDigest, publicationState, holderReceiptDigests}`，不保存 snapshot/Yjs bytes。holder
set 是最多 16 个 member 的 map，每个 holderMemberId 只保留一个 current receipt digest，不是追加不清的
credential 历史。service 在
attestation request 期间从 exact staged payload + final certificate 计算 expectedSnapshotDigest。
holder 在 snapshot/head fsync 后用 active non-revoked credential-bound session key 对
`"convax.checkpoint-publication-receipt/1\0" || SHA-256(JCS(unsigned receipt))` 签名。service 必须验证
credential/member/session/scope/docEpoch/outbox/certificate/snapshot digest 全部等于 exact
awaiting-holder record；durableHeadDigest 是 holder 的签名 assertion，不宣称 service 验证过物理磁盘。
首次 publication 的 priorHolderReceiptDigest 必须为 null；credential/session 轮换后，同一当前 member
可对同一 exact snapshot 重新 publication，priorHolderReceiptDigest 必须等于 service 当前为该 member
保存的 digest。service 以 publicationMutationId + full request digest 幂等，同 mutationId 不同 bytes
拒绝；valid renewal 以 CAS 原子替换该 member 的旧 digest并重新签 holder-confirmed
CheckpointFrontierReceiptV1，checkpoint/snapshot/outbox 不变。并发 renewal 只有一个 prior CAS 成功，
loser 读取新 frontier 后重签。任一 current active viewer/editor member 都可 renewal，因为它只刷新
同一 exact snapshot 的 possession assertion、不授予 edit/checkpoint authority；revoked/inactive member
不能 renewal。valid initial receipt 原子执行
awaiting-holder→holder-confirmed；valid renewal 保持 holder-confirmed。任何不匹配不改变 retention。
每 scope 最多 16 个 awaiting-holder，超限拒绝新 checkpoint，不驱逐。至少一个 holder-confirmed 前不得
裁剪 outbox→certificate mapping；裁剪后仍永久保留当前 scope certificate。response-loss 固定用原
outbox digest取回 certificate并与 staged bytes 组装，禁止重编码。

Durable head 是 kind `3` 的同 envelope、空 payload。certified store 与 local-fork store 使用不同的
封闭 union；local fork 没有 snapshot/docEpoch，不能伪造一个 snapshotDigest：

```ts
interface CertifiedDurableHeadCommonV1 {
  format: "convax.collaboration-durable-head/1"
  storeKind: "certified-team"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  docEpoch: string
  commitSeq: string
  snapshotDigest: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
}

type CertifiedDurableHeadV1 =
  | (CertifiedDurableHeadCommonV1 & {
      state: "snapshot-only"
      predecessor: { kind: "genesis" } | { kind: "compaction"; priorHeadDigest: string }
    })
  | (CertifiedDurableHeadCommonV1 & {
      state: "journal"
      priorHeadDigest: string
      finalRecordKind: "certified-intent" | "certified-abandonment"
      finalRecordDigest: string
      segmentKey: SegmentKeyV1
      segmentSequence: string
      committedEndOffset: string
      committedRecordCount: string
    })

interface LocalForkDurableHeadCommonV1 {
  format: "convax.collaboration-durable-head/1"
  storeKind: "local-fork"
  projectId: string
  projectEpoch: string
  docKind: "project-index" | "canvas"
  docId: string
  shardEpoch: string
  commitSeq: string
  protocolDigest: string
  schemaDigest: string
  canonicalizerDigest: string
}

type LocalForkDurableHeadV1 =
  | (LocalForkDurableHeadCommonV1 & {
      state: "empty"
      predecessor: { kind: "genesis" } | { kind: "compaction"; priorHeadDigest: string }
    })
  | (LocalForkDurableHeadCommonV1 & {
      state: "journal"
      publication: "append" | "compaction"
      priorHeadDigest: string
      finalRecordDigest: string
      segmentKey: SegmentKeyV1
      segmentSequence: string
      committedEndOffset: string
      committedRecordCount: string
    })

type DurableHeadV1 = CertifiedDurableHeadV1 | LocalForkDurableHeadV1
```

- snapshot 使用相同 fixed binary envelope；payload 只包含 `Y.encodeStateAsUpdate`、state vector 与
  bounded receipt index，checkpoint certificate 只在 final JCS header；
- certified journal record 是完整 kind `1` 或 kind `8` `CVXCOLL1` frame；local fork 是 kind `4`；
- local fork compaction 按本节状态机保留每 operation 的一条自包含 latest record；没有 active/pinned
  record 时
  发布 `state:"empty"`。它不重锚或复制 certified snapshot，rebuild 总是读取当前 certified head后再
  replay active local intents；
- fsync segment 后以 expected `priorHeadDigest` CAS 原子更新并 fsync durable-head；
- 只有 segment fsync、durable-head CAS+fsync、目标 doc apply/rebuild 和 projection hash 验证全部成功，
  才能返回 `local-saved`；head 前 crash 的 record 从未确认，head 后 response 前 crash 通过 operation
  receipt 返回既有结果；
- `committedEndOffset` 是 segment 中最后已提交 record 之后的 byte offset。append/fsync 后若 CAS/head
  fsync 失败，writer 立即 fail-stop；取得同一 lease 后必须把 segment truncate 到旧 offset并 fsync，
  或把整个 tail 移入 quarantine并重新建 segment。完成前禁止 append 新 record，后续 head 不能跨过
  失败 tail；
- 启动只读取 durable-head 精确范围内 records，head 后完整/断裂 tail 从未 ACK，按上一条恢复；
  head 范围内任一损坏进入 corrupt fail-closed；
- single writer lease 防止两个 Desktop 进程写同一 Project；无 lease 只能 read-only；
- compaction 写新 snapshot、fsync、原子 publish，再删除已被 attested checkpoint 覆盖的旧 segment；
- 删除旧 segment 前必须证明 snapshot + retained suffix 能恢复相同 state vector；
- checkpoint 保留每 scoped actor 的 admitted logicalCounter high-water 和 bounded recent exact receipts。低于
  high-water 的旧 operation 不得重新执行；若完整 result 已裁剪，返回 `already-committed/reload-projection`。
- durable head 已成功后，certified apply、working rebuild 或 projection hash mismatch 都进入
  recovery-required，禁止继续写入、ACK 或 GC。

### 9.1 Digest registry

所有未另行说明的 digest 都是 lowercase SHA-256 hex。JCS signed object 的 signature preimage 固定为
`UTF8(object.format) || 0x00 || SHA-256(JCS(object without its signature field))`；Ed25519 key/signature
先 unpadded base64url decode并检查规范长度。artifact digest 则包含签名后的完整对象：

| Name                                      | Exact preimage                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trustBundleDigest`                       | `concat(UTF8("convax.service-trust-bundle-digest/1\0"), JCS(full root-signed ServiceTrustBundleV1))`                                                      |
| `serviceTrustBootstrapDigest`             | `concat(UTF8("convax.service-trust-bootstrap-digest/1\0"), JCS(full root-signed ServiceTrustBootstrapV1))`                                                |
| `bootstrapPageRequestDigest`              | `concat(UTF8("convax.service-trust-bootstrap-page-request-digest/1\0"), JCS(exact ServiceTrustBootstrapPageRequestV1))`                                   |
| `adminCapabilityDigest`                   | `concat(UTF8("convax.membership-admin-capability/1\0"), decoded canonical 32-byte admin secret)`                                                          |
| `inviteSecretDigest`                      | `concat(UTF8("convax.invite-secret/1\0"), decoded canonical 32-byte invite secret)`                                                                       |
| `membershipAdminRequestDigest`            | `concat(UTF8("convax.membership-admin-request-digest/1\0"), JCS(exact MembershipAdminRequestV1))`                                                         |
| `identityChallengeDigest`                 | `concat(UTF8("convax.identity-challenge-digest/1\0"), JCS(full signed IdentityChallengeV1))`                                                              |
| `rolloverChallengeRequestDigest`          | `concat(UTF8("convax.project-epoch-rollover-challenge-request-digest/1\0"), JCS(full member-signed ProjectEpochRolloverChallengeRequestV1))`              |
| `rolloverChallengeDigest`                 | `concat(UTF8("convax.project-epoch-rollover-challenge-digest/1\0"), JCS(full signed ProjectEpochRolloverChallengeV1))`                                    |
| `bootstrapRecoveryChallengeDigest`        | `concat(UTF8("convax.bootstrap-recovery-challenge-digest/1\0"), JCS(full signed BootstrapRecoveryChallengeV1))`                                           |
| `bootstrapRecoveryReceiptDigest`          | `concat(UTF8("convax.bootstrap-recovery-receipt-digest/1\0"), JCS(full signed BootstrapRecoveryReceiptV1))`                                               |
| `credentialDigest`                        | `concat(UTF8("convax.membership-credential-digest/1\0"), JCS(full signed MembershipCredentialV1))`                                                        |
| `membershipSnapshotDigest`                | `concat(UTF8("convax.membership-snapshot-digest/1\0"), JCS(full signed MembershipSnapshotV1))`                                                            |
| `projectInviteDigest`                     | `concat(UTF8("convax.project-invite-digest/1\0"), JCS(full signed ProjectInviteV1))`                                                                      |
| `inviteRevocationReceiptDigest`           | `concat(UTF8("convax.project-invite-revocation-receipt-digest/1\0"), JCS(full signed ProjectInviteRevocationReceiptV1))`                                  |
| `membershipMutationReceiptDigest`         | `concat(UTF8("convax.membership-mutation-receipt-digest/1\0"), JCS(full signed MembershipMutationReceiptV1))`                                             |
| `peerFreshnessTicketDigest`               | `concat(UTF8("convax.peer-freshness-ticket-digest/1\0"), JCS(full signed PeerFreshnessTicketV1))`                                                         |
| `coreDigest`                              | `concat(UTF8("convax.intent-core/1\0"), u32be(coreHeaderLength), coreHeaderBytes, corePayloadBytes)`                                                      |
| `clientSignatureDigest`                   | `concat(UTF8("convax.intent-client-signature-digest/1\0"), decoded 64-byte Ed25519 signature)`                                                            |
| `admissionDigest`                         | `concat(UTF8("convax.admission-certificate-digest/1\0"), JCS(full signed AdmissionCertificateV1))`                                                        |
| `abandonmentRequestDigest`                | `concat(UTF8("convax.actor-counter-abandonment-request-digest/1\0"), JCS(full client-signed ActorCounterAbandonmentRequestV1))`                           |
| `actorCounterAbandonmentDigest`           | `concat(UTF8("convax.actor-counter-abandonment-digest/1\0"), JCS(full signed ActorCounterAbandonmentV1))`                                                 |
| `operationLookupReceiptDigest`            | `concat(UTF8("convax.operation-lookup-receipt-digest/1\0"), JCS(full signed OperationLookupReceiptV1))`                                                   |
| `canvasGenesisReservationRequestDigest`   | `concat(UTF8("convax.canvas-genesis-reservation-request-digest/1\0"), JCS(full session-signed CanvasGenesisReservationRequestV1))`                        |
| `canvasGenesisReservationDigest`          | `concat(UTF8("convax.canvas-genesis-reservation-digest/1\0"), JCS(full signed CanvasGenesisReservationV1))`                                               |
| `checkpointEpochReservationRequestDigest` | `concat(UTF8("convax.checkpoint-epoch-reservation-request-digest/1\0"), JCS(full session-signed CheckpointEpochReservationRequestV1))`                    |
| `checkpointEpochReservationDigest`        | `concat(UTF8("convax.checkpoint-epoch-reservation-digest/1\0"), JCS(full signed CheckpointEpochReservationV1))`                                           |
| `checkpointDigest`                        | `concat(UTF8("convax.checkpoint-certificate-digest/1\0"), JCS(full signed CheckpointCertificateV1))`                                                      |
| `projectIndexBindingDigest`               | `concat(UTF8("convax.project-index-binding/1\0"), JCS(exact ProjectIndexBindingV1))`                                                                      |
| `routeFenceDigest`                        | `concat(UTF8("convax.project-index-route-fence-digest/1\0"), JCS(full signed ProjectIndexRouteFenceV1))`                                                  |
| `checkpointFrontierReceiptDigest`         | `concat(UTF8("convax.checkpoint-frontier-receipt-digest/1\0"), JCS(full signed CheckpointFrontierReceiptV1))`                                             |
| `checkpointPublicationReceiptDigest`      | `concat(UTF8("convax.checkpoint-publication-receipt-digest/1\0"), JCS(full session-signed CheckpointPublicationReceiptV1))`                               |
| `requestDigest`                           | `concat(UTF8("convax.typed-intent-request/1\0"), JCS(exact typed intent))`                                                                                |
| `guardDigest`                             | `concat(UTF8("convax.local-intent-guard/1\0"), JCS(exact canonical guard object))`                                                                        |
| `operationReceiptDigest`                  | `concat(UTF8("convax.operation-receipt-digest/1\0"), JCS(exact BoundedOperationReceiptV1))`                                                               |
| `canonicalValueDigest`                    | `concat(UTF8("convax.canonical-value/1\0"), JCS(exact closed field value))`                                                                               |
| `changedPathsDigest`                      | `concat(UTF8("convax.changed-paths/1\0"), JCS(sorted canonical changed paths))`                                                                           |
| `writeSetDigest`                          | `concat(UTF8("convax.write-set/1\0"), JCS(sorted canonical entity/field writes))`                                                                         |
| `routeDigest`                             | `concat(UTF8("convax.canvas-route/1\0"), JCS(canonical CanvasRouteRecord))`                                                                               |
| `receiptRoot`                             | `concat(UTF8("convax.receipt-index/1\0"), JCS(exact ReceiptIndexV1))`                                                                                     |
| `canonicalStateHash`                      | `concat(UTF8("convax.canonical-state/1\0"), canonicalizer-produced JCS logical state bytes)`                                                              |
| `canonicalProjectionDigest`               | `concat(UTF8("convax.canvas-projection/1\0"), JCS(exact CanvasProjectionV1))`                                                                             |
| `fullUpdateHash`                          | raw Yjs full-update bytes                                                                                                                                 |
| `stateVectorHash`                         | raw Yjs state-vector bytes                                                                                                                                |
| `updateSha256`                            | raw Yjs delta-update bytes                                                                                                                                |
| `transcriptDigest`                        | `concat(UTF8("convax.peer-handshake-transcript/1\0"), JCS(exact PeerHandshakeTranscriptV1))`                                                              |
| `wholePayloadHash`                        | `concat(UTF8("convax.peer-message/1\0"), channelByte, messageKind, exact logical payload bytes)`                                                          |
| `documentsDigest`                         | `concat(UTF8("convax.peer-inventory-documents/1\0"), JCS(full canonical inventory documents array))`                                                      |
| `requestsDigest`                          | `concat(UTF8("convax.peer-sync-requests/1\0"), JCS(full canonical sync requests array))                                                                   |
| `actorTerminalsDigest`                    | `concat(UTF8("convax.peer-actor-terminals/1\0"), JCS(full ordered PeerActorTerminalFrontierV1 array))`                                                    |
| `terminalRoot`                            | `concat(UTF8("convax.peer-terminal-root/1\0"), JCS(exact ordered terminal summaries array))`                                                              |
| `pluginStateSchemaDigest`                 | `concat(UTF8("convax.plugin-state-schema/1\0"), JCS(exact PortableBoundedValueSchemaV1))`                                                                 |
| `payloadDigest`                           | `concat(UTF8("convax.plugin-state-payload/1\0"), JCS(exact Plugin state payload))`                                                                        |
| `blobHash`                                | raw complete blob bytes                                                                                                                                   |
| `manifestDigest`                          | `concat(UTF8("convax.blob-manifest-digest/1\0"), JCS(full session-signed BlobManifestV1))`                                                                |
| `chunkHash`                               | raw exact chunk bytes                                                                                                                                     |
| `chunkMerkleRoot`                         | exact domain-separated Merkle algorithm in Peer/blob section                                                                                              |
| `siblingHash`                             | exact sibling node hash at the declared Merkle proof level                                                                                                |
| `durableIndexDigest`                      | `concat(UTF8("convax.blob-durable-index/1\0"), JCS(exact BlobDurableIndexV1))`                                                                            |
| `blobAckDigest`                           | `concat(UTF8("convax.blob-durable-ack-digest/1\0"), JCS(full signed BlobDurableAckV1))`                                                                   |
| `replicaAckDigest`                        | `concat(UTF8("convax.replica-durable-ack-digest/1\0"), JCS(full signed ReplicaDurableAckV1))`                                                             |
| `finalFrameDigest`                        | complete certified `CVXCOLL1` envelope bytes                                                                                                              |
| `localForkRecordDigest`                   | complete local-fork `CVXCOLL1` envelope bytes                                                                                                             |
| `admissionOutboxDigest`                   | complete admission-outbox `CVXCOLL1` envelope bytes                                                                                                       |
| `abandonmentOutboxDigest`                 | complete abandonment-outbox `CVXCOLL1` envelope bytes                                                                                                     |
| `certifiedAbandonmentDigest`              | complete certified-abandonment `CVXCOLL1` envelope bytes                                                                                                  |
| `checkpointOutboxDigest`                  | complete checkpoint-outbox `CVXCOLL1` envelope bytes                                                                                                      |
| `snapshotDigest`                          | complete snapshot `CVXCOLL1` envelope bytes                                                                                                               |
| `durableHeadDigest`                       | complete durable-head `CVXCOLL1` envelope bytes                                                                                                           |
| `protocolDigest`                          | `concat(UTF8("convax.protocol-artifact/1\0"), exact published protocol artifact bytes)`                                                                   |
| `schemaDigest`                            | `concat(UTF8("convax.schema-artifact/1\0"), exact published ProjectIndex/Canvas schema artifact bytes)`                                                   |
| `canonicalizerDigest`                     | `concat(UTF8("convax.canonicalizer-artifact/1\0"), exact published pure canonicalizer artifact bytes)`                                                    |
| `validationArtifactDigest`                | `concat(UTF8("convax.validation-artifact/1\0"), exact published portable validator artifact bytes)`                                                       |
| `resetIntentDigest`                       | `concat(UTF8("convax.project-reset-intent/1\0"), JCS(exact reset intent))`                                                                                |
| `priorEpochFenceDigest`                   | `concat(UTF8("convax.project-epoch-fence/1\0"), JCS({projectId, priorProjectEpoch, priorMembershipEpoch, priorIndexCheckpointDigest, rolloverSequence}))` |
| `identityDigest`                          | `concat(UTF8("convax.portable-identity/1\0"), u32be(JCS(PortableIdentityInputV1).length), JCS(PortableIdentityInputV1))`                                  |
| `nativeStoreKeyDigest`                    | `concat(UTF8("convax.native-store-key/1\0"), u32be(JCS(NativeStoreKeyInputV1).length), JCS(NativeStoreKeyInputV1))`                                       |

`ReceiptIndexV1` 与 API scoped actor state 必须产生相同 high-water/recent terminal semantics；每 snapshot
最多 256 actors、每 actor 最多 4096 receipts。Bun、Chromium、API 和 attester 必须用同一 golden
fixture 重算上述每个 digest、MMR empty/genesis/two-leaf/root、checkpoint rollover 和首个 new-epoch frame。

带 `base/prior/observed/active` 前缀的 digest field 直接引用表中相应 artifact digest，不再二次 hash：
例如 baseCheckpointDigest/priorCheckpointDigest/observedProjectIndexCheckpointDigest 都是
checkpointDigest，activeMembershipSnapshotDigest 是 membershipSnapshotDigest，
observedMembershipSnapshotDigest/expectedMembershipSnapshotDigest 是
membershipSnapshotDigest；previousBundleDigest/afterBundleDigest 是 trustBundleDigest；
targetBootstrapDigest 是 serviceTrustBootstrapDigest。challengeRequestDigest 引用
rolloverChallengeRequestDigest；inviteDigest 引用 projectInviteDigest；
challengeDigest 按 request variant 引用
identityChallengeDigest 或 rolloverChallengeDigest；recoveryChallengeDigest 引用
bootstrapRecoveryChallengeDigest，sessionChallengeDigest 引用 identityChallengeDigest。
originalChallengeDigest 按 bootstrap flow 引用 identityChallengeDigest 或 rolloverChallengeDigest。
`finalRecordDigest` 在 certified head 中等于
finalFrameDigest 或 certifiedAbandonmentDigest，在 local-fork head 中等于 localForkRecordDigest。
`genesisCheckpointOutboxDigest` 引用 checkpointOutboxDigest；`bootstrapDigest` 引用
serviceTrustBootstrapDigest；`activeBundleDigest` 引用 trustBundleDigest。`admittedCoreDigest` 引用
coreDigest；`resultDigest` 由 ReceiptIndex terminal 决定为 admissionDigest 或
actorCounterAbandonmentDigest；`blobAckDigests` 的每一项都是 blobAckDigest。
`initiatorCredentialDigest/responderCredentialDigest/senderCredentialDigest/requesterCredentialDigest` 引用
credentialDigest；
`projectIndexCheckpointDigest` 引用 checkpointDigest。
`canvasGenesisReservationRequestDigest` 和 `canvasGenesisReservationDigest` 分别直接引用上表同名
artifact digest；`checkpointEpochReservationRequestDigest` 和 `checkpointEpochReservationDigest`
同理，不得二次 hash。
`priorHolderReceiptDigest/frontierReceiptDigest/publicationReceiptDigest` 分别直接引用
checkpointPublicationReceiptDigest/checkpointFrontierReceiptDigest/checkpointPublicationReceiptDigest；
null 只允许首次 holder publication。
带 `base/observed/genesis` 前缀的 state/canonical/full-update hash 直接引用表中对应 hash；
`priorHeadDigest` 引用 durableHeadDigest。`intentDigest/discardedIntentDigest` 引用 requestDigest；
`targetRequestDigest` 引用 requestDigest；`targetReceiptDigest` 引用 operationReceiptDigest；
`canonicalDigest/expectedDigest/expectedData/expectedGeneration/expectedPlugin/expectedHistoryStateDigest/
expectedGeometryDigest/expectedRelationDigest/sourceData/targetData/sourceVersionDigest/valueDigest` 引用
canonicalValueDigest；`logicalPostStateDigest` 引用 canonicalStateHash；
`bindingDigest` 引用 projectIndexBindingDigest；`genesisCheckpointDigest/indexCheckpointDigest` 引用
checkpointDigest；
`localDurableIndexDigest` 引用 durableIndexDigest；expectedSnapshotDigest 引用 snapshotDigest；
expectedStateVectorHash 引用 stateVectorHash。
MMR 算法中的 `leftHash/rightHash` 是内部节点值，不是 wire
artifact identity。任何其他未登记 digest/hash 字段禁止加入 v1 wire schema。

## 10. 被删除的旧 version 语义

删除：

- `CanvasDocument.revision`；
- `CanvasCommandEnvelope.expectedRevision`；
- JSON `CanvasDocumentRepository.save(expectedStorageVersion)`；
- renderer history 的 revision acknowledge；
- Canvas resource/generation 的 whole-document conflict retry；
- UI/Agent/Plugin transport 中的 Canvas expected revision。

保留但改名或明确限定：

- journal `durableHead` CAS；
- Project text/blob content guards；
- entity incarnation；
- operation receipt/idempotency；
- Plugin ActiveSet revision；
- project/membership/shard/doc epoch；
- view scope/remount generation，用于取消 stale effect，不用于合并文档。

代码审查不能用 `rg revision` 全删；必须按 owner 和语义分类。

## 11. 可证伪验收

1. 相同 logical snapshots 在不同 Yjs clientId/到达顺序下产生不同 projection。
2. containment cycle 的不同 peer 排除不同 relation。
3. delete 后旧 incarnation 的 edge 或 generation result 重新可见。
4. Plugin source delete 后 creation group 任一 Canvas entity 成为孤立可见结果。
5. remote update 进入本地 UndoManager。
6. crash 恢复 state vector 与 fsync receipt 不一致。
7. checkpoint compaction 后无法从 snapshot+suffix 重建同一 state vector。
8. UI、Agent 或 Plugin 仍暴露 Canvas `expectedRevision`。
9. Bun、Chromium 与 attester golden fixture 产生不同 core bytes/digest/signature/MMR/certificate。
10. certificate 改变导致 coreDigest/MMR leaf 改变，或 core/certificate 形成 self-hash。
11. append/segment fsync/head CAS/head fsync 失败后 working state 不等于 durable journal replay，或 undo 未清空。
12. 并发 Project Canvas rename/tombstone 能让 tombstoned route 复活。
13. 未 durable bound Index frontier 的 Canvas frame 能进入 certifiedTeamDoc/workingDoc/projection/ACK。
14. compaction 后无法从 checkpoint+certified suffix 重建 exact base 并重放 intent。
15. Plugin snapshot/schema mismatch 的端仍能提交 Project durable intent。
16. admission/checkpoint service commit 后、response 前 crash 无法用 durable outbox + operation/frontier
    certificate 恢复 exact frame/snapshot。
17. certified head durable、local retire 未写入时重启会重复 replay 同 operation。
18. local-fork durable head 需要不存在的 snapshotDigest/docEpoch 才能验证。
19. sequential write 和 same-base concurrent write 得到相同 conflict-copy 判定。
20. caller 自选 actorId、跨 shard abandonment 或 stale membership ticket 被接受。
21. unknown/rollback trust bundle 或 key purpose/issuedAt 不匹配的 service signature 被接受。
22. create/reset genesis 只能重新编码 logical state，无法取得 certificate 绑定的 exact Yjs bytes。
23. 两个 actor 使用相同 operationId/ordinal 派生出相同 entity/incarnation/relation/version identity。
24. A→B、A→B/C、B/C→D 的任一 arrival/clientId permutation 产生不同 live set/reservation projection，
    或一份 version 被复制到 primary/reservation 两处。
25. abandonment-pending 在 terminal receipt/checkpoint 前被 compaction 丢弃，或 response-loss 后 counter
    无法恢复。
26. operationId/canvasId/shardEpoch 等 wire id 直接进入 native path，或 `../`、NFC/NFD、padding、
    大小写别名产生 escape/collision。
27. membership object 可由 admission key 验证，或无本地 bundle 的新 Host 只能依赖 HTTPS 接受 challenge。
28. Canvas checkpoint certificate 的 outbox/binding/frontier 任一字段可由 service 替换，或 commit-response
    crash 后只能取得 latest certificate。
29. 任一 Node/Generation/receipt/intent/guard/write-set unknown key 没有 fail closed，或两套 reducer 无法
    仅凭本规范生成相同 logical/projection digest。
30. Caller transport 携带 operationId/counter/ordinal/derived id，或 core sessionId/nonce/leaseId 与
    credential 任一不一致却被接受。
31. 两个 reducer 对 multi-node geometry、三字段 metadata 或 mixed creation-group 分配不同
    writeOrdinal/ActorStamp。
32. group/generation/node/edge/version 经过 checkpoint compaction 后无法从 persisted origin 重算 identity。
33. promote 后 reservation 仍可见、产生重复 version owner，或并发 promote 静默覆盖其中一个 primary。
34. abandonment request session signature 与 service receipt signature 可以互换，或 kind 7/8 非空 payload
    被接受。
35. NativeStoreKey 的非法 namespace cross-product 可构造、同对象有多个 key，或 segment sequence
    reuse/overwrite。
36. detached-map 先填后挂与先挂后填产生不同 normalized write-set，或合法 create 缺 identity/
    creationGroup expected write。
37. `convax.canvas-intent/1` 被当 alias 接受，或 kind 4 intent length/trailing/duplicate guard 产生第二种
    canonical record bytes。
38. create/rollover response-loss 无法用 fresh recovery challenge + original long-term key 取回 exact
    tagged receipt，或 rollover 只返回摘要就允许发布 reset tree。
39. checkpoint frontier receipt 的 null/committed 组合、scope/digest/binding/frontier 可不匹配 embedded
    certificate，或错误 publication receipt推进 holder-confirmed。
40. 三个各自合法但来自不同 Index frontier 的 checkpoint/index/fence 对象可被混搭接受。
41. operation lookup 缺 doc scope/requestDigest，或 service 能为与 signed request 不同的 scope/digest
    签 not-committed receipt。
42. invite create response-loss 后无法用本机 durable secret + mutationId 取回 exact signed invite，或
    同 mutationId 不同 request 被接受；invite/member revoke 只靠未签 HTTP response 生效，或 revoke
    receipt 与 signed membership snapshot 的 role/state 不一致。
43. 同一 ProjectIndex logical snapshot 中多个 primary claim 同 path 时，两套 canonicalizer 产生不同
    winner/materializationPath，或 native adapter 自行追加数字后缀。
44. creation-group create→semantic inverse→redo 无法只靠 closed plan 创建 fresh shared group/entities，
    或 target node.create 能以无关 metadata plan 冒充 inverse。
45. schema-valid generation.complete 使用 non-resource node data，或 URI project/epoch/file/version/blob
    与 outputResource durable guard 任一不匹配仍被接受。
46. 两个独立 Peer adapter 对 handshake/attach/renewal/1 MiB update/blob chunk 产生不同 logical/fragment
    bytes，或 incomplete fragment 可无界占用 reassembly state。
47. update/blob message 未取得 exact flow credit、inner CVXCOLL1 scope/digest 不匹配或 renderer plaintext
    被 apply/ACK。
48. trust high-water 落后九个 bundle 时不能用 closed page cursor 连续验证到 pinned target head，或
    historical-by-digest fetch 能推进 active high-water。
49. revoke/role change 后旧 credential 可直接 admission/checkpoint/abandonment/lookup，或 role mutation
    没有关闭 target sessions。
50. rollover challenge 可在没有 exact admin bearer + member long-term PoP + observed frontier 时签发，
    session memberCounter 可替代 adminCounter，或 rollover 静默改变 admin capability digest。
51. 同 shard 两次 checkpoint 后，第一次 response-loss lookup 不能通过 exact outbox path/body 取回第一份
    receipt，或 generic latest frontier 被当作替代。
52. tuple 较大 peer 能先拨号并成为 transport initiator，或新 session 没有 service-signed active-peer
    directory 就需要猜测 peerId/credential。
53. holder 的旧 credential 过期后，同一 current viewer/editor member 无法在不创建新 checkpoint 的
    情况下以 prior-receipt CAS renewal 原 snapshot proof，或并发 renewal 产生两个 current holder digest。
54. `{byteLength:"2",chunkSize:"1",chunkCount:"1"}`、
    `{byteLength:"2097152",chunkSize:"2097152",chunkCount:"1"}` 能通过 manifest validation，或
    `(1048577,1048576,2)` 接受非 `[1048576,1]` 的 chunk lengths。
55. 零字节 blob 存在第二个合法 chunk tuple/root，或能产生 chunk request/data。
