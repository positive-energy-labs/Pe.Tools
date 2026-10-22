# 0021: One access switch; reads are free; a thread targets a set of documents

Date: 2026-10-22. Status: accepted. Supersedes the grant clock and visibility rule of [ADR 0016](0016-proposals-review-the-grant-gates.md) and rules 5 and 10 of [ADR 0017](0017-caller-identity-and-the-head-grant.md). Source: kaitpw, thread "grant" (composer protoui round 1, then muse), 2026-10-22.

## Context

ADR 0016 made the `rw` grant the one Revit write gate: the thread head names one user document, the grant expires 60 minutes after the last human message, and a visible `rw · Nm` mark revokes it. The 2026-10-14 ruling then made selecting the document the grant itself. What was left beside the target added little:

- The 60-minute clock. Every human message renews it, and scheduled tasks launch fresh threads with no grant (`scheduled-tasks.ts`). It fires only when one Pea run goes on for more than an hour, and then it stops a big job halfway. kaitpw: no real case wants that stop.
- The `rw · Nm` chip. "A grant nobody can see is not consent" meant the targeted document's name is visible, not a separate grant mark. kaitpw rejected all five chip variants of protoui round 1.
- One document per thread. The BIM-manager loop (edit a family, load it into projects, carry standards between projects) is the main use, and it touches several documents in one thread.

Reads already need no grant, except one: a ReadOnly script refuses beside an open sibling document that has no authority (K9), because `ExecuteInReadOnlyRollbackGuard` rolls back the target only, so a commit on a sibling persists.

## Decision

1. **Reads are unconditional.** Any principal that can read may read any open document. The ReadOnly rollback guard covers every open document in the Revit process, so K9 no longer refuses a read.
2. **One access switch governs writes.** The existing harness access setting (`providers.access().guarded`) is the only switch, with two stated consequences: the harness's shell and file tools, and writes to the user's open Revit documents. ADR 0017 rule 10 (harness approval and Revit grant are separate) is reversed.
   - **Full**: Pea writes any open document.
   - **Guarded**: Pea writes its own lifetimes and the documents a human pointed the thread at.
3. **A thread targets a set of documents.** Only a human adds a user document to the set. Authority ends when the document closes or a human removes it from the set. There is no clock and no renewal.
4. **The document name is the visible consent.** The composer shows the targeted documents by name, with a tone where write authority needs saying. No separate grant mark, countdown or revoke popover exists.
5. The host keeps the admission record internally (who added the document, when, revision fencing, human transport, remote-administration policy from ADR 0017 rules 1 to 4 and 6 to 9). It is a host invariant, not a user-facing noun.

## Consequences

- Deleted: `GRANT_MS` and expiry in `control.ts`, `heardHuman` renewal, `GrantChip`, `GrantView` minutes, and the `rw` marks in the machine drawer, `/open` and Sharing.
- The thread head schema changes from one target to a set; `resolveCallTarget`, `target_set`, Page binding (ADR 0017 rule 8) and Pea's instruction texts follow. The multi-document picker UX is not designed yet.
- K9 depends on a rollback group per open document. Until that is proven in Revit, the sibling refusal stays.
- Under Full, a user who wants Revit writes free and the shell guarded has no setting. That user was judged not to exist; a second switch is the reversal path.
