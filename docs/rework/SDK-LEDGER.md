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
| S12 | fixed@2426cef | beta.17 packed (7 companions + trio) and pushed to Pe.Tools eng/sdk-feed (10 nupkgs). Phase 1 exit met. |
| S13 | open | `install remove` still requires build sources (MirrorRemove) — unusable on user machines without a checkout; users rely on MSI uninstall/gc. Dest-only remove is a follow-up (found by W1b). |

## Pe.Tools — Phase 2

| id | status | item |
|---|---|---|
| T1 | in-progress | Drizzle: fixed via SEA require shim (vite.config.ts plugin — plain `neverBundle` dies with ERR_UNKNOWN_BUILTIN_MODULE; static ESM externals cannot load inside the SEA) + JS sidecar staging; alt-port repro confirms TypedQueryBuilder gone, but `/pe/*` still 503 on the NEXT init failure — see T9. |
| T2 | in-progress | Mastra observability: implemented + repro-verified — init error persisted to `state/host/mastra-init.err.log` (cleared on healthy boot) and surfaced as `agentRuntime {available,error}` on `/host/status` (hostProbeDataSchema, HOST_CONTRACT_VERSION 36→37); awaiting orchestrator commit. |
| T3 | fixed@(this commit) | Consumed beta.17: all pins bumped (incl. Versioning beta.9→17 skew); `PE_LANE` guard deleted (loader-pinned lane); legacy 8s timeout dropped for the SDK 15s default. Pe.App builds clean; 63/63 tests. NOTE: SDK added real overloads (391ea4f) so beta.16-shape call sites stay binary-safe across the staged-loader window. |
| T4 | open | Dev shims: adopt `pe-revit dev link`; delete `PeaLinkDevCommand`'s own launcher + User-PATH prepend (PeaLinkDevCommand.cs:37-58); shims dir registered via `pe-revit path ensure`. |
| T5 | open | pea installed revival (D5, clarified: bare `pea` always launches the MastraTUI): apps/pea `vp pack` machinery is intact (dist-installed/pea.exe, same neverBundle natives as host — verified). Mirror T1's drizzle sidecar, stage native sidecars for pea, re-add `VersionedApp pea` payload (source `source/pe-tools/apps/pea/dist-installed`, entry `pea.exe`), pea PathShim gains `"target": "versionedApp:pea"`, build pipeline stages the payload. |
| T6 | open | Web success copy: "open Revit sessions swap live" is false — staged-until-restart wording. |
| T7 | open | BUILD.md: stale pre-squash sections (bin/pea/versions layout, pea.cmd lanes, Pe.App.runtime.json descriptor). |
| T8 | open | Firewall UX: verified fixed at 0.6.8 by loopback bind (screenshot was the 0.6.4 exe). Codex confirms absence on a fresh install; stale per-version block rules are cosmetic. |
| T9 | open | Installed Mastra init blocker #2 (post-drizzle, surfaced by T2 observability): `Cannot find module '../bin/napi-v6/win32/x64/onnxruntime_binding.node'` — onnxruntime-node (via @mastra/fastembed, referenced by both mastracode and @mastra/memory) is inlined and resolves its native binding relative to the SEA. Sidecar-staging it is a real decision: onnxruntime-node is 255MB with runtime deps (adm-zip, global-agent→own tree, onnxruntime-common); alternatives: stage a win32-x64-pruned copy, or keep the eager fastembed path out of installed init. Stopped per brief (2-iteration fence) — needs an owner call before more bundling smash. |

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
| T-DEF-1 | deferred(live-gated; prior spike) | talk_to_pea→runMC; createCodingAgent for pea; effect beta.94 coordinated bump; runRuntimeAgentControllerWeb deletion after peco migrates; thread-lock as Effect service; `/host/update` self-shutdown + stale CmdFFMigrator route text; host port-0 fallback; env-var port plumbing → service-file reads in C# callers; `runtimeDescriptorFileName` dead TS constant. |
