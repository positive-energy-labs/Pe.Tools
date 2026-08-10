# P9 native readback results

## Changed

- Added `RoomTakeoff.ReadbackNative` for every Space on a requested level and phase, independent of ownership token.
- Native Space boundary curves are tessellated without simplification, ordered largest-loop-first, and serialized through `TakeoffResult.ToTsv` as `rooms_<level>.native.tsv` with typed `source=native` provenance.
- Native area, outer-loop perimeter, location point, and limit offset flow into standard `ROOM` fields; unusable limit offsets fall back to native unbounded height, then the configured story cap, with a log entry.
- Writes use a same-directory temporary file followed by an atomic move/replace. The typed result reports spaces read, unplaced and unenclosed skip counts, and the path written; the same census is always logged.
- Detector directory parsing ignores `.native.tsv` siblings, so later materialization resolution still reads only detector takeoffs.
- Added FreshRevitProcess round-trip and ownership-independent renumber proofs. The round-trip parses through `TakeoffTsv.ParseTsv` and reports `source=native`.

## Exposure

`MaterializeSpaces` has no host-operation metadata or wrapper; it is exposed only by the public C# `RoomTakeoff` facade for scripts/tests. Readback remains in that same lane, so no operation typegen or `source/pe-tools/` change is required.

## Binding gates

- Exact FreshRevitProcess C# filter: 53 passed, 0 failed, 0 skipped.
- Focused native round-trip and renumber filter: 2 passed, 0 failed, 0 skipped.
- Source compile (`Pe.Revit.Tests`, `Debug.R25`): succeeded with 0 errors; existing repository warnings remain.
- `python eval/rhvac/score-takeoff.py`: TOTAL SCORE 54.1 exactly.
- Committed replay TSVs: untouched.
- `source/pe-tools/`: untouched.
- Changes staged; no commit created.
