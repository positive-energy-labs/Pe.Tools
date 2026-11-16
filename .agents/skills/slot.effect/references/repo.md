---
scope: repo
---

# Effect in Pe.Tools

A port rewrites this file under the same headings. It holds facts that change only by decision, never a census of the code. Existing code is not cited here, because the target in `SKILL.md` is what code converges to.

## Pin and clones

- `ts/package.json` pins `effect` exactly, with `@effect/platform-node` and `@effect/atom-react` in step. ADR 0029 makes a bump a wave of its own.
- Installed sources: `ts/node_modules/.pnpm/effect@<pin>/node_modules/effect/src/` and `.../ai-docs/src/`.
- Upstream: `.explore/effect` follows `Effect-TS/effect` and carries release tags. Make the pin's worktree with `git -C .explore/effect worktree add <scratch dir>/effect-<pin> effect@<pin>`.
- `.explore/effect-smol` is archived at a beta. Do not cite it.
- `.explore/t3code` is the largest app on v4 we can read. Its `docs/internals/effect-services.md` is commentary.

## House authority

- ADR 0029 is the law for the host: Effect is the standard library, and each request runs on one fiber.
- `docs/features/host/EFFECT-V4-PATTERNS.md` holds the v3-to-v4 renames and the pinned version's behaviour that bit us. Read it before writing from memory.
- `docs/features/host/LEDGER.md` records each adoption, rejection and shortfall, and the rulings on failures and lint.

## Pe's reasons

- Three owners, never blurred. The C# libraries own domain and native meaning. Feature composition in the host interprets domain receipts and the policy for consumed intent. Shared host owners enforce admission, dispatch, durable recovery and guarded publication. A feature that needs its own execution framework shows that a shared owner is missing.

- A transport is thin because Pea reaches one capability through host routes, MCP tools and the CLI, and libraries own Revit meaning while every door stays a thin adapter.
- `kind` on the wire is `HostErrorKind`, owned by the C# operation contracts, and Pea reads it as text. `problem` is the closed code the host mapper keys on. `notDispatched` is retry authority, so it is always a producer-set field with a test.
- A status from the C# bridge is decoded into a closed outcome where the frame arrives.

## Edges and the gate

- The run-family marker is `// effect-edge: <reason>`, and the reason vocabulary lives in `ts/scripts/oxlint-effect-edge.js`.
- The ratchet for unconverted code is `ts/tests/repo-guards/src/effect-islands.baseline.json`.
- The gate is `pnpm verify`, which runs `vp lint --type-aware`. Effect's diagnostics join it as the `effecttsgo` oxlint plugin from `@effect/tsgo`, by ruling of 2026-11-15.
- Until `@effect/vitest` lands, a host test runs Effects through `apps/host/tests/effect-test.ts`.
