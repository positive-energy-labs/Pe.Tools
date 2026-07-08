# Installed E2E — Codex driver handoff (2026-07-08, beta.17 / 0.6.9 spike)

Mission: prove the **beta.17 SDK + Pe.Tools 0.6.9** spike on this machine, through the CLI/GH-release
channel, with GUI verification via computer use. This spike fixed the three defects the owner cared
about most — **firewall prompt, installed `/pe/*` 503, and dev-shim DX** — plus the SDK lane/verify/
service/PATH primitives behind them. Your job is to prove those fixes hold end-to-end on a real
Revit + real user surface, and to run down anything that surprises you. You are the driver; the
owner (kaitp) is available for anything marked OWNER.

Full context lives in [PLAN.md](PLAN.md), [SDK-LEDGER.md](SDK-LEDGER.md), and the review of record
[DESIGN-REVIEW-2026-07-08.md](DESIGN-REVIEW-2026-07-08.md). Read those if a claim here surprises you.

## What changed THIS spike (hold this in your head)

The SDK went beta.16 → **beta.17** and Pe.Tools consumed it. Fixes that change how you drive:

- **`/pe/*` works installed now.** The installed Mastra runtime used to 503 ("Agent runtime
  unavailable"). Root cause was SEA-bundling (drizzle-orm circular imports, onnxruntime-node native,
  get-stream, mastracode package-root) — all fixed in `apps/host/vite.config.ts` (the
  `pe:sea-require-shim` plugin) + `stage-native-sidecars.mjs`. Proof it works: `GET /host/status`
  now reports `agentRuntime: {available: true, error: null}`; `GET /pe/info` → 200. **This is the
  headline fix — if `/pe/*` is dead installed, the whole spike failed.**
- **Observability.** If the agent runtime ever fails to init, the error is written to
  `state/host/mastra-init.err.log` AND surfaced on `/host/status.agentRuntime.error`. You are never
  blind again — read that field first if `/pe/*` misbehaves. Host contract version is now **37**.
- **Lane is explicit.** The old `PE_LANE` env guard in `TsHostLauncher` is gone; the loader pins the
  deployment lane to `installed`. No ambient lane tricks. `state/service/host.json` lane must read
  `installed` for a Revit-spawned host.
- **`pe-revit install verify` is destination-only.** Plain `verify` (no `--release`, no checkout)
  now passes on a user machine — it reads the installed manifest copy + receipt and checks disk.
  This is the verb to use everywhere now; you do NOT need `--release latest` to verify.
- **Same-version re-apply is a no-op** (`already-current`), not a failure. `--force` re-copies
  (stops the service first). The old "NEVER re-apply the same version" rule is retired.
- **PATH + dev shims are SDK-owned.** `pe-revit path ensure|remove|status` (safe User-PATH
  registration of the shims dir — kind-preserving, no clobber) and `pe-revit dev link|unlink|status`
  (routes pea/peco/pe-dev shims to a checkout). Pe.Tools' old `pe-dev bootstrap-path` and
  `pe-dev pea link-dev` (which hand-rewrote PATH and kept a second launcher) are DELETED.
- **`pea` resolves to the install now.** The manifest declares a `VersionedApp pea` payload and the
  pea PathShim targets `versionedApp:pea`. Bare `pea` on a user machine launches the installed pea
  CLI (MastraTUI); `pea --installed` forces installed even when dev-linked; a `pea.dev.txt` marker
  (written by `pe-revit dev link`) routes to the checkout. `peco`/`pe-dev` stay dev-only (targetless).
- **Firewall:** the host binds `127.0.0.1` only (loopback never prompts Windows Firewall). The
  service contract now mandates loopback. A fresh 0.6.9 install must produce NO firewall prompt.

Unchanged and still correct: **one process** (`Pe.Host.exe`) serves the bridge WS, `POST /call`,
`/pe/*`, and the web SPA on one port. Discovery is file-based — the host writes
`%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\service\host.json` (`{pid,port,version,lane,token}`)
on bind; **the actual port wins, never hardcode 5180**. The Revit addin is **staged-until-restart**:
reinstalling while Revit is open stages `versions/<new>/` and advances `current.txt`, but the running
Revit keeps the old addin until restart. That is correct, not a bug.

## Preconditions (in order)

1. OWNER: confirm the working tree is committed. You pack from a clean committed tree.
2. Versions: installed is currently **0.6.8** (contract v36 — the pre-spike host). The manifest
   `version` field (`product.payloads.json`; there is no `pe-version.json` anymore) is the release
   authority. This E2E ships **0.6.9** and proves the web-update **0.6.8 → 0.6.9**.
3. Shut down the dev world so lanes don't fight: close any dev Revit session, then stop the dev host
   — read the token from `state/service/host.json`, `POST http://127.0.0.1:<port>/admin/shutdown`
   with header `X-Pe-Service-Token: <token>` (fallback: taskkill the pid). Confirm the port is free
   and the service file is gone.
4. Use the **beta.17** CLI: `dotnet tool restore` in the Pe.Tools checkout (the pin is beta.17;
   it restores from `eng/sdk-feed`), then drive with `dotnet pe-revit ...` (or the installed shim
   once install #1 lands). `pe-revit doctor` should be clean — in particular `companion-pins` and
   `ts-client-drift` are new checks and must pass.
5. **Machine cleanup from the old dev flow** (T4): the retired `pe-dev bootstrap-path` / `link-dev`
   may have left `bin\pea\*.cmd` launchers and `bin\pea` / Pe.Dev.Cli entries on your User PATH.
   Before testing the new dev DX, capture `reg query HKCU\Environment /v Path`, then remove those
   stale entries and delete `%LOCALAPPDATA%\Positive Energy\Pe.Tools\bin\pea\*.cmd` (the SDK never
   writes those). Report what you cleaned.

## Build + release recipe (0.6.9)

1. Bump `version` to `0.6.9` in `product.payloads.json` (repo root) — the ONLY file a release bump touches.
2. TS payloads: `pnpm --filter @pe/host build:payload` AND the pea payload build (T5 — check
   `apps/pea/package.json` for the exact script name, `build:installed` or `build:payload`; it chains
   `vp pack` + `stage-native-sidecars.mjs`). Gates: `apps/host/dist-installed/Pe.Host.exe` +
   `apps/host/dist-installed/web/client/index.html` exist; `apps/pea/dist-installed/pea.exe` exists.
3. C# + installer: `dotnet run --project build -- pack installer --configuration Release.R25` (read
   `docs/BUILD.md` + `build/Program.cs` for the exact entry). The installer module stages Pe.App +
   host + **pea** per the manifest and emits artifacts under `.artifacts/`. Gate: the staged host
   payload contains `web/client/index.html`; the pea payload contains `pea.exe`.
4. Release: `gh release create v0.6.9` on `positive-energy-labs/Pe.Tools` with the install.zip +
   MSI artifacts the installer module produced (inspect `.artifacts/`).
5. Install: `dotnet pe-revit install apply --release latest`, then `pe-revit install verify`
   (plain — no `--release` needed now; it's dest-only).

## Test matrix (each check: evidence = screenshot / curl / reg output; report PASS/FAIL + timing)

**A. Fresh install (Revit closed), v0.6.9 — FIREWALL GATE**
- `pe-revit install apply --release latest` succeeds; **plain** `pe-revit install verify` is clean
  (this exercises the dest-only fix — it must pass with no checkout dependency).
- Layout under `%LOCALAPPDATA%\Positive Energy\Pe.Tools\`: `bin/host/versions/0.6.9/Pe.Host.exe`
  with `web/client/index.html` beside it; `bin/pea/versions/0.6.9/…/pea.exe` (T5) with `current.txt`
  = 0.6.9; addin versions dir + loader shim for Revit 2025; `shims/pea.cmd` etc.
- **FIREWALL: watch for a Windows Firewall prompt at first host spawn (check B). There must be NONE.**
  If one appears, capture the exact exe path in the dialog and STOP — that means something bound
  non-loopback; it's a spike-blocking regression.

**B. Revit boot + host spawn + `/pe/*` LIVE (the CRITICAL gate)**
- Start Revit 2025 (computer use). Pe Tools ribbon present.
- Within ~15s of the addin initializing (SDK default startup budget is 15s now, not the old 8s):
  `state/service/host.json` exists, lane `installed`, version `0.6.9`;
  `GET http://127.0.0.1:<port>/host/status` → 200, `lane: "installed"`, `hostContractVersion: 37`,
  `executablePath` under `versions\0.6.9\`, and **`agentRuntime: {available: true, error: null}`**.
- `GET /pe/info` → 200. Open the web UI (check D) and send a chat message that reaches the agent —
  a real reply proves `/pe/*` end-to-end. **If `agentRuntime.available` is false, read
  `agentRuntime.error` AND `state/host/mastra-init.err.log` and report verbatim — that's the exact
  observability channel this spike added; do not guess.**
- `bridgeIsConnected: true` once a document is open.

**C. `pea` from PATH → installed MastraTUI (D5 gate)**
- In a NEW terminal (fresh PATH after `pe-revit path ensure`), run `pea` with NO dev link present
  (confirm `pe-revit dev status` shows pea lane = installed, no `pea.dev.txt`). It must launch the
  **installed** pea CLI MastraTUI from `versions\0.6.9\…\pea.exe` — NOT error, NOT the dev pnpm path.
  This is the D5 fix and the T5 payload working. Capture the TUI on screen.
- `pea --installed` forces installed. `peco` / `pe-dev` with no checkout: targetless dev-only, so a
  clean "no linked checkout" message (not a crash) — that's correct.

**D. Web**
- Ribbon → open Pe Tools Web → default browser opens `http://127.0.0.1:<port>` → SPA loads; chat
  renders and a trivial message gets a reply (this is also the check B `/pe/*` proof); `/ops` renders
  host data on the same origin. The update toast (after a reinstall) should say the honest
  staged-until-restart copy, NOT "sessions swap live" (T6 fix).

**E. Dev-shim DX round-trip (the owner wants this dead-simple — prove it is)**
- From the Pe.Tools checkout: `pe-revit path ensure` (registers `<appBase>\shims` on User PATH,
  once). Capture `reg query HKCU\Environment /v Path` before/after — the ONLY change is the appended
  shims dir; every other entry byte-identical; the value KIND is preserved (if it was REG_EXPAND_SZ
  with `%VARS%`, it stays REG_EXPAND_SZ, vars unexpanded). This is the owner's top pain — verify it
  hard.
- `pe-revit dev link` → `pe-revit dev status` shows pea/peco/pe-dev lane = dev, linked to this
  checkout. In a fresh shell, `pea` now runs the source (dev) path; `pea --installed` still runs the
  installed exe. `pe-revit dev unlink` → status back to installed.

**F. LIVE reinstall 0.6.8 → 0.6.9 (the web-update headline), Revit OPEN + host RUNNING**
- With the pre-spike 0.6.8 installed and its Revit open, drive the web "Update" button (or
  `pe-revit install apply --release latest`) to go to 0.6.9 while everything runs.
- Success criteria, all:
  - Apply completes, no locked-file errors, **NO PATH mangling** (`reg query HKCU\Environment /v Path`
    byte-identical before/after).
  - Old host shut down via the service token (old pid gone, not orphaned); `versions/0.6.9/` +
    `current.txt` advanced for host AND Pe.App AND pea.
  - Host respawn: next EnsureRunning (ribbon web button, or addin) brings up the NEW host;
    `/host/status` `executablePath` under `versions\0.6.9\`, service version `0.6.9`,
    `agentRuntime.available: true`. Web SPA loads new assets.
  - **Staged-until-restart marker**: the RUNNING Revit still has the OLD (0.6.8) addin loaded —
    `pe-revit live status` (path identity) shows `current.txt` 0.6.9 but loaded 0.6.8. That mismatch
    is SUCCESS.
- Restart Revit → addin loads 0.6.9 (`live status` fresh; palette works; host 0.6.9; `/pe/*` live).
  Loop closed.

**G. Idempotence + hygiene**
- Re-run `pe-revit install apply --release latest` at 0.6.9 (same version) → reports
  `already-current`, touches nothing, exit 0 (S3 fix — the old "never re-apply" trap is gone).
  `--force` re-copies (stops the service first). `pe-revit install verify` clean throughout.
- `install gc` leaves `versions/0.6.8` eligible for cleanup only after restart.

## Sharp edges (do not discover these the hard way)

- **The healthy 0.6.8 host is on this machine (port 5180).** If you run any host/pea build's exe for
  a probe, do NOT let it clobber `state/service/host.json` (a second host instance overwrites it) —
  use an alt port (`PE_TOOLS_HOST_BASE_URL=http://127.0.0.1:<altport>`) and restore the file after,
  or just don't run a second host outside the real install/Revit flow.
- Bridge ops from CLI: 60–90s timeouts max; a hang is a stuck bridge op — read the revit log, never
  retry-loop.
- MSI channel: `pe-revit msi` now lays the real VersionedAddin/VersionedApp layout (ledger S2 prior),
  but VersionedApp `current.txt` pointer-guard parity is still deferred (S-DEF-6). This E2E is the
  CLI/GH-release (install.zip) channel; run MSI only if the owner asks, and treat its pea/host
  pointer behavior as unproven.
- Don't touch SDK versions or repack SDK nupkgs (beta.17 is packed + in `eng/sdk-feed`). Don't run
  `pe-revit live converge` against the owner's dev year unless asked (it kills/starts Revit).
- Logs, read the FIRST failure not the last: `state/host/mastra-init.err.log` (agent init),
  `state/service/host.log` (spawned-host stdout/stderr — new this spike, SDK captures it),
  `addin/loader.log`, and the install receipt, all under the product root. Retry layers mask roots.

## Report format

Per check: PASS/FAIL, evidence, wall-time, surprises. Headline verdicts first: **(1) firewall-free
fresh install? (2) `/pe/*` live installed with `agentRuntime.available: true`? (3) `pea` from PATH →
installed MastraTUI? (4) `pe-revit path ensure` left PATH intact?** Every defect gets a one-line
ledger-entry proposal for `docs/rework/SDK-LEDGER.md` (do not fix out of scope). Finish with: the
three most fragile things you touched, and anything a coworker install (no checkout, no dev tools)
would hit that this machine masked.
