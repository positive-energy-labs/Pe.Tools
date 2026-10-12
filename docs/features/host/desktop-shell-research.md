# Desktop shell, Windows distribution, and update census (2026-10-08)

Research for the host ledger's 2026-10-08 desktop-shell decision. Three witness reports were read live that day (GitHub API stars and 90-day commit counts, vendor docs, npm and NuGet); numbers are testimony dated 2026-10-08, not proof. Constraints that shaped the census: the host stays a Node single executable (host ledger 2026-10-07), Windows only, Tauri excluded by verdict, and the Revit add-in payload must be laid into `%APPDATA%\Autodesk\Revit\Addins\<year>` by the installer.

## Window shells

| Candidate | Engine on Windows | Can wrap the host's loopback URL | Keeps one Node runtime | Installer or updater of its own | Momentum (2026-10-08) |
|---|---|---|---|---|---|
| Edge app mode (`msedge --app=URL --user-data-dir=DIR`) | installed Edge | yes, primary use | yes (none added) | none; the host launches it | steady; a Chromium flag, no Microsoft reference page found |
| Edge PWA install | installed Edge | yes, but bound to an origin, and the host's port can fall back | yes | Edge | steady; window controls overlay documented 2026-09-02 |
| WebView2 direct (tiny C# exe, `Microsoft.Web.WebView2` 1.0.4258) | Evergreen WebView2, ships with Windows 11, 2 MB bootstrapper | yes | yes | none; bring MSI or Velopack | steady (Microsoft) |
| Photino.NET 4.0.16 / PhotinoX 5.3.5 | WebView2 | yes | yes | none | Photino fading (no release since 2025-01-23); PhotinoX rising but 44 stars |
| Neutralinojs 6.10.0 | WebView2 | yes (`url`, `enableServer:false`) | yes | none | steady, 27 commits in 90 days |
| `@webviewjs/webview` 0.4.7 and other Node N-API bindings | WebView2 (tao + wry) | yes, from inside Node | yes, but a SEA cannot load a `.node` from its blob (write to disk, `process.dlopen`) | none | tiny (79 stars) |
| Electron 44.7.0 (2026-10-07; majors every 8 weeks; 123k stars, 631 commits in 90 days) | bundled Chromium 152 + its own Node 24.18 | yes; the host would be a child process | no (second Node) | electron-builder NSIS + electron-updater (blockmap deltas, GitHub Releases); forge 8.0.1 | rising/steady; 158 MB runtime zip |
| Electrobun 2.0.2 (2026-09-29; 12.9k stars, 447 commits in 90 days) | WebView2 per TeamDev; optional CEF | yes (`url`) | no (Cottontail Zig+JSC pre-release, or Bun/Zig/Rust/Go/Odin) | self-extracting bundles, bsdiff updates | rising, main runtime pre-release |
| `deno desktop` (Deno 2.9, experimental) | WebView2 or `--backend cef` | not documented | no (Deno) | `.exe` or `.msi` output, `Deno.autoUpdate()` bsdiff | rising, experimental |
| Bun 1.4.2 | none: `Bun.WebView` is headless CDP over an installed browser, `headless:false` throws | n/a | n/a | none | no desktop story; `webview-bun` dead |
| Wails v3 (beta.28, 2026-10-05; v2.14.0 stable) | WebView2 | unproven for v3 | no (Go) | NSIS, optional MSIX | rising, still beta |
| NW.js 0.117 | bundled Chromium + Node | yes | no (its own) | none official | steady, 216 MB |
| CEF 156 / CefSharp 152 | bundled Chromium | yes | n/a (.NET or C++) | none | steady infrastructure, 175 to 367 MB |
| Gluon, node-webview, Verso, webview/webview, Photino.NET upstream | | | | | archived, dead, 404, 0 commits in 90 days, fading |

Surprises: Electrobun left Bun for its own runtime in 2.0; Deno now has an official desktop story; Bun has none; electron-builder's GitHub tag (26.17.0) and npm `latest` (26.15.3) disagree; electron-vite stable is 5.0.0 while 6.0.0-beta ships.

## Windows installers, updaters, signing

| Item | Can lay the Revit add-in outside its own folder | Update mechanics | Momentum |
|---|---|---|---|
| WiX MSI (v7.0.0 2026-04-06; the SDK's `pe-revit msi` runs the global `wix` 7.0.0 tool) | yes, per-user `AppDataFolder` today | none built in; the app checks a feed, downloads, runs `msiexec` (MajorUpgrade) | steady; v6+ carries the Open Source Maintenance Fee for organisations over US$10k annual revenue (docs.firegiant.com/wix/osmf); v5 is fee-free, last release 2024-10-05 |
| MSIX + App Installer | no at install time: package files are visible only to the package, HKLM writes fail; a full-trust app may copy into `%APPDATA%` at runtime with `unvirtualizedResources`, files left behind on uninstall | `.appinstaller` background and on-launch checks, deltas | steady; sideloading needs a trusted certificate |
| Velopack 1.2.161 (2026-09-29; 2,376 stars, 66 commits in 90 days; 1.0 on 2026-05-30) | partly: installs to `%LocalAppData%\{packId}`; `--msi` wraps the app folder only; hooks unproven | full and delta packages, GitHub Releases feed, apply on restart, its own stub | rising; successor to Squirrel |
| Squirrel.Windows, Clowd.Squirrel | n/a | | dead (2020) and archived; lineage lives in `electron/windows-installer` 5.4.4 |
| electron-builder NSIS + electron-updater 6.8.10 | probably via NSIS custom script, unproven | blockmap deltas, `latest.yml`, GitHub provider, `quitAndInstall` | steady-high |
| winget 1.29, Chocolatey 2.7.4, Scoop 0.6.0 | delegated to the installer they run | pull (`upgrade`), no in-app background update | steady; winget rising |
| ClickOnce (.NET 5+) | no | check on launch only; background mode removed | maintenance |
| Intune Win32 (`.intunewin` wrapping MSI or EXE), Enterprise App Catalog | yes | supersedence by IT | rising for IT-managed firms |
| Azure Artifact Signing (was Trusted Signing) | n/a | n/a | rising; about US$9.99/month Basic; certificates live about 3 days, timestamp required; eligibility pages conflict (one requires 3 years of tax history); no source tests Revit's add-in check against the chain; no instant SmartScreen trust, and EV no longer buys it either |
| OV/EV certificates | n/a | n/a | OV steady (US$150-500/yr, HSM key, 460-day cap since 2026-03-01); EV fading as a SmartScreen purchase |
| GPO or Intune trusted certificate | n/a | n/a | workable for an internal tool; Autodesk forum replies say Revit's prompt clears once the certificate is in Trusted Publishers |

## Reference: how t3code ships (read 2026-10-08, `.explore/t3code` at 7ab800a)

Electron 44.4.2 exact-pinned, `vp pack` (not electron-vite), electron-builder 26.15.6 NSIS only (per-user by default), `electron-updater` with a GitHub Releases feed and `latest.yml`/`nightly.yml` plus blockmaps, updates user-clicked (`autoDownload=false`, `autoInstallOnAppQuit=false`), check 15 s after start then every 4 minutes, Azure Trusted Signing through seven secrets with an unsigned fallback. The server runs as a child of the Electron exe with `ELECTRON_RUN_AS_NODE=1` from a `server.asar` sidecar (exists only to keep NSIS fast; 80-file cap). The renderer seam is `window.desktopBridge !== undefined`; the SPA talks loopback HTTP and WebSocket with a bearer token minted from a one-time bootstrap token over fd3. Practices worth copying: preload bundle verification, packaged-payload validation, an empty-PATH archive smoke test, nightly/stable/preview channels where preview ships no feed, `install.ps1` with `SHA256SUMS`. Not used there: Electron fuses, asar integrity.
