# 0017: Caller identity and the head grant

Date: 2026-10-12. Status: accepted; completed policy rulings 2026-10-13.
Source: kaitpw, ADR 0016 review and the 2026-10-13 reorient campaign. The [agent ledger](../features/agent/LEDGER.md) records the rulings.

## Context

[ADR 0015](0015-the-harness-drives-pea-is-tools-and-ui.md) gives inference and tool approvals to the harness.
[ADR 0016](0016-proposals-review-the-grant-gates.md) makes the document grant the one Revit write gate.
Neither transport headers nor a proposal prove human consent. The host must carry caller identity and grant lineage through admission, dispatch, and projection.

## Decision

1. The host mints five principals: `human`, `pea`, `page`, `external-mcp`, and `service`. Anonymous transport is read-only. A browser API request needs a host-minted session cookie. Browser headers alone never create a human. The local CLI bearer is a human consent marker. A harness bearer binds one Pea thread. MCP may inherit that Pea bearer, never a terminal human bearer.
2. One request admission function takes the caller and the route permission. The typed route contract owns permissions and admin classification. A missing permission refuses. SDK claim tokens mint a service caller only for shutdown and window. MCP protocol admission mints or checks its own session before any product action.
3. Machine administration requires a human and sits outside the document grant. Share leaves remote administration off by default. Remote administration off also forbids a remote browser from granting rw. External MCP remains read-only until a human pairing and renewal step exists.
4. The host is the sole writer of the head grant. It names an exact `{session, openId}`, grant time, expiry, human transport, authenticated tailnet login when present, and revoke evidence. Head selection and revoke advance the revision. A fork retains its target but copies no grant or human-message evidence.
5. A human selects any document. Pea selects only acquired lifetimes. Writes name an acquired document or the exact granted head; reads need no grant. A human thread message renews an unrevoked grant for 60 minutes. Closing the lifetime ends its authority. An old admission cannot survive revoke and re-grant, even on the same lifetime.
6. Revoke prevents a new step from beginning. Begun steps finish and report; there is no rollback. Process stop, restart, and reset refuse when another ungranted user document remains. Acquisitions and SDK posture derive whose documents they are; SDK custody alone does not.
7. K9: arbitrary scripts can reach every document in the process. A Pea or Page script refuses if any open sibling lacks authority. Check the census again before dispatch. The grant is admission policy, not containment of arbitrary code or hostile same-user processes.
8. A Page acts as `page` through its own path doors. Its host-owned binding is a thread, a pinned Address, or none. A thread follows its head grant. A pin resolves against inventory and writes only an acquired lifetime. No active-document or title fallback exists. The human binds in SPA chrome; Page content draws no consent control.
9. The host projects grant state with `hostNow`. Surfaces hide rw on stale readings or unavailable lifetimes, and use host clock differences for expiry refresh. The rw mark revokes with one click. JSON target pins fail closed and retain their source; malformed JSON never becomes a session name.
10. Harness approval and Revit grant are distinct terms and policies. Unguarded harness tools do not grant Revit rw; a document grant does not approve unrelated harness tools. Proposals remain review artifacts. Catalog eligibility names principals rather than a binary actor.

## Consequences

The implementation has deterministic tests for anonymous admission, human-only question and approval answers, fork grant removal, revision fencing, script sibling refusal, host-clock projection, and the chrome revoke control. These tests do not certify native queue behavior or a browser's layout.

Admission consumes the one typed route table in `host-contracts/src/pe-api.ts`; every route requires a permission, tested exhaustively. `admin` and `grant` permissions carry remote-administration policy rather than a second path map. Wave C must preserve the Page chrome mount when changing the shell. Native queue-begin enforcement and visual acceptance remain owed. Remote pairing, proxy authentication evidence, per-device revocation, and isolation of shared Page origins remain separate work; same-origin Pages and same-user local code are not a hostile-code security boundary.
