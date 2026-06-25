# @pe/runtime

`@pe/runtime` is the thin shared helper package under Pe.Tools agent runtimes. It should not rebuild MastraCode protocol/session surfaces, and it should not know whether the caller is the user-facing Pea product or the private `peco` development agent.

This package owns:

- runtime handle contracts for app-owned Harness sessions;
- generic auth descriptors and Pe auth profiles;
- storage and memory profile helpers;
- request-context and system-prompt capture helpers;
- protocol-neutral tool metadata contracts used by app-owned tool catalogs.

This package does **not** own:

- Pea product auth policy, Host workspace bootstrap, product skills, or product tools;
- `peco` repo-root discovery, Peco model defaults, repo skills, or live-loop policy;
- app CLI identity or Gunshi root command wiring;
- ACP, AG-UI, browser workbench servers, or compatibility adapters over MastraCode sessions.

App packages own product policy over native Mastra/Harness configuration:

- `source/pe-tools/apps/pea/src/runtime.ts` creates the Pea runtime/session.
- `source/pe-tools/apps/pe-code/src/runtime.ts` creates the `peco` MastraCode runtime/session.

Tool packages own product-specific tool IDs and catalogs. Runtime helpers may seed a `RuntimeToolCatalog` into `createRuntimeHarness` only when Pe-owned access policy or metadata is still needed.

## Development

Install dependencies:

```bash
vp install
```

Run format, lint, and type checks:

```bash
vp check
```

Run tests:

```bash
vp test
```

Build the package:

```bash
vp pack
```
