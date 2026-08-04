# Collaboration v10 R5.13 minimal unique delta

Status: architecture-owner-authored, non-authoritative correction input. This delta replaces only section 2.2, the corresponding owner/count clauses, and the corresponding falsifiers of rejected R5.12 candidate SHA-256 `61c390d2206feab796928763c24a5da4e1d1fdbca23d30c0e6d4fbc2a11efbc8`.

Every other R5.12 clause and every inherited R5.11, R5.10, R5.9 G/H and approved R5.8 I clause remains byte-semantically unchanged.

## 1. Exact destructive native metadata capability

This section replaces R5.12 section 2.2 in full.

### 1.1 Ownership and scope

`@convax/project/node` owns exactly one internal destructive capability:

```ts
export type RemoteIngressEvidenceMetadataNativeDeleteResultV2 =
  | Readonly<{
      status: "deleted"
    }>
  | Readonly<{
      status: "already-absent"
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "native-delete-primitive-unavailable"
        | "native-root-identity-mismatch"
        | "native-containment-failed"
        | "native-entry-raced"
        | "native-object-mismatch"
        | "native-durability-failed"
        | "store-corrupt"
    }>

export interface RemoteIngressEvidenceMetadataNativeDeleteCapabilityV2 {
  deleteExactMetadataObject(
    command: Readonly<{
      projectId: ProjectIdV2
      projectEpoch: Id128V2
      objectKind: RemoteIngressEvidenceMetadataObjectKindV2
      objectRecordDigest: DigestV2
      deletionCommitRecordDigest: DigestV2
      deleteCommittedHeadRecordDigest: DigestV2
    }>,
  ): Promise<RemoteIngressEvidenceMetadataNativeDeleteResultV2>
}
```

The command contains no native path, URI, filename, directory, platform handle, inode, file id, connection-selected location or caller-provided basename.

This capability applies only to Project-private immutable admission metadata admitted by `RemoteIngressEvidenceMetadataObjectKindV2`. It grants no authority over:

- ordinary Project files;
- managed assets or blobs;
- Canvas frame/checkpoint objects;
- staging files;
- Plugin closures;
- Marketplace data;
- user-selected paths;
- arbitrary files under `.convax`.

Those owners retain their existing independent deletion contracts.

### 1.2 Closed kind-to-location mapping

The three R5.12 kinds retain the exact logical mapping:

```text
base =
  <ProjectEpochNativeStore>/
    remote-ingress-evidence-admission/publication

"admission-publication-operation":
  <base>/operations/<digest-native-key>.bin

"admission-publication-terminal":
  <base>/terminals/<digest-native-key>.bin

"admission-publication-recovery-head":
  <base>/recovery-head-records/<digest-native-key>.bin
```

This mapping is descriptive only. It is not permission to concatenate strings and call a pathname-based deletion API.

`<digest-native-key>` is produced only by the existing canonical Project-local record-digest native-key codec. The resulting basename must:

```text
contain no separator
contain no "." or ".." component
contain no alternate data-stream syntax
contain no drive, device or UNC prefix
contain no percent-decoded second representation
contain no Unicode normalization alternative
round-trip through the native-key codec byte-for-byte
```

Unknown kind, raw path input, fallback directory, filename inference, directory scan, cross-kind alias or non-canonical basename rejects before opening or unlinking any entry.

### 1.3 Trusted root directory handle

Project/node obtains the Project-epoch native-store root through the existing validated Project binding. It opens one trusted root directory handle and pins its exact native identity for the complete destructive operation.

The trusted root handle must:

```text
name the bound ProjectEpochNativeStore directory
be opened as a directory, not a pathname alias
reject symbolic links, junctions and other reparse objects
reject namespace or mount redirection that escapes the bound store
remain open through traversal, validation, unlink and durability barrier
match the Project binding's expected native root identity
```

A caller cannot supply or replace this handle.

Every subsequent component is resolved relative to an already validated directory handle. Re-resolving the Project store from an absolute or current-working-directory pathname is prohibited.

### 1.4 Fixed literal descriptor-relative traversal

Project/node traverses only the fixed literal components selected by the closed kind switch.

Each component must be opened relative to the immediately preceding directory handle with semantics equivalent to:

```text
open exact literal child
do not follow a symbolic link, junction or reparse point
require directory type
require containment in the trusted native-store namespace
retain the opened child directory handle
```

The exact parent directory handle for the final metadata object remains open until the complete operation terminates.

The implementation must not validate a string path with `realpath`, `lstat`, `stat` or equivalent and later reopen that path for deletion. Such check-then-reopen behavior is non-conforming even when the earlier check reported containment.

### 1.5 Final no-follow handle and record validation

Using the retained exact parent directory handle and canonical basename, Project/node opens the final entry without following symbolic links, junctions or reparse points.

Through that same final handle it must:

```text
require a regular immutable metadata file
acquire the platform's stable native file identity
read the complete bounded record bytes
validate exact record format for objectKind
validate exact projectId and projectEpoch
compute ProjectLocalRecordDigest over those exact bytes
require the result equals objectRecordDigest
require the current delete-committed head and deletion commit name that exact object
```

Examples of stable native identity include:

```text
POSIX-family:
  filesystem/device identity plus inode identity from the opened handle

Windows:
  volume identity plus stable file identifier obtained from the opened HANDLE
```

These examples are not the protocol ABI. A platform may use another identity only if it provides equivalent stable same-object comparison.

Record validation performed through one handle cannot authorize deletion of a subsequently reopened entry.

### 1.6 Same-entry conditional unlink

Immediately before deletion, Project/node re-queries the canonical basename relative to the retained parent handle without following links and proves that the directory entry still identifies the exact native object validated through the final handle.

The same-entry recheck and deletion form one non-reentrant native critical operation:

```text
expected parent identity remains unchanged
expected canonical basename remains unchanged
current directory entry exists
current directory entry is not a link or reparse object
current directory entry native identity equals the validated final-handle identity
-> unlink that entry relative to the same retained parent handle
```

The adapter must provide semantics equivalent to:

```text
unlinkEntryIfIdentityMatches(
  retainedParentHandle,
  canonicalBasename,
  expectedNativeFileIdentity,
)
```

The implementation may use descriptor-relative POSIX operations, Windows handle-relative operations, a platform-specific conditional-delete primitive, or an equivalently strong native-store mutation guard.

POSIX names such as `openat`, `openat2` and `unlinkat` are illustrative implementation options only. They are not the portable contract.

Windows implementations may use rooted directory handles, reparse-point-safe relative opens, stable volume/file identifiers and handle-relative or identity-checked disposition operations. They must not fall back to a path reconstructed from a drive letter, UNC path or final Win32 pathname.

If the platform cannot guarantee all of the following:

```text
rooted containment
no-follow traversal
stable final-object identity
same-entry identity recheck
same-parent relative deletion
exclusive non-interleaving across recheck and deletion
```

the capability returns:

```text
status = "rejected"
code = "native-delete-primitive-unavailable"
```

and performs zero unlink operations.

Any detected parent, basename, entry or file-identity change returns:

```text
status = "rejected"
code = "native-entry-raced"
```

and performs zero unlink operations.

A detected race must never be retried by deleting the newly observed entry. Recovery must restart from the durable `delete-committed` authority and revalidate the complete operation.

### 1.7 Same-parent durability barrier

After successful relative unlink, Project/node flushes the directory-entry mutation through the same retained parent directory handle.

The required portable semantic is:

```text
the exact directory entry removal is durable across process and machine restart
before status="deleted" is returned
before terminal-deleted metadata state is published
```

A POSIX directory `fsync` and a Windows filesystem-supported directory or metadata flush are implementation examples, not protocol-level API requirements.

Reopening the parent by pathname and flushing the reopened directory is prohibited because it does not prove identity with the directory used for unlink.

If the platform cannot provide an equivalent same-parent durable directory-entry barrier, the operation fails closed with:

```text
status = "rejected"
code = "native-delete-primitive-unavailable"
```

before unlink.

If the platform claimed the primitive but the post-unlink durability barrier fails, it returns:

```text
status = "rejected"
code = "native-durability-failed"
```

The durable `delete-committed` tombstone remains current. Recovery reopens the trusted root and deterministically resolves whether the exact entry is present or absent before making any terminal transition.

### 1.8 Already-absent recovery

`status="already-absent"` is permitted only when:

```text
the exact delete-committed head remains current
the exact deletion-commit record validates
trusted-root and retained-parent identities validate
the canonical basename resolves to no entry
the same-parent durability barrier succeeds
the candidate has zero current native references
```

Absence discovered through a raw pathname, directory scan, wrong kind, wrong parent or caller-supplied location is not evidence.

An absent entry does not authorize deletion of any alias, replacement or similarly named object.

### 1.9 Exact successful sequence

The only successful physical deletion sequence is:

```text
reload exact delete-committed head and deletion commit
-> acquire trusted ProjectEpochNativeStore root directory handle
-> validate pinned root identity
-> descriptor-relatively traverse fixed literal no-follow directories
-> retain exact final parent directory handle
-> derive canonical basename from objectRecordDigest
-> open final entry no-follow relative to retained parent
-> acquire stable native file identity
-> read and validate exact record bytes through that handle
-> recheck delete-committed authority and zero references
-> atomically recheck same parent/name/native identity
-> unlink relative to the same retained parent handle
-> flush the same retained parent handle
-> verify exact canonical entry absence
-> return deleted
-> publish terminal-deleted through the unchanged R5.12 barriers
```

No step grants permission to delete a different entry after mismatch or race.

## 2. Exact owner and declaration count amendments

Add to the R5.12 exactly-one declarations:

```text
one RemoteIngressEvidenceMetadataNativeDeleteCapabilityV2 contract
one closed objectKind-to-fixed-literal-directory switch
one canonical digest-to-basename codec use
one trusted-root-handle acquisition path
one retained-parent destructive operation
one platform adapter per supported native platform
```

Add to the R5.12 `@convax/project/node` ownership list:

```text
trusted ProjectEpochNativeStore root-handle acquisition
fixed literal descriptor-relative no-follow traversal
stable native file-identity validation
same-entry conditional relative unlink
same-parent directory-entry durability barrier
fail-closed cross-platform adapter selection
```

Add to the R5.12 exactly-zero declarations:

```text
caller-supplied native deletion path
caller-supplied deletion basename
absolute-path metadata unlink
current-working-directory-relative metadata unlink
realpath/lstat check followed by pathname reopen
symbolic-link, junction or reparse traversal
mount or namespace escape from the trusted store
final link or reparse object accepted as a metadata record
record validation through one handle followed by deletion of a reopened entry
unlink after parent, basename or native file identity drift
retry that deletes a replacement observed after a race
directory scan used to infer an absent or replacement object
directory flush through a reopened pathname
POSIX-only public protocol ABI
Windows path-string fallback
weak platform fallback when an equivalent native primitive is unavailable
extension of this capability to ordinary Project files, assets or blobs
second destructive metadata authority
```

No package, dependency direction, persistence owner or public Plugin/Agent capability changes.

## 3. Mandatory falsifier amendments

Add the following mandatory falsifiers after the unchanged R5.12 list:

1. Replacing an intermediate directory with a symbolic link, junction, reparse point or namespace escape after root acquisition causes zero unlink operations outside and inside the selected parent.
2. Swapping an intermediate pathname after it was inspected cannot redirect traversal because every child is opened relative to the retained validated parent handle.
3. Replacing the final directory entry after record validation but before same-entry recheck returns `native-entry-raced` and performs zero unlink operations.
4. Replacing the final entry with another regular file having a different stable native identity performs zero unlink operations even if its filename is unchanged.
5. Replacing the final entry with a symbolic link, junction or reparse object performs zero unlink operations.
6. Mutation of kind, canonical basename, format, Project, epoch, record bytes or digest performs zero unlink operations.
7. A cross-kind hard-link or pathname alias cannot satisfy both the closed kind switch and exact record-format validation.
8. The entry used for unlink and the directory used for the durability barrier are proven through the same retained parent handle.
9. Swapping the pathname that originally named the parent after unlink cannot redirect the durability flush.
10. A platform lacking rooted no-follow traversal, stable file identity, same-entry relative unlink or same-parent durability returns `native-delete-primitive-unavailable` before unlink.
11. POSIX and Windows conformance adapters pass the same abstract capability suite without exposing platform API names through the domain contract.
12. An unexpected throw or ambiguous native result never selects a replacement entry for deletion; recovery restarts from the exact durable tombstone.
13. Recovery reports `already-absent` only for the exact canonical entry under the retained validated parent and never from a directory scan.
14. Invoking the capability with an ordinary Project file, Canvas object, asset, blob, Plugin object or arbitrary `.convax` path is impossible through the type/owner boundary and produces zero unlink operations.
15. Every unchanged R5.12 state-machine, retention, GC, physical-deletion, ACK and inherited falsifier continues to pass.

## 4. Red-team closure

The strongest rejection attempts are:

1. A checked-safe path can be swapped before unlink. This is rejected by trusted rooted handles, descriptor-relative traversal, retained parent identity and same-entry conditional relative deletion.
2. Record validation can authorize deletion of a replacement inode. This is rejected by final-handle validation plus exact stable-identity comparison immediately at the conditional unlink boundary.
3. A non-POSIX platform may silently weaken containment or durability. This is rejected by the platform-neutral capability contract and mandatory fail-closed behavior when Windows or another platform cannot provide equivalent primitives.

Flaw types checked:

```text
TOCTOU
path traversal
symlink/junction/reparse escape
mount or namespace escape
object-identity drift
cross-kind aliasing
check/reopen mismatch
wrong-parent unlink
wrong-parent durability flush
weak cross-platform fallback
destructive authority expansion
```

No major defect remains within this delta’s scope. This conclusion becomes false if the implementation substitutes pathname re-resolution for retained handles, permits unlink after an identity race, or treats a best-effort platform primitive as equivalent.

Score: 9/10. The remaining deduction is platform-adapter complexity. It is not fatal because unsupported platforms fail before unlink, the domain contract is platform-neutral, and the mandatory race/fault suite verifies the destructive boundary independently for every admitted adapter.

## 5. Unconditional unique author vote

As Project/store/URI architecture owner, I unconditionally vote `ADOPT` for this exact R5.13 minimal delta and no broader change.
