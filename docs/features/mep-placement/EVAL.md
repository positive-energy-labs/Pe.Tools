# MEP Placement Toolkits — Round-1 Comparative Eval (2026-07-03)

Three pods, three isolated agents, identical proof battery (P1 trunk / P2 branches+fittings / P3 collisions surfaced+fixed / P4 re-elevation / P5 cleanup), all proven live against Snowdon Towers Sample HVAC. Full details in each pod's `NOTES.md`.

## Scorecard

| | mep-sketch (placeholder-first) | mep-route (probe-and-route) | mep-solve (declare-and-solve) |
|---|---|---|---|
| Interface | plan JSON + native placeholders | C# scenario script (code-driven) | intent JSON (data-driven) |
| Total runs / compile fails | 16 / 0 | 18 / 1 | 22 / 1 |
| P3 collision story | 3→0, one auto 45° dodge; PARALLEL conflict escalated to human (by design) | 63→17→1→0 by reading computed `fix:` lines | 1→0; one constraint-refusal WITH diagnosis, one elevation edit |
| P4 re-elevation cost | 1 JSON edit + 2 runs | 3 edits + 4 runs (new band exposed new obstacles — inherent to improvise) | 1 field edit + 2 runs, printed diff |
| Fittings | ConvertDuctPlaceholders emitted all tees/elbows/taps, zero manual math | 3 takeoffs + 4 elbows vs live trunk, painless | 6/6 elbows + 3/3 takeoffs first try (solver guarantees exact junction geometry) |
| Distinct superpower | drafts are NATIVE placeholders — users hand-drag them in Revit and re-solve picks them up | feedback EXPLAINS every conflict + computed alternatives; enclosure-relative verbs (corridor/grid), no hand-typed XYZ | sub-second solves; DIFF between solves; refusals name the binding blocker; MapProbe ASCII occupancy map |
| Weak flank | parallel conflicts escalate early; terminal hookup unproven | 3–5 runs to converge in crowded ceilings; misreadable obstacle spans | bbox fidelity (sealed rooms, invisible doors); only as good as recon in front of it |

## Convergent findings (3/3 independent — treat as facts)

1. **Whole-pod ReadOnly policy is a harness bug for libraries.** Static mutation policy scans every compiled src file, so one mutating call in the library forces WriteTransaction on pure-read entrypoints. Port requirement: scope policy to the executed entrypoint's reachable code, or add a per-entrypoint policy declaration in pod.json.
2. **Finished models have no free terminals.** `Connector.IsConnected` gating + auto-stub-short ("near-connect") is the correct default; physical `ConnectTo` remains live-unproven everywhere. Eval round 2 needs a model with unconnected terminals.
3. **Reconnaissance is load-bearing.** Plan PNGs lie about routability (view ranges hide bands; doors are invisible to bbox indices; "corridors" are sealed at duct elevation). Every agent's loop stabilized only after a recon step: Recon CSV + duct-z histogram (route/sketch), MapProbe ASCII occupancy map (solve — the sleeper hit of the round).
4. **z is the fix lever.** Most collisions resolve by elevation change, not XY rerouting. Skills should teach "change elevation first" explicitly.
5. **Fitting APIs are not the hard part.** NewTakeoffFitting/NewElbowFitting/ConvertDuctPlaceholders all worked when junction geometry is exact-by-construction.
6. **Markers + replace-on-commit give safe iteration.** Comments-tagged elements + full relay per run = idempotent commits, surgical cleanup (pixel-diff verified), zero damage to existing model across ~56 shared-bridge runs.

## Verdict

**Ship one ability with solve's front door, sketch's middle, and route's voice:**

- **Front door (agent/user interface):** declarative intent JSON + clarify-first checklist (from mep-solve), because 100% of refinement becomes data edits — the cheapest, most reliable lever for a 75k-context operator. Keep a small verb API (from mep-route) as the escape hatch for interactive nudging and diagnosis.
- **Draft medium:** native placeholder ducts (from mep-sketch) for BOTH draft and solve output — visible in Revit, hand-editable by the user, convertible to real ducts with fittings for free. "User drags placeholders, agent re-solves" is the refine loop the mission statement asks for.
- **Deterministic middle:** sketch's solver responsibilities (elevation bands, crossing dodges, junction planning, conversion) + solve's router (lattice A* with named-blocker refusals) as one engine behind the intent.
- **Feedback voice:** route's report grammar — HIT/PASS/NEAR/CLEAR with computed fixes, `[approx]` honesty labels, VERDICT lines — plus solve's DIFF-between-solves and report-checks-everything/avoid-steers-router split. Adopt solve's MapProbe as a first-class recon entrypoint.

If forced to port exactly one pod as-is: **mep-solve**, with mep-sketch's placeholder draft medium as the first upgrade — its loop cost matched sketch's (1 edit + 2 runs) while carrying the strongest diagnosis story, and its weak flank (obstacle fidelity) is a bounded engineering problem with a known fix list.

## Round-2 open items

- Real pea tests: same task through each skill via pea itself (routing, methodology adherence, loop cost at 75k context). Skills installed to `~/Documents/Pe.Tools/.agents/skills/`.
- `read_image` E2E: one live pea turn viewing an exported plan PNG (tool is wired and unit-tested; provider rendering unconfirmed).
- Terminal hookup proof on a model with free connectors.
- Harness ports: entrypoint-scoped ReadOnly policy; RevitFailureHandling adoption in scripted transactions (done in working tree, uncommitted); warning-suppression session script no longer needed after that lands.
