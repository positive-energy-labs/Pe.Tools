# project-a Takeoff -> RHVAC end-to-end proof

Date: 2026-08-05

Branch: `codex/rhvac-room-shapes`

## Result

The current inferred-policy Partition replay produced 285 rooms. `RhvacCandidateBuilder` converted
all 285 to RHVAC envelope candidates, and the 32-bit Jet lane inserted all of them into a save-as
copy of the real project-a `.r10`. The copy extracted as 435 rooms: the original 150 plus the 285
inserts. Projection comparison proved:

- all 150 original room projections, all 42 systems, and stored building totals were unchanged;
- all 285 candidate rooms read back with the expected names, numbers, areas, heights, internal
  loads, floors, roofs, walls, assemblies, and direction codes within `0.001` of input;
- all 1,340 wall rows read back in the sent order with compact `index1` ordinals `1..N`;
- the source file SHA-256 remained
  `0CB85FABD0732AA9FAFF9981449C648BE017A3B85E8C99F837A25859F675D716` before and after export.

This proves an editable `.r10` data artifact, not a calculated design. RHVAC has no headless
calculation API; the inserted rooms have zero stored result loads until the scratch file is opened,
calculated, and saved in Elite RHVAC.

## 1. Fresh Partition replay

The capture directory also contained two project-b snapshots, so the project-a files were explicitly
filtered. `PE_TAKEOFF_POLICY` was removed: `ProjectAReplayDumpRun` therefore used its inferred
default. The SDK reported `lane: fresh`, `outcome: passed`, and one passing test in 2m55s; no user
RRD session was used.

```powershell
$env:PE_TAKEOFF_REPLAY_OUT = (Resolve-Path 'eval\rhvac\project-a\takeoff').Path
$env:PE_TAKEOFF_REPLAY_FILTER = 'replay_Level_0_Lower_Level.bin;replay_Level_0_Theatre.bin;replay_Level_1_Main_Level.bin;replay_Level_2_Upper_Level.bin;replay_Level_3_Attic.bin'
Remove-Item Env:PE_TAKEOFF_POLICY -ErrorAction SilentlyContinue
dotnet tool run pe-revit -- test fresh --json --filter 'FullyQualifiedName~ProjectAReplayDumpRun.Dump_replayed_tsvs' --timeout-seconds 600
```

| Level | Rooms | `META totalSqft` | SHA-256 |
| --- | ---: | ---: | --- |
| Level 0/Theatre | 4 | 826.2 | `E33E2AA545927B3D243F5FC7A1A3D9D6B16F05CD4657B610285DC552048DA251` |
| Level 0/Lower Level | 69 | 15,106.0 | `4D9D7B08A7027A1C9A412DD1310B562C7716D95843B42EBAEBB1CBD427E82FBC` |
| Level 1/Main Level | 82 | 22,825.0 | `05BC41D819F558A14DD50EE8126FCA798A03416C13B6148482F734E5A3686DD5` |
| Level 2/Upper Level | 79 | 14,137.4 | `8CBF5CFDE66324E14336083DFA10AF9F7E8AEDA4F9BA7B86B12E637BA3266470` |
| Level 3/Attic | 51 | 7,450.9 | `1886B162F77D11362379FFBBA30B835F391557F1871F8C3FEC993D5FF80BC58A` |
| **Total** | **285** | **60,345.5** | |

The refreshed outlines exposed a grid-pitch bug in both builder and web simplifiers: 94 snapped
edge components were below 0.01 ft, while the actual 0.25 ft raster component occurred 79,610
times. Using the minimum component selected a near-zero tolerance. The mirrored implementations
now use the most frequent repeated component no larger than the existing 1 ft raster limit. A
synthetic regression proves 100 clean long-span rooms cannot drown out a smaller raster staircase
or promote a micro-snap. The project-a regression reduces 83,372 raw outer-loop vertices to 12,268
(85.3%) while keeping every room within the existing area gate.

## 2. Candidate build

The committed project-a slab convention originally named a nonexistent assembly (`Slab on grade`).
It now uses the exact existing `.r10` floor seed, `shortest side of floor slab is 20' wide`, with
the same U-value 0.019. Wall, roof, slab-floor, and framed-floor seed names were all found exactly
once in the source assembly listing.

`RhvacProjectAEvalRun` is the existing offline entry point that calls `ParseTsv`, loads
`conventions.json`, calls `RhvacCandidateBuilder.Build`, and writes `candidate.rooms.json` before
scoring it:

```powershell
$env:PE_EVAL_PROFILE = 'bootstrap'
dotnet tool run pe-revit -- test fresh --json --filter 'FullyQualifiedName~RhvacProjectAEvalRun.Score_current_candidate' --timeout-seconds 600
```

The SDK reported `lane: fresh`, `VerifyTarget: FreshRevitProcess`, and `buildExitCode: 0`; the test
then intentionally exited 1 at the score assertion. The artifact was produced correctly without
contacting RRD; the red score is retained under Residual gaps instead of being treated as an export
failure.
`candidate.rooms.json` SHA-256 was
`B04A7D8A2B050339E3186D41F7550615A811AE3A35A27BC55A31474375F27BAA`.

| Level | Candidates | Area (ft²) | Walls |
| --- | ---: | ---: | ---: |
| Level 0/Theatre | 4 | 826.2 | 27 |
| Level 0/Lower Level | 69 | 15,106.2 | 347 |
| Level 1/Main Level | 82 | 22,825.5 | 368 |
| Level 2/Upper Level | 79 | 14,137.6 | 312 |
| Level 3/Attic | 51 | 7,450.9 | 286 |
| **Total** | **285** | **60,346.4** | **1,340** |

Direction counts followed the README convention `0=N..7=NW` clockwise: `0:161`, `1:183`,
`2:154`, `3:175`, `4:159`, `5:180`, `6:155`, `7:173`. Each room has at most one wall row per
direction.

## 3. Save-as-copy export

The existing `.r10` already used room numbers 1..150. The builder's domain candidates also start
at 1, so the scratch insert payload mechanically offset candidate numbers by the source maximum;
names and all geometry remained unchanged. This avoided asserting an unreliable candidate-to-
engineer-room update map.

```powershell
$work = Join-Path (Resolve-Path '.artifacts').Path 'tmp\rhvac-e2e-20260805-final'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$ps32 = 'C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
$extract = (Resolve-Path 'source\Pe.Revit.Takeoff\Rhvac\extract-rhvac.ps1').Path
$source = (Resolve-Path 'eval\rhvac\project-a\projectA.local.r10').Path

& $ps32 -NoProfile -ExecutionPolicy Bypass -File $extract -Path $source -Output (Join-Path $work 'source.extract.json')
& $ps32 -NoProfile -ExecutionPolicy Bypass -File $extract -Path $source -Output (Join-Path $work 'source.assemblies.json') -Assemblies

$sourceExtract = Get-Content -LiteralPath (Join-Path $work 'source.extract.json') -Raw | ConvertFrom-Json
$maxNumber = (@($sourceExtract.rooms | ForEach-Object { [int]$_.number }) | Measure-Object -Maximum).Maximum
$candidates = Get-Content -LiteralPath 'eval\rhvac\project-a\candidate.rooms.json' -Raw | ConvertFrom-Json
foreach ($room in $candidates) { $room.Number = [int]$room.Number + [int]$maxNumber }
$candidates | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $work 'candidate.insert.rooms.json') -Encoding utf8
```

The insert payload contained 285 rooms numbered 151..435. Export ran only in 32-bit PowerShell and
wrote a scratch copy:

```powershell
$export = (Resolve-Path 'source\Pe.Revit.Takeoff\Rhvac\export-rhvac.ps1').Path
$rooms = Join-Path $work 'candidate.insert.rooms.json'
$output = Join-Path $work 'projectA.partition.inserted.r10'
$sourceHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash
& $ps32 -NoProfile -ExecutionPolicy Bypass -File $export -RoomsJson $rooms -Template $source -Output $output
$sourceHashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash
if ($sourceHashAfter -ne $sourceHashBefore) { throw 'Source .r10 changed during save-as-copy export.' }
```

Result: `EXPORTED 285 room(s)`. The 18,593,792-byte output SHA-256 is
`D45AEE0DFCD805E7D891FF15F42B5A492A889D217AABE5FEB794398C5349189F`.
The 9,824,256-byte source stayed byte-identical. The output is ignored scratch data and is not
committed.

## 4. Extract and round-trip verification

```powershell
& $ps32 -NoProfile -ExecutionPolicy Bypass -File $extract -Path $output -Output (Join-Path $work 'output.extract.json')
powershell -NoProfile -ExecutionPolicy Bypass -File eval/rhvac/e2e-check.ps1 -CandidateJson eval/rhvac/project-a/candidate.rooms.json -SourceExtract (Join-Path $work 'source.extract.json') -OutputExtract (Join-Path $work 'output.extract.json') -NumberOffset 150
```

Result: `EXTRACTED 435 rooms, 42 systems` and `E2E-CHECK PASS`. The committed checker keys original
rows by `Identifier` and inserts by offset `Number`; it compares scalar fields, every floor/roof/
wall/opening row, exact strings, integer fields, direction codes, counts, compact wall ordinals,
and `GlassReference`/`DoorReference` against the parent wall ordinal. It allows less than 0.001 for
Jet float32 values. It passed with:

- 150/150 original rooms projection-identical;
- 285/285 inserts found and projection-equivalent;
- 1,340/1,340 wall direction codes exact;
- 1,340/1,340 wall ordinals compact and exact;
- candidate area 60,346.4 ft² -> extracted area 60,346.400097 ft², a +0.000097 ft² total delta;
- maximum room-area quantization 0.000098 ft², wall-length quantization 0.000010 ft,
  floor-area quantization 0.000120 ft², and roof-area quantization 0.000049 ft².

The existing real-file edit verification was also run against a separate scratch copy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File eval/rhvac/edit-check.ps1 -SourceR10 eval/rhvac/project-a/projectA.local.r10 -WorkDir .artifacts/tmp/rhvac-e2e-20260805-final
```

Result: `EDIT-CHECK PASS: 150 rooms -> 149; update Identifier=16 exact; delete Identifier=163
clean; all other rooms projection-identical.`

## 5. Regression lanes

The operational score gate is excluded because it deliberately asserts the currently failing
bootstrap quality target. The remaining NoDocumentRuntime suite was green through the SDK-owned
FreshRevitProcess lane without contacting RRD:

```powershell
dotnet tool run pe-revit -- test fresh --json --filter 'FullyQualifiedName~LibraryBehavior.NoDocumentRuntime&FullyQualifiedName!~ProjectAEvalRun' --timeout-seconds 300
```

Result: 37 total, 35 passed, 2 operational tests skipped, 0 failed.

The C#/web simplification implementations are mirrors, so the full web test suite was run:

```powershell
pnpm --filter @pe/web exec vp test run
```

Result: 16 files, 83/83 tests passed. Host files were untouched.

## Residual gaps and conversion losses

- **Detection quality is not at the RHVAC eval gate.** Bootstrap score: 121/132 oracle rooms
  matched, 285 candidates with 164 unmatched, curated gated coverage 24.7% area / 29.8% CFM,
  diagnostic coverage with provisional matches 79.2% area / 84.9% CFM, 25 violations, and 1,033
  warnings. Candidate area is 60,346 ft² versus 47,230 ft² across oracle rooms (+27.8%).
- **Partition area rounding:** summed TSV `META totalSqft` is 60,345.5 ft²; summed one-decimal ROOM
  areas used by candidates are 60,346.4 ft², a +0.9 ft² (+0.0015%) conversion delta.
- **Ambiguity remains unresolved:** 13 flagged rooms were exported as-is: 12 carry
  `open-plan-merge`; 3 carry `low-evidence-boundary` (two rooms carry both). No flag is representable
  in `.r10`, so the scratch file does not preserve those edit prompts.
- **Plan shape is lossy by design:** raw loops simplify 85.3%, then RHVAC receives scalar room area
  plus one summed exterior wall per direction, not the editable Partition polygon. The refreshed
  TSVs contain 752 excluded/non-domain void loops across 134 rooms; partition accounting still has
  zero uncovered in-domain cells. Coverage calculations honor these loops, but v1 exterior-wall
  classification ignores their boundaries, per `Rhvac/README.md`.
- **23 rooms have zero exterior wall rows.** They were not skipped; they exported with explicit
  zero wall placeholders that the extractor correctly drops. All 285 takeoff rooms were inserted.
- **No opening detection:** candidates contain zero windows and zero doors. Therefore wall ordinals
  were proven for wall row ordering, but no nonzero `GlassReference` or `DoorReference` was
  exercised in this takeoff export. The separate edit-check covers real glass references.
- **No RHVAC UI recalc/open in this proof:** stored source systems/building results remain unchanged
  and are stale for the inserted rooms by design. Manual open/calculate/save is still required for
  load results and final application-level acceptance.
