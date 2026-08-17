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
