# 0059: The product declaration owns the contract

Date 2026-11-20. Status accepted. Evidence in `.artifacts/runs/product-decl-20261120/RULES.md` (rulings 1 and 2, SM30 and SM31/SM32).

## Context

Product pointers in package manifests spread the contract across its consumers. A shared `productGateway` made generic host code carry product-specific functions. The SM30 reading compared retaining a typed gateway with giving each member a single home. Evidence in `.artifacts/runs/product-decl-20261120/muse-sm30/reading.md`.

## Decision

Each product declares one TypeScript contract with `product()`. The host binds its bodies with `implement()`, the web binds its routes with `screen()`, and generated registration assembles the declarations. A command declares its home-to-cell `writes` map. A native home is declared in C# and referenced from TypeScript.

The owner chose shape B with C2. Dissolve `productGateway` and register each member through its owning seam. The product declares captures with `emits`. The kernel stores them and supplies one capture header and receipt references.

Product-specific code and tests live under `ts/products`. Generic app and package code composes products through generated registration. The removal-only placement baseline tracks the remaining tests to move.

## Consequences

A product adds its contract and implementations in one folder. The generator derives the consumer projections. The route kernel and host journal own target admission. Page lineage from exact takings is tracked in the [Pages ledger](../features/pages/LEDGER.md).

Evidence in `.artifacts/runs/product-decl-20261120/wave/g.md` and `.artifacts/runs/product-decl-20261120/drive-90dbe51e/REPORT.md` (capture refresh overlap).
