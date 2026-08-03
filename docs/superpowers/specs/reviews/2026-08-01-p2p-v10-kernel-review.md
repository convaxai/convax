# P2P v10 三方架构裁决：因果内核视角

日期：2026-08-01

评审对象：

- `2026-08-01-p2p-canvas-schema.md`
- `2026-08-01-p2p-causal-kernel.md`
- `2026-08-01-p2p-service-peer-api.md`

评审身份：独立 red team。本文不保护任何一份草案，包括因果内核草案；裁决只服从唯一可信源、离线可编辑、确定性收敛、可验证安全边界和包所有权。

## 总体裁决

三份草案还不能直接进入实现。可以保留的主干是：ProjectIndexYDoc 与 per-Canvas Y.Doc 分片为唯一业务事实源；React Flow 只做投影；所有本地编辑先在 candidate 文档验证，再生成最终签名因果帧；PeerJS 只做不可信传输；服务端只持有身份、授权和有界派生证明，不持有编辑顺序。

需要先修正五个架构缺口：服务端检查点必须验证内容而不是只签元数据；压缩必须建立全体当前 editor 的因果稳定水位；生成任务发起 actor 被撤销后必须可确定性终止；服务端不得建立第二份 Project 文档注册表；本机 blob 持久化证明不得进入可移植协议。任一缺口未关闭，都不应写协同实现。

## C1：离线编辑是否进入最终因果历史

### 唯一决策

离线编辑在本机提交时直接成为最终签名因果帧，不设 provisional local fork，不在重连时重放业务命令或重新分配身份。

提交顺序固定为：从最新 working base 克隆 candidate Y.Doc，应用一个闭合 typed intent，验证 schema 与跨实体不变量，生成精确增量和写集，签名最终帧，将 frame object、outbox、journal 与 head 按持久化协议落盘并 fsync，最后才把该帧投影进本机 replicaDoc。重连只发送原字节帧。

后续授权撤销可以依据 C3 的确定性 cutoff 将某些帧排除到只读恢复区，但这不把本地提交降格成另一套临时权威。

### 理由

provisional fork 会制造 accepted/local 两个可写语义源，并要求重连时重新解释旧 intent。只要 Plugin schema、资源状态或跨实体上下文发生变化，同一个命令就可能生成不同结果，破坏操作身份、签名和用户已见结果的稳定性。最终帧加因果依赖允许无服务端时继续工作，也允许其他副本独立验证。

漏洞类型：因果内核草案若把离线提交表述为“最终”但没有说明后来 cutoff 的去向，属于生命周期遗漏；服务草案若要求重连后重新 admission，属于隐含在线权威假设；local fork 方案属于重复权威。

### 最强反驳

合法成员离线编辑期间被管理员撤销，其本机已经显示为成功的编辑会在团队历史中被排除。用户会认为“最终提交”承诺被推翻，而且无法靠可信墙钟判断哪些编辑发生在撤销前。

这是真实代价。产品必须把“本机已提交”和“已复制到团队”分开显示，并把被 cutoff 的帧保存在只读恢复分支。不能用 provisional 权威掩盖这个不可避免的授权事实。

### 可证伪检验

一个设备断开服务端和所有 Peer 后连续提交 100 个 intent；重连时网络上出现的 100 个 frame 必须与本机落盘字节逐一相同，operation id、actor sequence、Yjs delta 均不得重建。若任一帧需要重新执行 intent 才能发送，裁决失败。

### 因果内核草案需删除或改写

无需删除。需在 2.3 的“最终 causal frame”后补充：后续授权 cutoff 可将帧排入只读 recovery，但不得将其重解释为 provisional fork。

## C2：服务端是否验证检查点内容

### 唯一决策

服务端必须对完整检查点载荷做瞬时、确定性的内容验证，签发 service checkpoint certificate；持久层只保存 digest、scope、frontier、schema/protocol、验证器版本、授权 epoch、签名和有界派生 inventory，禁止保存 Yjs snapshot、frame payload、普通文件或 blob。

验证器应是可移植的纯函数内核，由未来 API 组合层通过有界流式/临时文件适配器调用。它必须验证：父检查点与后缀帧的签名和因果闭包、typed intent 重演、Yjs delta 与声明写集、Canvas/ProjectIndex schema、跨实体不变量、最终 state vector、snapshot digest 及最大 frontier。临时载荷在请求结束后销毁，不进入日志、分析或重试队列。

若当前 Cloudflare/JSON-only 部署不能在资源上限内完成验证，唯一诚实降级是禁用压缩并从 genesis 保留、重放历史；不能把“只看 header 后签名”称为检查点认证。

### 理由

只认证客户端声明的 snapshot digest 和 parent heads，服务端无法知道 snapshot 是否包含未声明的 Yjs 写入、遗漏合法帧或伪造 ProjectIndex 路由。一旦旧帧被压缩，新的副本只能信任任意 Peer 的不可审计状态。这不是 P2P 去中心化，而是把安全假设隐藏在快照提供者上。

漏洞类型：元数据认证方案存在事实性证明缺口；它隐含假设 genesis 历史永远可取，或任一快照持有者可信；从“服务端不排序编辑”跳到“服务端不能验证内容”是逻辑跳跃。

### 最强反驳

瞬时验证会让中心服务接触最大数百 MiB 的协同载荷，引入计算 DoS、隐私暴露、Yjs/业务 verifier 的跨环境一致性和新的中心信任点，也改变当前 API 的部署形态。

反驳成立，因此这是实现前的阻塞性可行性试验，而不是可以顺手编码的细节。验证器只能签“内容与公开规则一致”，不能决定编辑顺序；载荷必须端到端加密时，则需要另行设计可验证执行或放弃服务认证压缩，不能虚构两者兼得。

### 可证伪检验

构造一个 header、digest、父 frontier 均自洽，但 snapshot 内含无法由后缀 typed intents 产生的隐藏 Yjs key 的检查点。服务不得签发证书；合法 carrier 必须签发。请求结束后，对持久库、对象存储、日志和 tracing 取证，不得找到任何 payload 字节。若坏 snapshot 可获证或 payload 被持久化，裁决失败。

### 因果内核草案需删除或改写

无需删除内容验证条款。需把“服务可瞬时读取”收紧为明确的 ephemeral adapter、日志禁止和 verifier 部署 spike；在 spike 通过前删除任何暗示当前 API 已可直接承载该验证的表述。

## C3：成员撤销的因果边界

### 唯一决策

采用精确定义的混合 cutoff，而不是全 Project epoch rollover，也不是按服务端收到时间拒绝。

1. 日常撤销或角色收缩只递增目标 member/replica 的 authorization epoch；`membershipSequence` 只排序授权变更。
2. 服务端为每个文档签发一个 cutoff，绑定最新已验证的检查点集合及其因果闭包。
3. 被撤销 actor 的帧只有在 cutoff 闭包内才继续有效；闭包外帧进入只读恢复区。
4. 其他 actor 的独立帧继续有效；若其因果依赖包含已排除帧，则整体阻塞并进入恢复区，不得删除依赖后继续应用。
5. 日常撤销不得滚动全局 membershipEpoch、projectEpoch 或全部 docEpoch；只有信任根重置才做全局 epoch rollover。
6. 撤销不等待目标设备上线。

### 理由

服务端到达顺序不是编辑因果顺序，墙钟也不可信。全局 rollover 会无端废弃所有未同步成员的合法工作，扩大故障域。按已验证 checkpoint closure 定界，是服务端不读取单个编辑语义时仍能得到的最窄确定性授权边界。

漏洞类型：全 epoch rollover 是范围过宽且忽略替代方案；按服务端接收时间是隐含在线假设；直接保留依赖于已撤销帧的后继是因果完整性错误。

### 最强反驳

被撤销成员在 cutoff 后实际早已完成、但尚未复制的合法工作会丢失团队资格；同时，其他成员依赖这些帧的后继也会被污染。混合策略使恢复和 UI 解释比全 epoch rollover 更复杂。

这是没有可信全序或可信时间时不可消除的代价。复杂性必须显式进入 recovery 状态，而不能通过接受不再授权的帧或清空全团队历史来隐藏。

### 可证伪检验

构造 A 被撤销、B 未撤销：A 在 cutoff 闭包内的帧必须保留；A 在闭包外的帧必须排除；B 与 A 独立的未检查点帧必须保留；B 因果依赖 A 被排除帧时必须阻塞。任一结果依赖消息到达顺序，裁决失败。

### 因果内核草案需删除或改写

删除 9.2 中“角色变更、member/actor revoke 或 key rotation 为每个 document 生成 next docEpoch/genesis，并原子发布全新 membership epoch”的日常路径；删除 9.3 中所有 prior epoch 状态一律重建到 next docEpoch 的规则。改为目标 actor authorization epoch 加逐文档 certified cutoff，且保留不依赖被排除帧的其他 actor 工作。

## C4：压缩所需的因果稳定条件

### 唯一决策

只有 service-certified checkpoint 取得所有当前 active editor replica 的持久化 `ReplicaCausalFloorAck` 后，才成为可裁剪水位。viewer 不参与；新加入 replica 从该水位 bootstrap；不 ACK 的 editor 只有在管理员显式撤销并执行 C3 cutoff 后才不再阻塞。

`ReplicaCausalFloorAck` 至少绑定 project/document scope、docEpoch、checkpoint certificate digest、checkpoint closure frontier、replica actor identity 和签名。签名者承诺此后不会产生 base 未因果支配该 checkpoint 的新帧。ACK 必须先持久化到该 replica 的 signer state；设备存在未并入该 checkpoint 的本地帧时不得 ACK。

裁剪还必须满足：检查点载荷至少一个远端 holder 已 hash 校验并 durable ACK；没有 pending frame、equivocation evidence、recovery branch、outbox 或审计保留引用旧历史。

长期离线 editor 会无限期阻塞裁剪，直到上线合并并 ACK，或被显式撤销。这是离线编辑与有界历史之间的真实权衡。

### 理由

检查点“已发布”不代表所有可继续签名的 actor 都已跨过它。若旧历史被删，而离线 actor 仍能合法创建 pre-floor base 的帧，接收者无法重建 exact base，更不能验证 typed intent 的闭合差异。摘要证明不能恢复被删语义。

漏洞类型：三份草案均不同程度隐含“检查点发布后旧 actor 不会再写”的假设；这是因果稳定性缺失，而不是重试策略问题。

### 最强反驳

一个长期离线或遗失的 editor 设备可以无限期阻塞存储回收；管理员为了压缩而撤销设备，会把其未复制编辑送入恢复区。系统还新增一类带持久承诺的签名状态。

反驳不可消除。若产品不接受它，就必须放弃长期离线写、放弃安全裁剪，或引入在线租约/权威排序；不能同时声称三者成立。

### 可证伪检验

让一个 active editor 离线且保留旧 base，本组其他设备发布检查点。系统必须拒绝裁剪。该设备上线合并并 ACK，或管理员撤销后，才允许裁剪。此后该 actor 再签旧 base 帧必须被判定为协议违规/恢复数据，不能进入 accepted history。若裁剪能在缺少 ACK 或 cutoff 时发生，裁决失败。

### 因果内核草案需删除或改写

删除 7.6 中“至少一个其他 active Peer durable ACK checkpoint 即可裁剪”的充分条件；删除把正常 late old-base frame 交给未来 merge checkpoint 后重新纳入团队历史的路径。改为全体 current editor 的 `ReplicaCausalFloorAck`，或对缺席 actor 完成显式 revoke/cutoff。

## C5：编辑签名密钥的生命周期

### 唯一决策

编辑帧由每设备、每 replica 的长期 actor key 签名，私钥存 OS vault；它对应独立的 `ReplicaActorCredential`，不等同于短期会话凭证。session key 只用于 PeerJS 握手、通道密钥协商和短期 holder assertion，不能签协同编辑帧。

actor key 跨登录会话和短期 credential 续期保持不变，直到设备撤销、主动轮换或 doc/project universe reset。每文档 actor chain 仍由单一 Main durable writer 串行签名；本机 writer lock 只防诚实实现并发，不构成复制密钥后的防分叉机制。双签由相同 `{scope, actorId, sequence, prior}` 下不同 frame digest 的 equivocation 证据识别。

### 理由

离线编辑要求设备在服务不可达和 session 过期后仍能产生可验证帧。若每次会话换 actor/key，actor chain 碎裂且撤销粒度膨胀；若服务端代签，则重新引入在线权威。

漏洞类型：把 peerId、session key 或 MembershipCredential 当编辑身份属于身份层混淆；只靠单进程 writer lock 属于安全边界误判。

### 最强反驳

长期私钥被复制后，攻击者可以长期制造合法外观的 fork；相比短 session key，泄露窗口更大。OS vault 也不能证明设备未被完整克隆。

因此必须有显式设备撤销、equivocation 证据传播和新 actor 轮换；协议不宣称防止已失陷设备，只保证分叉可检测且可 cutoff。

### 可证伪检验

会话凭证续期后，actor chain 必须连续且无需重写旧帧；仅有 session key 的客户端签编辑帧必须被拒绝；复制 actor key 后在同序号双签必须生成可跨 Peer 验证的 equivocation evidence。任一条件不成立，裁决失败。

### 因果内核草案需删除或改写

删除 3.1 中“actorId 是一个 Project membership epoch 内的设备主体”的限定，并将 `DeviceActorCredentialV2` 拆成长期 `ReplicaActorCredential` 与可续期 authorization grant；删除 3.2 actor chain scope 中的 `membershipEpoch`。保留 session/peer ticket 仅授权 transport 的条款。

## C6：actor sequence 起点

### 唯一决策

actor sequence 使用十进制字符串编码的无符号 64 位整数，首帧严格为 `"0"` 且 `priorFrameDigest = null`，后续严格加一。缺少 actor head 用 nullable head 表示，不用 `0` 兼任“未开始”。sequence 只在新 actor identity 或新 docEpoch 中重置。

### 理由

零起点让数组式链位置、计数和首帧规则没有隐含 sentinel；字符串避免 JavaScript number 精度丢失。最重要的是三份协议必须只保留一种 golden encoding。

漏洞类型：草案间 0/1 起点差异属于直接协议事实冲突；若不裁决，会造成签名字节和 gap 检查不互操作。

### 最强反驳

一部分日志和服务 API 通常把序号 0 当未初始化值，1 起点更符合人类直觉，也可能更容易接入数据库约束。

协议不应为某个存储 sentinel 牺牲唯一编码；适配器必须显式表示 null。

### 可证伪检验

建立跨实现 golden vectors：首帧 0/null、次帧 1/prior；重复、负数、前导零、跳号、超过 u64 全部拒绝。若任一实现接受 1 作为无额外声明的首帧，裁决失败。

### 因果内核草案需删除或改写

无需删除；3.2 的零起点条款保留。需补充前导零拒绝与 u64 耗尽时冻结当前 docEpoch。

## C7：docEpoch 的存在与滚动规则

### 唯一决策

保留 `docEpoch` 于 `DocumentScopeV2`。checkpoint、压缩、普通成员/设备撤销、成员加入和 session 续期均不得改变 docEpoch。

docEpoch 仅在显式重建该文档协同宇宙时滚动：不兼容文档 schema/protocol reset、不可恢复的文档级 equivocation/损坏、Lamport 或 actor sequence 空间耗尽。Project 级破坏性重置滚动 projectEpoch；删除后重建同一 Canvas 必须创建新 shardEpoch，而不是借 docEpoch 模糊资源身份。

actor chain scope 为 `{projectId, projectEpoch, documentKind, documentId, shardEpoch, docEpoch, actorId}`。membershipEpoch 不进入 chain scope，因为日常授权变化不应重置已认证历史。

### 理由

docEpoch 是文档协议宇宙隔离，不是方便清缓存的 revision。把授权或检查点和它绑定会把局部运维事件扩大为全副本重置；完全移除它又无法确定性隔离 breaking reset 前后的同名文档。

漏洞类型：将 docEpoch 用作通用失效 token 是概念混淆；完全依赖 membershipEpoch 是授权与文档身份耦合。

### 最强反驳

projectEpoch、shardEpoch、docEpoch、authorization epoch 并存增加 scope 复杂度，任何漏签字段都会形成跨 epoch 重放漏洞。

这要求统一 `DocumentScopeV2` codec 和签名 golden tests，而不是合并语义不同的 epoch。

### 可证伪检验

检查点、成员撤销和 session 续期前后 docEpoch 必须不变；breaking reset 后旧帧必须因 scope 不同被拒绝，新 actor sequence 从 0 开始；错误 docEpoch 不能被当作暂缺依赖无限 pending。若普通 revoke 会滚动 docEpoch，裁决失败。

### 因果内核草案需删除或改写

删除 9.2/9.3 中普通 revoke 生成 `nextDocEpoch`、next genesis checkpoint 并让全部 actor sequence 重置的条款；将 docEpoch rollover 限定为本节列出的文档协同宇宙重建事件。

## C8：协议载荷与 frontier 上限

### 唯一决策

采用以下独立硬上限；所有大小均按最终协议字节计算，不能只限制解码后的对象字段：

| 对象 | 上限 |
| --- | ---: |
| canonical typed intent | 512 KiB |
| semantic guard | 256 KiB |
| causal context | 64 KiB |
| base state vector | 64 KiB |
| Yjs delta | 1 MiB |
| actual write evidence | 256 KiB |
| frame header | 64 KiB |
| 完整 causal frame | 2 MiB |
| 单文档 snapshot | 32 MiB |
| checkpoint direct parents | 8 |
| certified checkpoint maximal antichain | 8 |
| 未压缩 live frontier heads | 256 |
| attester 瞬时 carrier | 320 MiB |

attester carrier 内 parent snapshots 合计不超过 256 MiB，suffix 不超过 64 MiB 且不超过 4096 frames。字段独立上限不放宽完整 frame 的 2 MiB 总上限；按最大值粗算 `64 + 512 + 256 + 64 + 64 + 1024 = 1984 KiB`，仅剩 64 KiB 给编码与签名，因此实现必须在编码前预检，证据通常需显著低于独立上限。

第 9 个并列 checkpoint tip 不得继续发布新 checkpoint，必须先合并最多 8 个 tip；普通编辑不因此停止。

### 理由

512 KiB intent 比 256 KiB 更能容纳 Plugin 有界 state 和多实体 creation group，而把 write evidence 从 512 KiB 降到 256 KiB 避免 frame 总上限失真。parent/antichain 限 8 使 bootstrap 和服务验证有确定资源界；live edit frontier 可以更宽，但必须在检查点时收敛。

漏洞类型：只给单字段 cap、不验证总载荷属于算术遗漏；无限 checkpoint parents 属于资源边界遗漏；以“网络层会限流”代替协议上限属于层次错误。

### 最强反驳

九个长期网络分区可阻止新 checkpoint 发布；32 MiB snapshot 对大型画布偏小，512 KiB intent 又可能诱导把大 blob 塞进元数据。

前者是有意的有界证明约束，可先合并 8 个再合并剩余；后两者应通过分片、资源引用和 typed operation 拆分解决，不能无界增长单文档或单帧。

### 可证伪检验

为每个字段生成刚好上限和超一字节样本，并生成各字段均未超限但总 frame 超 2 MiB 的样本；后者必须拒绝。八个并列 tip 可验证，第九个必须阻止 checkpoint publication，合并后恢复。若解析器在完整分配后才拒绝巨载荷，裁决失败。

### 因果内核草案需删除或改写

将第 11 节 `typed intent JCS` 从 256 KiB 改为 512 KiB，`actual write evidence` 从 512 KiB 改为 256 KiB，checkpoint suffix 从 256 MiB 改为 64 MiB；增加 guard 256 KiB 和完整 carrier 内 parent snapshots 256 MiB 子上限。删除任何把字段上限简单相加后仍默认 frame 合法的暗示。

## C9：checkpoint frontier 的计算权威

### 唯一决策

服务 attester 根据 C2 的完整 carrier 计算实际因果闭包、dominance 和 maximal certified frontier。作者声明的 direct parents 只用于绑定载荷与快速定位，不是 frontier 权威；`anchorRevision` 仅是服务元数据 CAS，不是编辑顺序。

无效 child 不获证，也不能把合法 parent 从 anchor 移除；合法且相互不可比较的 child 全部保留；合法 child 因果支配 parent 后才可替换它。

### 理由

若服务只相信提案者声明的 parents，攻击者可声明自己覆盖多个检查点，提交丢历史或隐藏写入的 snapshot，再从 bootstrap 集合中移除好状态。frontier 是验证结果，不是客户端意见。

漏洞类型：客户端声明 parent 即证明 dominance 是信任边界错误；按提案到达顺序更新 anchor 是把 CAS revision 偷换成业务全序。

### 最强反驳

frontier 计算使 verifier 成为高价值正确性内核；一个 dominance bug 可全局签发错误压缩证书，影响比单 Peer bug 更大。

因此 verifier 必须是跨 Node/browser/service 的同一纯实现，具备差分测试、模型测试和证书版本钉住；证书不是“服务说了算”，而是任何 Peer 可重验的确定性证明结果。

### 可证伪检验

让无效 C 声称 A、B 为 parents，服务 anchor 必须仍为 A、B；让合法 C 完整合并 A、B，anchor 才变为 C。随机排列所有 proposal 到达顺序，最终 maximal frontier 必须相同。若到达顺序改变结果，裁决失败。

### 因果内核草案需删除或改写

无需删除；7.2 至 7.4 的内容验证与 maximal frontier 主张保留。需明确 proposal 的 declared parents 不是 dominance 权威，只有 verifier 重建的 closure 可更新 anchor。

## C10：文档发现与服务端 registry

### 唯一决策

禁止建立独立、可写、具有 Canvas 生死语义的服务端 document registry。ProjectIndexYDoc 是唯一 Project catalog 和 Canvas route/tombstone 权威。

服务端可在验证 ProjectIndex checkpoint 时派生并持久化有界 `DocumentScopeInventoryV2`，内容仅包括完整 document scope、live/tombstoned 状态、route digest、派生自哪个 checkpoint certificate；它是证书绑定的索引，不可独立写入，也不能复活、删除或重命名 Canvas。C3 cutoff 以最新已验证 inventory 为枚举依据。

未进入已验证 inventory 的新 Canvas 对被撤销目标 actor 默认不授予存续资格，其帧进入恢复区；未撤销 actor 的 staged Canvas genesis 只有在 ProjectIndex route 被验证并激活后才能成为 live shard。创建流程必须有明确的 staged-genesis → ProjectIndex route → activation 因果链。

### 理由

服务端 registry 与 ProjectIndex 同时决定 Canvas 存在，会重现 document-wide version 的双权威问题。纯派生 inventory 既能让服务枚举 cutoff scope，又不拥有业务目录。

漏洞类型：独立 registry 是重复权威；从“服务需要发现文档”跳到“服务需要拥有文档目录”是逻辑跳跃；依赖未验证 ProjectIndex header 是信任错误。

### 最强反驳

派生 inventory 可能落后于离线创建的 Canvas，撤销时无法精确列举所有 scope；ProjectIndex attester 不可用还会拖住成员管理。

安全默认必须是对撤销目标的新未知 scope 不予接纳，而不是默认有效。成员撤销可以先生效，未知数据进入恢复区；inventory 更新只负责恢复可证明的合法闭包。

### 可证伪检验

直接修改服务 inventory 不得创建或复活 Canvas；已验证 ProjectIndex tombstone 必须压过旧 inventory；撤销时一个未登记 scope 不得让目标 actor 的新帧进入 accepted history。若服务 registry 能独立改变 Project catalog，裁决失败。

### 因果内核草案需删除或改写

无需删除 ProjectIndex 路由权威条款。需把 9.2 的“从 ProjectIndex 枚举所有 Canvas shard”改写为从 certified ProjectIndex 派生 `DocumentScopeInventoryV2`；若其他段落将服务保存的文档列表表述为 registry 权威，全部删除。

## C11：资源可用性证明的协议边界

### 唯一决策

从所有 portable intent、frame、checkpoint 和 wire proof 中删除 `localDurableIndexDigest`。它是本机私有索引摘要，远端不可能重建，不具备协同证明意义。

资源引用分成三个边界：

1. Main 在构造本地 frame 前，通过 `@convax/project` 的 native port 校验 blob hash、length 和本地 fsync，返回 Main-only `LocalBlobCommitPermit`；该 permit 不序列化、不进入 Y.Doc。
2. wire 上只携带 `ProjectResourceCausalProofV2`：ProjectIndex 精确因果依赖/frontier、ProjectFileId、versionId、canonical Convax URI、blob hash、byte length、当前 live version。远端可验证引用合法性，即使 blob 尚未下载。
3. blob 接收者在 hash 校验并 fsync 后另签 `BlobDurableAckV2`。只有编辑帧已有远端 durable ACK，且每个新增引用 blob 至少一个远端 ACK，UI 才显示“已复制”。

远端缺 blob 时可接受结构并后台拉取，但播放/打开显示 unavailable。redo 重新引入资源引用前，本地必须仍有精确 bytes 或先完成重新获取；不能用旧本机索引摘要代替内容存在。

### 理由

机器 A 的路径、索引和 fsync 状态不是机器 B 可验证的事实。把它签入 portable frame 会导致同一语义在不同机器产生不同 canonical bytes，并把 native 实现泄漏到 headless schema。

漏洞类型：`localDurableIndexDigest` 属于本地性泄漏和可验证性事实错误；把结构复制与 blob 持久复制合并为一个 ACK 是语义混淆。

### 最强反驳

允许先接受结构，会短暂出现引用存在但资源不可播放的状态；远端可能永远拿不到 blob，形成永久悬空引用。

Canvas 元数据与文件传输本来就不能原子提交。显式 unavailable、后台重试、holder discovery 和“已复制/可完整离线”双状态比伪造跨文件事务更诚实。

### 可证伪检验

A、B 使用完全不同本机持久索引，对同一文件 bytes、ProjectFileId/versionId 和 URI 应生成相同 portable 资源证明。本地 permit 缺失时 A 不得签帧；B 可接纳结构，但未 fsync blob 前不得发 BlobDurableAck。若远端验证需要 A 的本机索引，裁决失败。

### 因果内核草案需删除或改写

因果内核草案当前没有 `localDurableIndexDigest`，无需删除。需补充并冻结 `LocalBlobCommitPermit` 不可序列化、`ProjectResourceCausalProofV2` 可移植、`BlobDurableAckV2` 独立签名三层，避免后续实现把本机 receipt 填回 frame。

## C12：typed intent 协议版本

### 唯一决策

使用 breaking token `convax.typed-intent/2`。发生不兼容根结构变化时，Canvas schema/root token 同步升级为 `convax.canvas.v2`，ProjectIndex 采用自身明确的 v2 token。不得在 `/1` 下替换 union、字段含义或 canonical encoding，也不得提供静默别名。

旧项目允许用户确认后执行破坏性 reset：先保留不支持的旧 bytes，不 hydrate、不原地迁移、不 GC；确认后删除旧项目内容并创建新 projectEpoch。UI 必须明确“无法恢复内容”。

### 理由

签名协议依赖精确 schema 和 canonical bytes。同一 `/1` 表示两种 union 会使不同 Peer 对同一签名作不同解释，失败模式是静默错写而不是清晰拒绝。开发阶段允许 breaking change，正应使用明确版本切断歧义。

漏洞类型：复用 `/1` 是版本事实冲突和兼容性伪装；自动 reset 是数据破坏授权缺失。

### 最强反驳

版本升级会使现有项目无法打开，也要求 Plugin/Agent/UI 同时升级，短期交付成本高。

当前明确允许不兼容且架构优先。成本必须通过原子发布和显式 reset 承担，不能把不兼容字节藏在旧 token 中。

### 可证伪检验

所有 `/1` golden payload 在 v2 decoder 必须明确拒绝；不存在兼容 alias 或启发式字段判断。未获用户确认时旧 `.convax` bytes 必须保持逐字节不变。若打开旧项目会自动 rewrite/reset，裁决失败。

### 因果内核草案需删除或改写

无需删除；4.1 的 `/2` token 和 10.2 breaking reset 方向保留。需把 Canvas/ProjectIndex v2 root token 与 reset 确认行为纳入同一协议 digest。

## C13：精确 causal base 与裁剪后验证

### 唯一决策

每帧必须绑定完整 base frontier（含 head digest/lamport）、精确 base state vector bytes 及其 digest。验证者选择 causal closure 为 frame base 子集的 certified checkpoint，按确定性拓扑顺序重放到精确 base，要求 state vector 逐字节相等，再重跑 intent 和闭合 diff。

验证比较 canonical intent、guards、实际写集和语义等价的 Yjs update；不要求重跑生成的 update 压缩字节与原 delta 完全相同，除非协议固定了 Yjs encoder 版本和编码方式。

裁剪只能依 C4 causal floor。稳定水位本身是唯一可用的 prune witness：它证明所有仍可写 actor 已承诺不再产生旧 base 帧。digest-only witness 不能重建旧业务状态，也不能代替 exact-base 重放。裁剪后收到 pre-floor base，只能作为违规/已撤销 actor 的恢复数据，不允许“等待未来证书”后进入正常历史。

### 理由

typed intent 的合法性依赖当时 base；仅验证 delta 的 Yjs 可应用性会接受隐藏写入，仅验证 intent 又无法证明提交者确实应用了声明结果。exact base 是闭合命令重演的前提。

漏洞类型：把 state-vector digest 当可重建状态属于证明能力夸大；先裁剪再等待某个未来 witness 属于循环依赖；要求 Yjs update 编码字节完全一致可能是实现细节误判。

### 最强反驳

全体 active editor ACK 会增加历史保留和重放成本，恶意/遗失设备可造成存储压力；重跑 intent 还要求 Plugin schema 和 verifier 长期可获得。

前者通过管理员显式 revoke 解决，不能静默越过；后者要求 frame 钉住 schema digest、Plugin closure/schema verifier 可内容寻址获取，否则该 intent 根本不具备长期可验证性。

### 可证伪检验

一个未 ACK 的离线 actor 必须阻止旧历史裁剪；完成 floor ACK 后，它构造旧 base 帧必须被拒绝。构造可应用但包含 typed intent 未声明 key 的 Yjs delta，必须被闭合 diff 拒绝。若只凭 digest 能让无法重建的 base 通过，裁决失败。

### 因果内核草案需删除或改写

删除 4.4 和 7.6 中把 `base-pruned` 作为正常可等待未来 anchored/merge checkpoint 后再接纳的规则；保留 exact-base reconstruction，但让 C4 稳定水位保证合法 active actor 的 base 不会被提前裁剪。`base-pruned` 仅用于损坏、违规、已撤销或 recovery/audit，不是正常 accepted 路径。

## C14：generation、creation group 与 containment

### 唯一决策

接受 Canvas 草案的以下结构：业务 edge 永远不称 parent；containment 使用扁平 actor-keyed 关系集合；投影先为每 child 选择最大 portable relation，再对每个确定性 cycle 删除最大 cycle relation，且不回退到较小候选；creation group 的源节点被 delete 时，整个 Plugin 创建的节点与边组隐藏；delete 胜过迟到 generation result；generation 的 `outputClaimStamp` 在 begin 时分配，terminal 到达时间不得改变优先级；redo 不自动重启计费生成。

但拒绝当前 singleton `generationTerminals[generationId]` 且“只有 begin actor 可终止”的组合。必须改为以下精确第三方案：

1. terminal claim 按 actor 分槽存储，例如 `generation/<generationId>/terminalActors/<actorId>`，避免多个 actor 对同一 Y.Map key 的覆盖竞态。
2. 正常 owner terminal 仅 begin actor 可写，绑定 exact begin，且该 owner 先前无 terminal。
3. 非 owner 只能写 `FAILED_RECOVERY`，且必须携带服务签发的 cutoff proof digest；证明 begin actor 已撤销/替换、cutoff closure 包含 begin 且不包含 owner terminal。非 owner 永远不能宣称成功或产生输出。
4. 投影优先合法 owner terminal；若不存在，则选择 portable order 最大的合法 recovery failure claim。旧 owner 在 cutoff 后迟到的 terminal 无效。
5. Canvas 只持 proof digest 和终止语义；授权证明由外层 collaboration/project verifier 注入，不让 Canvas 读取 membership 服务。

### 理由

扁平 containment 加确定性删环能在无全序下收敛，并避免业务 edge 与归属关系混淆。creation group 全删符合用户要求的原子业务可见性。

generation 现有设计有永久活跃漏洞：发起设备丢失或 actor 被撤销后，其他成员不能写 terminal，任务永远卡住。把 terminal 保持单 key 又会让 Y.Map 的并发覆盖决定可见值，绕过显式 portable order。

漏洞类型：现有 generation 是生命周期不完整；singleton terminal 是底层 CRDT 冲突语义泄漏；让 Canvas 自己查成员服务则会造成包边界倒置。

### 最强反驳

按 actor terminal 槽和 cutoff proof 显著增加 schema；Canvas 投影需要外层验证材料，恢复失败可能在服务不可达时无法立即提交。删除 cycle 最大边而不回退，也可能让本可保留的次优 containment 暂时消失。

恢复终止本就涉及授权事实，离线设备不能可信断言另一个 actor 已撤销。等待 proof 比允许任意成员抢终止更安全。containment 不回退避免删除一个新关系后旧关系意外复活；用户可显式再提交关系。

### 可证伪检验

撤销一个持有 active begin 的发起 actor，其他 editor 必须能凭 cutoff proof 写 recovery failure；旧 owner 随后发送 success 必须被排除；两个 recovery failure 并发必须跨顺序收敛。另对 containment、manual result、generation result、delete 和 creation group 做全排列交付，所有副本投影必须一致。若 generation 可永久 active 或依赖 Y.Map 到达顺序，裁决失败。

### 因果内核草案需删除或改写

因果内核草案没有定义 generation/containment schema，无需删除。需要删除任何“Canvas schema 已整体通过内核验证”的泛化结论；在支持 cutoff-proof recovery terminal 的 revised Canvas schema 进入 protocol digest 前，内核不得宣称跨实体不变量闭合。

## C15：undo/redo 的权威与栈语义

### 唯一决策

`Y.UndoManager` 只运行在 Main 的 replicaDoc/working projection 上，只跟踪“已 durable commit 的本地 root intent origin”。远端帧既不进入也不清空本地栈。UndoManager 产生的原始 Yjs update 只能用于选择和物化语义逆操作/正操作，绝不能直接持久化或广播。

undo/redo 必须重新形成一个闭合 typed intent，在最新 working base 的 candidateDoc 中验证，并作为新的最终因果帧提交。只有该帧 durable commit 后才移动 undo/redo 栈；guard stale 或验证失败时栈保持不变。undo/redo 不是新业务 root，不改变 creation group/generation 的原始 root 身份。进程重启、完整 rebuild 和 docEpoch rollover 清空栈，不支持跨重启 undo。

### 理由

React Flow 本地历史或直接应用 UndoManager update 都会绕过同一命令入口、资源检查和跨实体不变量。远端操作清栈则使协同中本地撤销几乎不可用；把逆操作在最新 base 重新验证，才能兼顾用户意图与并发状态。

漏洞类型：把 UndoManager 当 durable command log 是抽象层误用；renderer 持栈是权威泄漏；远端变化自动清栈是忽略语义替代方案。

### 最强反驳

远端改动可能让最近本地操作无法安全逆转，用户按 undo 得到“不可撤销”而不是时间倒流；语义逆操作的覆盖范围比 Yjs 原生 undo 更难实现。

这是协同编辑中的真实语义。UI 应展示失败原因和目标，不能通过回滚远端事实制造假象。每类 typed intent 必须定义可验证 inverse contract；没有 inverse 的操作明确不可撤销。

### 可证伪检验

依次提交本地 L1、远端 R1、本地 L2，undo 必须选择 L2 且 R1 保留；让 R1 使 L2 inverse guard stale，undo 失败后栈位置不变；重启后栈为空。若任何 UndoManager raw update 进入 journal/wire，裁决失败。

### 因果内核草案需删除或改写

无需删除；保留 5.1 durable barrier 后才提交 undo selection，以及 10.1 重启不恢复 UndoManager。需补充 remote transaction 不清栈、失败不移动栈、raw undo update 永不进入 wire 的规范文本。

## C16：检查点后的旧工作与无 holder bootstrap

### 唯一决策

检查点发布本身绝不使旧 base 工作失效。未完成 C4 floor ACK 的 active actor 仍可提交旧 base 帧，因此相关历史不得裁剪。若管理员选择撤销该 actor 来推进稳定水位，其未进入 cutoff closure 的工作转入只读恢复区。

已有完整本地副本的设备可以离线继续编辑。新设备若服务只持有证书/元数据且没有任何在线 holder 拥有所需 ProjectIndex、Canvas checkpoint/suffix 或 blob，必须进入 `waiting-for-holder`，不得打开空项目、信任过期缓存冒充完整状态或让服务端凭元数据重建内容。任一 certified maximal checkpoint 的必要 payload 无 holder 都阻止“完整 ready”；holder 返回后自动恢复 bootstrap。

用户若不愿等待，只能显式执行破坏性 Project reset，创建新 projectEpoch；不得静默 reset。

### 理由

P2P 不等于所有数据永远在线。个人离线编辑只证明“已有副本可工作”，并不证明“无副本的新设备可取回数据”。服务端不存 payload 与无 seed 可 bootstrap 不能同时成立。

漏洞类型：把离线编辑能力推导成新设备离线 bootstrap 是逻辑跳跃；假设至少一个 holder 永远在线是隐含可用性假设；检查点发布即拒绝旧工作是 C4 缺失。

### 最强反驳

团队最后一个持有者离线或损坏时，新成员无法工作；多 holder 中缺少一个并列 checkpoint 也可能阻止完整 ready。产品可用性弱于云端持久副本。

这是选择“服务端不持内容”的直接结果。可以通过多 Peer 复制状态和显式健康度降低概率，但若业务要求无 holder 也可恢复，就必须增加服务端 blob/replica seed，不能继续称为纯元数据服务。

### 可证伪检验

关闭所有持有者，新设备 bootstrap 必须稳定停在 waiting-for-holder，且不得创建空 Y.Doc；任一 holder 返回后无需重置即可继续。已有副本完全离线时仍可提交最终帧。发布 checkpoint 但不取得某旧 actor floor ACK，其旧 base 帧仍应可验证。任一相反结果使裁决失败。

### 因果内核草案需删除或改写

删除 12.1/12.3 中把 late pre-compaction frame 交给未来 attested merge checkpoint 作为正常自动合并方案的表述；按 C4 改写。保留“至少一个数据持有 Peer 在线才能 bootstrap”的约束，并新增明确 `waiting-for-holder` 状态及“不得创建空项目/静默 reset”。

## 跨项漏洞归类

| 漏洞类型 | 具体问题 | 后果 |
| --- | --- | --- |
| 重复权威 | provisional local fork、服务端 document registry、React Flow/JSON 持久态 | 同一事实出现不同提交和恢复语义 |
| 隐含假设不成立 | checkpoint 后旧 actor 不再写、永远有 holder、服务到达顺序近似时间 | 离线与网络分区下丢工作或无法验证 |
| 逻辑跳跃 | 服务不排序推出服务不能验证；设备可离线推出新设备可 bootstrap | 把产品取舍伪装成协议能力 |
| 事实/协议冲突 | sequence 0/1、typed-intent `/1`/`/2`、机器本地 digest 进入 wire | 签名不互操作或远端不可验证 |
| 生命周期遗漏 | generation owner actor 消失后无终止者 | 永久 active、资源和 UI 泄漏 |
| 忽略替代方案 | routine revoke 直接全 epoch rollover | 无关成员离线工作被过度废弃 |

## 实施前阻塞项

1. **检查点 attester 可行性未证明。** 必须先做跨 Node/browser/service 的纯 verifier spike，证明 320 MiB carrier 上限、确定性、资源配额、无 payload durable/log 泄漏和签名 golden；失败则明确采用“不压缩、保留 genesis”，不能退成伪证书。
2. **`ReplicaCausalFloorAck` 尚未进入协议。** 没有全体 active editor 的稳定水位，任何历史裁剪都不安全；这是压缩、离线和撤销三者的共同前置。
3. **generation 终止 schema 有永久卡死。** singleton terminal 与仅 owner 可终止必须按 C14 改造，并补齐撤销 proof 的包边界。
4. **服务端文档 registry 必须降级为证书派生 inventory。** 任何独立 Canvas 生死写入口都会违反 ProjectIndex 唯一可信源。
5. **`localDurableIndexDigest` 必须从协议删除。** 本地 permit、portable causal proof、BlobDurableAck 三层需要分别定型。
6. **协议 token 和 scope 尚未统一。** sequence、typed intent v2、Canvas/ProjectIndex schema token、docEpoch/shardEpoch 与签名覆盖字段必须先产出一套 golden vectors。

以上六项全部关闭前，我不会签署进入实现阶段。

## 最强整体反驳

领域专家否决整个方案最有力的三条理由是：

1. **它实际上不是“纯 P2P”。** 服务 attester、授权 cutoff 和 checkpoint certificate 是中心信任与可用性依赖；若服务宕机，撤销、压缩和新设备信任建立都会停摆。反驳不能靠改名消失。准确定位应是“数据面 P2P、身份与证明控制面服务化”。
2. **它为离线写付出了过高的状态机和保留成本。** causal frame、candidate 重演、checkpoint carrier、全 editor floor ACK、recovery branch、blob ACK 是一整套分布式数据库协议；小团队产品可能用在线 sequencer 加本地队列更便宜。只有“无在线权威顺序”和长期离线写是硬需求时，这个复杂度才合理。
3. **跨 Yjs、业务 schema、Plugin verifier 和 blob 的长期可验证性尚未被工程证明。** 任何旧 Plugin schema/closure 不可获取、Yjs 编码或 canonicalizer 漂移，都可能让合法历史无法重放。没有跨版本 golden、模型检验、故障注入和外部 clean-consumer pack test，架构文档仍只是承诺。

## 方案评分

当前三份草案合并后的可实施度：**6.5 / 10**。

扣分：

- -1.0：没有因果稳定水位却讨论安全裁剪。
- -0.8：服务 checkpoint 内容认证与当前部署/包边界尚未证明。
- -0.6：generation actor 撤销后的终止语义缺失。
- -0.5：服务 registry 和 ProjectIndex 存在重复权威风险。
- -0.4：资源本机证明、协议版本和 sequence 仍有直接冲突。
- -0.2：无 holder 的产品状态和恢复 UX 尚未规范化。

如果以下“愿意签署的规范条款”全部进入统一协议，并且前两项 spike 通过，可提升到 **8.5 / 10**。剩余问题不致命的原因是：P2P 无 holder 的可用性和长期离线阻塞压缩都是明确、可观测、可由管理员决策的产品取舍，不再是隐藏的一致性漏洞；大载荷性能则可用硬 cap 和压测继续收敛，不改变唯一权威或因果安全模型。

## 我愿意签署的规范条款

1. ProjectIndexYDoc 是 Project catalog、Canvas route/tombstone 和 current blob reference 的唯一事实源；每个 CanvasYDoc 是该 Canvas 的唯一事实源。
2. React Flow、renderer store、JSON snapshot、服务 inventory 和 Peer 缓存都只是投影或派生索引，不得提交整文档或成为第二权威。
3. UI、Agent、Plugin 只提交闭合 typed intent；Main 的同一 application service 在 isolated candidateDoc 上验证并产生最终帧。
4. 离线提交直接形成最终签名帧并 durable 落盘；重连发送原帧，不重新执行、不重新编号。
5. PeerJS 是不可信传输；peerId 不是身份。编辑身份是服务签发授权下的长期 device/replica actor key。
6. 首 actor sequence 为 `"0"`，后续严格加一；chain scope 使用完整 DocumentScopeV2 和 docEpoch。
7. 日常成员/设备撤销不滚动 project/doc epoch；使用目标 authorization epoch 与 service-certified checkpoint-closure cutoff。
8. 依赖已被 cutoff 排除帧的后继不得剥离依赖继续应用，只能进入恢复区。
9. 服务只对完整载荷做瞬时确定性 checkpoint 验证，持久化证书和有界派生元数据，禁止持久化内容 payload。
10. 服务 attester 不可行时禁用安全压缩并保留 genesis，不得签发 metadata-only 伪证书。
11. checkpoint frontier 由 verifier 根据实际闭包计算；proposal parents 和 anchor revision 不构成编辑顺序。
12. 历史只在所有 active editor 已 durable 签署 ReplicaCausalFloorAck，或未 ACK actor 已显式 revoke/cutoff 后裁剪。
13. 每帧绑定精确 base frontier 与 state vector；验证必须重建 exact base、重跑 intent 并检查闭合写集。
14. 服务端不得拥有独立 document registry；只可持有从 certified ProjectIndex 派生、不可单独写入的 inventory。
15. `localDurableIndexDigest` 不得进入 portable 协议；本地 commit permit、resource causal proof、BlobDurableAck 分层处理。
16. “本机已提交”“Yjs/frame 已复制”“新增 blob 已复制”“可完整离线”是四个不同状态，不得合并承诺。
17. containment 与业务 edge 分离；并发 cycle 按 portable order 确定性删最大关系且不回退；业务连线永远不称 parent。
18. creation group 的源节点 delete 隐藏整组 Plugin 节点与边；delete 胜过迟到 generation result；redo 不重启生成。
19. generation terminal 必须按 actor 分槽，并允许基于 verified cutoff proof 的非 owner `FAILED_RECOVERY`；非 owner 不得宣称成功。
20. UndoManager 只选择本地 durable roots；原始 Yjs undo update 不持久化，undo/redo 必须在最新 base 上生成并验证新的语义帧，重启清栈。
21. protocol 使用 `convax.typed-intent/2` 及明确 v2 schema token；旧项目只允许显式确认后的破坏性 reset，确认前原 bytes 不得改写或 GC。
22. 没有在线 holder 时，已有副本仍可离线编辑，新设备必须进入 waiting-for-holder；只有用户显式 reset 才可创建新 projectEpoch。
23. 所有 wire 对象执行独立字段 cap、完整载荷 cap、解析前资源限制和跨实现 canonical/signature golden tests。
24. 上述不变量必须通过消息全排列、断网、重连、撤销、双签、进程崩溃、stale async、缺 blob、无 holder 和裁剪故障注入证伪测试。
