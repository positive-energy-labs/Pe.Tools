# Mastra 0.25 Prune

Context captured after the MastraCode 0.25 session split migration.

## Direction

- Prefer MastraCode `Session` APIs over Pe wrappers for thread, model, mode, permissions, run control, and events.
- Prefer deleting Pe ACP/web/workbench layers over keeping compatibility shims.
- Accept public API breaks during this greenfield phase when a Pe wrapper exists only for a deleted transport.

## Applied Pruning

- Removed Pea and Peco web entrypoints and local ACP/server surfaces.
- Removed `@pe/runtime` ACP, protocol session, runtime kernel, workbench, protocol status, and generic runtime factory/descriptor layers.
- Replaced Pea's factory-then-create runtime API with direct `createPeaRuntime()`.
- Deleted orphan `@pe/acp-client` and `@pe/workbench-core` packages plus the stale web workbench probe doc.
- Deleted the orphan `apps/website` workbench client and removed the root `dev` script that targeted it.
- Shrunk MastraCode model resolution to the verified public path: `createMastraCode().resolveModel`.

## Known Regressions

- Pea no longer exposes `createPeaRuntimeFactory()` or `createPeaProtocolRuntimeFactory()`.
- Pea/Peco no longer serve custom web or Pe-owned ACP protocol modes.
- The root workspace no longer has a `dev` script for the deleted website workbench.
- The deleted workbench packages intentionally break any untracked local consumer still importing them.
