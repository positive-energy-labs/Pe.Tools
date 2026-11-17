# 0049: Effect identity belongs to the effect owner

Date: 2026-11-16. Status: accepted target, runtime UNPROVEN. Source: owner acceptance of [Converge S0](../features/host/CONVERGE-MAP.md#ordered-deletable-slices). Amends [ADR 0029](0029-effect-is-the-standard-library-one-fiber-per-request.md) rules 3, 6 and 10 and [ADR 0033](0033-one-host-read-graph-history-is-host-publication.md)'s ActionJournal survival clause. [ADR 0050](0050-workflow-owns-durable-commands.md) names the replacement host owners.

## Context

An Activity can run again after a crash. A host journal cannot establish whether Revit committed, nor can native dedupe establish whether a host file write or an outward delivery happened. The discovery reports in root `.artifacts/runs/converge-20261115/muse-d0/` are inherited testimony, not S0 runtime proof.

## Decision

1. The SDK `OpAttempt` owns native attempt identity and outcome below every native door. One attempt id binds one digest of operation, stable document identity and canonical payload. An identical resend replays or joins; changed intent conflicts before dispatch. Outcome binds process incarnation, document open instance and saved-after-commit evidence. The bridge id stays private; doors use the SDK session id and exact incarnation.
2. Native admission fails closed. An absent terminal receipt, lost reply, interruption or ended process does not prove rollback or safe retry. Started without a terminal remains unknown. Committed in an ended incarnation distinguishes witnessed saved and unsaved state and records why the process ended. A crash may leave a recovery copy, so no host projection claims the edit is absent from all copies.
3. Each host file effect uses its own create-only or content-addressed store identity keyed by step request id. Composite effects get separate recovery checkpoints. Host-internal state transitions use the workflow owner's SQLite transaction. Wrapping an unkeyed write in an Activity is insufficient.
4. For outside-owned effects with no receiver dedupe/query contract (OD8: outward delivery, process launch, auth transition), the engine records a create-only started mark before acting. Replay after that mark never acts again and answers unknown without terminal evidence. The person decides recovery. This is a named remainder because workflow supplies no at-most-once Activity. It prevents a second invocation, not a claim of delivery.
5. [ADR 0038](0038-consent-is-a-notice-three-guards-on-project-documents.md) stands: project synchronize, overwrite/discard and outward sends return held immediately with one notice. Family saves retain their exemption. Neither workflow replay nor a started mark bypasses a held act.

## Consequences

FND-01 is an unresolved S1/S4 gate: an armed observer plus absent save evidence does not establish an unsaved edit, even after a controlled close. Lost or failed starting/finishing save-event writes must yield uncertainty unless the SDK proves witness continuity. OD1 remains the accepted policy, but definitive unsaved outcomes and automatic re-stage cannot land on that unproved premise. UNPROVEN[save-evidence fault injection and disposable Revit corroboration not run]. The falsifier loses both save marks for an already admitted, completed and successfully saved edit and requires unknown rather than false. See root `.artifacts/runs/converge-20261116-wave0/foundation-smeller.md`, FND-01.

Features interpret domain results; they never reconstruct native outcomes or dedupe effects. Host receipt and History views project owner evidence and confer no new write or retry authority. Stop from History may address an already admitted live attempt with that attempt's authority.

S1 must falsify native identity through both doors, conflict, lost reply and restart with saved/unsaved readbacks. S4 must kill between each host effect and its durable record, including the OD8 started boundary. These runtime claims remain UNPROVEN in S0.
