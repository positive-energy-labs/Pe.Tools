# TASTE.md — kaitpw verdict ledger (append-only)

## 2026-08-16 — Round 1 summon: baseline vs sealer-fix + DoorGapMaxFt 6.0

Images: `.artifacts/ab-round1/` (Attic00, Main00, LL08, ML09, Attic01, Main15 A/B panels).
Pick: **B (candidate) — "better in every image."**

kaitpw verbatim: "The right side (i assume B) is better in every image. regressed acceptance
where it happened looks valid. the previously accepted rooms were no good in the first place."

Metric agreement: savedWork ranked the same way (0.334 → 0.378). Calibration note: the metric
*counted* LL08's and ML09's lost accepted rooms as costs, but taste says those rooms were never
good — savedWork under-penalized bad accepts (LL08's room had edge-on-ink 0.636). Weighting
edge-quality more steeply inside accepted rooms would have agreed harder. No recalibration forced
(rankings matched), noted for the next scorer revision.

Also ruled: SmallZoneSqft stays in the 700–800 band and is a **user-exposed per-project toggle**
("project-a is high end residential, most other projects are middle class homes with smaller 'small'
room size") — do not build the pipeline around the number, and do not fixture-tune it.

Process: reports must be colloquial; walls of numbers hindered the verdicts.

## 2026-08-16 — Round 2 summon: 45° fix + projector repair + round-3 direction

Images: `.artifacts/ab-round2/` (Attic01, UL02, UL03) and `.artifacts/ab-r2b/` (LL08, LL09).

- **45° drift fix: "Looks right, keep it."** Rotated-wing rooms stand on ink; falsifier did not
  fire; adoption stands.
- **Projector repair: adopt, AND the honesty bar becomes per-zone** — "no zone's own
  edge-on-ink falls" replaces the board-mean rule (board-mean dilution by ink-poor zones is a
  statistical artifact, not dishonesty).
- **Round 3 ruled: one more wave before consolidating** — wing residuals (a) + ML09 diagnosis
  (b), plus two new taste items verbatim: "LL09 shows a small room that should be squashed into
  others." and "consider that zone edges often clip walls, we can ignore padding of pixels
  along a zone edge, maybe treat that as the new zone bounds for the solver (UL02 shows this
  problem on left side)".
