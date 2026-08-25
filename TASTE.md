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

## 2026-08-16 — Round 3 summon: A/B verdict + honesty bar + consolidation go

Images: `.artifacts/ab-round3/` (ML05, UL02, LL09, Attic01).

- **"B's look better."** Round-3 adoptions stand. BUT the UL02 wall-clip fix "did not fix what
  i was looking at specifically. on UL02, the top side of the long thin room on the right has
  bad walls" — kaitpw annotated the thin room: red lines mark spots where **zone and room lines
  are parallel AND both live on wall ink** (two authorities for one wall; the snap guard stops
  crossing ink but nothing unifies parallel-on-same-wall pairs). Queued in TUNING.md round-4
  backlog per kaitpw ("queue this in the mds somewhere").
- **Honesty bar re-worded per-room** (kaitpw-approved): no previously-accepted ROOM may get
  less honest beyond ~0.005 noise; zone and board averages are diagnostic only.
- **Consolidation slate approved as listed** (oracle v1.1, seal-class split, stale-ink-lane
  delete, constant dedupe, repair tests, docs), then round-4 backlog + session wrap.

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

## 2026-08-17 — Wave-1 verdict: parallel-on-ink unification (exp/parallel-on-ink a5cbbde)

Zone: UL02 (Upper Level#02), A=20260817-160730 (baseline) vs B=20260817-161910 (unify 0.5).
Images: kaitpw's own flagged export
`proto-runs-feedback/.artifacts/takeoff-runs/_exports/20260817-125136/01-upper-level-02.png`
(flags: R08, R06, R04, R05 — made through the /runs feedback tray, first live use).
Pick: **direction adopted, coverage insufficient — iterate, not tombstone.**

kaitpw verbatim: "r05 is the only room that seems to have any change. in general the absorption
of the wall doesn't seem to have worked. all the biggest offenders, r08, 06, and 04, still have
room edges parallel to the zone boundary that overlap with the wall underneath. The other
improvement on ML15 looks good thought. that closing of the gap is exactly what i wanted."

Metric agreement: board savedWork was flat (+0.0001) and blind to both the win and the miss —
the promised "remaining double-line pairs" diagnostic is now owed BEFORE the coverage iteration
lands, so the next A/B prices exactly what this verdict judged by eye.

## 2026-08-21 — Loop 2 taste rulings (kaitpw, answered before Round 0)

Asked after the overnight loop's SUMMARY left four FOR-kaitpw calls open. Answers, verbatim intent:

- **#1 Flat savedWork can adopt.** A candidate with flat savedWork may adopt on an eyes ADOPT plus
  a NAMED secondary number that moved: accepted double-line residue ft (r7 baseline 980.7). This
  reopens parallel-on-ink as a quality adoption; the three tombstones were metric-blind, not wrong
  by eye (see 2026-08-17 above). Per-room honesty still holds — ML05 R02 style falls still reject.
- **#3 Segment-wise frames for ML09 are in scope** as an overreach build: code, not a knob.
  Whole-room second-frame retry was the no-op; per-segment-run frames are the untried mechanism.
- **#4 No blanket zone-edge non-vacuity rule.** Keep the 4 r7 rooms (4,581 sf, incl. Main 10,
  which the ledger already blessed). Vacuity is a flag a human sees, not a gate.
- Run shape: 3 builders per round, 60 min timebox, raster lane only (Revit stays at zero),
  code-first — solver stage order, new stages, and the frame model are all fair game.
  Gates and the honesty bar are not.
