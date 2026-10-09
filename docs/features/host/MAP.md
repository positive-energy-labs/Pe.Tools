# Machine control plane, build frontier

Live-effort map for the 2026-10-09 host ledger Decided line "MACHINE CONTROL PLANE". Deleted when wave 6 lands. Rulings are in the ledger; this file holds only what is still moving. Plan of record: `.artifacts/runs/muse-ops-ux-20261008/BUILD-PLAN.md` (gitignored; the wave table below is its durable half). Toiles of record: `.artifacts/runs/muse-ops-ux-20261008/toiles-r2-opus/` (tray-nested, open-drawer).

## Waves

| Wave | Delivers | Proof lane | State |
|---|---|---|---|
| 0 | Observed pid adoption: the web sends an icon-started Revit's pid and the host dispatches `--pid`, adopting through SDK `session start --pid` before a mutation; the test pinning the pre-receipt law is replaced by one that reads `op result` for a lost supervisor op | deterministic, compile | merged ee1ca8ed 2026-10-09; PROVEN[deterministic] |
| 1 | SDK ladder is the one resolver: `ts/apps/host/src/sdk-session.ts` adapter; delete `bridge.ts` target grammar and `inferCustody`, the `session:` selector brand in `agent-contracts`, `pe_do` target words, the web custody-only refusal; delete the five zero-consumer routes `/sessions`, `/sessions/mint`, `/doctor`, `/docs`, `/docs/recents` | deterministic, then a task-owned controlled dev session plus a task-owned observed process | merged 5470e8c3 2026-10-09; PROVEN[deterministic 265 tests]; controlled dev session proof owed to wave 6 |
| 2 | `Machine` owner `ts/apps/host/src/machine.ts` over the existing SSE readings; typed update reader with request-id persisted before apply and successor recovery through `op result`; `waitForVersionChange` deleted | deterministic, compile | merged 9cf56bcb 2026-10-09; PROVEN[deterministic 35 tests] |
| 3 | Installed host pins 5180 and refuses with the occupant named; `dotnet/Pe.Host.Tray` (NotifyIcon plus WebView2 window on `/machine?shell=tray`, native menu fallback) staged into the host payload; spawn after claim, dispose on exit | compile, artifact, then installed | tray shim merged 817d183b, pinned port merged 3a4fa77f, 2026-10-09; PROVEN[compile, deterministic, artifact 163 MB exe]; installed owed to wave 6 |
| 4 | `request-identity.ts` before every handler and the WS upgrade; `share.ts` owning one Serve mapping; `/mcp` Streamable HTTP behind it; invocation-local tool context; `dev.ts --share` deleted | deterministic ingress matrix, then installed tailnet from a second device | merged d84120dc 2026-10-09; PROVEN[deterministic 13 host + 84 mcps]; second-device tailnet owed to wave 6 |
| 5 | `/open` replaces `/instances`; machine drawer from the version chip; providers rendered in the drawer; tray route `/machine?shell=tray`; route tree regenerated | deterministic, controlled dev session, installed | merged 324a6d1f 2026-10-09; PROVEN[deterministic open 7, machine 9; seed screenshots]; controlled dev session and installed owed to wave 6 |
| 6 | Real old-to-new upgrade on an isolated installed machine with a saved and a modified document; ledgers; ADR 0014 narrow supersession; delete this map | installed | last |

## Stabilized after the lane (2026-10-09)

- `sdk-session.ts` memoizes the SDK resolution per live process incarnation (pid + processStartUtc); re-resolves when the incarnation changes or the process exits. f6eba964.
- The floater over the tray shell and the Open table was TanStack Devtools (dev-only), not a Pea launcher; it is off in `shell=tray` and on `/open`. f6eba964.
- PWA floor (ruled yes by kaitpw): manifest on the pinned origin with `id: "/"`, `start_url` `/open`, standalone, `launch_handler` focus-existing, one Open shortcut; App Badging from the version chip; "Install as app" in the drawer host group when Edge offers a prompt. No service worker; `--open` keeps `--app=url`; Window Controls Overlay is later protoui. The `id` is what keeps a later WCO or start_url change from orphaning installs. af4180c5. Installing from the product profile `<productRoot>/edge-app` is owed to wave 6a.
- The web prerender (and the Node 25 dev server) crashed on `EventSource is not defined` because the version chip subscribes to the machine reading on every page and the stream opened during SSR; `PeReadings.open` now returns without a window. The `--experimental-eventsource` flag is no longer needed anywhere. Found by `pack installer`.
- `Pe.Host.Tray.exe` 163 MB -> 72 MB with `EnableCompressionInSingleFile` only (Astra, publish-measured). Framework-dependent (1.3 MB) ruled out: supported years are 2023-2026, 2023/2024 are .NET Framework, Revit 2025.5/2026.5 move to .NET 10, and the SDK product manifest has no prerequisite slot. Trimming WinForms+WebView2 is unsupported. 10c2121e.

## Owed

- Wave 6a on desktop-p9vi8iv (tailnet, no Revit; needs sshd enabled by kaitpw): MSI install, login icon, one incumbent on 5180, WebView2 tray against the live host, Explorer restart, old-to-new upgrade with no documents, PWA install from the product profile, kp-pc as the second tailnet device through the web and `/mcp` once p9iv shares. Windows Sandbox is the fallback.
- Wave 6b on kp-pc, kaitpw driving: the upgrade with a saved and a modified document through the product's own consent flow; the felt tray. Then ledgers, ADR 0014 narrow supersession, delete this map.
- `/machine?shell=tray` Open window and Quit host need the service token only the tray holds (`POST /admin/window`); the drawer draws them refused with that reason.
- Web test-bar guard counts the new Open and machine tests as scaffold (28 against a ceiling of 16, same count as before).
- Tray startup cost with compression is unmeasured (81 ms more on a warm refusal exit); measure in 6a.

## Found by the toiles

- Wave 5 added a token-gated `POST /admin/window` (the tray footer's Open window had no route); only the tray carries the token, so the web drawer draws Open window and Quit host refused with that reason.

- `ObservedActive` has no documents: the Machine owner joins `doc list --pid` for observed rows and declares persistence unknown.
- `UpdateBlocker` has no pid: the pid chip is the `UpdatePlan.revits[]` row holding the same blocker.
- `open --start` has no posture or quarantine flags: the launcher prints and runs two commands for a non-default shape.
- Two openId namespaces (SDK vs host bridge) stay real through wave 1; SDK close takes SDK ids, product scripts keep `DocumentRef`; wrong-source ids are refused, never repaired by title.
- `/instances` gaps that move into `/open`: a controlled session read `observed` for seconds after load (say "census pending"); Restart refused with `session.hr-would-drop` offers no next step (show the document list and a deliberate drop); SSR ships no session strings so a text-level drive cannot verify the page.

## Owed upstream (SDK session ledger, not here)

- `UpdateRevit.custody` is a bare string; the custody union belongs on it.
- Optional pid on plan-level blockers.
- `open --start --posture --quarantine`.

## Playable later (ruled "you choose for now")

- Where update surfaces outside the drawer: the version chip bottom-left was chosen; a lit dot was the alternative.
- Dev-facing stop and discard UX once the lay path ships.
- A remote role chooser (read-only, per-login allowlist).
- Tray flat variant if nested proves a click too many on small fleets.
