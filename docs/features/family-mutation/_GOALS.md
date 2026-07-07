# Family Mutation Interface (experiment)

## Intent

Give Pea one *language* for family moulding: bulk parameter edits, instance-level edits,
param rename across a project, value migration old→new, nested-family mutation, and
(bonus) on-the-fly ParamDrivenSolids. Most machinery exists in `Pe.Revit.FamilyFoundry`
(FFMigrator/FFManager profiles, desired-state compiler, operation queues, snapshot
artifacts) — but it is type-level, single-surface-centric, and its gaps are exactly the
cases users ask pea for.

The spike question: **is a unified interface across all four surfaces reasonable — and
if not, where are the honest boundaries?** The four surfaces:

1. loaded family in a project
2. placed family instance in a project
3. open/standalone family document
4. nested family inside a family document

The deliverable is not just code — it is a **skill + an opinionated mutation abstraction**
(same pattern as the duct/pipe spike: fat skill carries the operating loop, a library
carries the determinism). Consistency goal: pea's tools should speak one language —
same information units, same addressing, same result records — across all surfaces.

## Method: three competing pods

Three pods under `Documents\Pe.Tools\workspaces\`, built simultaneously by isolated
agents so approaches stay uncontaminated. Each pod = C# library (`src/`), thin declared
entrypoints, a draft `SKILL.md`, honest `NOTES.md`, evidence artifacts. Best-of-all-worlds
wins the port.

| Pod | Thesis | Marker |
| --- | --- | --- |
| `fam-desired` | Desired-state document stretched across all four surfaces: one declarative profile + a scope selector; engine reuses FamilyFoundry where possible | PEA-FM-DES |
| `fam-verbs` | Address-and-verb: uniform resource address grammar spanning surfaces + a small verb set (set/add/remove/rename/migrate); batch = op list; uniform result records | PEA-FM-VRB |
| `fam-script` | Code-driven: one fluent navigator type (cursor) that normalizes the four surfaces; agent writes scenario scripts against it | PEA-FM-SCR |

These reproduce the MEP round's winning axes (data-declarative / verb-feedback /
code-driven) in the family domain — the MEP verdict (declarative front door + small verb
escape hatch) is a **hypothesis this spike tests**, not an assumption.

## Proof battery (identical per pod, live in Revit, Snowdon Towers Sample HVAC)

P0 recon census → P1 seed marker sandbox (3 marker families + 1 nested + placed
instances) → P2 bulk param edit across families in ONE input → P3 instance-only edit in
the same language → P4 rename+migrate `PE_OLD_Width`→`PE_NEW_Width` project-wide with
values + formula preserved → P5 nested-family param mutation with propagation →
P6 (bonus) ParamDrivenSolids prism bound to the renamed param, applied on the fly →
P7 cleanup to census-zero.

Metrics: interface inputs per proof (count + shape), script runs, compile failures,
loop cost per refinement, **same-language score** (which proofs spoke the same
addressing/units grammar), friction notes. Full spec in `FOUNDATION.md`.

## Verified environment facts (2026-07-04)

- Bridge restored via `live_restart` (Rider debug lane); Snowdon HVAC + 6 links open;
  `revit.apply.document.open` host op works (34.9 s for the 7-doc set).
- `pea --dev script execute` end-to-end loop works; ReadOnly static mutation policy
  rejects `EditFamily`/`FamilyManager`/FamilyFoundry mutation calls — family work runs
  as WriteTransaction (host-owned txn, rollback on exception).
- FamilyFoundry surfaces today (survey, 2026-07-04): type-level only; Migrator = N
  families × one profile; Manager = open family doc; desired-state compiles → lowers →
  operation queue with provenance; artifacts (run-summary/family-report/snapshot-diff)
  are the proof model. NOT possible today: instance edits, cross-project rename, nested
  mutation (only purge), per-family differentiated ops in one run.
- Family templates: `C:\ProgramData\Autodesk\RVT 2025\Family Templates\English-Imperial\`
  (`Generic Model.rft` confirmed). Deployed Pe DLLs (incl. `Pe.Revit.FamilyFoundry.dll`)
  under `%APPDATA%\Autodesk\Revit\Addins\2025\Pe.App\<stamp>\`.
- JSON host-op requests from PowerShell need `'{\"escaped\": \"quotes\"}'` through the
  dev-lane CLI.

## Open questions

- Does ONE addressing grammar honestly span project-family / instance / fam-doc /
  nested, or do instances want to stay an element-domain concern?
- Declarative desired-state vs imperative op-list: which survives the rename+migrate
  case (inherently transitional, not a state) with less contortion?
- Can FamilyFoundry's engine be reused from scripting, or does version-coupled DLL
  referencing force the interface up into host operations?
- Where does ParamDrivenSolids sit: same document as param mutations, or a separate
  geometry concern that merely shares the address grammar?
