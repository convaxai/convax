# Plugin-to-Host Change Governance

Status: mandatory review gate.

Plugin development consumes the public `@convax/plugin-api` Catalog and
`@convax/plugin-sdk` contracts. It does not own Host architecture. When a concrete
Plugin cannot be implemented with the published surface, the Plugin task must stop
at a capability request; it must not decide to modify the Convax repository.

## Non-negotiable boundary

A Plugin author or Plugin-authoring Agent may:

- inspect generated Host API and Plugin SDK references;
- check `since`, audience, grant, scope, side effect, and live availability;
- use an existing public capability exactly as declared;
- propose a generic missing capability from the `convax-plugins` repository.

It may not:

- edit, branch, commit, push, or open a PR in the Convax Host repository;
- import Host-private files or duplicate Host domain logic;
- add a concrete Plugin id, vendor, model, or product branch to Host code;
- widen an existing grant or call an undeclared/raw IPC or MCP method;
- use direct Plugin objects, MessageChannels, globals, or a service locator;
- hand-edit generated Catalog, Markdown, JSON, or Skill reference output.

Writable filesystem access, a shared task, or an obvious-looking implementation
does not waive this rule.

## Required capability request

Create the request in the Plugin repository under:

```text
docs/host-capability-requests/<kebab-case-slug>.md
```

Use this structure:

```markdown
# Host capability request: <generic name>

Status: pending human review

## User problem
<Observable user need, without prescribing a Host implementation.>

## Blocked Plugin use case
<Plugin contribution and exact point where published APIs are insufficient.>

## Catalog evidence
- Checked Catalog version:
- Closest existing APIs:
- Availability result:
- Why required/optional declaration does not solve it:

## Requested generic contract
- Proposed capability id or contribution:
- Intended audiences:
- Scope:
- Side effect:
- Required grant:
- Bounded request:
- Bounded response:
- Stable errors:
- Cancellation and stale-scope behavior:

## Alternatives considered
<Existing APIs, Plugin-to-Plugin capability, workflow changes, or why no Host
change is needed.>

## Security and authority
<Principal, least authority, resource/path exposure, credentials, executable and
renderer boundaries.>

## Compatibility
<Catalog SemVer effect, manifest/transport impact, since version, and old-Host
behavior.>

## Falsifiable acceptance tests
1. <Evidence that proves the capability is correctly generic.>
2. <Failure/cancellation/stale test.>
3. <Evidence that would show the proposal should be rejected.>

## Plugin-side plan after approval
<Changes that remain entirely in convax-plugins.>

## Human decision audit record
- Decision: pending
- Reviewer identity: pending
- Decision time: pending
- Protected receipt URL and SHA-256: pending
- Accepted published contract version and digest: pending
- Runtime conformance evidence: pending
```

The request must not include a Host patch. It is ready only when a reviewer can
reject it, map it to an existing API, or approve a generic Host change without
reading concrete Plugin implementation code.

## Human decision and separate Host task

Only an explicit human approval creates authority to change Host code. Approval must
name the accepted generic boundary and start a separate Host task or PR. It does not
authorize the Plugin task to make the change itself.

Approval prose committed by an Agent or Plugin author is not an approval. A
repository-local `humanDecision`, an edited request status, or deletion of the
request cannot unlock publication. Automated unblocking requires a protected,
externally verified human-decision receipt bound to the exact accepted generic
contract version, Catalog digest, affected Plugin version and runtime conformance
evidence. Until such a verifier is implemented, machine policy must accept only
pending requests and keep every affected Plugin version blocked.

The Plugin repository release gate must compare the candidate policy with the
exact protected-main commit immediately preceding the candidate. Every pending
request id and every affected `{kind,id}` obligation from that commit must remain
pending, even across package version bumps. Removing the request document, policy
entry, and workspace declaration together is a release error, not a resolution.
The protected-base check must run before Marketplace version selection, and the
workflow plus checker require human-owned branch protection/CODEOWNERS; repository
text alone cannot prove reviewer identity.

An approved Host change must:

1. name the owning Host package;
2. update typed source in `@convax/plugin-api` or `@convax/plugin-sdk`;
3. assign Catalog `since` and compatibility semantics;
4. generate human and Skill references from code;
5. add availability, permission, cancellation, stale-scope, and conformance tests;
6. preserve contribution/call separation and concrete-Plugin independence;
7. release the Host contract before the Plugin declares it.

After release, the Plugin task may resume against that published contract. Rejection
or deferral means the Plugin must use an existing public alternative or remain
blocked; it must not create an unofficial bridge.
