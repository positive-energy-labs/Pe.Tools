# 0016: Proposals are for review; the write grant is the one gate

Date: 2026-10-12. Status: accepted. Source: kaitpw, thread "Pea-Revit Document Control UX Rework", rulings Q7 to Q15. The ruling lines are in [the agent ledger](../features/agent/LEDGER.md).

## Context

Every route that Pea can change uses the proposal → staged → committed cell (`trichotomyCellSchema`, `agentWriteMask: [[..., "proposal"]]`). Pea may only propose, and a person stages and commits. That made the proposal a write gate. It did not fit the work:

- A background job on a throwaway copy, such as 140 schedule renames, had to propose although nothing of the user's was at risk.
- The user had nothing to check the proposals against except their memory of the target document.
- Users at the bottom of the AI trust ladder need one boundary they can understand. They do not need a ceremony on every write.

## Decision

- **A proposal is a review artifact only.** Pea uses one when a human needs to review content, often as a spreadsheet of changes. It is never a precondition for a write.
- **There is one write gate: the crossing into the user's live document.** Pea writes to a user's open document only while the human holds the `rw` grant on it. The grant is the thread head naming that document. Only the human moves the head onto a user's document. `target_set` names Pea's own documents only.
  - Under the grant, Pea writes live. Each write leaves one receipt. There is no per-call harness prompt for Pea's Revit tools.
  - Pea's own sessions, copies and files are always writable.
- **The grant ends** when the document closes, or 60 minutes after the user's last message in that thread. Each message renews it. One click on the `rw` mark revokes it. Expiry by mutation count and a daily reset were rejected: a count punishes big jobs and teaches Pea to batch, and a daily reset is arbitrary.
- **Workshared models get no special case.** Revit's element borrowing already refuses edits to elements another user owns, and the receipt names what Pea borrowed.
- **Full Revit control, with no trust setting.** Every lifecycle verb (open, start, close, stop, restart) is `actor: "any"`. The grant above is the only limit.

## Consequences

- `agentWriteMask` stops meaning "Pea may only propose". Each route that uses it (families, family, rooms, parameter links, schedule grid, instances) must decide whether its cell is review content (keep the proposal) or a launch or setting (Pea writes it directly). Instances is the first: staged launch is deleted.
- The `rw` grant must be visible wherever Pea's target shows: in the composer, the machine drawer, and `/open`. A grant nobody can see is not consent.
- `AGENTS.md` Posture still says "Agents propose; users retain approval, edit, staging, and rejection control." It contradicts this decision and is owed a rewrite. kaitpw approves the wording.
- Background work becomes the default safe path. Pea hands back a diff plan plus the copy, and the plan is a review artifact under this decision.
