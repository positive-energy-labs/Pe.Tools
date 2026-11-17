# 0039: Two failure policies, by class

Date: 2026-11-11. Status: accepted, not built. Source: kaitpw's ruling in the homes muse; the helper shape comes from the kernel purger and implementor forks. Evidence: `.artifacts/runs/homes-crusade-20261111/muse/` (`R1-dotnet-storage.md`, `R2-ts-storage.md`, `round3/purger.md`, `round3/implementor.md`). Extends [ADR 0033](0033-one-host-read-graph-history-is-host-publication.md) rule 5 and [ADR 0026](0026-one-route-shell.md) D4. Frontier: [homes MAP](../features/homes/MAP.md) slice 4.

## Context

Current amendment: [ADR 0050](0050-workflow-owns-durable-commands.md) applies the journal discard class to the engine database with an external discard epoch and fail-closed admission. The accepted historical decision below is unchanged.

Three failure policies coexist in stored-file readers. Some delete on a parse failure (Work, the journal on an unsupported version). One refuses and keeps (`providers.json`). Several throw at start or mid-read (scheduled tasks, devices, remote ingress, share, the update reader, captures, route settings, a corrupt journal line, a Page event log), so one corrupt row can stop the host. Work's discard is a `console.warn` in `route-document-store.ts`, which no person sees. Two earlier rulings pulled apart: ADR 0033 rule 5, "NO LEGACY! ... work should simply be deleted", and ADR 0026 D4, "Unknown is not old".

## Decision

1. **Two policies.** kaitpw agreed to this statement on 2026-11-11 ("agree"): authored files are refused and kept; Work, journal and threads are discarded with a notice; nothing stops the host.
   - `keep`: an authored file or a secret that does not decode is refused with a visible reason, its bytes are never rewritten, and defaults stay in force. This covers Pods and members, Pages, Catalogs, `Settings/<owner>.json`, `keys.json` and in-model owner blobs.
   - `discard`: Work, the journal, threads, Page state and derived files that do not decode are deleted, with one notice per file in the host's notice feed. The notice names the Place and, for Work, the staged values lost. It does not repeat on the next start.
2. **A class is not code.** The policy is one argument (`keep` or `discard`) of one decode helper, beside one write helper that replaces the hand-written temp-then-rename writes. The table of kinds lives in the homes MAP and glossary, not in a registry.
3. **T3's files are a third class, `foreign`.** Pe never decodes them, never discards them and never applies a policy to them. T3 refuses and migrates its own files.
4. **No migration code.** A stored shape that changed is handled by its policy. At a T3 cutover, old threads are discarded with a notice and provider records are entered again.
5. **Scratch is never read back**, so it has no policy.

## Consequences

- ADR 0033 rule 5 and ADR 0026 D4 no longer conflict: rule 5 governs the `discard` kinds and D4 governs the `keep` kinds.
- "Discarded with a notice" is new code. Today no discard reaches the notice feed.
- Every throw-at-start parse is deleted. The falsifier seeds one corrupt file per kind and counts zero throws at host start.
- The do-not-invest zone is not exempt from deletion: a one-line change in `scheduled-tasks.ts` from a throwing parse to a discard is worth making, because today one corrupt row stops the host.
- A coworker is told in the written promise that chat history and staged Work may reset on an update, and that authored files do not.
- An update that meets an authored file it cannot read lists it as "can't read, kept". Journey H5 proves this on real old shapes, on two installers in Windows Sandbox.
