# 0044: A script run is fenced to its target document

Date: 2026-11-14. Status: accepted, implementor default, re-openable. Supersedes [ADR 0017](0017-caller-identity-and-the-head-grant.md) rule 7 in part and one sentence of [ADR 0043](0043-a-persons-pin-consents-to-writes-on-its-document.md). Source: defect D14 of the pod-pages run; the implementor's rulings of 2026-11-14.

## Context

A person pinned a Page to one document while a second document was open in the same Revit. The Page's script was refused with `script.ungranted-documents`. The refusal came from ADR 0017 rule 7:

> K9: arbitrary scripts can reach every document in the process. A Pea or Page script refuses if any open sibling lacks authority. Check the census again before dispatch. The grant is admission policy, not containment of arbitrary code or hostile same-user processes.

ADR 0043 kept it: "ADR 0017 rule 7's script sibling census and ADR 0038's guards for synchronize, overwrite or discard, and send outward remain in force."

The reason was real. A C# script can reach any open document, and the ReadOnly guard did not roll back a commit in a sibling. So every Page was blocked on any machine with two documents open. The alternative on the table was to keep the refusal, name the sibling, and tell the person to close it.

## Decision

1. **The fence.** `SiblingFence` in `RevitScriptExecutionService` opens a `TransactionGroup` on every other writable, unlinked document that is open when the run starts, and rolls each one back when the run ends. A linked or read-only document gets no group, because Revit opens no transaction on it. It does this in every mode (ReadOnly, WriteTransaction, NoTransaction) and for every caller. What the run commits in such a sibling is discarded. Edits a person made in the sibling before the run stay, and the rollback does not leave the sibling modified.
2. **What stays writable.** A document the run opens itself (`EditFamily`, a file it opens, a new document) was not open at the start. It has no group and keeps what the run commits in it. In ReadOnly such a commit is not discarded either, so the run then fails as `PERSISTED`. A document the run reaches by `OpenDocumentFile` or `EditFamily` that was already open is that open document, and stays fenced.
3. **Human runs are not exempt.** One rule holds for every caller. A run that deliberately writes two open documents has the second write rolled back and reported. This is on the owner's queue and is re-openable.
4. **The result says so.** A rolled-back sibling commit is one sentence in `changes.summary`, one `failures` row in the host's words (empty `definitionId`, outcome `RolledBack`), and a `fence` warning. The words are in `ScriptChangeLedger`.
5. **Refusals in plain words.**
   - Revit refuses `Save` and `SaveAs` on a document with a transaction or a group open. The script fails on Revit's exception, which does not say which document it refused. So the result adds one `transaction` warning from `ScriptChangeLedger.SaveRefusedWords` that names every hold of the run: the one on its own document (the ReadOnly guard, the host's transaction, or the NoTransaction undo group) and the fence's on the siblings. A save the run's own undo group refused is therefore never blamed on the fence alone.
   - Revit refuses `Close` on such a document. The script fails on Revit's own words; the host adds no sentence of its own.
   - When Revit will not open a group on a sibling, the run is rejected before the script is entered. The refusal names that sibling and says to close it or run on a copy in its own Revit.
6. **The host asks for the target alone.** `admitScript` returns the run's footprint: the target document, or nothing for a consented ReadOnly run (ADR 0043). The action journal records no document effect per open sibling and no `census` consume for a script. `script.ungranted-documents` is retired for new runs; receipts already written keep it, so the code stays in `refusalCodes`. A run aimed at a document the caller has no authority over answers `grant.required`.

What is superseded: the second and third sentences of ADR 0017 rule 7, and the words "ADR 0017 rule 7's script sibling census" in ADR 0043. What still holds: the first and last sentences of rule 7 (the grant is admission policy, not containment of hostile code), ADR 0038's three guards, and the `census` consume of the lifecycle actions (`lifecycle.ungranted-documents`).

## Consequences

- A pinned Page, an external device and Pea run scripts on their target whatever else is open beside it.
- The journal's record of a script changes shape. A reader that expected one effect per open document, or a `census` consume, finds the target only.
- Proof: `SiblingFenceProofTests` (the platform facts) and `ScriptSiblingFenceTests` (through the service), fresh Revit 2025, 15 passed at 56812dc3. Each rule has a mutant that was run red once: the fence removed in `SiblingFence.Raise`, and `admitScript` widened to the process in `control.test.ts`.
- A person's Redo in a sibling survives a run. On Revit 2025 a posted Redo still restored the sibling's undone edit after a ReadOnly, a WriteTransaction and a NoTransaction run on the target, and after a run that committed in the sibling and was rolled back; a raw commit in the sibling took it, as expected (attached session, 2026-11-14). A ReadOnly run on a document itself keeps that document's Redo too.
- The Redo probe was `SiblingRedoProbeTests`: one attached run for each step, because Revit runs a posted Undo or Redo only when it is idle. No suite ran it, so it is deleted. Recover it with `git show 9f1a40b6:dotnet/Pe.Revit.Tests/Proofs/SiblingRedoProbeTests.cs`.
- The fence bounds documents that are open when the run starts, not documents the run opens. It does not contain hostile code, and it does nothing for files a script writes outside Revit. A consented ReadOnly read, admitted with no authority over its target, can still open a file from disk, commit in it and save it. This is the recorded stance that the grant is a guard and not a boundary; no code changes for it.
- 2026-11-18: the fence's mechanism, a `TransactionGroup` rolled back over committed transactions, is proven on a run's own document (`ScriptRunProofTests`, fresh Revit 2025; a `NoTransaction` run that does not finish is now rolled back this way). Read back from the document, nothing of the run remains after a `LoadFamily`, after `EditFamily` plus a load back, and on a workshared local. On the local the rollback does not give back what the run borrowed: the two elements it modified stay owned by the user, the family workset it made is gone, and a synchronize that relinquishes sends nothing of the run to the central (a second local made afterwards reads as before the run). The first and third limits below are therefore proven for a target and still UNPROVEN for a sibling.
- Open limits, each UNPROVEN:
  - A workshared sibling: whether a rolled-back commit leaves borrowed elements or other central state.
  - The skip of linked and read-only documents, which rests on Revit opening no transaction on them.
  - `EditFamily` plus `LoadFamily` back into a fenced sibling. Revit accepted the calls; the check after the rollback was flawed.
  - A script that returns with a transaction still open on a sibling. The group may not roll back; the run then fails and names the document.
- Rejected: keeping the census with a better refusal. It leaves every Page blocked whenever a second document is open.
