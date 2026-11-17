---
status: accepted
---

# A product lives in one folder, with one package per runtime

## Context

The ducts product grew a fans product. Later, fans split into its own route. The code for the two products is in many places that do not agree with each other: `ts/packages/ducts-domain`, `ts/packages/agent-contracts/src/ducts-*.ts`, `ts/apps/host/src/ducts-*.ts`, `ts/apps/web/src/ducts/sheet/` (fans UI), `ts/apps/web/src/ducts/proto/e/` (the production `/ducts` screen) and `ts/apps/web/src/fans/`. Of the about 45,000 production lines for ducts and fans, only 893 are in a folder named `fans`.

Four sealed readers examined the repo at 5209e50c, and all four found product meaning outside any product home (receipts: `.artifacts/runs/host-leak-20261116/`). The worst places are:

- the host's ducts files, where 493 of 2,314 lines are meaning;
- the other host files, where 1,290 lines are meaning, for example the takeoff assemblies and U-values at `ts/apps/host/src/takeoff-actions.ts:527`;
- `agent-contracts`, where about 2,300 lines are product rules, for example `DUCTS_DEFAULT_CRITERIA`;
- Pea's tool layer, `mcps`, where 700 lines are product rules.

Only ducts has a domain package. Families, takeoff, schedules and Pods do not have one, so their rules went into the host and into `agent-contracts`.

The owner (kaitpw, 2026-11-16) said: "Im tempted to even ask for going so far as fitting a products entire code in a single dir ... domain web and host all feel like they should be colocated". The owner also said: "host should never have had specific product code in it to begin with, but its impossible to enforce when one product spans so many different locations with no rhym or reason". When asked about this convention, about a domain package for each product, and about where to record the leaks, the owner said: "yes to both. shared base is still ducts, pilot can b fans".

## Decision

- Each product's TypeScript is in one folder, `ts/products/<product>/`. The folder holds one workspace package for each runtime:
  - `domain/` holds pure rules and calculations, with no DOM and no host imports;
  - `web/` holds the route and its screens;
  - `host/` holds thin handlers;
  - `contract/` holds the product's published schemas and its guide text.
- Each product has a `domain/` package. Domain meaning never goes into the host, into `agent-contracts`, or into `mcps`.
- Package dependencies set the boundaries:
  - `web/` and `host/` can import `domain/` and `contract/`, but they cannot import each other;
  - peers import each other only through declared `contract/` exports;
  - products import the shared `ducts` base through its declared exports, layer by layer and downward: web to web, domain or contract; host to host, domain or contract; domain to domain or contract;
  - any layer may import any product's `contract/`, including the base contract. The base imports no peer domain, web or host. Domain never imports web or host.
- The ducts family has three folders:
  - `ducts` is the shared base, with no route. It holds fitting physics, the network graph, the leg pricer, and the inputs, presentation and host acquisition that both products use;
  - two products come out of ducts: `duct-systems` (network health and heal; kaitpw 2026-11-16: "system on its own is not a good id ... a plumbing and electrical system product will comme at some point", then "duct-systems") and `fans`.
- Generic code does not name a product, except at real composition and generated registration sites. Generic code is `ts/apps/host/src`, `ts/apps/web/src/route`, `ts/apps/web/src/shell`, `runtime`, `mcps` and `agent-contracts`. `product-names.guard.test.ts` enforces a per-file mention baseline that only shrinks; the P4-fix-layer-guard work on `product-layers.ts` checks product imports. Existing name debt is [shared-base name cleanup](../features/ducts/LEDGER.md#owed), not an exemption from enforcement.
- A path does not use a status word or a variant letter. That means no `proto`, `old`, `new`, `v2` or single-letter folder name. A file in one product does not start with the name of a different product.
- Native C# stays in `Pe.Revit.*` and `Pe.Shared.*`, because one folder cannot hold two toolchains.
- `fans` is the pilot. It moves in the fans crusade cutover. Other products move later, each as an Owed line in its own ledger.

## Consequences

Amendment, 2026-11-17 (RULES.md, owner-queue item 8): kaitpw ruled "yes, layer by layer through the shared base; products talk only through contract." This clarifies the shared-base exception already stated in this ADR, rather than reversing its decision. The root clarified that downward imports are allowed. A facade solely to forbid a downward base import has no second consumer and is rejected. The later root ruling retains the original shrink-only name baseline: new files and increased per-file counts fail, and a reduction requires lowering the recorded count. [shared-base name cleanup](../features/ducts/LEDGER.md#owed) tracks existing names to zero.

- Leaks are easier to see, because a product rule outside its folder is visible in review and the guard counts it.
- The web route registry (`ts/apps/web/src/route/registry.ts:11`) must also find routes in `ts/products/*/web/route.ts`. The host must get a self-registration seam for command executors. Today `ts/apps/host/src/command-registry.ts:58` builds those executors by hand.
- Each product package needs its own tsconfig. This cost is accepted, because the tsconfig is what keeps DOM out of `domain/`.
- `docs/ARCHITECTURE.md` describes the layout by apps and packages. It must change when the pilot lands.
