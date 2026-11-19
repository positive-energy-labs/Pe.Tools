# 0049: Effect identity belongs to the effect owner

Date: 2026-11-16. Status: accepted target, runtime UNPROVEN. Source: owner acceptance of [Converge S0](../features/host/CONVERGE-MAP.md#ordered-deletable-slices). Amends [ADR 0029](0029-effect-is-the-standard-library-one-fiber-per-request.md) rules 3, 6 and 10 and [ADR 0033](0033-one-host-read-graph-history-is-host-publication.md)'s ActionJournal survival clause. [ADR 0050](0050-workflow-owns-durable-commands.md) records why the ActionJournal kept command ownership.

## Context

An Activity can run again after a crash. A host journal cannot establish whether Revit committed, nor can native dedupe establish whether a host file write or an outward delivery happened. The discovery reports in root `.artifacts/runs/converge-20261115/muse-d0/` are inherited testimony, not S0 runtime proof.

## Decision

1. The SDK `OpAttempt` owns native attempt identity and outcome below every native door. One attempt id binds one digest of operation, stable document identity and canonical payload. An identical resend replays or joins; changed intent conflicts before dispatch. Outcome binds process incarnation, document open instance and saved-after-commit evidence. The bridge id stays private; doors use the SDK session id and exact incarnation.
2. Native admission fails closed. An absent terminal receipt, lost reply, interruption or ended process does not prove rollback or safe retry. Started without a terminal remains unknown. Committed in an ended incarnation distinguishes witnessed saved and unsaved state and records why the process ended. A crash may leave a recovery copy, so no host projection claims the edit is absent from all copies.
3. The ActionJournal owns command state and keeps recovery checkpoints for each effect in a composite command. Each host file effect owns a create-only or content-addressed identity keyed by step request id. Consult that effect store to establish the outcome of its write.
4. For an effect whose recipient cannot deduplicate or report its outcome, the effect owner records a durable started mark before acting. This covers outward delivery, process launch, and authentication transitions (OD8). If a replay finds that mark and lacks terminal evidence, report the outcome as unknown and leave recovery to the person. The mark prevents automatic repeat dispatch.
5. [ADR 0038](0038-consent-is-a-notice-three-guards-on-project-documents.md) stands as amended by [ADR 0052](0052-no-guard-on-sending-outward.md): project synchronize and overwrite/discard return held immediately with one notice; an outward send is not held. Family saves retain their exemption. The same hold applies when the journal reconciles an earlier attempt.

## Consequences

FND-01 is an unresolved S1/S4 gate: an armed observer plus absent save evidence does not establish an unsaved edit, even after a controlled close. Lost or failed starting/finishing save-event writes must yield uncertainty unless the SDK proves witness continuity. OD1 remains the accepted policy, but definitive unsaved outcomes and automatic re-stage cannot land on that unproved premise. UNPROVEN[save-evidence fault injection and disposable Revit corroboration not run]. The falsifier loses both save marks for an already admitted, completed and successfully saved edit and requires unknown rather than false. See root `.artifacts/runs/converge-20261116-wave0/foundation-smeller.md`, FND-01.

Features interpret domain results; they never reconstruct native outcomes or dedupe effects. Host receipt and History views project owner evidence and confer no new write or retry authority. Stop from History may address an already admitted live attempt with that attempt's authority.

S1 must falsify native identity through both doors, conflict, lost reply and restart with saved/unsaved readbacks. S4 must kill between each host effect and its durable record, including the OD8 started boundary. These runtime claims remain UNPROVEN in S0.
