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

## Shared Language

| Term               | Meaning                                              | Prefer / Avoid                                                                                |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **runtime add-in** | The deployed Revit add-in assemblies loaded by Revit | Avoid confusing this with the `.Tests` configuration, Design Automation, TS code, or the host |
| **task**           | A Task Palette action under `Tasks/`                 | Avoid using it as a synonym for background/async work                                         |

## Living Memory

- This package's dependency graph owns the live RRD runtime. Be unusually cautious about builds because they will
  _always_ force a costly Revit restart.
- Keep `Pe.App` thin. If logic starts looking reusable or testable outside the command shell, move it into the owning
  domain/shared package.Ok
- `Application.cs` is the startup truth. If a capability depends on bootstrapping, logging, or event subscription,
  verify it there first.
- `ButtonRegistry.cs` is the ribbon truth. Do not scatter command discovery assumptions across docs.
- When rename-era paths drift, trust the current command files under `source/Pe.App/Commands/...`, not stale docs or
  plans.
- If the host bridge UI looks broken, check both Revit-side bridge startup (`HostRuntime.Initialize`) and external host
  availability before debugging schema/data logic.
- The normal app posture is still manual bridge connection. Auto-connect exists for explicit host-bridge automation
  cases, not as a general scripting dependency.
