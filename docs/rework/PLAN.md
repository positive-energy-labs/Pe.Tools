# Prod-Shape Rework Plan — Pe.Tools + Pe.Revit.Sdk

2026-07-07. Owner intent: **purge, simplify, effectify**. Target: production shape for both repos; SDK publishes to NuGet after a release or two proves it. Squash-first — the release slips if it must.

Decisions locked (do not relitigate):
- Host absorbs pea: `Pe.Host.exe` stays the Revit-spawned service (Effect v4), gains agent runtime + web serving. Custom pea TUI is deprioritized/deletable; installed UX is web-only (one ribbon button).
- Mastra STAYS as the agent framework. "Purge" = delete Pe-owned glue superseded by upstream (precedent: 2b96990). Bump @mastra/* 1.48-alpha → 1.50.x and mastracode 0.27-alpha → latest, then delete what the bump obsoletes.
- e2e types: Mastra surfaces speak `@mastra/client-js` (native). Effect RPC/HttpApi typed contracts go to the **Pe-owned surfaces** (bridge ops, host status/update, Revit-data routes) — currently untyped `POST /call` + `/pe-host` proxy.
- Effect v4-beta everywhere in the service (host already on 4.0.0-beta.92; bump to current beta).
- Live-swap of the WPF addin: **demoted to staged-until-Revit-restart** (dotnet/wpf#1700 + ILRepack short-name collapse; unfixable-in-practice). Delete the loader swap machinery. The TS service still live-updates itself (stage → respond → self-restart → addin retry-loop reconnects).
- Install channels: BOTH MSI and `pe-revit install --release`. MSI must produce the versioned layout (fix in SDK, likely MSI-as-bootstrapper).
- Config SoT target: `product.payloads.json` (version + identity + payloads + legacy) + `global.json` (single SDK pin). Release bump touches ≤1 file.

## Delegation policy

- **Claude Fable (me):** orchestration, creative direction, main-repo implementation, shell testing, the SDK ledger, all git operations.
- **Opus subagents:** bounded creative/code work — design passes, module rewrites, doc harvesting. Fast and creative; give them the grounding docs.
- **codex gpt-5.5:** compile-smashing, iterative convergence to a stated objective, long linkage chases, computer-use for e2e GUI testing. No taste — always hand it a pattern + objective, never an open design question.

## Grounding protocol (every agent brief includes this)

1. `docs/rework/EFFECT-V4-PATTERNS.md` — condoned Effect v4 patterns harvested from `apps/host` + `repos/.explore/effect-smol` (beta.94). **Agents have Effect v3 internalized; v4 by reflex is wrong.** The doc carries a v3→v4 gotcha table; when unsure of an API, grep effect-smol source for the real signature — never write from memory.
2. `docs/rework/MASTRA-DELTA.md` — pinned→latest diff for @mastra/* AND mastracode, per Pe touchpoint, with the glue-deletion ledger (what upstream now covers → delete ours). `packages/runtime/MASTRA_UPSTREAM_CANDIDATES.md` is the standing ledger; keep it current.
3. `docs/rework/SDK-LEDGER.md` — every SDK defect/enhancement with status. Any agent that finds an SDK issue adds a line; phase exits require a ledger review. Nothing falls through the cracks — we are prepping the SDK for public release.
4. Use the SDK's own tooling first: `pe-revit guide`, `deps sources|collisions|why`, `code find|refs|unused`, `doctor`, `install plan|verify`, `live status|converge`, `test attached|fresh`, `release plan`. Do not reinvent what a verb already does.

## Phases

### Phase 0 — Ground truth + worktree stabilization
- Generate the three grounding docs (two Opus agents + me for the ledger).
- Commit Pe.Revit.Sdk at its beta.14 state (shipped nupkgs currently correspond to no commit).
- Revert all SDK-HOTSWAP smoke markers (both repos, incl. `smokeMarker` in `@pe/runtime` PeWebInfo), restore HelloAddin sample, gitignore `eng/sdk-feed` nupkgs, resolve/document the `@smithy/core` override, delete throwaway GH releases v0.6.2/v0.6.3, checkpoint-commit Pe.Tools experiment keepers.
- Exit: clean committed worktrees; grounding docs exist.

### Phase 1 — SDK hardening (release-prep)
- Delete `EnsureUserPathStartsWith` (MSI owns PATH). Rewrite shim script: `%*` arg handling, fallback only when dev launcher unlaunchable (never on child exit code). Fix `stage:` resolution for Install packages. Release temp-dir cleanup, stale help text.
- MSI × VersionedAddin: design pass (bootstrapper vs real transport), then implement. MSI must yield the same installed layout as `.install.zip`.
- **Swap demotion:** delete LoaderApplication watcher/SwapHandler/debounce, PayloadHost side-by-side probing, `IsFirstLoad` from the payload contract. Loader reads `current.txt` once at startup.
- **Installed-service primitive:** `install apply` restarts VersionedApps whose payload advanced (the primitive that deletes the port-squat/hang/orphan defect class).
- **Runtime layout API:** installer copies manifest into install root; loader-hosted `InstalledProduct.Discover/Resolve(payload)` + lane; `PePayloadContext` gains Version/Lane/Deployment. Round-trip contract test (install to temp root → resolve every payload).
- Version SoT: props/CLI accept `version` in `product.payloads.json` (git-tag fallback); CLI reads the `global.json` pin (dotnet-tools pin dies).
- Exit: SDK beta.15 packed **from a committed tree**; HelloAddin round-trip green; ledger reviewed.

### Phase 2 — Pe.Tools config collapse (consumes beta.15)
- Delete both hardcoded C# manifests in `CreateInstallerModule.cs`; build performs a source-path-rewrite transform of the checked-in `product.payloads.json` only.
- Delete `pe-version.json` (version into manifest / tag). Prune `Pe.Shared.Product`: descriptor model (`PeAppRuntimeDeploymentDescriptor`, `RevitDeploymentIdentity` stale layout), `PeaLauncherContent` (SDK ShimContent is the one generator), layout constants superseded by the runtime API. Fix `ThemeManager.cs:55` stale pack URI.
- Exit: release bump ≤1 file; contract tests green; ledger reviewed.

### Phase 3 — Mastra/mastracode bump + glue purge (on the current 3-process shape)
- Bump @mastra/* → 1.50.x, mastracode → latest. Then delete per MASTRA-DELTA: `/pe/messages` image hack + `postPeMessage` (native attachments), approval workarounds (verify `autoResumeSuspendedTools` against our symptom), capture proxies (native accessors), dead code (`interrupts.ts`, `packages/agent-projection`, `packages/workbench-transport`), `models/resolve.ts` throwaway-runtime hack if upstream now exposes a resolver.
- Verify approvals + images live before proceeding. Thread hydration stays ours (upstream mastra#13645); note on ledger.
- Exit: web works on current shape with strictly less code; approvals/images demonstrably fixed or isolated with a named cause.

### Phase 4 — The squash (host absorbs pea)
- Host: effect beta.92 → current; Mastra runtime as a `Layer.scoped` tenant; `MastraServer` (Hono, fetch-based) mounted under the Effect HTTP server; static web served by host; ONE port (5180).
- Process lifecycle: `/host/update` returns-after-staging then self-restarts; addin kills version-mismatched stale hosts via tokened `/admin/shutdown`; orphan story (job object or startup sweep); ribbon = one button → open web at the host URL.
- Typed Effect RPC/HttpApi for Pe surfaces replacing untyped `/call` + dev-only `/pe-host` proxy; web consumes the derived client.
- `apps/pea` shrinks to whatever survives (MCP entries live in `packages/mcps`; TUI deletable; `pea web` dies into host). `apps/host/dist-installed` + separate host payload entry die; the service ships as the single VersionedApp.
- Exit: one Revit-spawned process; installed web functionally equal to dev; e2e types on Pe surfaces; peco/pea MCPs still work.

### Phase 5 — Release + e2e
- Pack, publish, install on a clean lane through BOTH channels; staged-until-restart UX text explicit; codex computer-use for GUI e2e with the owner.
- Exit: coworker-ready release.

### Phase 6 — SDK to NuGet (after a release or two proves the SDK)
- Template/docs polish reflecting the condoned patterns (runtime API, service primitive, staged updates); publish pipeline; version/tag discipline.
