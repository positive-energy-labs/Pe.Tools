# Pe.Tools

Revit tooling for MEP engineering designers, built around **Pea** — a coding agent that operates Revit.

## Surfaces

- **Pea** — the agent. `pea agent` is the operator workbench; `pea --prompt` runs one headless turn.
  Pea drives Revit through typed host operations for quick actions and scripting for real work.
- **Pods** — shareable add-ins. Pea builds them on top of host operations and the `Pe.Revit.*` packages;
  users supply intent, share Pods, and ask Pea to adapt them.
- **Web routes** — the visual surfaces served by the Pe.Tools frontend:
  - `/family` — family profiles and Family Foundry work
  - `/takeoffs` — takeoff review and measurement
  - `/ops` — the live host-operation catalog and glance views
  - `/design-system` — the executable design authority for the UI language
- **Revit scripting** — a persistent workspace under `Documents\Pe.Tools\scripting\workspace` for daily API
  probes and small automation loops. Author single-file scripts under `src/` and run `pea script src\MyProbe.cs`;
  requests route through `Pe.Host` over the private Host/Revit bridge and execute via `ExternalEvent`.
  Scripting v1 is single-session and synchronous: no SSE, no cancellation, no multi-file execution.

## Building and running

Everything about build, verify, test, package, install, publish, and the live dev loop lives in
[`docs/BUILD.md`](docs/BUILD.md). Read it before touching anything build- or dev-loop-related — the Revit
tooling setup is bespoke, and the live dev session is expensive state.

Use the SDK control plane (`pe-revit live`, `pe-revit test fresh|attached`) rather than hand-orchestrating Revit.

## Where to read next

- [`AGENTS.md`](AGENTS.md) — operating rules and shared vocabulary
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — target architecture and product direction
- [`docs/adr/`](docs/adr/) — decisions that constrain more than one feature
- `docs/features/<name>/LEDGER.md` — per-surface decisions, rejected paths, and open work
