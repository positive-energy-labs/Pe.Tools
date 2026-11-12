# 0041: Pea calls any target; the user's target is the default

Date: 2026-11-12. Status: accepted. Source: kaitpw's ruling, relayed by the homes implementor after the T3 spike's F3 run.

## Context

[ADR 0021](0021-one-access-switch-and-document-targets.md) made a thread target a set of documents that only a human fills. [ADR 0024](0024-root-run-consent-and-shared-work.md) then made thread targets context only, and [ADR 0038](0038-consent-is-a-notice-three-guards-on-project-documents.md) moved write limits to three held acts on project documents. No current ADR states what a thread target does. The T3 spike's F3 drive asked that question: can Pea call a document that is not the thread's target?

kaitpw: "pea should be able to call on any target it wants, the user's target is the default, which i think means 'only suggest'".

## Decision

1. **Pea may call any open document.** A call that names a target runs on that target, whether or not it is the thread's target.
2. **The user's target is the default, and it is only a suggestion.** A call that names no target runs on the thread's target. A thread target never refuses a call that names a different target.
3. **A thread target is not a write limit.** Holds on writes come from the ADR 0038 guards, not from the target.
4. **The receipt names the document the call ran on,** not the thread's target.

## Consequences

- The code already does this. `resolveCallTarget` in `ts/packages/agent-contracts/src/target.ts:133-169` lets an explicit call target win. With no call target, a thread with exactly one target uses it.
  - Proof: PROVEN[Revit lane, controlled session `t3spike`, `crusade/t3` 35d80920, 2026-11-12]. With the thread target on doc A:
    - an untargeted read ran on A;
    - an explicit read and an explicit script on doc B succeeded;
    - receipt a024d28f names B.
  - Evidence: `.artifacts/runs/homes-crusade-20261111/t3/revit/f3.ndjson` and `f3.join.txt`.
- A thread with several targets has no single default. An untargeted call there still returns `Target choose: several-targets`, and Pea names one target per call. This keeps today's code. kaitpw can re-open it, because "only suggest" could also mean "pick one".
- A closed or unknown document still returns `Target choose: document-closed` (or `session-gone`). The resolver never chooses another document for Pea.
- The composer's document chip shows the default. It is not a fence, so its copy must not say that Pea is limited to it.
