# Pe.Tools SDK Hot-Swap Handoff

This is a review handoff for the throwaway Pe.Tools installed-release A/B hot-swap experiment.

## Intent

Test the SDK installed hot-swap primitive as a real Pe.Tools user would encounter it:

- Publish/install release A from GitHub.
- Start normal Revit, not RRD.
- Use a real open model, not a sample: `MEP_Architect_Project Name_R25`.
- Verify real loaded Revit assemblies, UI/task text, logs, host ops, PATH shims, Pea backend, and web frontend.
- Publish/install release B through GitHub while the same Revit process is still running with A loaded.
- Record installer/runtime defects as product findings. Do not manually fix install-state defects unless clearly outside installer responsibility.

## Success Criteria

Release A must install from GitHub and prove:

- Exactly one winning Revit addin registration for Revit 2025.
- Installed versioned payloads exist under `%LOCALAPPDATA%\Positive Energy\Pe.Tools`.
- Receipts and `current.txt` pointers match A.
- Revit loads `Pe.App` from installed payload, not build/dev output.
- The active real document is visible through host status and host ops.
- Revit C#, TS host, `pea`, web backend, and web frontend all show A smoke markers.
- `pea` and `pe-revit` resolve through installed product shims.

Release B must install while the A Revit process is still running and prove:

- Locked A files do not block install.
- B payloads are staged before pointers advance.
- Pointers advance to B.
- Old payloads are retained/pruned according to retention behavior.
- Revit observes B where live swap is expected.
- TS host, web backend, frontend, and PATH shims are verified after B.
- Any required restart/reload behavior is explicit and actionable.

## Chronology

1. Re-scoped the test from SDK/RRD to full Pe.Tools user flow:
   - Normal Revit 2025.
   - Pe.Tools GitHub releases only.
   - Host update endpoint `/host/update` as the B install trigger.
   - Pe.Tools MCPs for status, scripting, document/session context, and logs.
   - User-opened cloud model `MEP_Architect_Project Name_R25`; do not reopen the old sample.

2. Patched SDK installer issues and bumped Pe.Tools to the local SDK feed:
   - SDK version moved through beta builds up to `0.1.0-beta.14`.
   - Added `.install.zip` release consumption so installs apply all payload types, not only the legacy bundle/addin path.
   - Fixed release package relative `source` resolution.
   - Added/verified `Cli` and `PathShim` behavior for installed commands.
   - Made product shim PATH entry prepend and prune stale old Pe.Tools bin entries.
   - Fixed legacy `addins:*/Name` cleanup to handle both folders and `.addin` files.
   - Fixed shim default behavior: try dev link first when present, but fall back to installed on dev failure; `--dev` still hard-forces dev.
   - Copied SDK beta.14 nupkgs into `eng/sdk-feed` and pinned Pe.Tools `global.json` / `.config/dotnet-tools.json` to beta.14.

3. Patched Pe.Tools packaging/install shape:
   - Removed stale `Build.Version=0.5.2` override from `build/appsettings.json`.
   - Updated `product.payloads.json` to use `positive-energy-labs/Pe.Tools`, `VersionedAddin` `Pe.App`, versioned host app, `pe-revit` CLI, versioned `pea`, and installed `pea` `PathShim`.
   - Removed dangerous legacy `app:bin/pea`; PATH cleanup belongs to SDK install.
   - Made installer build emit `.install.zip` with all payloads/legacy/CLI/shims.
   - Made installed Pea payload include `pea.exe`, native sidecars, and built web static client.
   - Made `pea web` resolve installed static client beside the installed exe.
   - Made installed host runtime resolve versioned `bin\host\current.txt` and `versions\<version>\Pe.Host.exe`.
   - Added a small deployment-runtime test for versioned installed host resolution.
   - Added pnpm override `@smithy/core: 3.26.0` to fix installed `pea.exe web` bundle failure.

4. Created release A `0.6.2` smoke markers:
   - `Pe.App` startup log: `SDK-HOTSWAP-A`.
   - Example task name: `SDK Hot Swap Smoke A`.
   - Example task description/output: `SDK-HOTSWAP-A`.
   - TS host `/host/status`: `smokeMarker: SDK-HOTSWAP-A`.
   - Pea workbench metadata and `/pe/info` / `/pe/inspect`: `SDK-HOTSWAP-A`.
   - Web frontend route text: `Internal tools - SDK-HOTSWAP-A`.

5. Built and published A:
   - Ran `dotnet run --project build\Build.csproj -c Release -- pack desktop installer --configuration Release.R25`.
   - Uploaded/clobbered GitHub release `v0.6.2` assets, including `.install.zip`, MSI, bundle, Pea zip/json, and SDK payload manifest.
   - Installed A from GitHub with `dotnet tool run pe-revit -- install apply --release latest --repo positive-energy-labs/Pe.Tools --year 2025 --json`.

6. Verified A:
   - Normal Revit PID was `23560`; installed host PID was `44668`.
   - Active model was `MEP_Architect_Project Name_R25` from Autodesk Docs.
   - `mcp__pea.pe_status` showed installed host lane and `Pe.App 0.6.2` loaded from `%LOCALAPPDATA%\Positive Energy\Pe.Tools\addin\versions\0.6.2\2025\Pe.App.dll`.
   - Revit script confirmed task registry contained `SDK Hot Swap Smoke A`.
   - `/host/status` showed `smokeMarker: SDK-HOTSWAP-A`.
   - Fresh registry PATH resolved `pea.cmd` and `pe-revit.cmd` from product shims first.
   - `pea --installed host status` reached the installed host and active document.
   - Installed `pea --installed web` served `/pe/info`, `/pe/inspect`, and frontend JS with `SDK-HOTSWAP-A`.

7. Created release B `0.6.3` smoke markers:
   - Bumped `pe-version.json` to `0.6.3`.
   - Changed C#, TS host, Pea runtime, runtime web API, and web frontend markers from A to B.
   - Built with the same pack command.
   - Created GitHub release `v0.6.3` as latest stable with the full install asset set.

8. Installed B through the running A host:
   - Called `POST http://127.0.0.1:5180/host/update` while Revit PID `23560` stayed open.
   - The HTTP request hung for about 15 minutes and was interrupted.
   - Install had already completed: addin, host, and pea `current.txt` pointers all advanced to `0.6.3`; receipt `releaseVersion` was `0.6.3`; B version dirs existed.

9. Verified B and failures:
   - Revit log showed A shutdown followed by `SDK-HOTSWAP-B Pe.App startup marker`, so Revit C# did live-swap to B.
   - `mcp__pea.pe_status` later showed both `Pe.App 0.6.2` and `Pe.App 0.6.3` loaded in the same Revit process.
   - Running host stayed old `0.6.2` on port `5180`, so B Revit refused to connect:
     `Host port is occupied by installed host ... 0.6.2 ... but Pe.App resolved Installed host ... 0.6.3`.
   - After recording that defect, manually stopped only stale host PID `44668`.
   - Revit retry loop then started installed host `0.6.3` PID `108800` and bridge reconnected.
   - `/host/status` then showed installed host `0.6.3` and `smokeMarker: SDK-HOTSWAP-B`.
   - Installed `pea --installed web` served `/pe/info`, `/pe/inspect`, and frontend JS with `SDK-HOTSWAP-B`.
   - Post-swap scripting broke: even `WriteLine("simple B scripting control")` rejected with `No non-abstract PeScriptContainer type was found`. Diagnostics show scripts compile against B disk references while A assemblies remain loaded, so this looks like assembly identity/reference resolution fallout.

## Main Findings

- SDK install staging/pointer swap works for versioned payloads: B installed without locked-file failure while Revit held A.
- Revit C# hot-swap occurred, but both A and B `Pe.App` assemblies remain loaded.
- Host self-update is not handled: old TS host keeps port `5180`, blocks B bridge connection, and makes `/host/update` hang after install success.
- Scripting is broken after side-by-side A/B load because script container type discovery no longer matches the runtime `PeScriptContainer` identity.
- Installed Pea backend/frontend and PATH shims work after B once current pointers are B.

## Defects To Review

- `POST /host/update` should return after successful install, or explicitly report staged install plus required host restart.
- Host update should stop/restart TS host when installed host payload advances, or the SDK primitive should provide that as a first-class installed app restart hook.
- Revit scripting reference resolution must handle side-by-side loaded `Pe.App` versions after hot-swap.
- Runtime should avoid or explicitly manage duplicate loaded product assemblies if scripting/task/UI surfaces depend on type identity.
- Host singleton takeover/logging can crash because `host.log.txt` is opened by the existing process.
- `pea web --help` still describes separate static/API ports, but installed web currently serves as a single-port app.
- `pe-revit install --release` help text is stale and still sounds bundle/addin-only.
- A stale HelloAddin addin previously caused `Assembly with same name is already loaded`; installer/SDK cleanup may need a better story for cross-product stale SDK loader registrations.

## Current Dirty Worktree Intent

Most modified files are intentional experiment changes, not cleanup:

- SDK beta.14 feed and pins.
- Pe.Tools install/package fixes.
- A/B smoke markers now left at B (`0.6.3` / `SDK-HOTSWAP-B`).
- Throwaway releases `v0.6.2` and `v0.6.3` exist on GitHub and should be manually deleted after review.

