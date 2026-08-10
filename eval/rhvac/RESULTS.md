# Scoreboard usability-gate results (2026-08-05)

## projectA

Command: `python eval/rhvac/score-takeoff.py`

The command exited 0, the project-a registration self-check assertion passed, and the existing
headline remained exactly `TOTAL SCORE 54.1`.

```text
TOTAL SCORE 54.1  (mean IoU x100 over 118 GT rooms; high-conf 56.5 over 92; 0 stale-excluded)

PRECISION  (candidate best same-floor GT IoU; matched >= 0.20)
floor  gt cand ratio match% junk  junk sf  <60 60-150  >150
    0  17   73  4.29   19.2   59   9023.1   18     23    18
    1  44   82  1.86   42.7   47  15401.3   21      7    19
    2  45   79  1.76   46.8   42   6981.8   22      7    13
    3  12   51  4.25   27.5   37   4109.0   22     10     5
TOTAL 118  285  2.42   35.1  185  35515.2   83     47    55

GATES  (absolute; --gate exits nonzero on failure)
FAIL candidate/GT <= 1.2 per level: L0 4.29 FAIL  L1 1.86 FAIL  L2 1.76 FAIL  L3 4.25 FAIL
FAIL taxonomy ok >= 80% of GT rooms: 22.9%
FAIL zero junk candidates <60 sf: 83
FAIL wall recall >= 80% at 1.5 ft: 53.7%
OVERALL FAIL
```

The run wrote five junk-flagged overlays beside `project-a/scoreboard.txt`, one for each takeoff TSV.

## projectB

Per `project-b/NOTES.md`, the brief's takeoff-only invocation was adapted to include the project-b oracle:
`python eval/rhvac/score-takeoff.py --project eval/rhvac/project-b --takeoff-dir eval/rhvac/project-b/takeoff`.

```text
TOTAL SCORE 23.3  (mean IoU x100 over 22 GT rooms; high-conf None over 0; 0 stale-excluded)

PRECISION  (candidate best same-floor GT IoU; matched >= 0.20)
floor  gt cand ratio match% junk  junk sf  <60 60-150  >150
    0  22   20  0.91   55.0    9   2204.6    4      2     3
TOTAL  22   20  0.91   55.0    9   2204.6    4      2     3

GATES  (absolute; --gate exits nonzero on failure)
PASS candidate/GT <= 1.2 per level: L0 0.91 PASS
FAIL taxonomy ok >= 80% of GT rooms: 4.5%
FAIL zero junk candidates <60 sf: 4
FAIL wall recall >= 80% at 1.5 ft: 0.0%
OVERALL FAIL
```

The run wrote `overlay_MAIN_LEVEL.png` and `overlay_ROOF_PLAN.png` beside
`project-b/scoreboard.txt`.

## Gate exit

PowerShell equivalent of the requested exit-code proof:

```powershell
python eval/rhvac/score-takeoff.py --gate
Write-Output "EXIT_CODE=$LASTEXITCODE"
```

```text
OVERALL FAIL
EXIT_CODE=1
```
