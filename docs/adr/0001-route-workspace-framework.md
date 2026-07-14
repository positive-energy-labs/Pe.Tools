# ADR 0001 — Route-workspace framework (trichotomy core, commit primitive, session binding, Atom state layer)

Date: 2026-07-13. Status: accepted, implemented.
Evidence base: a four-plugin spike (family-types, parameter-links, settings,
schedule-grid), each driven e2e with proven Revit/disk writes, plus a 4-way
compiling state-layer bake-off (bare hook vs TanStack Query vs Effect.Atom vs
Legend State). The working docs and scratch package were deleted after this ADR
absorbed their conclusions; the full friction reports live in git history
(`source/pe-tools/docs/route-plugin-harvest.md`,
`source/pe-tools/packages/scratch-state-bakeoff`).

## Context

Four chat plugins (family-types, parameter-links, settings, schedule-grid) were built
over the route-state substrate as a pattern-harvesting spike, each driven e2e
(chat → shared UI → human approve → commit → proven Revit/disk writes). The substrate's
core model held with zero changes; everything else was hand-rolled four times.

## Decisions

1. **The trichotomy (proposal → staged → committed) is the substrate's collaboration
   grammar**, owned by `@pe/agent-contracts/trichotomy`. `staged` is a nullable presence
   object (`{ value } | null`), never a bare optional — "staged but the value is
   undefined" must be representable without a sidecar boolean (the settings
   `hasStaged` wart). Domain provenance (family-types' markdown source ref) is a
   per-route proposal EXTENSION, not core (it leaked into schedule-grid otherwise).

2. **Commit is a first-class primitive** (`defineCommitCommand`): select staged →
   block on `attention` → expand to edits (per-cell refusals stay staged) → one
   transaction → fold successes / keep failures staged → structured
   `{ applied, failures }`. Known boundary, found honestly during the port: it models
   PER-CELL PARTIAL SUCCESS. All-or-nothing atomic writes with fold-before-throw
   semantics (settings `save` with its version-token conflict flow) do not fit and
   stay plain handlers — do not force them. Candidate polish: a `verb` option so the
   block message can say "Push/Save blocked" instead of "Commit blocked".

3. **Session targeting is doc-level binding with per-command override.** Every route
   doc carries a substrate-owned `binding: { target, boundAt }`; a built-in human-only
   `bind` command (implemented by the dispatcher, never by routes) writes it; handlers
   resolve `input.target ?? doc.binding.target`. An unresolved target with >1 Revit
   session connected hard-fails — at the raw `/call` endpoint too (409 listing
   sessions), and `/call` rejects unknown body keys (400) because a body-level
   `bridgeSessionId` was once silently ignored and routed writes to the user's live
   Revit.

4. **Web state layer is Effect.Atom on v4-beta** (`@effect/atom-react@4.0.0-beta.92`,
   version-locked to the repo's effect). Chosen over TanStack Query (built for
   pull/refetch caches; fights a push-authoritative doc) and Legend State (its sync
   engine must be bypassed; generics fight; beta risk without payoff). The doc is an
   `Atom.family` over `Stream.concat(hydrate, SSE)` — one shared subscription per
   route spec; drafts are an `Option<T>` override with derived value/dirty
   (clobber-safety is structural); commands are `Atom.fn` with `AsyncResult`
   pending/error. v3→v4 Atom rename table: `docs/rework/EFFECT-V4-PATTERNS.md` §4c.

5. **Route docs are durable across host restarts** via a file-backed store
   (`packages/runtime/src/route-state-store.ts`): `route:*` session-state keys
   write through atomically to `<peaStateDir>/route-state/<resourceId>.json` and
   rehydrate (absent-keys-only) before the first read. This seam exists because
   Mastra persists thread history but resets session state; a canonical persisted
   state model would subsume it.

6. **Typed command context**: `RouteStateCommandContext<TDoc>` inferred from the route
   schema; `registerRouteState` binds handlers to `z.infer<TSchema>` — no
   `getDoc() as TDoc` casts in handlers.

## Consequences

- A new route touches: one spec file (contracts), one handler file (mcps), two
  one-line registry entries, one web plugin. Handlers contain no fold logic; plugins
  contain no reviewer JSX (shared `<CellTrichotomyReviewer>`/`<RouteWorkspaceShell>`).
- The MCP boundary keeps `coerceJsonObject` (untyped `z.unknown()` params arrive
  double-encoded from MCP clients).
- Registration is registry-module based: a new route = spec file + handler file +
  one entry in `packages/mcps/src/pea/routes.ts` (server) + one registration in
  `apps/web/src/workbench/route-chat-plugins.tsx` (web; chat enum + titles derive
  from it).
- Open (tracked, not blocking): commit `verb` option (block message says
  "Commit blocked", not the domain verb); binding chip target picker;
  `useRouteDraft` lift to an Atom family when two components must share one draft;
  snapshot staleness gates (`freshness` option exists on the commit primitive,
  unused by routes so far); `route_state` list host-revision provenance (a stale
  host silently serves yesterday's route set); coupling parameter-links
  persist+preview into one command (the "Draft changed; preview again" foot-gun);
  snapshot truncation as a dropped-row count instead of a boolean; a shared
  `withMockedHostCall` test seam for handler tests.
