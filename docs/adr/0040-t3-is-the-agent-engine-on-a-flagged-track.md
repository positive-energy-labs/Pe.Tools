# 0040: T3 is the agent engine, on a flagged track with a flip rule

Date: 2026-11-11. Status: accepted as a track; the cutover itself is decided by the flip rule below. Source: kaitpw's rulings in the homes muse and in the T3 research thread; the falsifiers and the flip rule come from that thread, which ran four spike rounds. Evidence: `.artifacts/runs/homes-crusade-20261111/muse/` (`R5-t3-source.md`, `R6-t3-spikes-cutover.md`, `round3/t3.md`), `.artifacts/runs/t3-spike-20261110/`, branch `t3/t3-spike-codex-r4` at 08ee7890, T3 Code at 1a2a4a5e in `.explore/t3code`. Amends [ADR 0015](0015-the-harness-drives-pea-is-tools-and-ui.md) at cutover. Rows, falsifiers and the do-not-invest list: [T3-CUTOVER.md](../features/homes/T3-CUTOVER.md).

## Context

Pe's own agent machinery (provider records, the ACP thread engine, the thread store, a scheduler, device pairing, a share) works, in the owner's words, "ok, but its not good, and many t3 features are things I want in the near future." T3 Code ships that machinery: a durable thread record in SQLite, delegation with lineage, a queue, scheduled tasks, usage meters and eleven harness drivers. Four spikes ran T3 as a sidecar to Pe.Host, to an MSI install in Windows Sandbox, with a Codex API key typed in Pe's UI, with zero T3 edits. No spike touched Revit, a consent surface, attachments, the composer, a Claude key, a subscription login in a Pe-owned home, or an upgrade. A decision without a run on real Revit would rest on testimony.

## Decision

1. **T3 is in the crusade as a parallel track behind a flag.** The flag is a Pe.Host start option on the owner's machine only. It is never shipped to coworkers while off, and it is deleted at cutover. The track touches none of the storage slices.
2. **The track opens with one spike on a real Revit lane:** falsifiers F1 to F11, on a controlled dev session, with J1 run on both engines as a parity check and not as a gate.
3. **The flip rule is fixed before the spike runs.**
   - T3 becomes the default before a second coworker joins only if F1 to F5 pass; F7 (Claude sees the Pea tools in the installed shape) and F11 (a personal subscription works beside the firm key) pass or have a named fix on Pe's side; and the composer port measures about a week.
   - If F1 to F5 pass but the composer port runs well past a week, T3 is the last slice, after a one-coworker pilot.
   - If any of F1 to F5 fails with no fix on Pe's side, T3 is out of this crusade, and the generic zone stays frozen.
4. **The deletion dogma.** kaitpw: "Im super down for this, but only if it properly deletes, replaces, and integrates everything in that research list that i included in my original message. this will be a major axis where a trailing purger must enforce the dogma". The cutover is done only when every row of that list is deleted, merged, or kept with a written reason. No row may end as "both exist". The purger holds the list.
5. **Standing rulings from the T3 thread's record:** Codex works on day one, because coworkers hold only OpenAI keys. The Claude CLI stays. Pe carries no T3 patch, except for a foundational blocker. If T3 wins, it becomes canon. Acceptance is proven only through the user's own path, never an RPC back door.
6. **Both key sources work** (ADR 0037 rule 9): one T3 provider instance per credential source. The firm key is resolved by Pe and handed to the T3 instance in its environment at spawn. Pe never copies it into T3's store. A personal subscription rests in the harness's own home.
7. **Pea threads run in T3 `full-access`.** T3 then asks nothing. The guards of ADR 0038 (two since ADR 0052) live in Pe.Host and do not depend on T3's approval rows.
8. **T3's files are `foreign`** (ADR 0039 rule 3). The T3 home sits under the machine state root, never under a content home. The agent's working directory is frozen before cutover, because T3 finds its project by that path.
9. **No migration at cutover.** Old threads are discarded with a notice. `providers.json` is deleted, and a coworker enters a personal key again with one paste.

## Consequences

- ADR 0015 is amended at cutover: the harness still drives, but T3 owns the durable thread record, the queue, delegation and provider instances; "One adapter: ACP" is replaced by T3's drivers; the approval card has nothing to render. Pea stays the Revit tools, the Work linkage, the guards and notices, and the chat UI. Until the flip rule fires, ADR 0015 stands unchanged.
- Until cutover, no code is added to the do-not-invest zone. A deletion there is free and shrinks the cutover.
- T3's managed ChatGPT runtime deletes `OPENAI_BASE_URL`. The firm key path does not use that runtime, so this does not block rule 6. A custom firm endpoint through the same file is UNPROVEN[never run].
- Known gaps the spike must close or name: Claude has no Pea MCP entry in the installed shape; a key changed after a Codex session exists is not picked up without a restart; whether an agent's shell can read the sidecar secret (F10).
- The grader's seam is a Pe export that joins the engine's transcript to Pe's receipts by run reference, so journeys survive an engine change.
- The spike also records memory with Revit open and the per-session cost of Codex.
