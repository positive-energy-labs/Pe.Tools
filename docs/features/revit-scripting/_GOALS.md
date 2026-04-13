# Revit Scripting Goals

## North Star

Make Revit-side automation cheap to author, cheap to run, and safe to grow from quick probes into durable shared units.

## User Goals

- run a Revit script from the terminal without a VSIX
- see output and failures while the script is still running
- keep daily authoring inside one persistent workspace with working IntelliSense
- share simple scripts without turning every experiment into a repo package

## Developer Goals

- keep the supported execution surface explicit and reproducible
- separate compile-time and runtime dependency behavior
- keep host/bridge/runtime seams obvious so policy changes stay local
- preserve a future path toward source-package sharing without destabilizing the single-file lane

## Integration Goals

- allow the host, CLI, and future AI/task surfaces to target the same execution model
- keep `.csproj` as a local authoring/dependency artifact, not the long-term interchange contract
- preserve explicit policy seams for security, transaction, output, and source-shape evolution

## Non-Goals

- full package execution in this slice
- arbitrary external local file execution in this slice
- cancellation in this slice
