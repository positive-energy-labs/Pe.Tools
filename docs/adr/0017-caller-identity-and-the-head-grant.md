# 0017: Caller identity and the head grant

Date: 2026-10-12. Status: Accepted 2026-10-12. Source: kaitpw, "i take all your recommendations", after [round 2 section 2](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round2/VERDICTS.md:60). D1-D14 below use the owner's capture numbering, not that sheet's D9-D16 numbering.

## Context

[ADR 0016](0016-proposals-review-the-grant-gates.md) is the owner's grant policy. This ADR records how the code carries it. The reviews found five gaps, with source evidence rather than runtime proof:

- The caller self-asserts `actor`, and an absent header means human ([control review:14](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round2/control-boundary-muse-opus.md:14); `ts/apps/host/src/call-route.ts:228-229`).
- The head has no grant, expiry, or revoke fields ([round-1 check:52](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round1/L1-grant-targeting-check.md:52); `ts/packages/agent-contracts/src/target.ts:150-160`).
- The host never receives the thread on Pea's `/call` requests ([round-1 check:55](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round1/L1-grant-targeting-check.md:55)).
- Pages bypass the gate as `actor:"human"` ([Pages check:83](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round1/L3-contribution-pages-examples-check.md:83); `ts/apps/host/src/pages/pe.js:129-135`).
- The patch bay computes a grant in the browser without a host clock ([control review:18](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/review-20261012/round2/control-boundary-muse-opus.md:18); `ts/apps/web/src/open/grants.ts` on `feat/revit-patchbay@9afc38e8`).

## Decision

1. **D1.** The grant is typed fields on the one head aggregate: document lifetime, expiry, and revoke evidence. The host is its only writer.
2. **D2.** A host-minted caller context replaces self-asserted `actor` at every door. It carries principal (`human`, `pea`, `page`, `external-mcp`, or `cli`), thread, head revision, exact destination, and request id. Anonymous loopback is read-only.
3. **D3.** Agent stop, restart, and reset refuse when any other ungranted user document is in the session. They are free on an empty user Revit.
4. **D4.** Revoke means no new step begins. Begun steps finish and report. There is no rollback. Queued-but-unbegun work is refused.
5. **D5.** Wave 1 needs no SDK hook. The grant is Pe.Tools work.
6. **D6.** "Whose session" is derived per session from the launch receipt plus SDK posture. Per-document derivation comes later when background copies exist. SDK custody alone is not ownership.
7. **D7.** `feat/revit-patchbay` may merge with agent lifecycle human-only on user sessions. Direct launch and the staging deletion stay.
8. **D8.** Per-call write overrides name only Pea's own lifetimes or the granted head. Reads never need a grant.
9. **D9.** A Page acts as itself (`page` principal) under its bound thread's grant. This supersedes the [Pages ledger](../features/pages/LEDGER.md) decision that a page button acts as the human.
10. **D10.** Page target binding is host-owned: `{thread}`, pinned Address, or none. The human sets it through a bind chip. Pea sets it only to its own documents. Delete the fallback chain.
11. **D11.** Pages use path doors `/pages/<slug>/…` with a `page` principal. A separate origin comes only when shared remotely.
12. **Consensus.** Add no contribution registry. Keep the standalone Pages root. Build no SDK job platform or remote design work now. Firm/project overrides are outside this cut.

## Consequences

The composer, machine drawer, and `/open` show the same grant chip from a host clock. Pages show their binding and grant. Every refusal names its door and reason. Delete `actor` header trust, browser-computed grants, and the Page fallback chain. These decisions do not certify enforcement.

Wave 1 builds caller identity, the head grant, and Page binding. Wave 3 owes D12 key grammar before the catalog grows, D13 the membership reader, and D14 kind-by-path. The 14 telemetry questions remain unanswered. The [host ledger](../features/host/LEDGER.md) and [Pages ledger](../features/pages/LEDGER.md) own implementation and proof follow-ons.
