# 0043: A person's pin consents to writes on its document

Date: 2026-11-14. Status: accepted, implementor default, re-openable. Supersedes [ADR 0017](0017-caller-identity-and-the-head-grant.md) rule 8 in part. Applies [ADR 0038](0038-consent-is-a-notice-three-guards-on-project-documents.md) rule 1.

## Context

A person pins a Page to their open document in the host's chip. ADR 0017 rule 8 still refuses every write unless Pea acquired that document. This blocks write scripts, selections and pictures from a tool the person chose to use. ADR 0038 says, "Consent is a notice, not a boundary" and "Nothing else asks." ADR 0017 also states that same-origin Pages are not a hostile-code boundary.

## Decision

A pin whose host-owned `boundBy` is `human` consents to the Page's writes on the exact document lifetime resolved for that request. The Page acts as the person who pinned it. The receipt keeps the Page key, `boundBy: human` and the admitted lifetime. Its notice names the Page and the person who pinned it. The binding records a role, not an account name, so neither receipt nor notice invents a named identity.

A pin Pea made still writes only acquired documents. A person's pin gives no authority over another lifetime or session. An unbound Page keeps its refusal. ADR 0017 rule 7's script sibling census and ADR 0038's guards for synchronize, overwrite or discard, and send outward remain in force.

## Consequences

Same-origin Page script can already reach `/actions` as the person by choosing its referrer; ADR 0017 names this as a non-boundary, and this decision widens nothing there.

People can use a pinned Page's write tools without making Pea acquire their document or binding a thread first. The host carries the same pin consent through preflight, dispatch and the receipt, while preserving the Page as caller. A request never borrows authority from a changed binding or a different document lifetime. Pin consent adds no confirmation or approval wait. Accepted ADR 0017 remains unchanged; this ADR is the supersession record.
