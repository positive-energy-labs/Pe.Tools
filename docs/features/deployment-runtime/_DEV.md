# Mental Model

Deployment/runtime has three orthogonal concerns that must stay separate:

- build taxonomy decides the workflow and execution policy
- install layout decides the durable product-owned filesystem shape
- runtime lane decides which executable distribution a launcher should resolve at runtime

Runtime lane is not a new build taxonomy axis. It is a small runtime-path authority used by launchers such as `Pe.App`, `pe-dev`, and `pea`.

The current lanes are:

- `Dev`: optimized for repo iteration and RRD
- `Installed`: optimized for MSI/user validation

# Architecture

The runtime authority lives in `Pe.Shared.Product`:

- `ProductRuntimeLayout` describes the installed/current-user runtime root under `%LocalAppData%\Positive Energy\Pe.Tools`
- `ProductDevelopmentRuntimeLayout` describes the dev-only host root under `%LocalAppData%\Positive Energy\Pe.Tools\dev`
- `ProductRuntimeAuthority` resolves the active host/CLI paths for a given lane
- `PeAppRuntimeDeploymentDescriptor` is the small JSON contract that tells `Pe.App` which lane it was deployed for

Important asymmetry:

- `Pe.Host` uses a dedicated dev runtime root in `...\Pe.Tools\dev\bin\host`
- `pe-dev` stays PATH-friendly in `...\Pe.Tools\bin\pe-dev`
- `pea` stays PATH-visible in the installed-shaped root `...\Pe.Tools\bin\pea`

That asymmetry is intentional. Host needs rebuild-friendly separation from the installed runtime. `pe-dev` and `pea` are operator entrypoints and must remain predictable from the terminal.

# Key Flows

## Interactive/RRD flow

- interactive `Pe.App` publish/deploy writes `Pe.App.runtime.json` with lane `Dev`
- `Pe.App` runtime companion builds refresh:
  - `...\Pe.Tools\dev\bin\host`
  - `...\Pe.Tools\bin\pe-dev`
- when `Pe.App` launches `Pe.Host`, it reads the adjacent descriptor first, resolves lane `Dev`, and launches the dev host path

This keeps repo iteration fast while avoiding file-lock contention against the installed host root.

## Installed/package flow

- isolated/package publish writes `Pe.App.runtime.json` with lane `Installed`
- installer payloads keep the installed runtime shape under `...\Pe.Tools\bin\...`
- when the installed add-in launches, `Pe.App` resolves the installed host path through the same authority

This gives installer validation a product-shaped runtime without needing ad hoc cleanup before returning to normal dev work.

## `pea` dev freshness

`pea` is intentionally handled differently from `Pe.Host`.

- terminal users expect `pea` to just work from a stable PATH-visible location
- `pe-dev pea sync-runtime` builds the repo `pea` app and mirrors the dev payload into the installed `pea` runtime root
- the stable launcher stays at `...\Pe.Tools\bin\pea\pea.cmd`
- the active payload version is selected by `...\Pe.Tools\bin\pea\current.txt`

This keeps `pea` easy to invoke while still allowing installer/user-validation flows to own the installed-shaped bootstrap.

# Open Questions

- Whether `pea` should eventually gain a richer `runtime use-installed` / `runtime use-dev` experience. The current design intentionally stays smaller: installed bootstrap plus explicit dev payload sync.
