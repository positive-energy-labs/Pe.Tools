# Mental Model

Deployment/runtime has four concerns that must stay separate:

- build taxonomy decides the workflow and execution policy
- installer product slices decide the user-facing install concerns
- install layout decides the durable product-owned filesystem shape
- runtime lane decides which executable distribution a launcher should resolve at runtime

Runtime lane is not a new build taxonomy axis. Installer product slice is not an MSBuild project taxonomy. They are small product/runtime vocabularies used by launchers, packaging, and MSI authoring.

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

The installer models user-facing concerns as product slices:

- `desktop-runtime`: Revit add-in files under Addins/year plus the installed shared host runtime
- `pea-cli-bootstrap`: PATH-visible `pea` launcher plus payload version selection
- `pe-dev-cli-bootstrap`: PATH-visible `pe-dev` operator CLI

Desktop add-in install intentionally remains in `%AppData%\Autodesk\Revit\Addins\<year>`. The Nice3point SDK local debug workflow deploys to the same Addins/year shape, so prod/dev desktop sessions share provenance and avoid ambiguous loaded-assembly origins.

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
- MSI authoring groups concrete components under product slices rather than treating WiX `Feature` as the only product model
- the host runtime component stops any running installed `Pe.Host.exe` under `...\Pe.Tools\bin\host` and replaces that product-owned tree before `InstallFiles`
- when the installed add-in launches, `Pe.App` resolves the installed host path through the same authority

This gives installer validation a product-shaped runtime without needing ad hoc cleanup before returning to normal dev work. The host tree replacement is deliberate: .NET assemblies currently keep stable file versions, so native MSI file replacement alone can leave a stale installed host contract behind during beta upgrades.

## `pea` dev freshness

`pea` is intentionally handled differently from `Pe.Host`.

- terminal users expect `pea` to just work from a stable PATH-visible location
- `pe-dev pea install-dev` builds the repo `pea` app and mirrors the dev payload into the installed `pea` runtime root
- the stable launcher stays at `...\Pe.Tools\bin\pea\pea.cmd`
- the active payload version is selected by `...\Pe.Tools\bin\pea\current.txt`

This keeps `pea` easy to invoke while still allowing installer/user-validation flows to own the installed-shaped bootstrap.

# Open Questions

- Whether `pea` should eventually gain a richer `runtime use-installed` / `runtime use-dev` experience. The current design intentionally stays smaller: installed bootstrap plus explicit dev payload sync.
