# Pe.App

## Scope

Owns the Revit add-in entrypoint, ribbon/command exposure, task palette commands, and the Revit-side bootstrap for host bridge/runtime services.

## Purpose

`Pe.App` is the user-facing runtime shell inside Revit. It wires startup/shutdown, ribbon registration, tasks, and command entrypoints, while delegating domain logic to shared/runtime packages instead of owning deep business rules itself.

## Critical Entry Points

- `Application.cs` - add-in startup/shutdown, event subscriptions, `HostRuntime.Initialize`, internal scripting pipe startup, optional bridge auto-connect, logger setup.
- `ButtonRegistry.cs` - single source of truth for ribbon buttons and top-level command visibility.
- `Commands/FamilyFoundry/` - Family Foundry, migrator, and schedule-manager command entrypoints.
- `Commands/SettingsEditor/` - Revit-side settings editor bridge/connect UX.
- `Tasks/TaskInitializer.cs` - task palette registration.
- `Services/` - add-in-local services such as AutoTag and explorer helpers.

## Validation

- Do not build this project during RR debug; building during a live Rider/Revit debug session always breaks hot reload.
- Prefer validating runtime-facing fixes through the smallest affected command or focused `.Tests` lane when possible.
- If a change should affect bridge behavior, verify both add-in startup wiring and the corresponding `Pe.Host` endpoint/service path.
- Auto-connect is opt-in through `PE_SETTINGS_BRIDGE_AUTO_CONNECT=true`. Do not silently turn the bridge into an always-on startup dependency.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **runtime lane** | The deployed Revit add-in assemblies loaded by Revit | Avoid confusing this with the `.Tests` lane |
| **bridge** | The Revit-side named-pipe connection to `Pe.Host` | Avoid using it for HTTP/SSE endpoints |
| **RR debug** | A live Rider/Revit debug session against the deployed runtime lane | Prefer this over vague phrases like `live debug` when the Rider+Revit lane specifically matters |
| **task** | A Task Palette action under `Tasks/` | Avoid using it as a synonym for background/async work |

## Living Memory

- Keep `Pe.App` thin. If logic starts looking reusable or testable outside the command shell, move it into the owning domain/shared package.
- `Application.cs` is the startup truth. If a capability depends on bootstrapping, logging, or event subscription, verify it there first.
- `ButtonRegistry.cs` is the ribbon truth. Do not scatter command discovery assumptions across docs.
- When rename-era paths drift, trust the current command files under `source/Pe.App/Commands/...`, not stale docs or plans.
- If the settings editor looks broken, check both Revit-side bridge startup (`HostRuntime.Initialize`) and external host availability before debugging schema/data logic.
- The normal app posture is still manual bridge connection. Auto-connect exists for explicit settings-editor automation cases, not as a general scripting dependency.
