# 0044: A script run is fenced to its target document

Date: 2026-11-14. Status: accepted, implementor default, re-openable. Supersedes [ADR 0017](0017-caller-identity-and-the-head-grant.md) rule 7 in part and one sentence of [ADR 0043](0043-a-persons-pin-consents-to-writes-on-its-document.md). Source: defect D14 of the pod-pages run; the implementor's rulings of 2026-11-14.

## Context

A person pinned a Page to one document while a second document was open in the same Revit. The Page's script was refused with `script.ungranted-documents`. The refusal came from ADR 0017 rule 7:

> K9: arbitrary scripts can reach every document in the process. A Pea or Page script refuses if any open sibling lacks authority. Check the census again before dispatch. The grant is admission policy, not containment of arbitrary code or hostile same-user processes.

ADR 0043 kept it: "ADR 0017 rule 7's script sibling census and ADR 0038's guards for synchronize, overwrite or discard, and send outward remain in force."

The reason was real. A C# script can reach any open document, and the ReadOnly guard did not roll back a commit in a sibling. So every Page was blocked on any machine with two documents open. The alternative on the table was to keep the refusal, name the sibling, and tell the person to close it.

## Decision

1. **The fence.** `SiblingFence` in `RevitScriptExecutionService` opens a `TransactionGroup` on every other document that is open when the run starts, and rolls each one back when the run ends. It does this in every mode (ReadOnly, WriteTransaction, NoTransaction) and for every caller. What the run commits in such a sibling is discarded. Edits a person made in the sibling before the run stay, and the rollback does not leave the sibling modified.
2. **What stays writable.** A document the run opens itself (`EditFamily`, a file it opens, a new document) was not open at the start. It has no group and keeps what the run commits in it.
3. **Human runs are not exempt.** One rule holds for every caller. A run that deliberately writes two open documents has the second write rolled back and reported. This is on the owner's queue and is re-openable.
4. **The result says so.** A rolled-back sibling commit is one sentence in `changes.summary`, one `failures` row in the host's words (empty `definitionId`, outcome `RolledBack`), and a `fence` warning. The words are in `ScriptChangeLedger`.
5. **Refusals in plain words.**
   - Revit refuses `Save` and `SaveAs` on a document with a group open. The script fails on Revit's exception, and the result adds a `fence` warning that names the held documents.
   - Revit refuses `Close` on such a document. The script fails on Revit's own words; the host adds no sentence of its own.
   - When Revit will not open a group on a sibling, the run is rejected before the script is entered. The refusal names that sibling and says to close it or run on a copy in its own Revit.
6. **The host asks for the target alone.** `admitScript` returns the run's footprint: the target document, or nothing for a consented ReadOnly run (ADR 0043). The action journal records no document effect per open sibling and no `census` consume for a script. `script.ungranted-documents` is retired for new runs; receipts already written keep it, so the code stays in `refusalCodes`. A run aimed at a document the caller has no authority over answers `grant.required`.

What is superseded: the second and third sentences of ADR 0017 rule 7, and the words "ADR 0017 rule 7's script sibling census" in ADR 0043. What still holds: the first and last sentences of rule 7 (the grant is admission policy, not containment of hostile code), ADR 0038's three guards, and the `census` consume of the lifecycle actions (`lifecycle.ungranted-documents`).

## Consequences

- A pinned Page, an external device and Pea run scripts on their target whatever else is open beside it.
- The journal's record of a script changes shape. A reader that expected one effect per open document, or a `census` consume, finds the target only.
- Proof: `SiblingFenceProofTests` (the platform facts) and `ScriptSiblingFenceTests` (through the service), fresh Revit 2025, 15 passed at 56812dc3. Each rule has a mutant that was run red once: the fence removed in `SiblingFence.Raise`, and `admitScript` widened to the process in `control.test.ts`.
- The fence bounds a script's commits. It does not contain hostile code, and it does nothing for files a script writes outside Revit.
- Open limits, each UNPROVEN:
  - A workshared sibling: whether a rolled-back commit leaves borrowed elements or other central state.
  - A sibling's redo stack after the commit and rollback.
  - The skip of linked and read-only documents, which rests on Revit opening no transaction on them.
  - `EditFamily` plus `LoadFamily` back into a fenced sibling. Revit accepted the calls; the check after the rollback was flawed.
  - A script that returns with a transaction still open on a sibling. The group may not roll back; the run then fails and names the document.
- Rejected: keeping the census with a better refusal. It leaves every Page blocked whenever a second document is open.
