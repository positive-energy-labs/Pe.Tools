# Installed e2e — Codex driver handoff (2026-07-08)

Mission: prove the full **pack → GH release → install → run → LIVE reinstall → Revit restart**
loop on this machine, through the CLI channel, with GUI verification via computer use.
You are the driver; the owner (kaitp) is available for anything marked OWNER.

## What changed (context you must hold)

The backend was squashed: **one process** — `Pe.Host.exe` (Effect TS host) — is spawned by the
Revit addin and serves EVERYTHING on one port: the Revit bridge WS, `POST /call` ops, the Mastra
agent (`/api/agent-controller/*`, `/pe/*`), and the web SPA (static, from `<exeDir>/web/client`).
There is no separate pea backend or web server in the installed product. Discovery is file-based
(A10): the host writes `%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\service\host.json`
(`{pid, port, version, lane, token}`) on bind — the ACTUAL port wins, never hardcode 5180.
The Revit addin is **staged-until-restart**: reinstalling while Revit is open lays down
`versions/<new>/` and advances `current.txt`, but the running Revit keeps the old addin until
Revit restarts. That is correct behavior, not a bug.

## Preconditions (do these first, in order)

1. OWNER: commit the in-flight palette work (`Palette.xaml*`, `AppCore.cs`, `CmdFF*`,
   `CmdScheduleManager.cs` are modified in the tree). You pack from a clean committed tree.
2. Shut down the dev world so lanes don't fight: close the dev Revit session (RRD), then stop
   the dev host — read the token from `state/service/host.json`, `POST http://127.0.0.1:<port>/admin/shutdown`
   with header `X-Pe-Service-Token: <token>` (fallback: taskkill the pid in the file).
   Confirm port 5180 is free and the service file is gone.
3. Versions: manifest (`product.payloads.json`, field `version`) is `0.6.1`. GH releases
   `v0.6.2`/`v0.6.3` are THROWAWAYS from an old experiment. Use **0.6.4** for install #1 and
   **0.6.5** for the reinstall. **NEVER re-apply the same version twice** — same-version
   re-apply over a locked dll is a known open defect (ledger P10), and stale-cache traps hide
   real failures.

## Build + release recipe (per version)

1. Bump `version` in `product.payloads.json` (repo root). That is the ONLY file a release bump touches.
2. TS payload: `pnpm --filter @pe/host build:payload` (run under `source/pe-tools/`).
   Gate: `apps/host/dist-installed/Pe.Host.exe` AND `apps/host/dist-installed/web/client/index.html` exist.
3. C# + installer: read `docs/BUILD.md` and `build/Program.cs` for the pipeline entry
   (`dotnet run --project build/...`); the installer module stages payloads per the manifest and
   emits the release artifacts under `.artifacts/`. Gate: the staged host payload contains
   `web/client/index.html`.
4. Release: `gh release create v<version>` on `positive-energy-labs/Pe.Tools` with the artifacts
   the installer module produced (inspect `.artifacts/` — the install.zip lane).
5. Install: `pe-revit install apply --release latest` (the dotnet tool; `pe-revit install verify`
   afterwards is your structural check — use it after every apply).

## Test matrix (each check: evidence = screenshot or curl output; report PASS/FAIL + timing)

**A. Fresh install (Revit closed), v0.6.4**
- `pe-revit install apply` succeeds; `pe-revit install verify` clean.
- Layout: `%LOCALAPPDATA%\Positive Energy\Pe.Tools\` has `bin/host/versions/0.6.4/Pe.Host.exe`,
  `.../web/client/index.html` beside it, `current.txt` = 0.6.4, addin versions dir + loader shim
  registered for Revit 2025.

**B. Revit boot + host spawn**
- Start Revit 2025 (computer use). Pe Tools ribbon present.
- Within ~15s of the addin initializing: `state/service/host.json` exists (lane `installed`,
  version `0.6.4`); `GET http://127.0.0.1:<port>/host/status` → 200, `lane: "installed"`,
  `executablePath` under `versions\0.6.4\`; `bridgeIsConnected: true` once a document is open.
- **Watch the spawn timing**: the C# EnsureRunning timeout is 8s (legacy value) and the host now
  boots the Mastra tenant. If spawn flaps or double-spawns, capture logs — that timeout is a
  flagged risk, and your timing numbers decide whether we raise it.

**C. Palette**
- Open the Pe Tools palette (ribbon button; OWNER can supply the hotkey), execute one benign
  palette item (a "go/do/switch" navigation item, not a model-mutating command). Success = the
  action executes with no error dialog. This is also the first live test of the reworked palette —
  report any weirdness verbatim, don't rationalize it.
- GUI fallback: ops can be fired without pixel-hunting via
  `POST /call {"key":"revit.apply.command.execute", ...}` — check `GET /ops` for the exact
  schema. Prefer real clicks for the palette check itself (that's the point); use the op route
  for setup/teardown conveniences.

**D. Web**
- Ribbon → "Open Pe Tools Web" → default browser opens `http://127.0.0.1:<port>` → the SPA loads
  (this exercises the prerendered index.html shell — new, never live-tested). Chat renders; send
  a trivial message and get a reply; visit `/ops` (host data via same origin — proves the SPA and
  API share the port). NOTE: the pdf-audit lab routes are dev-only (server functions) — do not
  test them installed.

**E. pea TUI**
- Run `pea` in a fresh terminal. On THIS machine the shim resolves through the dev lane (repo
  checkout present), so the TUI should start. **Known decision point**: the installed product no
  longer ships a pea payload (installed UX is web-only per owner decision) — on a coworker
  machine with no checkout, `pea` has no target. If the owner wants installed TUI back, that's a
  small manifest+build change — report the observed behavior and flag, don't fix.

**F. LIVE reinstall (the headline check), v0.6.5 — with Revit OPEN and host RUNNING**
- Bump → build → release → `pe-revit install apply --release latest` while everything runs.
- Success criteria, all of them:
  - Apply completes with no locked-file errors and NO PATH mangling (user PATH must be
    byte-identical before/after — capture `reg query HKCU\Environment /v Path` both times).
  - The old host was shut down via the service token (not orphaned — old pid gone), and
    `versions/0.6.5/` + `current.txt` advanced for host AND Pe.App.
  - Host respawn: click the ribbon web button (or let the addin's next EnsureRunning fire) →
    NEW host comes up; `/host/status` `executablePath` under `versions\0.6.5\`; service file
    version `0.6.5`. The web SPA still loads (new assets).
  - **Revit marker (staged-until-restart)**: the RUNNING Revit still has the OLD addin loaded —
    verify via `pe-revit live status` (path-identity: loaded path vs deployed) or the addin's
    version surface. `current.txt` says 0.6.5, loaded says 0.6.4. That mismatch is SUCCESS.
- Restart Revit → addin now loads 0.6.5 (`live status` fresh; palette still works; host still
  0.6.5). That closes the loop.

**G. Idempotence + hygiene**
- `pe-revit install verify` clean after every step; `install gc` leaves `versions/0.6.4` eligible
  for cleanup only after restart (the host also forks gc on bridge disconnects).

## Sharp edges (do not discover these the hard way)

- Bridge ops from CLI: 60-90s timeouts max; a hang means a stuck bridge op — read the revit log,
  never retry-loop.
- Don't run the MSI channel this round — ledger A8 (VersionedApp current.txt File component
  hazard) is open; this e2e is the CLI/GH-release channel.
- Don't touch SDK versions or repack SDK nupkgs; don't run `pe-revit live converge` against the
  owner's dev year unless asked (it kills/starts Revit).
- Logs: host stdout is captured by the addin spawn; Revit-side `revit.log` and the install
  receipt live under the product root (`%LOCALAPPDATA%\Positive Energy\Pe.Tools`). Read the FIRST
  failure in a log, not the last — retry layers mask root causes.

## Report format

Per check: PASS/FAIL, evidence, wall-time, surprises. Every defect found gets a one-line entry
proposal for `docs/rework/SDK-LEDGER.md` (do not fix out of scope). Finish with: (1) the three
most fragile things you touched, (2) anything a coworker install (no repo checkout, no dev
tools) would hit that this machine masked.
