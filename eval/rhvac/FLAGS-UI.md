# Ambiguity-flag resolution UI (/rhvac plan pane)

The Partition formulation refuses to guess intent: per-room ambiguity flags ride the takeoff
TSVs as backward-compatible `META flag <id>:<flag+flag>` lines (Contracts.cs `ToTsv`). This
surface is the pre-commit intent-resolution loop: every flag is one human decision, resolved
with one touch in the web plan pane and recorded durably.

## Resolutions

| Flag | One-touch resolutions |
| --- | --- |
| `open-plan-merge` | **split** — click two boundary points; the polygon bisects by that chord, areas recompute · **keep as one** (accept) |
| `low-evidence-boundary` | **accept** — the boundary stands (nudge-to-alternative deferred) |
| any unknown kind | **accept** (forward-compatible; unknown kinds render and queue verbatim) |

UI shape (`src/rhvac/plan-pane.tsx`): flagged polygons render clay + dashed; a compact
"needs decision" queue below the legend lists each pending flag (room id, kind, sf) with its
resolution buttons inline. Clicking a row switches to that level and highlights the polygon.
Split mode snaps both clicks to the room's outer ring (`nearestOnRing`), so the recorded
chord replays deterministically against a re-parse of the same TSV.

## Sidecar schema (`takeoff-resolutions.json`)

Deterministic JSON — no timestamps, stable sort by `(candidateKey, flag)`:

```json
{
  "version": 1,
  "resolutions": [
    { "candidateKey": "Level 1/Main Level:R05", "flag": "open-plan-merge",
      "action": "split", "params": { "a": [312.5, 640.25], "b": [312.5, 655.0] } },
    { "candidateKey": "Level 1/Main Level:R09", "flag": "low-evidence-boundary",
      "action": "accept" }
  ]
}
```

- `candidateKey` = `<levelName>:<roomId>` (types.ts `candidateKey`).
- `params` chord endpoints are model coordinates (feet, Y up — the TSV frame), already
  snapped to the outer ring.
- Applied after TSV parse + simplification in both TypeScript (`applyResolutions`) and C#
  (`RhvacCandidateBuilder.ParseTsvDirectory`): pure and idempotent — a resolution whose
  candidate/flag no longer exists is skipped.
- Splits replace the room with `<id>.a` / `<id>.b` (larger area = `.a`; tie → smaller
  centroid), `splitFrom` carries the original id; children inherit other unresolved flags.
  Holes go to the half containing their centroid.
- Splits affect display and candidate polygons. C# candidate generation consumes the same sidecar
  before `.r10` export, so exported rooms use the resolved polygons.

## Persistence

- localStorage per takeoff source (`rhvac:takeoff-resolutions:<sourceKey>`; host lane keys
  by the .r10 path, fixtures by `fixture:project-a`) is the fixture lane and host fallback.
- Downloadable JSON from the queue footer.
- `rhvac.takeoff-resolutions` reads and atomically writes deterministic
  `<dir>/takeoff-resolutions.json` beside the takeoff directory. The host lane loads it with the
  takeoff and serializes every resolve/reset write in decision order; when no sidecar exists,
  localStorage rehydrates prior browser-only decisions.

## Fixtures

The web-only project-a fixture contains the real Partition replay TSVs, including 10 flagged Main
rooms and 3 flagged Upper rooms. The committed canonical eval TSVs are also Partition outputs;
the UI lane does not copy or re-baseline them.

## Deferred

- `low-evidence-boundary` nudge-to-suggested-alternative (needs the detector to emit the
  alternative geometry).
- Nested splits (splitting a `.a`/`.b` child) and split preview line while drawing.
- Naming split children in the room map beyond deterministic `<id>.a` / `<id>.b` ids.
