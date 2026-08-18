# MEP placement grounding

Live-proven Revit MEP placement facts (2026-07) — behaviour observed against real models, not inferred from API metadata.

- Project Base Point offsets break level banding: on project-a (PBP 348 ft), `Level.Elevation` (348) ≠ element geometry Z (≈0), so Scout saw ZERO geometry on a level holding 991 ducts. Use `Level.ProjectElevation` at every functional site. A PBP=0 model (Snowdon) can never catch this.
- Equipment connectors are not interchangeable: fans carry ~5 connectors (intake already connected, discharge free, plus `shape=Invalid` non-duct stubs) and `BranchTo` auto-selected the wrong one. Pick by system type + free status + proximity.
- Stale-state Commit: the persistent state dir survives sessions, so `Commit()` will happily convert yesterday's solve DTO into today's model (observed: a fresh thread re-materialized the previous tier's geometry coordinate-for-coordinate under new ids). Commit must verify the DTO's draft ids exist, or solves must be session-stamped.
- A client-side script timeout does NOT abort the bridge op (PrepHard "timed out" at 120s and completed server-side) — grade before re-running.
- `document.open` on a heavy linked model holds the bridge ~44 min while the Manage Links dialog is up; it completes the moment it is answered. A fresh Revit process is the DLL-swap window: copy the new Placement DLL into the addin folder BEFORE the first script references it.
- Fitting APIs are not the hard part: `NewTakeoffFitting` / `NewElbowFitting` / `ConvertDuctPlaceholders` all worked whenever junction geometry was exact-by-construction.
- Skill loading is silently fragile: a `description:` frontmatter value containing `: "` is parsed by gray-matter as an invalid YAML mapping and the skill is dropped without warning.
- `talk_to_pea` prompts with embedded double quotes crash the PowerShell 5.1 arg path (exit 255).
