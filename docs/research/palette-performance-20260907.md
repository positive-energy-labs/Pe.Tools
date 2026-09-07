# Palette performance in Revit, 2026-09-07

The shared palette changes reduce search latency and long scrolling stalls. They do not improve every timing. Warm family opening and median individual navigation steps were slower in these runs.

## Change and scope

Baseline: `bb4b7f1e5b973199aea245f9feed46f9962a4502`. Candidate: the palette changes accompanying this report, developed in `Pe.Tools-palette-perf`, branch `perf/palette-20260907`.

- `PostableCommandHelper.LoadPostableCommands` reads usage CSV once. `IPaletteListItem.Icon` accepts native `ImageSource`; command rows no longer encode and decode PNGs.
- `SearchFilterService.BuildMetadata` reads display properties once. Revit-backed view and family items retain those strings for the item snapshot. Their providers create new items on refresh.
- `PaletteViewModel` retains valid acquisitions across query cancellation, caches empty snapshots, rejects obsolete revisions, uses a 50 ms debounce, and updates row slots without collection Reset. Selection is explicitly synchronized after filtering.
- `ListView` uses native scrolling with one selection-scroll owner. The palette shadow covers a sibling surface instead of row content. Family highlighting uses debounced selection and the real Revit task queue; previews clear once per selection burst and reject stale queued renders.

## Runtime custody

**PROVEN[session, controlled, dev payload]:** the probe ran inside `Revit.exe`, in SDK snapshot session `palette-perf-25`, with `Pe.Revit.Ui.dll` loaded from that session's generation. Each run recorded its process, assembly location, module ID, and session descriptor from inside Revit. These are not standalone WPF timings.

| Run | Revit PID | Generation | Pe.Revit.Ui module ID |
|---|---:|---|---|
| Initial baseline | 94896 | 20260907072346818 | 0e316e32-95bf-47d5-8160-63350922c036 |
| Initial candidate | 85432 | 20260907072935950 | 1bccb12d-6f6d-4373-adb1-1d4532bd6f5e |
| Settled baseline | 65964 | 20260907073435924 | 0e316e32-95bf-47d5-8160-63350922c036 |
| Settled candidate | 99388 | 20260907073714796 | 4cb8fdf6-3148-43e6-92da-b2fa5db8315e |

The SDK CLI was `0.1.0-beta.150`, SHA-256 `4D23791A6C273158A4E64D5361F79D2A04C575C25BA202D1381D54CF43563457`. Only this task's sessions were stopped. Other agents continued working; these are sequential workstation measurements under concurrent load, not isolated-machine estimates.

## Workload and measurements

[`PalettePerformanceProbe`](../../source/Pe.App/Benchmarks/PalettePerformanceProbe.cs) creates an unsaved Revit project, adds 120 drafting views, loads a real family fixture and duplicates types, and closes its document without saving. The four surfaces contain 120 views, 91 family types including template types, 449 real ribbon commands, and 13 JSON profiles from the test fixtures. Counts matched between baseline and candidate.

The probe opens actual `PaletteFactory` windows, runs five searches including clears, then 40 downward navigation steps (15 for profiles). It uses the app's Revit queue and WPF dispatcher. Opening includes acquisition and initial layout. Search includes debounce, filtering, and layout. These timings do not measure OS key delivery or GPU presentation.

The settled comparison has three iterations per surface; iteration zero is excluded. Search has 10 warm samples per surface, navigation has 80 (30 for profiles), and opening has only two. Navigation waits until the old animated viewer reaches its target within one pixel, then completes layout. This prevents treating an unfinished 300 ms animation as completed scrolling. p95 uses nearest rank.

| Surface | Open median, ms before → after | Search median, ms before → after | Navigation median, ms before → after | Navigation p95, ms before → after | Navigation sequence total, ms before → after |
|---|---:|---:|---:|---:|---:|
| Views | 521 → 400 | 197 → 74 | 32 → 47 | 347 → 95 | 3361 → 2062 |
| Family types | 391 → 420 | 200 → 108 | 33 → 48 | 347 → 93 | 3421 → 2031 |
| Commands | 519 → 404 | 327 → 119 | 26 → 47 | 318 → 80 | 2825 → 1907 |
| JSON profiles | 480 → 378 | 317 → 159 | 22 → 30 | 370 → 79 | 942 → 526 |

Search median improved 46–64%; navigation p95 improved 73–79%; complete navigation sequence time improved 32–44%. Median single-step navigation regressed, so the scrolling claim is reduced stalls and sequence time, not uniformly faster steps. Family opening regressed 7%; two warm samples do not establish a stable opening improvement elsewhere.

The earlier six-iteration comparison independently measured search improvements of 59%, 45%, 60%, and 47%, respectively (25 warm samples each). Its navigation timings ended at layout and could omit ongoing animation; they are preserved but are not settled-scroll proof. Initial opening results were also mixed: 416 → 398 ms Views, 361 → 431 ms Families, 522 → 451 ms Commands, and 389 → 419 ms Profiles.

## Checks and limits

The candidate completed all three iterations and passed assertions on each surface for selected item/index identity, empty results, clearing search, rapid query replacement, reverse selection, reuse of the acquisition during search, caching an empty acquisition, and reacquisition on explicit refresh. Candidate-only checks run outside timed operations in iteration zero. Rendered images of all four surfaces were inspected. Final isolated `Debug.R25` compilation passed with 0 errors and 33 warnings after removing the startup hook; `final-compile.log` records this separate compile proof.

**UNPROVEN:** full production action execution, sidebar preview latency, family-document highlighting latency, docking, installed-product behavior, and large-project scaling. The timed surfaces use real providers/items and shared palette code, with a no-op Inspect action and no sidebar. The family workload exercises family types, not every family palette tab. No speedup is attributed separately to individual changes. The timings include the deliberate debounce reduction.

## Reproduction and rejected runs

Invoke `PalettePerformanceProbe.RunAsync(uiapp, outputDirectory, fixturesDirectory, expectedSessionId)` from a controlled Revit callback, then return control to Revit so queued acquisition can run. Observe the returned task. The method requires the expected session descriptor and records the answering runtime before creating data. It is an explicit developer probe; normal app startup contains no benchmark hook.

The local evidence root is `.artifacts/runs/session-20260907-palette-perf/` in the worktree. It contains each run's CSV, runtime identity, completion marker, the candidate renderings, SDK results, `product.patch`, `startup-hook.patch`, the original probe, and `summarize.py`. `python .../summarize.py settled` produces the detailed summary. The temporary startup hook selected three iterations; baseline skipped candidate-specific cache assertions. SDK stop removes its generation files, so the contemporaneous module IDs and receipts, rather than retained baseline DLLs, are the baseline identity evidence.

An earlier `test --attach --id palette-perf-25` executed in `pe.app-25`, PID 71484, loading that session's assembly. Those timings are rejected. A dedicated fresh test also launched Revit without its test adapter and produced no workload proof. Quarantine was a possible explanation for that adapter failure, not a demonstrated cause. The final measurements bypassed the adapter using the temporary app startup hook and verified their own process and payload. A worktree name or successful SDK launch alone was never accepted as runtime proof.
