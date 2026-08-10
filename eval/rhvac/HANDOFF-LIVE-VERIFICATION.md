# Handoff — live project-a verification of the edit-in-Revit loop (2026-08-10)

Audience: the next agent. The takeoff/rhvac campaign round P6–P9 + P8R is MERGED to main
(f69ea0e) and offline-proven; the one remaining step is collaborative live verification with
kaitpw. The worktree and its branch are deleted — main is the only lane.

## Where things stand

- Flow (user-aligned): calc draft → resolve intent → materialize → human edits geometry in
  Revit → readback → (P10, unbuilt) recalc-as-diff. Revit is the geometry editor; the /rhvac
  route is metadata/resolve/visibility only.
- Offline proofs all green and re-verified: C# filter 53/53 (+P8R materializer 9/9), web
  96/96, host 44+2 skipped, scoreboard TOTAL 54.1 exact. Briefs/results in `eval/rhvac/
  BRIEF-P6..P9*.md`, `RESULTS-P6..P9*.md`; state log in `eval/rhvac/REFINEMENT.md`.
- Live session at handoff: user Revit pid 57420 (bridge port 62993) with the local projectA
  copy + two IFCs open. Its hot-loaded takeoff build is byte-identical to merged main. Host
  service port 61625, web dev http://localhost:3000/rhvac (both launched from main via
  `.claude/launch.json` names `host` / `web-only`). Pids/ports go stale — re-check with
  `pe-revit live status` before trusting.

## What to do with the user

1. Drive takeoff calc + `RoomTakeoff.MaterializeSpaces` against the open project-a doc. NOTE:
   there is NO host-op wrapper for the takeoff Revit lane (`Detect`/`MaterializeSpaces`/
   `ReadbackNative` are a script/test facade — see RESULTS-P9-NATIVE-READBACK.md §Exposure).
   Drive via the script lane over the bridge.
2. Judge the drawn result together on a real view. Expected shape (project-a Main, from
   doc-backed tests): 10 Spaces (regularized only), ~72 muted FilledRegions (unresolved
   evidence), ~2 outline fallbacks (R17/R59), zero silent holes.
3. User straightens 1–2 rooms natively (separation lines / redraw), then run
   `RoomTakeoff.ReadbackNative` → writes `takeoff/rooms_<level>.native.tsv`
   (`META source native`).
4. Confirm the route flips those rooms to "native — edited in Revit" (merge view lands by
   room id; native excluded from resolution remap).
5. Capture verdicts + screenshots as a RESULTS-LIVE doc; update REFINEMENT.md state log.

## Gotchas

- `pe-revit live converge` without `--restart` exits 3 "restart-required": the descriptor-
  owned payload is gone (killed in cleanup). Do NOT restart casually — it is explicit policy
  and the user's session (57420) holds the open project-a doc. If a C# hot-patch is needed,
  `converge --restart` then reopen the doc.
- A locked husk of the deleted worktree remains at `Pe.Tools-rhvac-room-shapes/` (DLLs mapped
  into Revit 57420). Delete the folder after that Revit session closes.
- Nice3point.Revit.Extensions is pinned 2025.2.3 (2025.2.4 collides with Pe.Revit.Compat
  ToElementId — CS0121 on fresh restores). User decision deferred: eventually let Nice3point
  own ToElementId. Do not unpin without that decision.
- `pe-revit test fresh` once matched ZERO tests right after the pin changed the package graph
  (rerun was 9/9). Zero-match ≠ pass — always read the counts.

## Open items after live proof

- Promote the takeoff Revit lane to typed host ops + typegen (needs live host + `--session`).
- P10 recalc-as-diff: needs user decisions on conflict semantics (what counts as a conflict
  vs auto-accept; who wins by default). Grill before speccing.
- The 2 remaining ring failures (R17/R59) are a separate small mechanism if they bother the
  live result.
