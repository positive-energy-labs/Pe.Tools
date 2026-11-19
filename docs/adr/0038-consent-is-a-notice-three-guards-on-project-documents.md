# 0038: Consent is a notice; three guards on project documents

Date: 2026-11-11. Status: accepted, not built; rules 2.3 and 6 superseded by [ADR 0052](0052-no-guard-on-sending-outward.md). Source: kaitpw's rulings in the homes muse; the guard shapes come from the journeys thread and the kernel purger and driver forks. Evidence: `.artifacts/runs/homes-crusade-20261111/muse/` (`R4-permissions.md`, `POSITION-v2.md` to `POSITION-v4.md`, `round3/`). Amends [ADR 0027](0027-one-route-one-subject-one-consent.md) rule 11. ADR 0027 rule 12 stands. Builds on ADR 0036 (harness tools are ungated), which exists only on the unmerged branch `t3/pea-muas-retest`. See the [homes ledger](../features/homes/LEDGER.md) for the retained decisions and open work.

## Context

A person meets one permission question, the per-thread run-consent row. Pea meets about fifteen silent refusals. On main, `harness/threads.ts` refuses every native shell and file call and tells the model that the user refused. Consent fires on any non-empty footprint (`control.ts`, `if (!footprint.length) return null`), so opening a model waits on a "Reject?" window; the agent ledger on `t3/pea-muas-retest` records one such wait at 4 min 27 s, not diagnosed. No operation metadata marks save, synchronize, delete or upload. The owner asked for permissions to be rebuilt "from the very ground up how this should manifest in user land, and work backwards".

## Decision

1. **Consent is a notice, not a boundary.** kaitpw: "your list of sync, save, and upload I think are literally the only things that need guars against. I wanna move towards safteynets and notices, not guardrails." Pea acts, and the notice feed says what it did. Nothing else asks.
2. **Exactly three guards, defined by the act:**
   1. Synchronize with central.
   2. Overwrite or discard a person's model state: save over a model, or stop, close, reset or restart a session that has unsaved changes.
   3. Send outward: a file's bytes to any service other than the inference provider, or a message or share made as the person.
3. **Guards 1 and 2 cover project documents only.** kaitpw: "the guard, whatever it is, should only guard against save/sync for projects, not families." Family Foundry and scripts save family files with no guard; the owner calls that "a non-negotiable".
4. **A guard never waits inside a tool call.** The call returns "held" at once, worded as held and never as the person refusing. The person presses Save or Synchronize in Revit themselves.
5. **Choke points, not metadata.** Save and synchronize are held at Revit's cancellable pre-events (`DocumentSaving`, `DocumentSavingAs`, `DocumentSynchronizingWithCentral`), so a script is covered without being classified. The pre-event tells Pea's save from the person's: a Save the person presses during a Pea run goes through, and the receipt records it as the person's. Discard is held in the host's own `instances.stop`, `close`, `reset` and restart handlers, which read `Document.IsModified`; when it cannot be read the call returns "held". An outward send of file bytes is held in the one function that uploads.
6. **A setting can pre-allow an outward service.** A firm or project setting that allows the hosted parser turns guard 3 into a notice for that service. The hosted reader is LlamaParse at `agentic_plus` with markdown, per the owner's ruling recorded on `t3/pea-muas-retest` at 468cf1b1.
7. **The honest limit is written down.** Guards cover Pea's own doors. A shell `curl` or a file copy gets past them, so they catch mistakes and not adversaries. The written promise also says that inference sends what Pea reads to the model provider.
8. **Not guards:** opening a model, reading any drive, writing to the shared drive, downloading vendor data, writing a cited catalog row, and a Work edit.

## Consequences

- ADR 0027 rule 11 is amended: the per-thread run consent with its auto-approve window is narrowed to the three guarded acts and then replaced by the "held" return. `chat.autoApprove` is deleted in the same change that narrows the trigger, never before it. The native refusal (`isPeaTool`) is deleted.
- The remote MCP gateway does not land until its send tools have a door that returns "held".
- The hosted parser path cannot merge ungated: a trimming commit on `t3/pea-muas-retest` removes it and the gateway, and then the branch merges with the local parser only.
- Every guard test ships a named mutant that turns it red and a sentinel that proves its scan is not empty. The set of acts that ask is a literal list of three in one test, so growing it is a visible edit and the owner's decision.
- UNPROVEN[no C# file subscribes to these pre-events at a02b8aea]: that a pre-event can hold Pea's save on a project document and attribute it. Fallback, per the owner: Pea scripts and Pe's own save helpers refuse the save and synchronize API entities for project documents, and family documents stay free.
- The real Chadds model is never saved or synchronized by a drive. Guard drives write to the detached clone and to the cloud throwaway clone named in the homes ledger.
- Rejected: a catalog-wide consequence axis; a run-registry split out of the consent service; a guard on any act in rule 8.
