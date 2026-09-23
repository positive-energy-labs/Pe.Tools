# 0012 — One verification entrypoint

Date: 2026-09-23. Status: accepted.

## Context

Five of six crusade lines on 2026-09-22 reported the same friction: root `vp test` bypassed the web and host lane setup, `vp check` on touched paths missed contract consumers in other packages, the ops-catalog guard rebuilt the desktop dotnet graph on every guard run (200 to 330 s, output hidden), guards starved under parallel load, and no tool named dead source. Nothing in CI ran any of it. Every agent invented its own proof command and reported "vp check clean" from a run nobody could repeat.

## Decision

`pnpm verify` from `ts` (`ts/scripts/verify.ts`) is the one proof of a change, run by CI and named by the `execute` skill. It runs, in order, with full output and stopping at the first red: the workspace `vp check`, `knip` against `ts/knip.json`, every package's own `test` script, then the repo guards serialized.

The ops-catalog guard never builds dotnet. `pnpm codegen` records `ops-catalog.sha`, a hash of every non-test C# source, beside `host-ops.generated.ts`; the guard compares that hash to the sources. `codegen:check` remains the slow lane that proves the generator itself.

A test's lane is its path. `apps/host/tests/**` and `apps/web/src/routes/-*.test.tsx` are surface lanes; a web or host test that parses through a contracts package is a contract test; every other web test is scaffold and counts against the ceiling in `test-bar.test.ts`.

## Consequences

- Any C# edit demands one `pnpm codegen` before `pnpm verify` passes, even when no op changed. The narrower hash needs the op graph, which only the dotnet build knows.
- Dead source is `knip --fix` plus one `vp check --fix`; the guard is knip itself inside `pnpm verify`.
- `pnpm ready`, `typegen:check`, the root `codegen:check`, and the route-primitive rule that forced a dead `export const manifest` in every route file are gone.
- A claim that names any other command as its proof is UNPROVEN.
