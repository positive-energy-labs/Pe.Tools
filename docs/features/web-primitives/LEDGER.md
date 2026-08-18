# web-primitives ledger

Scope: shared primitives and cross-route patterns in `source/pe-tools/apps/web/src`.

## Decided
- 2026-08-15 — `components/master-table/` is the canonical table (multi-sort, facets over ALL rows, cluster headers, tested pure core); every other table implementation is a migration target, not a peer. Atlas migrated onto it and its fork + `takeoff/cells.tsx` were deleted.
- 2026-08-15 — Proposals get a shared *vocabulary* (state names, tone budget, dot/badge/queue, receipt shape), NOT one store. The three commitment models (`/family` FieldState, `/takeoffs` write-through decide, `/families` plan-as-lens) stay per-route; only the language unifies.
- 2026-08-15 — `components/ui/pane.tsx` landed as the pane primitive (`Pane`, `PaneSplit`, `PaneWorkspace`, keyboard-accessible handles, persist + controlled collapse); atlas is first consumer.
- 2026-08-15 — `lib/affine-frame.ts` is the one camera seam: finite bounds, union, uniform fit, Y-up/Y-down, renderer-neutral matrix, exact forward/inverse mapping. Domain projection and rendering stay outside it.
- 2026-08-15 — A stateful pan/zoom camera was deliberately NOT added to `affine-frame`; compose one over the frame when a real user-controlled camera earns it.
- 2026-08-15 — Purge wave: −4,932 LOC across 14 files, `vp check` + `vp test` (21 files / 123 tests) green. Two `/docs/*` exhibit routes and `target-chip.tsx` deleted; `@t3-oss/env-core` and `@tanstack/router-plugin` dropped (zero imports; routing belongs to `tanstackStart`, generation to `@tanstack/router-cli`).
- 2026-08-15 — The second consumer is the only evidence a seam is real. A docblock naming three futures, a passing test, and an ADR line are all consumers that were *described*, not consumers that *arrived*.
- 2026-08-15 — Authoring test for any new seam: not "can I name a future user?" (always answerable) but "what makes this obviously wrong if the future never comes?" Code with no tripwire doesn't fail — it accumulates, compiles, and passes.
- 2026-08-15 — Undiscoverable is the leading indicator of dead: every route deleted this wave was unreachable from the index `TOOLS` list. Reachability from the front door tracks liveness better than any timestamp.
- 2026-08-15 — Kept-despite-looking-dead, with reasons: `Peek` (posterity, unmounted by decision); `route:family-types` contracts + pea handlers (family SHIMS 7, `WORKSPACELESS_ROUTES` prevents a 404 workspace); `ops/synthetic.tsx` (alive — see Tried); `takeoff/proto/**` and the `rhvac` takeoff half (`?source=fixture` is a user-selectable adapter with a "never a fallback" rule); `rhvac` extract normalizer (kept alive by `takeoff.test.ts`, which is a data-integrity proof over committed fixture data — a proof seam dies only when its replacement preserves the proof); `lab/estimate.ts`, `grounded-doc/**` (real consumers).
- 2026-08-15 — `src/host/target-scope.ts` kept though its tenancy half is exercised only by its own test: 84 LOC of pure tested functions whose header names concrete futures with migration paths — the cheapest form the bet can take. A test is not a consumer; revisit if no second consumer appears next wave.
- 2026-08-15 — Purge method for the next wave: grep the import graph by **symbol**, not path; distinguish *used elsewhere* (live) / *used only in its own file* (drop the `export`, keep the code) / *declaration-only* (dead, safe to cut); always include `tests/` in the sweep.

## Tried & rejected
- 2026-08-15 — Documentation-as-UI exhibits (`docs/runtime` 3,183 LOC, `docs/target` 1,327 LOC): 4,510 LOC of the single largest cut. `docs/target` *did* import the live model, which is why it never broke and why it survived a month past usefulness — importing the live model protects an exhibit from drifting, not from becoming pointless. `docs/runtime` documented another repo's internals pinned to "as of beta.97" and reenacted a bug already fixed in beta.97. An exhibit needs an owner and an expiry.
- 2026-08-15 — `useRouteDraft`/`RouteDraftHandle`: a generic save/discard draft hook with zero call sites. ADR 0001 listed "lift to an Atom family when two components share one draft" as tracked-open work, which *read* like a named future consumer but was a note written while the hook had zero callers. Deleted; ADR line rewritten to describe the need rather than the artifact. Rebuild against a real second consumer.
- 2026-08-15 — Web-side mirror types lose to generated contracts silently: `rhvac/types.ts`'s `RhvacExtract` was superseded by `RhvacExtractData` from `@pe/host-contracts` the day the contract landed, but nothing failed because both compiled. Also deleted: the `RhvacAssemblyOption`/`Catalog` block mirroring an `rhvac.assemblies` op the web never calls, and `DIRECTIONS` (a label table for a field stored as a raw number).
- 2026-08-15 — Symmetric alias/wrapper layers: 6 of 12 `Ff*` aliases in `host/familyfoundry.ts` and 5 of 15 exported readers in `takeoff/host.ts` had zero references. When a file's job is "one alias per contract member", it gets filled out for symmetry, and completeness masquerades as design. Generate on demand, not in sets.
- 2026-08-15 — Prose-census-based deletion: `ops/synthetic.tsx` was misread as dead ("glance moved to real ops" meant the *deps* became real ops — the fan-out runner is what makes that work; `routes/ops.tsx` mounts `SyntheticRunner` and all three `ops/glance/*` type against it). Path-shaped grep also missed `proto/mock-geo`, imported relatively as `./mock-geo`. The import graph beat the prose census both times.
- 2026-08-15 — Other declaration-only cuts: `TONE_STYLE`/`ageLabel` (`host/target-ui.tsx`, orphaned by the docs-route deletion), `loadFixtureExtract`/`FIXTURE_SOURCE_LABEL` (`rhvac/fixture.ts`), `BridgeBusyNotice` (`host/issues.tsx`), `joinUniqueIds` (`parameter-links/model.ts`).
- 2026-08-15 — Speculative seams that *paid* (counter-examples, don't re-litigate): `ops/synthetic.tsx` — the seam was behavioral (fan out N deps, per-dep status, one "as of"), not structural, so real ops needed no change and three glance modules came free; `grounded-doc/**` — three unrelated consumers plus server routes, arrived at honestly.

## Owed

### Bugs, sharp and now
- `setBusy(null)` outside `finally` ×3 in `families.tsx:704-783` — a thrown apply wedges the route busy forever. (verify)
- `PROFILE_READ_LIMIT = 40` silently slices in `families.tsx:382` while its docblock promises "nothing truncates silently". (verify)
- `--radius-sm` computes to a negative value (`styles.css:157`); Google Fonts is a remote blocking `@import` (`styles.css:1`). (verify)

### Duplication to collapse
- `timeAgo` ×6 copies (`family/live.tsx`, `schedule-grid.tsx`, `settings.tsx`, `instances.tsx`, `host/target-ui.tsx`, schedule-grid plugin), plus takeoffs' `.slice(0,10)`. (verify)
- Esc-handler with input-guard ×3, each with a different guard list. (verify)
- `ops/primitives.tsx:213` `DataTable<Row>` is a second, incompatible `Column<Row>` interface with 12 consumers; hand-rolled tables also in `data-tables.tsx`, `schedule-grid.tsx`, `instances.tsx`, `ops.tsx`, `parameter-links/Evaluation.tsx`, and families' decision-queue + receipts tables. (verify)

### Capabilities the master table must absorb before it can abolish the rest
- Multi-select selection model — families hand-rolls `pickedIds: Set<number>` in a cell; single cursor is already covered by `activeKey` + `onVisibleChange`. (verify)
- Cell width control — only a `width` utility-class string today. (verify)
- URL-addressable filter/sort/query state — component-local `useState` today, invisible to the route, the URL, and any chat plugin. (verify)
- Proposal-aware cells (blocked on the shared proposal vocabulary above).
- (Already covered, don't rebuild: editable cells via `master-table/cells.tsx`, first-col lock via `Column.lock`.)

### Primitives still owed
- One `useVerb`/`useRun` hook: serialized verbs (one host transaction at a time is already the law), busy label + elapsed seconds, error channel, receipt firing — replaces three idioms plus eight hand-rolled brackets and the copy-pasted receipt `useState`.
- `/takeoffs` is the last `Sentence` holdout: it reimplements a full-screen `TargetGate` over the same `useTarget`/`mintSelector` primitives and prints its addressable URL as raw text. End state (family SHIMS 3): every plugin route declares its sentence via config.
- Finish the honesty-chrome extraction: one Seam/Live chip (two idioms today — children-based vs op-based), one `STATE_META` (takeoffs still uses the original, families consumes the `master-table/cells.tsx` extraction), and write the one-alarm hue budget into the design-system route — it is currently enforced only by taste.
- Per-domain host-call façades on the `host/familyfoundry.ts` pattern (83 LOC, typed façade over `callHostRpc`), plus universal `HostIssuePanel` adoption — its good 7-variant error UI is used by only 4 of 11 surfaces. Today: five inline `callHostRpc` sites and five non-`/call` fetch paths with ad-hoc error handling.
- Write the route pattern into `apps/web/AGENTS.md` (currently 3 lines), not a framework: route = adapter (world + verbs); feature dir = model + view; seam interface for the store; ONE spelling for the fixture lane (`?mock` vs `?source=fixture` — pick one); state-lane choices (react-query for host reads, route-state for agent-shared docs, `useState` for session ephemera).
- Token dialect sweep — prerequisite polish for every other primitive: pick Tailwind utilities over tokens, promote missing type steps to utilities, then sweep. Three dialects today (shadcn tokens / paper `var(--paper)` aliases / raw inline `style`), `ops/**` never adopted the `--color-cat-*` utilities, `sentence.tsx` carries 26 inline styles, and the design-system exhibit itself has the highest arbitrary-px count (28).
- Resolve whether `SidePane` (6 consumers, overlay collapse) and `PaneSplit` remain two primitives once chat, the family reshape, and the FOM/BOD tool land on `pane.tsx`.

### Discoverability and rot risk
- `/` index `TOOLS` lists 7 of 11 routes — `/data-tables`, `/design-system`, `/parameter-links`, `/schedule-grid` are reachable only by typed URL (schedule-grid also as a chat workspace). (verify)
- `/parameter-links` is the most likely next thing to die: real surface with a tested model, unlinked, untouched since 2026-07-14.
- Declaration-only symbols flagged but not cut inside the protected `src/takeoff/**` zone, for the next takeoff pass to decide: `readStatus`, `readViews`, `readZones`, `applyRegistry`, `readZoneRegions` (`takeoff/host.ts`); `DEFAULT_ARTIFACT_DIR` (`takeoff/model.ts`); `openDecisions` (`takeoff/proto/mock.ts`); `ZonePlan`, `PlanLegend` (`takeoff/zone-plan.tsx`).

### Chat-plugin readiness
- `/takeoffs` and `/families` have zero state outside the React tree — nothing for a plugin to read; only `/family` is registered. Path is not a rewrite: each route's canonical doc (takeoff's `World` + overlay, families' scope/plan/receipts) becomes a route-state slice with commands, as `/family` did. Blocked by MasterTable-internal filter state and component-local proposal state being invisible to plugins.

### Noted, not scheduled
- Takeoffs' inline-C#-via-`scripting.execute` stays until `takeoffs.*` host ops exist (takeoffs SHIMS #1-3); the façade work does not block on it.
- Mastra/route-state transport vs host-RPC split (two origins, two error models) is real, but a product/architecture call — not a web-primitives cleanup.
- `workbench/provider.tsx` (670 LOC) + `adapter.ts` (963 LOC) chat internals: untouched.
- Per-route stale-time literals in `host/queries.ts` are hand-tuned, not a policy — fine for now.
- Reworking every route's typography is out of scope for the theme-10 sweep.
