# @pe/runtime

`@pe/runtime` owns the protocol-neutral runtime seam used by Pe.Tools agent transports. It should not know whether the caller is the user-facing Pea product or the private `peco` development agent.

This package owns:

- generic runtime factory/handle contracts;
- generic auth descriptors and protocol auth projections;
- runtime session registry and protocol session lifecycle helpers;
- runtime event contracts and ACP / AG-UI event mapping;
- protocol-neutral tool metadata contracts used by app-owned catalog projections;
- local protocol transport helpers for ACP and AG-UI servers.

This package does **not** own:

- Pea product auth policy, Host workspace bootstrap, product skills, or product tools;
- `peco` repo-root discovery, Peco model defaults, repo skills, or live-loop policy;
- app CLI identity or Gunshi root command wiring.

App packages own product policy over native Harness configuration:

- `source/pe-tools/apps/pea/src/runtime.ts` builds the Pea runtime factory.
- `source/pe-tools/apps/peco/src/runtime.ts` builds the `peco` runtime factory.

Tool packages own product-specific tool IDs and catalogs. Runtime factories may seed a `RuntimeToolCatalog` into `createRuntimeHarness`; runtime events carry the resolved metadata for protocol adapters. ACP uses that metadata before fallback name buckets. AG-UI stays on its existing event names and does not receive a raw Mastra event side-channel in this slice.

Protocol adapters should receive an app-owned `RuntimeFactory` instead of dispatching on `"pea" | "Peco"` themselves. Compatibility aliases may exist temporarily, but new code should use the generic `Runtime*` names. If a factory supplies a custom `createHandle`, it must construct sessions with the same tool catalog when it wants event enrichment.

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
