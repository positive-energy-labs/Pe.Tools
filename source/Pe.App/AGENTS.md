# Pe.App

## Scope

Owns the Revit add-in entrypoint, ribbon/command exposure, task palette commands, and the Revit-side bootstrap for host
bridge/runtime services.

## Purpose

`Pe.App` is the user-facing runtime shell inside Revit. It wires startup/shutdown, ribbon registration, tasks, and
command entrypoints, while delegating domain logic to shared/runtime packages instead of owning deep business rules
itself.

## Critical Entry Points

- `Application.cs` - add-in startup/shutdown, event subscriptions, `HostRuntime.Initialize`, optional bridge auto-connect, logger setup.
- `ButtonRegistry.cs` - single source of truth for ribbon buttons and top-level command visibility.
- `Commands/FamilyFoundry/` - Family Foundry, migrator, and schedule-manager command entrypoints.
- `Commands/PeTools/` - Revit-side host bridge/connect UX and browser launch into the external Pe Tools frontend.
- `Tasks/TaskInitializer.cs` - task palette registration.
- `Services/` - add-in-local services such as AutoTag and explorer helpers.

## Validation

- Do not run interactive `Pe.App` builds during RRD; package-local deploy builds can break hot reload and force a costly restart.
- For compile verification, use plain terminal `dotnet build`; it uses isolated outputs and does not refresh live runtime.
- If you want to validate a changed runtime package through scripting or `Pe.Revit.Tests`, build the affected package-local outputs and run `pe-dev revit sync-runtime` first.
- Prefer validating runtime-facing fixes through the smallest affected command or focused `.Tests` configuration when
  possible.
- If a change should affect bridge behavior, verify both add-in startup wiring and the corresponding `Pe.Host`
  endpoint/service path.
- Auto-connect is opt-in through `PE_TOOLS_BRIDGE_AUTO_CONNECT=true`. Do not silently turn the bridge into an
  always-on startup dependency.

## Shared Language

| Term               | Meaning                                                              | Prefer / Avoid                                                                                   |
|--------------------|----------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| **runtime add-in** | The deployed Revit add-in assemblies loaded by Revit                 | Avoid confusing this with the `.Tests` configuration                                             |
| **bridge**         | The Revit-side private WebSocket connection to `Pe.Host`             | Avoid using it for public HTTP/SSE endpoints                                                      |
| **RRD**            | A live Rider/Revit debug session against the deployed runtime add-in | Prefer this over vague phrases like `live debug` when the Rider+Revit setup specifically matters |
| **task**           | A Task Palette action under `Tasks/`                                 | Avoid using it as a synonym for background/async work                                            |

## Living Memory

- This package's dependency graph owns the live RRD runtime. Be unusually cautious about builds because they will
  *always* force a costly Revit restart.
- `Pe.App` only owns the post-deploy add-in approval hook now. Do not reintroduce hot-reload or test-run orchestration here.
- Keep `Pe.App` thin. If logic starts looking reusable or testable outside the command shell, move it into the owning
  domain/shared package.
- `Application.cs` is the startup truth. If a capability depends on bootstrapping, logging, or event subscription,
  verify it there first.
- `ButtonRegistry.cs` is the ribbon truth. Do not scatter command discovery assumptions across docs.
- When rename-era paths drift, trust the current command files under `source/Pe.App/Commands/...`, not stale docs or
  plans.
- If the host bridge UI looks broken, check both Revit-side bridge startup (`HostRuntime.Initialize`) and external host
  availability before debugging schema/data logic.
- The normal app posture is still manual bridge connection. Auto-connect exists for explicit host-bridge automation
  cases, not as a general scripting dependency.
