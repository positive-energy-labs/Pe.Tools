# SDK Ledger — Pe.Revit.Sdk release-prep tracker

Every SDK defect/enhancement, with status. Any agent that finds an SDK issue ADDS A LINE here (status `open`). Phase exits require a review of this file. Statuses: `open` → `in-progress` → `fixed@<version|commit>` | `wontfix(<reason>)`.

## Ship-blockers (Phase 1)

| id | status | issue | where |
|---|---|---|---|
| S1 | open | `EnsureUserPathStartsWith` corrupts user PATH: REG_SZ overwrite kills REG_EXPAND_SZ `%VARS%`, rewrites entire PATH 2×/install, no WM_SETTINGCHANGE, fights MSI `Part="first"`. Fix: DELETE — MSI owns PATH (kernel's own comment says so). | InstallCommand.cs:829-845, called :238,:270 |
| S2 | open | MSI manifest lane emits flat `RevitAddin`/`Exe` — official MSI has none of the versioned/loader layout. Root cause: MsiCommand.cs:202 throws on `VersionedAddin`. Fix: MSI-as-bootstrapper or real transport; MSI must yield same layout as `.install.zip`. | MsiCommand.cs:202; Pe.Tools CreateInstallerModule.cs:244-245 |
| S3 | open | Shim `dev_then_installed` re-runs installed payload on ANY nonzero dev exit (double execution; Ctrl-C = nonzero). Fix: fall back only when dev launcher unlaunchable. | InstallCommand.cs:398-405 |
| S4 | open | cmd `shift /1` doesn't affect `%*` — `--installed`/`--dev` leak into forwarded args. | InstallCommand.cs:374-385,:396,:401 |
| B1 | open | `stage:` source inside Install-kind package resolves to build-machine `.artifacts/stage` path (nonexistent on user machine). Treat as package-relative. | InstallCommand.cs:450-453 |

## Architecture (Phase 1)

| id | status | issue |
|---|---|---|
| A1 | open | **Swap demotion**: delete LoaderApplication watch/swap machinery (`_swapEvent`/`_watcher`/`_debounce` :28-30, StartWatcher :99-115, SwapHandler :117-143, SlotDispatch.BeginRebind), PayloadHost side-by-side ActiveDirs probing (:17,:42-52). Loader reads `current.txt` once at startup. Remove `IsFirstLoad` from payload contract once consumers stop branching. Rationale: dotnet/wpf#1700 + ILRepack short-name collapse — 7+ unfixable resource surfaces. |
| A2 | open | **Installed-service primitive**: `install apply` restarts VersionedApps whose payload advanced (declare exe/health/restart). Deletes the port-squat / update-hang / orphan defect class. |
| A3 | open | **Runtime layout API**: installer copies `product.payloads.json` into install root (beside receipt); loader-hosted `InstalledProduct.Discover(product,vendor)` / `.Resolve(payload)` → {currentVersion, versionDir, entryPath} + `Lane`; `PePayloadContext` gains Version/Lane/Deployment. Kills the 17-fact dual-maintenance ledger vs Pe.Shared.Product. Fold into Pe.Revit.Loader (inherits identity pinning). net48 = regex JSON parse (LoaderApplication.JsonField pattern). |
| A4 | open | **Round-trip contract test in SDK repo**: `install apply --root <temp>` a fixture manifest → `InstalledProduct` resolves every payload → assert files exist. The only test that fails when layout grammar changes. |
| A5 | open | **Version SoT**: props + CLI accept `version` in `product.payloads.json` (delete consumer `pe-version.json`); git-tag (`git describe`) fallback for 0-file releases. |
| A6 | open | **Single SDK pin**: CLI resolves its version from `global.json` msbuild-sdks (or ships in SDK package); `.config/dotnet-tools.json` pin dies. |
| A7 | open | Reverse leak: `LegacyPathEntriesForShimDir` hardcodes Pe.Tools names (`bin/pea`, `bin/pe-dev`) inside the product-agnostic kernel. Dies with S1 deletion; verify. | 

## Polish (Phase 1, low)

| id | status | issue |
|---|---|---|
| P1 | open | Release temp dirs never cleaned: `%TEMP%/pe-revit/release/<tag>` accumulates one extract per tag forever (InstallCommand.cs:507-525). |
| P2 | open | `pe-revit install --release` help text stale (bundle/addin-only wording). |
| P3 | open | Version dir written raw but resolved normalized (`NormalizePayloadVersion`) — normalize on write (InstallCommand.cs:141,148). |
| P4 | open | `_releasePackage` mutable static in otherwise-stateless kernel — thread through as parameter (InstallCommand.cs:442). |
| P5 | open | Cross-product stale loader registrations (`Assembly with same name is already loaded` from old HelloAddin) — installer cleanup story. |
| P6 | open | SDK repo hygiene: beta.11–14 shipped from uncommitted worktree (fix in Phase 0 by committing); HelloAddin sample polluted with hot-swap markers. |

## Consumer-side items tracked here because the SDK gap causes them

| id | status | issue |
|---|---|---|
| C1 | open | Pe.Tools `CreateInstallerModule.cs` hand-maintains TWO C# manifests duplicating `product.payloads.json` (drifted: MSI=RevitAddin/Exe, peco dropped, slug ×3). Delete after S2/A5; build becomes source-rewrite transform only. |
| C2 | open | `Pe.Shared.Product` prune after A3: descriptor model (`PeAppRuntimeDeploymentDescriptor` — zero writers; `RevitDeploymentIdentity` models pre-loader layout), `PeaLauncherContent` (duplicate of SDK ShimContent — two competing pea.cmd generators ship today), layout constants. |
| C3 | open | `ThemeManager.cs:55` hardcodes pack URI naming pre-merge assembly `Pe.Revit.Ui` (works single-load by WPF fallback luck). Fix regardless of demotion. |
| C4 | open | Scripting `ScriptAssemblyLoadService` first-simple-name-match assembly resolution (:158-165,:199-220) — mostly mooted by A1 demotion (single era), but Location-match is still more correct; decide during Phase 2. |
