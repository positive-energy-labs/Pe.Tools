# SDK launch review: breakaway vs ShellExecute (temporary)

Temporary review artifact, 2026-09-14. Receipts: `.artifacts/runs/opus-sdk-proof-20260914/` (`receipts.jsonl` is the timeline). When a decision lands, promote one line to the SDK ledger and delete this file.

## Verdict

1. **The lifetime problem is real, and it is old.** Revit launched by the OLD SDK (`ShellExecute`, beta.158) dies when you press Ctrl+C on `vp run dev`. It survives a Host restart. The user's "never saw it" shows only that nobody watched. It does not show survival.
2. **The breakaway change (6426125, released as beta.159) fixes nothing, and it breaks the product launch path.**
   - With the `pe-revit` apphost, breakaway returns success, but Windows keeps Revit in the `vp run` job. Revit then dies exactly like OLD.
   - Through `dotnet tool run pe-revit` (the Host dev lane) it fails every time with `session.launch-breakaway-failed`, and Host reports the action as `succeeded`.
3. **No launch flag inside the SDK can fix lifetime under `vp run`.** The `vp run` task job is `0x2000` (KILL_ON_JOB_CLOSE, no BREAKAWAY_OK). vite-task 0.2.1 does not let you configure it.

Recommendation:
- **Revert 6426125** (back to `UseShellExecute = true`).
- **Keep 474d8df** (honest launch failure reporting).
- Drop the breakaway fixture that d675179 narrowed.
- Accept, and state in the dev output, that stopping `vp run dev` stops the Revit it started.
- Want Revit to outlive the dev command? Start that session outside the task. A simple case is a second terminal running `dotnet tool run pe-revit -- session start`. That keeps a simple `vp run dev` and adds no broker. (UNPROVEN: survival of a session started this way was not tested.)

## Evidence

Lane: session. Chain: Herdr w3:p1 `vp run dev` → `dev-watch.ts` → Host → `pe-revit` → Revit 2025. Checkout: Pe.Tools-route-primitive. SDK: NuGet `pe.revit.cli` beta.158 (a1d3ef6) and beta.159 (d5bf3e4). All test sessions (`opus-*`) were controlled by this run, and each one was stopped with `pe-revit session stop`. Installed Revit 43996 was not touched.

Two ways to select the SDK:
- **apphost lane:** `PE_REVIT_CMD=<nuget>\Pe.Revit.Cli.exe`, set by `dev-with-sdk.ps1` in the same PowerShell that runs `vp run`.
- **default lane:** plain `vp run dev`, so `dotnet tool run pe-revit` with the manifest pin beta.159.

| Run | Launch | Host restart | vp Ctrl+C |
|---|---|---|---|
| OLD apphost `opus-old-1` | PROVEN ok: Revit 78136, 21:49:43.616Z, parent CLI 28476 ← Host 68440 | PROVEN survived: touch 21:51:28.080Z, Host 68440→55776 | PROVEN killed: Ctrl+C 21:52:17.081Z, gone by 21:52:18.519Z |
| NEW apphost `opus-new-1` | PROVEN ok: Revit 19632, 21:54:03.877Z, parent CLI 73104 ← Host 54492 | PROVEN survived: touch 21:55:26.924Z, Host 54492→5900 | PROVEN killed: Ctrl+C 21:56:00.146Z, gone by 21:56:00.582Z |
| NEW apphost `opus-new-4` | PROVEN ok: Revit 61340, 22:03:32.405Z | not repeated | PROVEN killed: Ctrl+C 22:04:30.219Z, gone by 22:04:30.690Z |
| NEW default `opus-new-2`, `opus-new-3` | FALSIFIED: `session.launch-breakaway-failed` 21:57:53.779Z; Host action state `succeeded` | n/a | n/a |
| NEW default, agent shell (outside `vp`) | FALSIFIED: same failure, 22:01:13Z | n/a | n/a |

The user's failure at 20:16Z (receipt `3cd884b7`) is the same default-lane failure.

Job evidence comes from `jobs.ps1`, which duplicates job handles and reads limit flags and member PIDs:
- **The `vp run` runner node holds a `0x2000` job.** Its members are the pane PowerShell, the `vp exec` node, `dev-watch`, Host and `dev-web`. `vp exec` creates **no** job. The prior probe's "`vp exec` 0x2800" was the agent harness job.
- **Each node holds a libuv child job, `0x3C00`** (KILL_ON_CLOSE + BREAKAWAY_OK + SILENT_BREAKAWAY_OK + DIE_ON_UNHANDLED_EXCEPTION).
- **At 22:03:33.59Z, Revit 61340 was a member of the `vp run` `0x2000` job**, even though beta.159 had launched it with `CREATE_BREAKAWAY_FROM_JOB`. It was not in the Host libuv job. Breakaway left only the job that permits breakaway.
- **Default lane:** the `dotnet tool run` muxer (5124) holds a job that contains the CLI (47200). `Microsoft.DotNet.Cli.Utils.dll` (SDK 10.0.203) contains `ProcessReaper`, `CreateJobObject` and `KillOnJobClose`. Breakaway from the immediate job fails, so the launch fails.

Death signature is the same in OLD and NEW, and the same as the unexplained exits at 14:15 and 14:42:
- The journal stops in the middle of an event (`journal.3753` stops at 16:51:48 local, with no `ExitNativeInstance`).
- The Application log has no WER entry.
- The SDK row changes to `gone-receipt`.
- Death comes 0.4–1.5 s after Ctrl+C.

## Against the prior diagnosis

- "vp run blocks breakaway, so detach Revit": the fix was never tested against Revit under the real chain. On the apphost path the API returns success and does nothing useful. On the real path it fails for a different reason (the .NET tool reaper, not vp).
- The fixture proved survival inside a job that the fixture itself made permissive. The real outer job was never in that test.
- beta.159 was released without a real Host → `dotnet tool run` start. One real start would have shown the regression.

## Uncertainty

- **UNPROVEN: exact cause of the 14:15 and 14:42 exits.** Their signature matches a job kill. The Revit at 14:42 was a beta.158 session started through the default lane, and the next `vp run dev` started at 14:45:38. No Ctrl+C timestamp for those exits was recovered.
- **UNPROVEN: OLD on the default lane (`dotnet tool run` + `ShellExecute`), Ctrl+C test.** Not run, because it needs a local pin change. Registry receipt `374fb29e` shows that this lane launched and that Revit outlived the CLI exit. The job topology above predicts that Ctrl+C kills it.
- **UNPROVEN: the limit flags of the `dotnet tool run` reaper job.** They were not read, because the inspector had a length bug at that time. The failure itself is proven four times.
- The Windows rule for breakaway in nested jobs is taken from observed behavior, not from documentation.
- **Owed (Host):** `instances.start` reports `succeeded` when the SDK returns a `failed-receipt` without diagnostics. This is fixed only when 474d8df ships.

## Side effects of this run

- `apps/host/src/dev.ts` LastWriteTime was touched twice. The content did not change.
- The first OLD attempt had a corrupted `PE_REVIT_CMD`, because Herdr stripped the quotes. It left Host action `659270b1` in state `unknown`, and nothing was dispatched to the SDK.
- The staged Instances start was changed during the tests and restored at revision 21.
- w3:p1 is back on plain `vp run dev` (Host 34608).
