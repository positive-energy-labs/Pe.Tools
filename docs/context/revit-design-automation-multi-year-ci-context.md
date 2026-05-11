# Revit Design Automation Multi-Year + CI Context

Saved context from DA planning discussion on 2026-04-21.

## Current repo state

- `Pe.Dev.RevitAutomation.Worker` already works as a general DA shell with typed workload dispatch.
- Single-model cloud open and schedule collection are already proven in this repo's current direction.
- Root build/config knows about `R23` through `R26`; Design Automation packaging starts at `R24` because R23 DA targeting is no longer supported.
- Model discovery and batch manifests now carry per-model routing fields; keep future DA work grouped by execution engine year rather than one batch-wide engine assumption.

## Multi-year DA direction

- Keep one APS appbundle/activity per Revit engine year.
- Add one shared engine/year registry and use it from:
  - DA worker build/package
  - appbundle/activity naming
  - artifact/result paths
  - CLI validation/defaulting
- Do not keep parsing year via `engine.Contains("2025")`.
- `Autodesk.PackageBuilder` is useful for authoring bundle manifests cleanly, but it does not remove the APS engine-bound appbundle/activity constraint.

## Model-year routing direction

- Detect cloud model year from APS/Data Management metadata and carry it through discovery output.
- Stop treating `engine` as one batch-wide setting.
- Prefer per-model `revitYear` or resolved `engine`, then group submissions by engine year before shell readiness and workitem submission.
- Keep explicit override support for cases where metadata is missing or suspect.

## CI direction

- DA is a reasonable CI lane for composite, DA-safe end-to-end tests, including FF-style roundtrips.
- The main limit is not "can CI do this"; it is fixture stability, APS credentials, runtime cost, and flake control.
- Good split:
  - PR lane: very small DA-safe smoke set
  - nightly/manual lane: broader year matrix and heavier workflows
  - separate desktop-only tests from DA-safe tests

## `ricaun.RevitTest` adaptation

- `ricaun.RevitTest` already has the right abstraction seam: `IRunTestService`.
- The promising path is not to port its named-pipe desktop runtime into DA.
- Instead:
  - keep the NUnit-facing surface
  - add a DA-backed `IRunTestService`
  - submit a DA workitem
  - emit `TestModel` / `TestAssemblyModel` JSON back through stdout/artifact flow
- The desktop runner's pipe/process/busy semantics are local-Revit concerns and should not be forced into DA.

## Useful repo anchors

- `source/Pe.Dev.RevitAutomation/RevitAutomationWorkerBundleBuilder.cs`
- `source/Pe.Dev.RevitAutomation/RevitAutomationModelDiscoveryService.cs`
- `source/Pe.Dev.RevitAutomation/ScheduleCollectionBatchContracts.cs`
- `source/Pe.Dev.RevitAutomation.Worker/RevitAutomationShellApp.cs`

## Useful external anchors

- `C:\Users\kaitp\source\repos\ricaun.RevitTest`
- `https://github.com/ricaun-io/Autodesk.PackageBuilder`
- `https://github.com/ricaun-io/RevitTest`
