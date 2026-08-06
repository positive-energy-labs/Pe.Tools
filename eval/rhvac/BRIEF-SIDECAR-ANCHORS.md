# Mission: sidecar v2 — geometric anchors so human resolutions survive re-detection (P1)

Execute phase P1 of eval/rhvac/PHASE5-EDITABILITY-PLAN.md (read it fully first; it has
file:line grounding). Summary: resolution `candidateKey`s point at `R{rank}` ids that
reshuffle on every detector change, and applyResolutions silently skips mispointed keys
(apps/web/src/rhvac/resolutions.ts:43-48) — silent loss of human work. Fix at the consumer
edge with anchors; no detector/output-contract changes.

Scope (plan §3, all four items):
1. Sidecar v2: each resolution gains `anchor: {label:[x,y], sqft}` captured at record time;
   per-level TSV sha256 provenance stamp. v1 files stay readable (key-match only).
2. Re-key pass on load in BOTH mirrors — TS (resolutions.ts) and C#
   (RhvacCandidateBuilder.ApplyResolutions): key resolves + anchor contained + sqft ±20% →
   apply; else anchor-containment remap; else ORPHANED (retained, surfaced, never dropped).
   Shared fixture test asserting identical remap outcomes across TS and C# (extend the
   existing mirror-test pattern — takeoff.test.ts / RhvacCandidateBuilderTests.cs).
3. Loss accounting: apply returns {applied, remapped, orphaned}; FlagQueue footer shows
   orphan count; C# export logs the triple and warns loudly on orphans > 0.
4. score-takeoff.py: `--resolutions <sidecar>` applies accept/split python-side and prints a
   RESOLUTIONS block (touches by verb, applied/remapped/orphaned, before/after ratio+score).
   NOTE: score-takeoff.py may have been touched by a concurrent suspect-flag mission —
   rebase on whatever is in the worktree, do not revert others' staged work.

Gates:
- Renumber-survival test (plan §4): synthesize a rank reshuffle (e.g. permute room order in
  a fixture TSV so ids shift), apply a v2 sidecar recorded pre-shuffle: >= 95% auto-remap,
  0 silent drops, orphans reported. Offline, in the mirror tests.
- All existing rhvac web tests + RhvacCandidateBuilderTests + RhvacEvalTests green
  (web: pnpm --dir source/pe-tools test pattern — find the exact invocation).
- Deterministic sidecar serialization preserved (no timestamps; stable sort).

Results to eval/rhvac/RESULTS-ANCHORS.md. Stage, do not commit. Work autonomously; do not
ask questions.
