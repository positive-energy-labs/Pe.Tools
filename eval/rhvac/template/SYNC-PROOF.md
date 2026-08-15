# `rhvac.sync` proof — firm template, INSERT-dominant path

What the `rhvac.sync` op's PowerShell lanes actually did to a scratch copy of the firm's Manual-J
starter template. Companion to [`SYSTEM-INSERT-PROBE.md`](SYSTEM-INSERT-PROBE.md) (the System
clone-insert probe) and `../project-a/UPSERT-PROBE.md` (the Room UPDATE/INSERT probe).

Fixture: `ManJ_Architect_Project_YYYYMMDD.r10` from the team drive, md5
`48c0249c8fc9f47bdf8a7ff858fc4d79`, 780,288 bytes — 1 blank room (Identifier/Number 1), 2 systems
(`1 "Down"`, `2 "Up"`), and exactly one assembly anywhere in the file (floor
`passive, heavy dry or light wet soil`, U-1.18). The original on `G:` was only ever read.

Artifacts here: [`sync-probe.json`](sync-probe.json) (the request),
[`sync-probe.result.json`](sync-probe.result.json) (what the lane reported),
[`sync-probe.extract.json`](sync-probe.extract.json) (an independent `extract-rhvac.ps1` read-back),
[`verify-sync-probe.ps1`](verify-sync-probe.ps1) (30 assertions over the end state).

## What was asked for

Two systems seeded (3, 4), two rooms inserted, the blank seed room deleted — and deliberately, one
room whose wall assembly exists in **neither** the file nor the preset catalog, to exercise the
fallback:

| Room | Assemblies | Resolution path |
|---|---|---|
| 101 Great Room | floor `passive, heavy dry or light wet soil` | already in the target file |
| | roof `R49 closed cell sprayfoam in 2x14 joist cavity`, wall `Tasting Room Wall` (x2), glass `U-0.55 SHGC-0.40`, door `Wood - Solid Core` | preset catalog |
| 102 Primary Bedroom | floor `WR R20` | preset catalog |
| | wall `PROBE - assembly in neither the file nor the catalog` | **fallback** |

## Run

```
BEFORE  rooms=1  tables=18
Seeded System 3 'Great Room - IU-3' (identifier=4, cloned from System 1)
Seeded System 4 'Primary Suite - IU-4' (identifier=5, cloned from System 1)
Room 101 'Great Room': identifier=2 walls=2 glass=1 doors=1 floors=1 roofs=1 OK
FALLBACK room 102 'Primary Bedroom' walls: assembly not in the file or the preset catalog
        [PROBE - assembly in neither the file nor the catalog] -- category written as one zero row
Room 102 'Primary Bedroom': identifier=3 walls=0 glass=0 doors=0 floors=1 roofs=0 OK
SEED ROOM DELETED (Identifier 1)
SYNCED systems=2 inserted=2 updated=0 deleted=0 seedRoom=deleted fallbacks=1
AFTER   rooms=2  tables=18
VALIDATED: non-Room tables unchanged (System +2), room count 2 as expected, Numbers unique.
SWAPPED -> ...\synctest.r10   backup: ...\backups\synctest.20260814-220945.bak.r10
```

The reported result (`sync-probe.result.json`) carries the number -> Identifier mapping the caller
needs for Revit provenance — `101 -> 2`, `102 -> 3` — plus `fileIdentity`, the seeded systems with
their assigned identifiers, the seed-room decision and its reason, and the one assembly fallback.

## Read-back (independent of the writing lane)

`verify-sync-probe.ps1` re-opens the swapped file and asserts the end state: **30 checks, all pass.**
The load-bearing ones:

- **Systems**: 4 rows. `1 "Down"` and `2 "Up"` still carry the template's own names; `3` and `4`
  carry the requested names and **inherit** `WinterIndoorDryBulb` 70 / `SummerIndoorDryBulb` 75 from
  the clone source — which is the honest consequence of cloning, recorded, not hidden.
- **Rooms**: 2 rows; the blank seed room is gone. Room 101 reads back area 420.5, walls `22,19`,
  glass on wall ordinal 1, door on wall ordinal 2.
- **Catalog code fields landed, not just the description text** — the point of the shim:
  `WallConstructionMaterial = Tasting_Wall,Tasting_Wall`, `WallGroupCode = H,H`,
  `RoofConstructionMaterial = R49 CC SPF in 2x14`, `DoorConstructionMaterial = 11D`.
- **The file's own assembly still wins over the catalog**: room 101's floor description is the
  template's `passive, heavy dry or light wet soil`.
- **The fallback is a zero row, never a guess**: room 102's `WallLength = 0`, `WallDescription = ''`,
  `WallUValue = 0`. The room carries no wall load at all, and the omission is reported rather than
  papered over with a plausible material.

## Envelope

- **Backup is byte-identical to the pre-sync file**: `48c0249c8fc9f47bdf8a7ff858fc4d79` on both the
  original template and `synctest.20260814-220945.bak.r10`.
- **`-WhatIf` leaves the target untouched**: same md5 after the run, `swapped: false`,
  `backupPath: null`, and the identifiers it would assign still reported (2, 3).
- **Validation is not decorative**: it allows `System` to grow by exactly the number of systems the
  lane reported seeding, requires the room count to match inserts/deletes/seed-room, requires Room
  `Number` uniqueness, and re-checks every reported inserted Identifier against the file — a wrong
  number -> Identifier mapping fails the sync rather than reaching Revit provenance.

## Residual gaps

1. **Not opened in Elite RHVAC.** Everything above is Jet-layer. A file with *seeded systems* has
   never been through RHVAC's own open + recalculate (the room-UPDATE equivalent has — see
   `source/Pe.Revit.Takeoff/DECISIONS.md`). This is the standing manual check per export.
2. **`fileIdentity` is weak** — the format carries no GUID. It is file name + a hash of the
   project/client titles; retitling the project in RHVAC changes the stamp.
3. **The preset catalog is a shim** with 16 assemblies mined from one project (projectA). A firm
   assembly it has never seen falls back to a zero row. Per-project custom assemblies are the real
   design and are deferred.
4. **Seed-room deletion is keyed to Identifier 1** — the template's blank row. The lane refuses if
   that row has been edited, but "the seed room is Identifier 1" is a template convention, not a
   schema fact.
5. **Single template, single RHVAC version** (`Version` 9.1). Column counts already differ from
   project-a (System 237 vs 240), which is why the lane reads column lists at runtime.
