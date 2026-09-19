# Room-solve tuning rounds — standing brief

Living doc for the 2026-08 tuning orchestration (worktree `room-solve-tuning`). Every experiment
agent reads this first. Orchestrator: the session's Fable. Verdict authority: kaitpw, via
[TASTE.md](TASTE.md).

## Mission (kaitpw-locked, 2026-08-16)

Raise **accepted coverage** by making more geometry good enough to pass the existing honesty
gates — **never by loosening the gates**. Honesty bar (kaitpw-reformulated 2026-08-16, round-3
summon): **per-room** — no previously-accepted room's own edge-on-ink may fall beyond ~0.005
noise; zone and board averages are diagnostic only (dilution by honest newcomers is a
statistical artifact, not dishonesty). Second-order: residual held geometry should get less
horrendous (held FRs are designer-visible), never at the cost of accepted coverage.

Baseline fact that frames everything: accepted recall 0.284 but **held-recall 0.578** — the solver
already finds most rooms; the work is converting held→accepted honestly.

## Currency

`eval/rhvac/score-looks-good.py` (v1, commit 39d8352). Board **savedWork** is the number to beat;
per-zone recall / edgeOnInk / swallowed-wall-sf / edit-cost carry the gradient. Oracle boundary
distance is diagnostic-only, confidence=high only, and near-meaningless on Lower Level
(registration UNTRUSTED — median 1.95 ft chamfer; Main/Upper drifted, Attic registered).
Conservation gates in the test suite stay the only gates.

```
dotnet test source/Pe.Takeoff.Tests -c Debug          # writes .artifacts/takeoff-zone-promotion/report.json
python eval/rhvac/score-looks-good.py score  .artifacts/takeoff-zone-promotion/report.json
python eval/rhvac/score-looks-good.py compare <baseline-report.json> <candidate-report.json>
```

Knob overrides without recompiling were `PE_TAKEOFF_KNOBS="Name=Value;Name=Value"`, named after the
raster-era `TakeoffOptions` (deleted; the solver's knobs are `Pe.Revit.Partition.Knobs`).
`PE_TAKEOFF_ZONE=<name>` filtered to one zone. Knob overrides
land in `optionsHash`; since 2026-08-17 the zone filter does too, AND is persisted explicitly as
`zoneFilter` in report.json/meta.json (`null` = unfiltered). Before that fix a filtered run's
package hashed identically to the full baseline's — run `20260817-161144-5973e5c14825` carried 1
zone under the 45-zone baseline's hash and burned a review sitting as an inexplicably empty A side.
Pre-fix packages remain ambiguous; /runs marks them "possibly partial" by the modal-zone-count
heuristic.

Trap: persisted `ink_*.bin` are stale vs replay seed ink (Attic −45%). score-looks-good.py reads
seed ink from `replay_*.bin` directly; do not score against `ink_*.bin`.

## Baseline (fresh homogeneous bins, 2026-08-16 recapture, commit 80e6448)

Board: recall **0.276**, held-recall **0.569**, missing 18, savedWork **0.334**, edgeOnInk
acc 0.848 / held 0.781, swallow 176.9 sf, edit cost 8.38. 127/127 tests green.
Report-card: LL06 saved 0.538 · LL08 0.060 · ML05 0.464 · ML09 0.232 · Attic00 0.138 (0 accepted,
held-recall 0.833!) · Attic01 0.113 (0 accepted, held 0.667, swallow 48 sf).
Registration: Lower UNTRUSTED (and floor-mapping suspect — floor 1 chamfers better than floor 0),
Main/Upper drifted, Attic registered.

**Run-snapshot protocol**: `dotnet test` wipes `.artifacts/takeoff-zone-promotion/`, and
report.json references artifact-relative Tsv/Ink paths — comparing against an old report whose
artifacts are gone silently zeroes the A side. After every run you intend to compare against,
copy the WHOLE `.artifacts/takeoff-zone-promotion/` dir to `.artifacts/runs/<name>/`.

## Report-card zones

LL06, LL08 (ink starvation; LL08 backing is ~all door-head evidence), ML05, ML09 (diagonal wing),
Attic 00 / Attic 01 (same level, opposite sealing needs), Main 10 + 2–3 boring orthogonal canaries.
Success = better on every regime, no regime sacrificed.

## Sacred (adversarial waves included)

- The five conservation gates (closure, containment, identity, edit preservation, no vacuous pass).
- Zone clip+snap authority law; "proposals live nowhere"; the stage array stays a flat list.
- DECISIONS.md tombstones: reopenable ONLY with new evidence (post-recapture ink counts as new
  evidence — several tombstones were sealed on framing-polluted ink); record the reopening.

## Round protocol

1. Experiments run as fresh Fable agents (low/med), one hypothesis each, in isolated agent
   worktrees (seeded from last commit — orchestrator checkpoints before fan-out).
2. Every experiment reports: knobs/code changed, board+report-card score table vs baseline,
   rejection-histogram shifts, and an honest "what would falsify this" line.
3. Adopted change = one checkpoint commit + DECISIONS.md entry. Falsified = DECISIONS.md tombstone.
4. Adversarial waves interleave: prune knobs, merge stages, delete dead levers; board score must
   not regress; sacred list above.
5. kaitpw summoned only on: board savedWork ±10%, report-card regime flip, or subtle-unmeasured
   win needing a verdict (which then becomes a metric). A/B image bundles via
   compare-zone-runs.py; verdicts recorded in [TASTE.md](TASTE.md) (zone, images, pick, kaitpw's words).
   A proxy that disagrees with a recorded verdict is wrong by fiat.

## Hypothesis backlog (seeded from DECISIONS deferred items + baseline)

- **H0 (analysis-first, highest value)**: mine fresh-baseline RejectionDetails magnitudes — which
  gate owns the held-vs-accepted recall gap (0.578→0.284), per zone. Output: ranked lever list
  with the tolerance each rejection says it needed.
- **H1**: wall-run sealer is angle-blind (diagonal scans bridge 6.4 ft where 4.5 declared;
  95% of ML05's run plugs are diagonal-scan-owned). Re-tune on framing-filtered (post-recapture)
  ink. ML05's four `frame:BoundaryDrift` holds (4.0–6.4 ft) are the expected converts.
- **H2**: `FrameMaxSourceDropFt` — old sweep said only ≥7.8 ft buys anything (one clean 547 sf
  LL08 room); re-sweep against savedWork instead of counts.
- **H3**: door-head levers on Lower (LL08 edge-on-ink 0.094 ink-only vs 0.732 with seals — the
  zone lives on door-head evidence; DoorGapMaxFt=6.75 is tombstoned, door-head-specific paths are
  not).
- **H4**: interior-ink-containment as a shape defect signal (ML09 26.7 sf, Attic 01 48.2 sf,
  Main 10 21.2 sf swallowed) — does penalizing swallow in partition/recombination move savedWork?
- **H5**: per-zone adaptive rules keyed on ink-ratio — re-measure attic ratios post-recapture
  first (pre-recapture ratios were framing-noise-inflated; AdaptivePolicy tombstone says the
  inkRatio signal itself is real).

## Adversarial backlog

- **Oracle pollution (R3b, 2026-08-16): 25/118 rooms are phantoms/duplicates** — a guest-house
  takeoff PDF was ingested and registered onto the main house (ML09 carried 4 phantom rooms of
  9), and floor-2 pages 12/13 duplicate each other 95–100%. Hygiene prototype (drop
  guest-house-sourced, dedupe >40% same-floor overlaps keyed on ink registration) measured:
  board savedWork 0.3916→0.3957, recall 0.3534→0.3626. ADOPT during consolidation as currency
  v1.1 — report both v1 and v1.1 during the transition; falsifier: a dropped room later
  accepted cleanly at its exact footprint means the dedupe kept the wrong copy. Prototype:
  R3b scratchpad `score_clean_oracle.py`.
- **Round-4 — parallel-on-ink zone/room edge unification (kaitpw annotation, UL02 thin room,
  2026-08-16)**: spots where the declared zone line and the detected room line run PARALLEL and
  BOTH live on the same wall's ink — two authorities for one wall, room edge offset inside the
  wall band. The R3c snap guard stops edges crossing ink but nothing unifies
  parallel-on-same-wall pairs; the missing move is a snap ALONG ink (room edge joins the zone
  line when both stand on one wall band), which the guard currently refuses no differently
  than a crossing sweep. Annotated image in kaitpw's round-3 reply; [TASTE.md](TASTE.md) entry.
- **Round-4 — tilted-longest-edge anchor election (C2 test discovery, pinned as
  `LIMITATION_a_tilted_longest_edge_wins_the_anchor_election_and_is_not_squared`)**: when an
  off-frame edge is the ring's LONGEST, the anchor law elects the tilt itself as frame
  authority and the squarer squares the short sides into the tilted frame. Pipeline-safe today
  (admission audit refuses, zero live rooms hit it) but unrepairable; adjacent to
  parallel-on-ink unification.
- **Round-4 — review-takeoff.py still reads ink bins** (C1 residual): the sha256-manifest A/B
  bundle lane, not a silent fallback — migrating it touches the C#-emitted manifest contract.
- **Round-4 design — mixed-frame room projection (ML09's true mechanism)**: rooms speaking two
  frames (45° + orthogonal fixture walls, curves) cannot be expressed by single-frame
  projection; segment-wise frame assignment on the zone's declared frame families, unmodified
  audits. Touches the editability contract (45° corners) — canonical-contract treatment, not a
  promotion-stage patch. This is the round-1 "24 held oracle rooms" pool's real name. Gate
  loosening proven useless (1 of 5 converts at drift 6.0; refusals rotate).

- **Door-head sealer manufactures backing evidence over low ceilings (2026-08-16 render
  forensics)**: the lintel predicate has no door-width bound, so duct soffits/low basement
  ceilings seal wholesale (LL08: one 255 sf door-head component), and `EvidenceInkDistance`
  counts those cells as BACKING — LL08's edge-on-ink is 0.73 with them, 0.09 ink-only. Teal
  must mean trustworthy; manufactured backing inflates trust. → R2d experiment.
- **Seals bin: persist door-head and wall-run as separate rasters (INKP v4)** — per-cell
  attribution is unrecoverable downstream (validated recompute drifts up to ~72 sf/zone).
- **Stale `ink_*.bin` lane, stronger evidence**: Attic bin missing 51% of replay seed cells in
  the Attic00 crop. Renderer + scorer now bypass it; delete or repair the lane.

- The stale `ink_*.bin` lane: fix the persistence or delete the lane (one truth for evidence ink).
- Stage mutual-exclusivity audit: zone-fit vs editability vs ink-backing overlap; Main 10 has
  0 oracle rooms in-zone (zone def or oracle floor-mapping oddity — cheap to resolve).
- report.json is test-harness-owned; product-side emitter is a known gap (do not build during
  tuning; note only).

## [TASTE.md](TASTE.md)

Worktree-root ledger of kaitpw verdicts. Append-only. Entry: date, zones, image paths, pick,
kaitpw's words verbatim, metric agreement (did savedWork rank the same way — if not, the metric
owes a recalibration entry).
