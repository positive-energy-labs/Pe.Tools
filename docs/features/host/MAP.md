# Machine control plane, build frontier

Live-effort map for the 2026-10-09 host ledger Decided line "MACHINE CONTROL PLANE". Deleted when wave 6 lands. Rulings are in the ledger; this file holds only what is still moving. Plan of record: `.artifacts/runs/muse-ops-ux-20261008/BUILD-PLAN.md` (gitignored; the wave table below is its durable half). Toiles of record: `.artifacts/runs/muse-ops-ux-20261008/toiles-r2-opus/` (tray-nested, open-drawer).

## Waves

| Wave | Delivers | Proof lane | State |
|---|---|---|---|
| 0 | Observed pid adoption: the web sends an icon-started Revit's pid and the host dispatches `--pid`, adopting through SDK `session start --pid` before a mutation; the test pinning the pre-receipt law is replaced by one that reads `op result` for a lost supervisor op | deterministic, compile | started 2026-10-09 |
| 1 | SDK ladder is the one resolver: `ts/apps/host/src/sdk-session.ts` adapter; delete `bridge.ts` target grammar and `inferCustody`, the `session:` selector brand in `agent-contracts`, `pe_do` target words, the web custody-only refusal; delete the five zero-consumer routes `/sessions`, `/sessions/mint`, `/doctor`, `/docs`, `/docs/recents` | deterministic, then a task-owned controlled dev session plus a task-owned observed process | after 0 |
| 2 | `Machine` owner `ts/apps/host/src/machine.ts` over the existing SSE readings; typed update reader with request-id persisted before apply and successor recovery through `op result`; `waitForVersionChange` deleted | deterministic, compile | started 2026-10-09 |
| 3 | Installed host pins 5180 and refuses with the occupant named; `dotnet/Pe.Host.Tray` (NotifyIcon plus WebView2 window on `/machine?shell=tray`, native menu fallback) staged into the host payload; spawn after claim, dispose on exit | compile, artifact, then installed | tray source started 2026-10-09; host integration after 2 |
| 4 | `request-identity.ts` before every handler and the WS upgrade; `share.ts` owning one Serve mapping; `/mcp` Streamable HTTP behind it; invocation-local tool context; `dev.ts --share` deleted | deterministic ingress matrix, then installed tailnet from a second device | after 2 |
| 5 | `/open` replaces `/instances`; machine drawer from the version chip; providers rendered in the drawer; tray route `/machine?shell=tray`; route tree regenerated | deterministic, controlled dev session, installed | deterministic and seed screenshots on `mcp/w5-web` 2026-10-09, unmerged; controlled dev session and installed owed |
| 6 | Real old-to-new upgrade on an isolated installed machine with a saved and a modified document; ledgers; ADR 0014 narrow supersession; delete this map | installed | last |

## Owed to the build, found by the toiles

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
