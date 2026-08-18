# `[System]` seeding probe — clone a row, override `Number` + `Name` only

Discharges the obligation before `rhvac.sync` seeds systems: *"a new RHVAC System can be created by
cloning an existing System row and overriding only the engineer-facing number and name, without
inventing equipment, infiltration, or ventilation metadata."*

Fixture: the firm's Manual-J starter template
(`G:\Shared drives\PE Team Folder\04 PE Software Files\ManJ_Architect_Project_YYYYMMDD.r10`,
780,288 bytes, md5 `48c0249c8fc9f47bdf8a7ff858fc4d79`). Every probe ran on a scratch copy; the
original on `G:` was only ever read.

Lane: 32-bit `System.Data.Odbc`, `Driver={Microsoft Access Driver (*.mdb)}` — same as every other
`.r10` touch. Script: [`system-insert-probe.ps1`](system-insert-probe.ps1) (it writes the file it is
given; hand it a scratch copy).

**Verdict: PROVEN at the Jet layer. Clone-insert overriding `[Number]` + `[Description]` changes
exactly those two columns plus the autonumber `Identifier`, and touches no other table.** Wired into
`rhvac.sync` system seeding.

## 1. Schema facts (template, RHVAC 9.1 `Version` row)

| Fact | Value |
|---|---|
| `System` columns | **237** (projectA, a newer file, has 240 — schema drifts across releases, so the column list must be read at runtime, never hardcoded) |
| `System.Identifier` | `COUNTER` (autonumber). Do not supply it — same law as `Room.Identifier`. |
| `System.Number` | `INTEGER`, PRIMARY KEY, unique-enforced (see §4) |
| **The system NAME column is `Description`** | `VARCHAR` — *not* `Name`. Same naming as `Room.Description`. The host op's request field is `name`; the lane writes `[Description]`. |
| `DefaultSystem` table | **does not exist.** There is no `DefaultRoom`-style template row for systems, so the clone source must be an existing `System` row (the lane uses the lowest `Number`). |
| Template contents | 2 systems: `Number=1 "Down"` (Identifier 1) and `Number=2 "Up"` (Identifier 3). Identifiers already have a gap — never assume `Identifier == Number`. |

## 2. The insert

```sql
INSERT INTO [System] ([Number], [Description], <the other 234 columns>)
SELECT ?, ?, <the same 234 columns> FROM [System] WHERE [Number] = <cloneFrom>
```

The 234 cloned columns are every column except `Identifier` (COUNTER), `Number`, and `Description`.
They include the `LONGBINARY` blobs (`HotWaterPipeMaterial`, `DevicePressureLossNames`, …) and every
`Calculated*` result column.

```
affected rows = 1
new row Identifier=4  Number=3  Description='PROBE SYS 3'
```

## 3. Column-by-column read-back — 3 of 237 differ

Every column of the new row compared against the clone source (`LONGBINARY` compared by
sha256 + length):

```
DIFF Number:      '1' -> '3'
DIFF Identifier:  '1' -> '4'          # COUNTER; Jet assigned it (counter was at 3)
DIFF Description: 'Down' -> 'PROBE SYS 3'
columns differing: 3 of 237
```

Table census before/after, all 18 tables:

```
CHANGED System   2 -> 3
```

Nothing else moved. No sibling row is required anywhere — same result the room INSERT probe found
(`../project-a/UPSERT-PROBE.md` §3).

## 4. Duplicate `Number` is refused by the engine

```
INSERT … SELECT 3, 'DUPLICATE', … FROM [System] WHERE [Number] = 1
→ [23000] … would create duplicate values in the index, primary key, or relationship.
```

So the sync lane does not need its own uniqueness check to preserve integrity — but it checks anyway
to fail with a readable message instead of an ODBC string, and to make seeding idempotent
(an existing `Number` is left **untouched**, never renamed).

## 5. Parentage / metadata hygiene — what we deliberately never touch

The clone carries the source system's **entire** engineering payload: indoor design conditions
(`SummerIndoorDryBulb` 75 / `WinterIndoorDryBulb` 70), infiltration rates and method options,
coil delta-Ts, ventilation and exhaust rates, heat-recovery flags, duct load factors, the full
Manual-S equipment selection (`ModelType*`, `Brand*`, `Capacity*`, `SEER`/`AFUE`/`HSPF`, warranty
fields), and the stale `Calculated*` results.

**The sync lane writes exactly two of the 237 columns and interprets none of the others.** Rationale:

- Every one of those fields is an engineering decision the mechanical engineer owns in RHVAC. A
  seeded system is a *placeholder to hang rooms on*, not a designed system.
- Cloning is honest about provenance: the new system is visibly a copy of an existing one, and the
  engineer edits it in RHVAC's own dialogs. Inventing values would look designed but be fiction.
- `Calculated*` values come across stale (all zero in the template). RHVAC owns recalculation; it
  overwrites them on the next Load Preview, exactly as it does for cloned rooms.

Consequence to state plainly: **a seeded system inherits the clone source's design conditions.** In
the firm template both systems carry code-min defaults, so this is benign there. Against a real
project file the engineer must review seeded systems before trusting loads.

## 6. Residual gaps

1. **Not proven through Elite RHVAC itself.** As with the room UPDATE probe, this is Jet-layer
   integrity only. RHVAC opening a file with a cloned system and recalculating cleanly is a manual
   check per export. (The room-side equivalent has since been closed live — see `docs/features/takeoffs/LEDGER.md` —
   which is weak evidence in the same direction, not proof.)
2. **`Room.SystemNumber` → `System.Number` stays unenforced.** Jet accepts an orphan room. The sync
   lane validates the reference itself, before writing.
3. **One template, one RHVAC version.** The template is `Version` 9.1; project-a is a later build with
   240 System columns. The lane reads the column list at runtime, so drift is tolerated, but no
   third file has been probed.
4. **Clone source choice is a convention, not a proof.** The lane clones the lowest-numbered
   existing system. If an engineer's system 1 carries unusual design conditions, every seeded system
   inherits them.
