# Pe.Tools runtime acceptance

Product-owned executable implementation of the consumer-neutral
`Pe.Revit.Sdk/RUNTIME_ACCEPTANCE.md` contract.

## Profiles

- `deterministic` is the release regression. It drives only the pinned `pe-revit` JSON CLI and
  Pe.Tools public HTTP routes. It never converges or restarts RRD implicitly. Its one explicit
  convergence gate calls `host.ops.catalog`, reverses that operation's ordering implementation,
  Hot Reloads, proves the same RRD session now returns reversed behavior, then restores and proves
  the original behavior while both sandbox lanes remain live.
- `showcase` is a real Pea chat turn. Its transcript is rubric-checked, but the model turn is not
  called deterministic.

## Run

From `Pe.Tools`:

```powershell
pnpm --dir source/pe-tools acceptance -- --plan
pnpm --dir source/pe-tools acceptance -- --profile deterministic `
  --sdk-root ..\Pe.Revit.Sdk
pnpm --dir source/pe-tools acceptance -- --profile showcase
```

The deterministic profile requires one fresh Pe.Tools RRD for the requested year, the candidate
Pe.Tools product already installed and verified, matching SDK/CLI pins, and no irreplaceable
documents in acceptance-owned processes.

Installed receipt verification runs in the authority gate, before a source sandbox deploys the
SDK's shared selector. The installed runtime gate remains later so source and installed sandboxes
must still coexist; it does not reclassify the active selector as install corruption.

It refuses a dirty consumer by default because temporary worktrees test `HEAD`. `--allow-dirty` is
for development only; the evidence records the dirty status and is not released-artifact proof.

Evidence defaults to `.artifacts/runtime-acceptance/<run-id>/`. `verdict.json` is the summary;
every CLI envelope, HTTP request/response, stderr stream, gate transition, and cleanup result is
also retained. The runner fails at the first bad assertion and still ordinarily stops only the
sandboxes it created and removes only its disposable worktrees.

## Ownership seam

The SDK owns lifecycle, identity, JSON envelopes, and the close verifier. Pe.Tools owns concrete
projects, fixtures, host/service routing, scripting, installed-product behavior, worktree cases,
and Pea. The runner is deliberately not a reusable workflow engine: another consumer should write
its own thin product proof against the same SDK contract.
