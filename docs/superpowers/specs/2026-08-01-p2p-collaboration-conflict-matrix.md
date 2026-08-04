# P2P Collaboration Architecture Conflict Matrix

Status: open; this document records questions, not decisions.

The Canvas, causal-kernel, and service/API reviewers must independently answer
every item. A resolution becomes normative only after all three reviewers approve
the same canonical specification digest.

| ID | Required decision | Existing disagreement to eliminate |
| --- | --- | --- |
| C1 | Define the durable meaning of an offline local edit. | Immediately signed replica frame versus provisional local fork awaiting online replay. |
| C2 | Define who verifies checkpoint content and what a service receipt proves. | Transient service content verification and certificate versus unverified service metadata with peer verification. |
| C3 | Define revocation and post-revocation history. | Whole-shard membership/document epoch rollover versus authorization epoch plus checkpoint-set cutoff; treatment of honest uncheckpointed work is unresolved. |
| C4 | Define causal stability before compaction. | One remote durable ACK is insufficiently reconciled with a long-offline actor that later submits an old-base frame. |
| C5 | Select the edit-frame signing principal. | Long-lived per-device replica key versus session key; offline signing must remain possible. |
| C6 | Select actor sequence genesis and increment rules. | First sequence `0` versus first sequence `1`. |
| C7 | Define document epoch presence and rollover triggers. | A protocol `docEpoch` is required by one draft and absent from another. |
| C8 | Freeze protocol bounds. | Typed intent 256 versus 512 KiB; frame, snapshot, checkpoint parent, tip, and anchor limits need one set of constants. |
| C9 | Define the checkpoint maximum frontier and invalid-child handling. | Service-computed frontier after content validation versus declared parent tips; an invalid child must not mask a valid parent. |
| C10 | Define service document discovery without making ProjectIndex content service-readable. | Service document registry and route discovery need an authority, registration transaction, and anti-rollback rule. |
| C11 | Define resource-proof layers. | A local durable-index digest must not be mistaken for remotely verifiable wire evidence; local commit and blob replication ACK require distinct proofs. |
| C12 | Freeze the typed-intent protocol token. | Existing `/1` text versus an intentionally breaking `/2` cutover. |
| C13 | Define exact causal-base reconstruction after compaction. | Candidate validation requires the exact base while pruning removes history; the retained witness is unresolved. |
| C14 | Approve or reject the proposed Canvas containment and generation convergence schema. | Flat containment ownership and immutable generation begin/terminal claims need cross-layer confirmation. |
| C15 | Freeze semantic undo/redo behavior under remote edits. | Local undo must not be silently cleared by a remote frame, but inverse/forward intent validity and failure semantics must be exact. |
| C16 | Define bootstrap and stranded-history product behavior. | New device with no online holder, old work after checkpoint/cutoff, and recoverable-but-not-team-visible data require explicit states. |

## Required answer format

For each item, every reviewer must supply:

1. one exact normative choice, including constants and failure state where relevant;
2. the strongest objection to that choice;
3. a falsifiable executable test or spike;
4. any clause that must be deleted from that reviewer's own draft.

A majority vote is insufficient. Any disagreement returns the item to all three
reviewers. The primary task may normalize headings, terminology, cross-references,
and formatting only after semantic unanimity.
