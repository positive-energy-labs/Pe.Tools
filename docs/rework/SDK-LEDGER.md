# Ledger — SDK beta.17 + Pe.Tools 0.6.9 spike

One line per item, forward-looking. Statuses: `open` → `in-progress` → `fixed@<version|commit>` |
`deferred(<reason>)` | `codex(<handed off in E2E-HANDOFF>)`. Agents that find issues ADD LINES;
phase exits review this file. Fixed items from prior spikes live in git history, not here.

## SDK (Pe.Revit.Sdk) — Phase 1

| id | status | item |
|---|---|---|
| S1 | fixed@85b9b16 | Lane: `EnsureRunning(name, timeout?, lane?)`; `Open/Discover(pinnedLane)`; loader pins `installed`; product-wide `*.dev.txt` scan deleted. TS already explicit. |
| S2 | fixed@7112bc9 | `install verify` destination-only (RunVerify + ResolveInstalledTarget: manifest → installed copy → CLI self-location); passes on user machines with no checkout. |
| S3 | fixed@7112bc9 | Idempotent apply: `already-current` no-op; `--force` stops the service then recopies (prior P10). |
| S4 | fixed@7112bc9 | `pe-revit dev link|unlink|status`; apply stops writing dev.txt; release installs emit `skipped-dev-only` for targetless shims. |
| S5 | fixed@7112bc9 | `pe-revit path ensure|remove|status`: kind-preserving, no-clobber, WM_SETTINGCHANGE; refuses to write on unparseable Path (never clobbers). |
| S6 | fixed@7112bc9 (C# @85b9b16) | Loopback MUST in ServiceSpec + pe-service.ts; spawned stdio → `state/service/<name>.log` both impls; TS serve helpers. |
| S7 | fixed@7112bc9 | doctor companion-pins + ts-client-drift, asserted in smoke Check 24. |
| S8 | fixed@85b9b16 | `Resolve(name, revitYear?, payloadType?)` — type disambiguates shared names (prior P12). |
| S9 | fixed@85b9b16 | Loader inert-on-corrupt: catch → log + Result.Succeeded; Note falls back to loader dir (prior R5). |
| S10 | fixed@7112bc9 | Residual version-authority wording reworded (4 sites). |
| S11 | fixed@7112bc9 | Smoke 27e-27h added; full suite green. NOTE (W1b): the release-package `skipped-dev-only` path is code-complete but only exercisable in a real release consume — covered by the Codex E2E. |
| S12 | fixed@46c4e4c | beta.17→**beta.18** packed (7 companions + trio) and pushed to eng/sdk-feed (10 nupkgs). |
| S13 | open | `install remove` still requires build sources (MirrorRemove) — unusable on user machines without a checkout; users rely on MSI uninstall/gc. Dest-only remove is a follow-up (found by W1b). |
| S14 | fixed@46c4e4c | **beta.17 regression**: doctor companion-pins/ts-client-drift globbed `**/*.csproj`+`pe-service.ts` with AllDirectories+post-filter → walked the whole `node_modules/.pnpm` tree on any TS-containing consumer, hanging doctor. Pruning walk (skip excluded dir names before descending). Verified: doctor returns 17 checks in <60s on Pe.Tools via the restored beta.18 tool (was: indefinite hang). Both S7 checks were themselves validated by this — they caught S15 + the stale vendored client. |

## Pe.Tools — Phase 2

| id | status | item |
|---|---|---|
| T1 | fixed@5a62da3 | Drizzle: SEA require shim (`pe:sea-require-shim`) + JS sidecar staging. GATE MET (with T9): alt-port repro shows `/pe/info` 200 + `agentRuntime.available:true` installed. |
| T2 | fixed@5a62da3 | Mastra observability: init error → `state/host/mastra-init.err.log` (cleared on healthy boot) + `agentRuntime {available,error}` on `/host/status` (HOST_CONTRACT_VERSION 37). Caught 3 further init blockers in one session. |
| T3 | fixed@266d06f (+beta.18 follow-up) | Consumed beta.17→**beta.18**: all pins bumped; `PE_LANE` guard deleted (loader-pinned lane); legacy 8s timeout dropped for the SDK 15s default. Pe.App builds clean; 63/63 tests. SDK real overloads (391ea4f) keep beta.16-shape call sites binary-safe. Follow-up (found by doctor companion-pins): `build/Build.csproj` still pinned Versioning beta.9 — now beta.18. |
| T11 | fixed@(this commit) | Re-vendored `apps/host/src/pe-service.ts` from the beta.18 SDK canonical (S6 changed it — loopback docs, stdio capture, serve helpers; all additive, no exports removed). doctor ts-client-drift now OK. Found by the new drift check. |
| T4 | fixed@01bdfa1 | Both PATH writers deleted (PeaLinkDevCommand + BootstrapPathCommand — the latter rewrote user PATH as REG_SZ); tombstones route to `pe-revit path ensure` + `dev link`; `pe-dev` became a targetless manifest PathShim (dotnet run dev command); self-test 13/13 (fixed a pre-existing failing assertion). Machine cleanup of old `bin\pea` launchers/PATH entries → Codex E2E. |
| T5 | fixed@in-tree | pea installed revival (D5, bare `pea` launches the MastraTUI). Done: apps/pea/vite.config.ts got the `pe:sea-require-shim` plugin (verbatim host copy — drizzle-orm + get-stream require-shim, onnxruntime-node throwing stub); NEW apps/pea/scripts/stage-native-sidecars.mjs (verbatim host copy — 3 natives + drizzle-orm + get-stream(+2 deps) + mastracode decoy); `build:installed` chains `vp pack && node scripts/stage-native-sidecars.mjs`; product.payloads.json gained `VersionedApp pea` (source `source/pe-tools/apps/pea/dist-installed`, entry `pea.exe`) and the pea PathShim gained `"target": "versionedApp:pea"` (dev preserved); CreateInstallerModule PublishPeaAsync stages the payload (`pnpm --filter @pe/pea build:installed`) + `["pea"]` in both MSI and install.zip dicts; ProductLayoutAuthority.GetPeaPublishDirectory + PeaCliIdentity.ExecutableName added. VERIFIED: build:installed green (pea.exe 152MB); static bundle checks pass (TypedQueryBuilder=0, no static drizzle import, createRequire shims for `drizzle-orm/pg-core`+`get-stream`, onnxruntime stubbed); init probe (bare pea.exe, isolated PE_TOOLS_PRODUCT_HOME, empty stdin) RENDERED the MastraTUI with only a benign punycode deprecation on stderr — no Reference/module/drizzle/onnx/get-stream/mastracode errors. Build project compiles (0/0). No verbatim-copy deviations needed. Full TTY E2E + MSI pack → Codex. Awaiting orchestrator commit. |
| T6 | fixed@01bdfa1 | Web update toast now says staged-until-restart truth. |
| T7 | fixed@(this commit) | BUILD.md fully current: lane/shim/PATH sections → SDK verbs + PePayloadContext (eded9a6); `bin\pea` layout section rewritten to the settled T5 VersionedApp shape (`bin\pea\versions\<v>\pea.exe`, shim at `shims\pea.cmd`, sidecars point at stage-native-sidecars.mjs; dead `@opentui` line removed — custom TUI is dead per D5). |
| T8 | open | Firewall UX: verified fixed at 0.6.8 by loopback bind (screenshot was the 0.6.4 exe). Codex confirms absence on a fresh install; stale per-version block rules are cosmetic. |
| T10 | open | Latent SEA bundle gap surfaced while packing pea (T5): rolldown reports `playwright-core` cjs subpaths (`chromium-bidi/lib/cjs/bidiMapper/BidiMapper`, `.../cdp/CdpConnection`) and several `eval` sites (playwright-core, @promptbook/utils) as UNRESOLVED and leaves them as runtime externals — but chromium-bidi is NOT staged beside pea.exe, so any pea browser-tool code path would `Cannot find module` at runtime. Not hit at TUI init (init probe passed). Likely shared with the host bundle (same mastracode source). No embedder/browser feature is in scope this spike; revisit if pea/host gains a browser tool. |
| T9 | fixed@in-tree | Installed Mastra init blockers #2-#4 (each surfaced by the T2 channel), all fixed in the host build, decision recorded: (2) onnxruntime-node (eager via mastracode→@mastra/fastembed, 255MB) → throwing-stub virtual module in vite.config.ts — approved option 1: no embedding-dependent feature runs installed (no embedder, semanticRecall off, OM is LLM-based); throws a descriptive pointer to this line only on USE; bundle shrank 61→37MB. (3) get-stream@9 → added to the SEA require shim + staged with its 2 deps (rolldown duplicates the module and mis-renames its `nodeImports` binding). (4) mastracode's init-time `findMastraCodePackageRoot` walk → decoy `package.json` (name "mastracode") staged at the payload root by stage-native-sidecars.mjs. Upstream asks filed in MASTRA_UPSTREAM_CANDIDATES.md (lazy fastembed import, lazy package root). Verified: `/pe/info` 200, `agentRuntime.available:true`, no mastra-init.err.log after healthy boot. Awaiting orchestrator commit. |

## Deferred (reason required)

| id | status | item |
|---|---|---|
| S-DEF-1 | deferred(working host code; post-release) | Full `PeServiceHost` serve-side helper (bind loopback, port fallback→0, token, shutdown route, file lifecycle) in C#+TS; Pe.Tools host-lifecycle adopts it and deletes the dual identity/token files (identity.json takeover vs service file). |
| S-DEF-2 | deferred(assembly boundary; ~40 LOC each) | Unify the CLI's `ShutdownAdvancedService` with the loader's service client (prior F4). |
| S-DEF-3 | deferred(opts-in keeps client ~300 LOC) | TS `InstalledProduct` resolver so `ensureRunning(appBase, name)` needs no pre-resolved opts (prior F3). |
| S-DEF-4 | deferred(manifest field is SoT for now) | Git-tag version authority tier (prior F1). |
| S-DEF-5 | deferred(warn-only guard shipped) | True single SDK pin — kill the dotnet-tools pin (prior F2). |
| S-DEF-6 | deferred(host is CLI-updated) | MSI VersionedApp current.txt pointer-guard CA parity (prior A8). |
| S-DEF-7 | deferred(cosmetic) | Pin-drift guard walks RepoContext.Find() redundantly (prior R6); cross-product stale loader registrations cleanup story (prior P5). |
| S-DEF-8 | deferred(no signing infra yet) | Installed-lane code-signing story; unsigned-addin approval dialog can hang unattended startup — document per release until solved. |
| S-DEF-9 | deferred(post-release; review primitive #5) | Transport staging verb: `pe-revit install stage --transport msi|zip` stages sourced payloads + emits the source-rewritten manifest — absorbs Pe.Tools' `TransformManifest` (CreateInstallerModule.cs:305-326) and gives native-sidecar staging a home; no consumer should write a JSON rewriter. |
| S-DEF-10 | deferred(post-release; also SDK NEXT.md) | Single schema/version source: SDK props, `RepoContext.ResolveVersion`, and Pe.Tools `ResolveVersioningModule.ReadManifestVersion` (build/Modules) read the same manifest field with parallel regexes that must agree. |
| S-DEF-11 | deferred(trivial; next loader touch) | `Deployment.ServiceBaseUrl(name)` → read service file → `http://127.0.0.1:{port}` — deletes Pe.Tools' env-var port re-broadcast (`PE_TOOLS_HOST_BASE_URL` set inside TsHostLauncher) once C# callers read it. |
| S-DEF-12 | deferred(DISCUSS FIRST — owner ledger style) | Dev-lane service seam ownership: Pe.Tools' hand-rolled `EnsureDevHostRunning` (TsHostLauncher.cs:93+, probe/match/takeover) is the de facto spec nobody owns. Either extend `ensureRunning` with a dev descriptor (checkout entry, lane dev) or bless "dev is the consumer's job" in SPEC and document the takeover-token pattern. |
| T-DEF-1 | deferred(live-gated; prior spike) | talk_to_pea→runMC; createCodingAgent for pea; effect beta.94 coordinated bump; runRuntimeAgentControllerWeb deletion after peco migrates; thread-lock as Effect service; `/host/update` self-shutdown + stale CmdFFMigrator route text; host port-0 fallback; env-var port plumbing → service-file reads in C# callers (see S-DEF-11); `runtimeDescriptorFileName` + `devSourceFileName` dead TS constants. |

## Codex installed E2E (2026-07-08, v0.6.9 on real Revit 2025) — findings

Headline gates ALL PASS: firewall-free install (loopback-only), installed `/pe/*` live
(`agentRuntime.available:true`, `/pe/info` 200 — the CRITICAL 503 fix proven), installed Revit
bridge (Pe.App 0.6.9 loaded), `pea` from PATH → installed exe, `path ensure` byte-identical PATH.
Released v0.6.9 (MSI + install.zip + manifest) at commit ae4dd22; tag/release pushed, `main` NOT
pushed (local ahead 54 — owner to push when ready).

| id | status | item |
|---|---|---|
| E1 | open (SDK, low — cosmetic) | `install apply --release latest` same-version is not fully touchless: exits 0 (already-current) but still rewrites `install.receipt.json` and re-runs the Cli + PathShim payloads. S3 short-circuits only the versioned copy/flip. Harmless (Cli self-copy is skipped when running installed; receipt rewrite is cosmetic) but not the intended no-op. Fix: when EVERY payload resolves already-current, skip the receipt rewrite + non-versioned re-runs too. Does NOT affect the web-Update UX (that advances a version). |
| E2 | open (SDK, med) | `install apply --force` cannot recopy a VersionedAddin/VersionedApp whose files a running Revit/host hold locked → exit 1 (locked Pe.App.dll + Pe.Host.exe; host recovers). --force + same-version + Revit-open is inherently at odds with staged-until-restart (a loaded addin dll can't be live-swapped). Fix: --force should be best-effort over locked files — stage the fresh copy where possible and report `staged-locked`/`skipped-locked` rather than fail. Edge case (the web-Update version-advance path is unaffected). |
| E3 | open (Pe.Tools, low) | `revit.catalog.recent-documents` is a TS host-local op (call-route.ts:124), callable via POST /call but absent from the Revit `/ops` bridge catalog + `host_operation_search`. Add host-local ops to the discoverable catalog, or document them as a separate discovery surface. |
| E4 | resolved-by-design | Fresh install has no `pe-dev.cmd` → shell says "command not found", not a friendly "no linked checkout" message. This is CORRECT per D7 (release installs skip targetless dev-only shims — no `.cmd` is written, so there is nothing to print a message). The E2E-HANDOFF's stated expectation was wrong; the behavior is right. No code change. |
| E5 | open (low) | `pe-revit live status` is a dev-lane bridge tool, not a reliable installed-product path-identity proof (Codex used installed `/host/status` + pea status instead). Either scope `live status` output to say "dev lane" or add an installed-aware freshness proof. Matches SPEC (live loop is the dev lane) — mostly a docs/expectation clarification. |
