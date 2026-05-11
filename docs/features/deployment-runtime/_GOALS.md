# North Star

Runtime freshness should be a resolution problem, not a manual copy/cleanup problem.

Normal repo work should pick the freshest dev runtime automatically. Installer validation should pick the installed runtime automatically. Switching between them should be explicit, centralized, inspectable, and stable.

# User Goals

- Installed Revit and terminal experiences should run a coherent product-shaped distribution.
- Installer validation should exercise the real installed shape, not an ad hoc approximation.
- Running the installer should not force manual cleanup before returning to day-to-day RRD iteration.

# Developer Goals

- `dotnet build` / `dotnet run` for `Pe.Host` should stay practical while RRD is active.
- `pe-dev` should stay PATH-friendly and always resolve predictably.
- `pea` should stay easy to invoke from the terminal without requiring PATH churn.
- Runtime path selection should have one authority and one inspectable story.
- Build taxonomy should not absorb runtime-lane concerns.

# Integration Goals

- `Pe.App`, `Pe.Host`, `pe-dev`, and `pea` should agree on the active runtime lane through shared product/runtime contracts.
- Packaging and installer authoring should emit the same runtime-lane facts that the live shells consume.
- Runtime status/diagnostic commands should make the active lane and resolved paths visible without code spelunking.

# Non-Goals

- One physical runtime root for every dev and installed scenario.
- Environment-variable-driven deployment selection as the primary workflow contract.
- Scattered fallback probing such as “try installed, then repo, then anything that exists.”
