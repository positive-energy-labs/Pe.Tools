# pea Goals

## North Star

`pea` is the Pe Agent entrypoint: an agent-owned command surface for using Pe tooling through stable host contracts instead of teaching users or agents the repo's internal dev workflows.

## User Goals

- Give users a small, approachable way to start agent-assisted Revit work.
- Keep the public experience centered on intent and outcomes, not on Revit runtime plumbing.
- Let users build custom tooling against the same host surface that `pea` uses.

## Developer Goals

- Keep `pea` close to the agent runtime and generated TypeScript host client surface.
- Treat local filesystem, runtime, and install path conventions as host/shared-contract facts, not duplicated client guesses.
- Preserve a clear boundary between public agent UX and dev/operator workflows.

## Integration Goals

- Use `Pe.Host` as the public automation boundary for Revit-backed capabilities.
- Prefer typed generated clients over handwritten HTTP calls when host operations are available.
- Install `pea` through the MSI as the PATH-friendly deployed agent command alongside Host/App.
- Keep `pe-dev` available for repo-local development, validation, runtime sync, and operational tasks, but do not install it through the MSI.

## Non-Goals

- `pea` is not the replacement for every `pe-dev` workflow.
- `pea` should not independently encode Pe runtime path conventions.
- `pea` should not expose implementation details of the private Revit bridge.
