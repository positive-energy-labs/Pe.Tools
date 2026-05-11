# pea app

`pea` is the Pe Agent command surface. It is user/agent-facing and talks to `Pe.Host` through the generated TypeScript host client.

## Commands

```powershell
pea --help
pea agent
pea host status
pea host logs --target revit --tail 50
pea script bootstrap --workspace default
pea script execute --source-path src\SampleScript.cs
```

## Local development

```powershell
pnpm install
pnpm run check
pnpm run build
pnpm run pea --help
```

Development scripts mirror the public command shape:

```powershell
pnpm run agent
pnpm run status
pnpm run bootstrap
pnpm run execute -- --source-path src\SampleScript.cs
```

## Configuration

`pea` resolves host/workspace facts in this order:

- `--host`, then `PE_TOOLS_HOST_BASE_URL`, then the local default host URL
- `--workspace`, then `default`
- `--workspace-root`, otherwise the root returned by `Pe.Host` workspace bootstrap

Prefer host-reported paths over hardcoded TypeScript assumptions. Use `--workspace-root` only as an explicit local override.
