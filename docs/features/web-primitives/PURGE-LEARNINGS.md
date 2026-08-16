# apps/web purge — 2026-08-15

One wave of aggressive dead-code removal across `source/pe-tools/apps/web`, with evidence per cut
(import graph + `git log` + gate runs). Net **−4,932 LOC** across 14 files; `vp check` and
`vp test` (21 files / 123 tests) green at the end.

The point of this document is not the inventory — git has that. It is the second half: **which
speculation paid rent and which did not**, so the next wave builds fewer of the latter.

---

## What was deleted

### Routes and their captive components (4,785 LOC)

| File | LOC | Why it was dead |
| --- | --- | --- |
| `src/routes/docs.runtime.tsx` | 3,183 | Unlinked from index `TOOLS`; documented **another repo's** internals (Pe.Revit.Sdk loader/selector/sandbox) pinned to "as of beta.97", and its scripted scenario reenacts an incident the doc itself says was **already resolved** in beta.97. Nothing compiles against those citations, so it could only rot. |
| `src/routes/docs.target.tsx` | 1,327 | Unlinked from index `TOOLS`; the exhibit's centerpiece was the retired `TargetChip`, and THE SENTENCE is canon on every real surface. |
| `src/components/target-chip.tsx` | 275 | Retired 2026-07-14, superseded by `components/sentence.tsx`. Its **only** remaining mount was the `docs/target` exhibit above — it went with it. |

`pnpm exec tsr generate` was re-run; `routeTree.gen.ts` shed 42 lines.

### Dead symbols in live files (147 LOC)

| Symbol(s) | File | Why |
| --- | --- | --- |
| `TONE_STYLE`, `ageLabel` | `src/host/target-ui.tsx` | Orphaned *by* the docs-route deletion — the exhibits were their last callers. Also dropped the now-unused `CSSProperties` import. |
| `loadFixtureExtract`, `FIXTURE_SOURCE_LABEL` | `src/rhvac/fixture.ts` | Declaration-only. The fixture lane calls `loadFixtureTakeoff`; the test reads the extract JSON directly. |
| `DIRECTIONS`, `RhvacAssemblyOption`, `RhvacAssemblyCatalog`, `isDecisionFlag`, `LEGACY_STATE_FLAG_KINDS` | `src/rhvac/types.ts` | The assembly-catalog block was a web-side mirror of an `rhvac.assemblies` op the web never calls. `DIRECTIONS` was a label table for a field stored as a raw number. |
| `useRouteDraft`, `RouteDraftHandle` | `src/workbench/route-state.tsx` | A generic save/discard draft hook with **zero** call sites. See the ADR note under *Ambiguities* below. |
| `BridgeBusyNotice` | `src/host/issues.tsx` | One-line wrapper over `HostIssuePanel`, never mounted. |
| `joinUniqueIds` | `src/parameter-links/model.ts` | `ids.join("\n")`, never called. |
| `FfLoweredAction`, `FfParameterProvenance`, `FfResolvedParameter`, `FfDiffSummary`, `FfApplyReceipt`, `FfProjection` | `src/host/familyfoundry.ts` | Six unreferenced one-line aliases of generated contract namespaces. The six *used* aliases stay — the file's "one short vocabulary" rationale earns its place only for vocabulary someone speaks. |

### Dependencies

`@t3-oss/env-core` and `@tanstack/router-plugin` — zero imports anywhere in `src`, `tests`, or
`vite.config.ts`. Routing plugin duties belong to `tanstackStart`; route generation belongs to the
`@tanstack/router-cli` devDep. Both removed from the lockfile cleanly.

### Docs

- `THEMES.md` gaps #1 and #3 struck through as CLOSED (both now fully resolved); gap #6's route
  count corrected (7 of 11, was 6 of 13).
- `docs/adr/0001` open-items list rewritten to stop naming the deleted `useRouteDraft`.

---

## Kept despite looking dead — with the named reason

| Item | Why it stays |
| --- | --- |
| `Peek` (`src/takeoff/atlas.tsx`) | Protected: posterity comment, unmounted by decision today. |
| `route:family-types` contracts + pea handlers + inline renderer | Protected: family SHIMS shim 7 — pea's tools still target the slice. `WORKSPACELESS_ROUTES` already prevents offering a 404 workspace. |
| `src/ops/synthetic.tsx` | **Alive, census was misread.** `routes/ops.tsx` mounts `SyntheticRunner`, and all three `ops/glance/*` modules type against `SyntheticOp`/`SyntheticViewProps`. "Glance moved to real ops" meant the *deps* became real host ops — the runner that fans them out is exactly what makes that work. |
| `src/takeoff/proto/**` (`mock.ts`, `mock-geo.ts`, `fixture-world.ts`) | **All three reachable.** `takeoffs.tsx → useFixtureWorld → ./mock-geo → ./mock` + `rhvac/fixture`. `mock-geo` is imported *relatively*, which is why a path-shaped grep (`proto/mock-geo`) shows zero hits — a near-miss worth remembering. |
| `src/rhvac/` (takeoff half + extract normalizer) | `parseTakeoffTsv`/`mergeTakeoffLevels`/shape helpers feed `?source=fixture`. `normalizeExtract`/`RhvacExtract` are kept alive only by `takeoff.test.ts` — but that test is a **data-integrity proof over committed fixture data** (room-map candidates resolve to parsed polygons; 150 unique room identifiers). Per repo posture, a proof seam only dies when its replacement preserves the proof. |
| `src/lab/estimate.ts` | Real consumer: `family/doc-pane.tsx`. `src/lab/` contains nothing else. |
| `src/grounded-doc/**` | All four consumers real: `routes/doc-lab.tsx`, `routes/design-system.tsx`, `family/doc-pane.tsx`, and the `api/pdf-audit/*` server routes. |
| `src/host/target-scope.ts` | Ambiguous — kept. See below. |
| `src/takeoff/**` dead symbols | Protected zone. Flagged, not cut — see below. |

### Routes that are neither index-linked, a chat workspace, nor an exhibit

Named as required, all **kept**:

- `/data-tables` — the `revit.apply.schedule` table-authoring lane, actively in flight.
- `/design-system` — the living style reference; the only mount for several `ui/` primitives.
- `/parameter-links` — real surface with a tested model (`parameter-links/model.test.ts`), but
  untouched since 2026-07-14. The most likely next thing to die if it stays unlinked.

All three are reachable only by typed URL. **Undiscoverable is the leading indicator of dead** —
see the pattern below.

### Flagged inside the protected `src/takeoff/**` zone (not cut this wave)

Declaration-only, zero callers, listed so the next takeoff pass can decide:
`readStatus`, `readViews`, `readZones`, `applyRegistry`, `readZoneRegions` (`takeoff/host.ts`);
`DEFAULT_ARTIFACT_DIR` (`takeoff/model.ts`); `openDecisions` (`takeoff/proto/mock.ts`);
`ZonePlan`, `PlanLegend` (`takeoff/zone-plan.tsx`).

That is **five of the fifteen** exported readers in `takeoff/host.ts` — the script-per-op wrapper
layer is being generated faster than it is consumed.

### Ambiguities recorded rather than resolved

- **`src/host/target-scope.ts`** — a generalized `(threadId, consumerId)` scope book with exactly
  one consumer (`chat-target.tsx`), which self-describes as a one-entry book. The tenancy half
  (`isInherited`, `clearScoped`, the inheritance branch in `readScoped`) is exercised **only by its
  own test**. Kept because it is 84 LOC of pure, fully-tested functions and its header names three
  concrete futures with the migration path for each — the cheapest possible form this bet could
  take. But note the tell: *a test is not a consumer.* Green tests over an unused generalization
  prove the code works, not that anyone needs it. Revisit if a second consumer has not appeared by
  the next wave.
- **`useRouteDraft` vs. ADR 0001** — the ADR listed "`useRouteDraft` lift to an Atom family when
  two components must share one draft" as tracked-open work, which reads like a named future
  consumer. It is not: it is a note on how to *evolve* the hook if it ever got used, written while
  it had zero call sites. Deleted, and the ADR line rewritten to describe the need rather than the
  artifact. Rebuild it against a real second consumer.

---

## LEARNINGS

### Patterns that made code die fast here

**1. Exhibits outlive their subject.** The single largest cut (4,510 LOC across two routes) was
documentation-as-UI. `docs/target` was built to explain targeting and ended up as the last mount of
the very component targeting had replaced — the exhibit kept a corpse warm and made the retired
chip look load-bearing to a grep. `docs/runtime` documented a *different repo*, pinned to a version
string, reenacting a bug that was already fixed. Neither had any compile-time tie to its subject,
so nothing could tell them they had gone stale.

> An exhibit needs an owner and an expiry, and it must import the thing it explains rather than
> re-describing it. `docs/target` actually did the former (it imported `host/target`) — which is
> why it never *broke*, and why it survived a month past its usefulness. **Importing the live model
> protects an exhibit from drifting; it does not protect it from becoming pointless.** Only the
> subject's retirement can decide that, and someone has to be watching.

**2. Undiscoverable surfaces rot silently.** Every route deleted this wave was unreachable from the
index. Of the routes that remain unlinked, the one untouched longest (`/parameter-links`,
2026-07-14) is exactly the one most at risk. Reachability from the product's own front door tracks
liveness better than any timestamp: if nobody can navigate to it, nobody notices it is wrong.

**3. Generalizations with one consumer, built for futures nobody scheduled.** `useRouteDraft`
generalized save/discard for zero callers. `target-scope`'s inheritance policy generalized tenancy
for one. The assembly catalog in `rhvac/types.ts` mirrored a host op the web never calls. Each cost
little individually; together they teach the same lesson — **the second consumer is the evidence,
and nothing else substitutes for it.** Not a docblock naming three futures, not a passing test, not
an ADR line.

**4. Type aliases and wrapper layers accrete faster than they are consumed.** Six of twelve `Ff*`
aliases and five of fifteen `takeoff/host.ts` readers were never referenced. When a file's job is
"one alias/wrapper per contract member", the layer gets filled out for symmetry rather than for
need, and completeness masquerades as design. Generate these on demand, not in sets.

**5. Mirror types quietly lose to the real contract.** `src/rhvac/types.ts` defines `RhvacExtract`;
the live takeoffs lane actually consumes `RhvacExtractData` from `@pe/host-contracts`. The local
mirror was superseded by the generated contract and survived only via a fixture test. When a typed
contract lands for a domain, the hand-written mirror becomes dead weight the same day — but nothing
fails, because both still compile.

### Speculative seams that proved right

- **`ops/synthetic.tsx`** — the fan-out runner was built before the glance views had real ops
  behind them. It paid off precisely because the seam was *behavioral* (fan out N deps, report
  per-dep status and one "as of" timestamp), not structural. When the deps became real host ops,
  the runner needed no change and three glance modules came along for free. **The census even
  misread this as dead; the import graph did not.**
- **`takeoff/proto/**` + the `rhvac` takeoff half** — a fixture stack that outlived its prototype
  *and earned it*, because `?source=fixture` is a documented, user-selectable adapter with an
  explicit "never a fallback" rule, not a leftover scaffold. A fixture lane that a real UI switch
  mounts is a feature; one that only a deleted prototype mounted would have been debris.
- **`grounded-doc/**`** — three unrelated consumers (a lab route, the design system, a family pane)
  plus server routes. Multiple independent consumers is the same evidence as the second-consumer
  rule above, arrived at honestly.
- **`master-table/`, `ui/pane.tsx`, `lib/affine-frame.ts`** — landed today, already multi-consumer.

### The through-line

Every good seam on this list was validated by **a consumer that arrived**, and every bad one was
justified by **a consumer that was described**. The reliable test at authoring time is not "can I
name a future user?" — that is always answerable — but "what will make this obviously wrong if the
future never comes?" Code with no such tripwire (an exhibit nothing links to, an alias nothing
imports, a hook only its own test calls) does not fail; it accumulates, compiles, and passes.

### Method note for the next wave

Grep the import graph by **symbol**, not by path. Two near-misses this wave: `proto/mock-geo` looked
orphaned because its only importer uses a relative `./mock-geo`, and `ops/synthetic` looked
superseded because a prose census said so. Also distinguish three states, because only the third is
safe to cut blind: *exported and used elsewhere* → live; *exported but only used inside its own
file* → drop the `export`, keep the code; *declaration-only* → dead. And always include `tests/` in
the sweep — `tailFollowState` and `ScrollMetrics` read as dead against `src/` alone.
