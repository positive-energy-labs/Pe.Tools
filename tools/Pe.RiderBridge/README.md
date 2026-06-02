# Pe.RiderBridge

Minimal Rider plugin spike for replacing Pe.Tools hot-reload AHK automation with a localhost-only IDE action bridge.

## Why this exists

The dev-agent attached-RRD sync flow mutates `PeHotReloadSignal.cs` and asks Rider to apply changes through this localhost-only IDE action bridge. This replaces the old focus/keystroke AutoHotkey path for normal dev-agent use.

The reference macro in `source/Pe.Dev.RevitAutomation/Assets/auto-hr-macro-settings.zip` contains:

```xml
<macro name="Auto HR">
  <action id="ActivateCommitToolWindow" />
  <action id="Tree-selectAll" />
  <action id="ChangesView.EditSource" />
  <action id="Synchronize" />
  <action id="RiderDebuggerApplyEncChagnes" />
</macro>
```

The default bridge endpoint invokes the smallest action sequence that proved live in RRD:

1. `ActivateCommitToolWindow` — gives Rider a debugger/change-aware action context without using OS focus automation.
2. `Synchronize` — Rider/IntelliJ Reload All from Disk.
3. `RiderDebuggerApplyEncChagnes` — Rider debugger Apply Changes action. The typo is Rider's registered action ID.

## Endpoints

Rider's built-in local web server chooses the port. On most JetBrains installs it is commonly `63342`, but check Rider's built-in server settings if needed.

```http
GET http://127.0.0.1:63342/pe-tools/ping
```

```http
POST http://127.0.0.1:63342/pe-tools/actions/invoke?actionId=Synchronize&project=Pe.Tools
```

```http
POST http://127.0.0.1:63342/pe-tools/actions/invoke?actionId=RiderDebuggerApplyEncChagnes&project=Pe.Tools
```

```http
POST http://127.0.0.1:63342/pe-tools/hot-reload?project=Pe.Tools
```

```http
POST http://127.0.0.1:63342/pe-tools/restart-rrd?project=Pe.Tools
```

The hot-reload and restart responses include action results, lightweight Rider action-state diagnostics, failed-action problem entries, and `restartRecommended` when Rider context suggests Hot Reload cannot be trusted.

## Dev-agent sync integration

The dev-agent `live_rrd_sync` tool owns the normal non-focus path:

1. Resolve the repo root.
2. Mutate `source/Pe.Revit.Global/HotReload/PeHotReloadSignal.cs`.
3. Probe `GET /pe-tools/ping`.
4. Invoke `POST /pe-tools/hot-reload?project=Pe.Tools`.
5. Return the `RiderBridge` lane result and per-action statuses.

Removed public `pe-dev sync`/AutoHotkey guidance should not be restored as the default path; attached RRD sync now belongs to dev-agent live-loop tooling.

## Build/install notes

Package the plugin from the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/Pe.RiderBridge/package.ps1
```

The script emits:

- `.artifacts/packages/rider/Pe.RiderBridge.0.1.0.zip`
- `.artifacts/packages/rider/Pe.RiderBridge.0.1.0.jar`

Install the zip from Rider's **Settings > Plugins > Install Plugin from Disk...** and restart Rider when prompted. The plugin descriptor currently targets JetBrains builds `252` through `261.*`; check Rider's `product-info.json` after major Rider updates before bumping that cap.
