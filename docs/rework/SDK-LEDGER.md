# Ledger — SDK beta.17 + Pe.Tools 0.6.9 spike

One line per item, forward-looking. Statuses: `open` → `in-progress` → `fixed@<version|commit>` |
`deferred(<reason>)` | `codex(<handed off in E2E-HANDOFF>)`. Agents that find issues ADD LINES;
phase exits review this file. Fixed items from prior spikes live in git history, not here.

## SDK (Pe.Revit.Sdk) — Phase 1

| id | status | item |
|---|---|---|
| S1 | open | Lane: `EnsureRunning(name, lane?)`; loader pins `installed` on the `PePayloadContext.Deployment` product; delete the product-wide `*.dev.txt` scan in `InstalledProduct.Lane` (InstalledProduct.cs:63). C#/TS symmetry: TS already takes explicit lane. |
| S2 | open | `install verify` destination-only: read installed manifest copy + receipt at appBase; never `ResolveSource` (InstallCommand.cs:113,138,155,197 false `missing-source` on user machines). Default plain `verify` to the installed manifest when no checkout. |
| S3 | open | Idempotent apply: same version + pointer current ⇒ `already-current` no-op; `--force` to stop-service-and-recopy. Kills the locked-exe IOException (prior P10). |
| S4 | open | Dev verbs: `pe-revit dev link|unlink|status` (explicit, from checkout, idempotent); `install apply` stops writing `{name}.dev.txt`; release installs skip targetless dev-only shims with `skipped-dev-only`. |
| S5 | open | `pe-revit path ensure|remove|status`: safe idempotent User-PATH registration of the shims dir (REG_EXPAND_SZ preserved, no dup/clobber, WM_SETTINGCHANGE, honest status). Owner pain: hand PATH edits keep wrecking machines. |
| S6 | open | Service contract: loopback-only mandate documented in `ServiceSpec` + `pe-service.ts` header; spawned-service stdout/stderr captured to `state/service/<name>.log` in BOTH EnsureRunning impls (truncate at spawn). |
| S7 | open | doctor: companion `PackageReference` pin check (catches Pe.Revit.Versioning beta.9 vs beta.16 skew); vendored `pe-service.ts` drift check (hash consumer copy vs CLI-embedded canonical). |
| S8 | open | `InstalledProduct.Resolve(name, type?)` or manifest name-uniqueness guard (first-by-name ambiguity, prior P12). |
| S9 | open | Loader: inert-on-corrupt loader.json/shim (log + skip, never Result.Failed dialog) — prior R5. |
| S10 | open | Residual "pe-version.json is the authority" wording: Pe.Revit.Package.targets:244,246; McpCommand.cs:22; MsiCommand.cs:78 (prior P9 remainder; Explain.targets fixed P0). |
| S11 | open | Smoke: add no-source verify check (user-machine sim), already-current check, dev link/unlink check, path ensure check. |

## Pe.Tools — Phase 2

| id | status | item |
|---|---|---|
| T1 | open | Drizzle: `neverBundle` drizzle-orm in host vite config + stage as JS sidecar (extend stage-native-sidecars.mjs); verify with the alt-port repro that `/pe/*` returns 200 installed. Root cause: `TypedQueryBuilder` ReferenceError, SEA bundle module ordering. |
| T2 | open | Mastra observability: persist init error from the `mastra-runtime.ts:49` catch to the state dir; add agent-runtime availability + last-error to `/host/status` (app.ts:91-97). |
| T3 | open | Consume beta.17: bump global.json + dotnet-tools + ALL Pe.Revit.* PackageReferences (Versioning is at beta.9 in 5 csprojs); delete the `PE_LANE` guard in TsHostLauncher.cs:81-91 (pass lane explicitly via the new API); timeout 8s → SDK default 15s. |
| T4 | open | Dev shims: adopt `pe-revit dev link`; delete `PeaLinkDevCommand`'s own launcher + User-PATH prepend (PeaLinkDevCommand.cs:37-58); shims dir registered via `pe-revit path ensure`. |
| T5 | open | pea installed revival (D5): rebuild apps/pea dist-installed payload (same SEA pattern as host, same drizzle sidecar fix), re-add `VersionedApp pea` to the manifest, point the pea PathShim at `versionedApp:pea`. Design-check first: whether pea CLI boots the runtime in-process or rides the installed host. |
| T6 | open | Web success copy: "open Revit sessions swap live" is false — staged-until-restart wording. |
| T7 | open | BUILD.md: stale pre-squash sections (bin/pea/versions layout, pea.cmd lanes, Pe.App.runtime.json descriptor). |
| T8 | open | Firewall UX: verified fixed at 0.6.8 by loopback bind (screenshot was the 0.6.4 exe). Codex confirms absence on a fresh install; stale per-version block rules are cosmetic. |

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
