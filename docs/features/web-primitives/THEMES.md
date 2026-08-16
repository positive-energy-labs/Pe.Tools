# Web primitives — theme census after the takeoff/family merges

Collected 2026-08-15, the day `takeoff-fresh` and `family-fresh` landed on main. Source: full
census of `/takeoffs`, `/families`, `/family` plus the shared `apps/web` infrastructure. This is
the shopping list for the TS improvement wave; each theme names its evidence and its candidate
primitive. Perfection is not the goal — code is the spec; ignored work is flagged, not hidden.

Paths are relative to `source/pe-tools/apps/web/src`.

## Themes — patterns that earned canonization

### 1. The master table IS the product surface

Seven independent table implementations exist. `components/master-table/` (306+164+214 LOC,
tested pure core) is the canon: multi-sort, facet filters over ALL rows (stable vocabulary law),
cluster headers, chip strip, two honest empty states.

- The atlas migrated onto the canon (2026-08-15): its fork and `takeoff/cells.tsx` are deleted,
  it gained sorting and a `match` flags filter.
- `ops/primitives.tsx:213` `DataTable<Row>` is a second, incompatible `Column<Row>` interface
  with 12 consumers across the ops views.
- Hand-rolled besides: `data-tables.tsx:263`, `schedule-grid.tsx:300`, `instances.tsx:214`,
  `ops.tsx:789`, `parameter-links/Evaluation.tsx:97`, plus families' decision-queue
  (`families.tsx:1015`) and receipts (`:1116`) tables.

Capabilities the canon must absorb before it can abolish the rest:
- **Selection model** — families hand-rolls `pickedIds: Set<number>` in a cell (`families.tsx:540`).
  A single cursor IS covered (`activeKey` + `onVisibleChange`, how atlas's j/k walks the visible
  order); multi-select is not.
- **Editable cells** — covered: `master-table/cells.tsx` owns `TextCell`/`NumberCell`/`CellSelect`,
  rendered from a column's `cell`, as the atlas's Manual J columns do.
- **First col lock** — covered by `Column.lock` (sticky-left with its own ground); no consumer yet.
- **Cell width control** — only a `width` utility-class string today.
- **Proposal-aware cells** — see theme 2.
- **URL-addressable state** — filters/sorts/query are component-local `useState`
  (`master-table.tsx:55-57`), invisible to the route, the URL, and any future chat plugin.

### 2. Proposals are one concept wearing three costumes

Three proposal models shipped, and the shared skeleton is visible:
**propose → review (accept / dismiss / needs-attention) → commit with receipt + drift guard.**

- `/family`: `FieldState { proposal?, staged?, review? }` keyed by JSON Pointer
  (`family/store.tsx:34-44`), tri-state review marks, `acceptAll`, save gate, "Saved N · M failed"
  receipt. The richest model.
- `/takeoffs`: write-through `decide(room, flag, verb)` with optimistic `decided` map
  (`atlas.tsx:239`), plus a session overlay for Manual J edits. No staging by decision.
- `/families`: plan-as-lens + staged `excludedIds` + `expectedPlanHash` drift refusal + receipts.
- Chat side: `CellTrichotomyReviewer` (`workbench/trichotomy-reviewer.tsx`) already shared by 3
  plugins.

Candidate primitive: NOT one store — a shared **proposal vocabulary** (state names, tone budget,
dot/badge/queue components, receipt shape) that all three commitments render with. The stores
stay per-route; the language becomes one.

### 3. The verb bracket (busy / error / receipt) — three idioms, one latent bug

- `takeoffs.tsx:101-112`: `run(label, work)` with `finally`, busy-seconds ticker.
- `families.tsx:704-783`: three verbatim try/catch blocks with `setBusy(null)` OUTSIDE `finally`
  — a thrown apply leaves the route busy forever. Real bug.
- `family.tsx:2255-2280` + eight more hand-rolled brackets.
- Receipt state is a copy-pasted `useState<{text, atMs} | null>` in two routes, both feeding
  `Sentence`'s `receipt` prop.

Candidate primitive: one `useVerb`/`useRun` hook — serialized verbs (one host transaction at a
time is already the law), busy label + elapsed seconds, error channel, receipt firing.

### 4. Sentence everywhere — takeoffs is the last holdout

`/families` and `/family` mount the shared `Sentence` with `SlotSpec`; `/takeoffs` reimplements a
full-screen `TargetGate` (`takeoffs.tsx:411-451`) over the same `useTarget`/`mintSelector`
primitives and prints its addressable URL as raw text. Family SHIMS shim 3 already names the end
state: every plugin route declares its sentence via config. Also: `sentence.tsx` carries 26
inline `style={{}}` — the flagship targeting surface bypasses the token system.

### 5. Panes: simultaneous cross-context visibility

The atlas's plan-dominant layout (rail / plan+table / peek, vertically-resizable plan with a
hand-rolled pointer-capture splitter at `atlas.tsx:372-392`) is the best pane story in the app.
`/family` has a fixed `w-[42%]` right rail, no splitter; `/families` is one vertical column.
`components/ui/side-pane.tsx` (178 LOC, 5 consumers) covers only the overlay case.

Resolved 2026-08-15: `components/ui/pane.tsx` — `Pane` (kind-scoped chrome), `PaneSplit` (binary
resizable split), `PaneWorkspace` (nav | visual/inspector over content grid), keyboard-accessible
handles with persist + controlled collapse. The atlas is the first consumer; chat, the family
reshape, and the FOM/BOD tool are the intended next ones. Open question carried forward: whether
`SidePane` (6 consumers, overlay collapse) and `PaneSplit` remain two primitives once those land.

### 6. SVG visualization: three camera systems, three math

- Atlas + zone-plan: `viewBox` + Y-flip over a shared `Bounds` (`takeoff/model.ts` `boundsOf`/
  `pathD`) — the right idiom for model-space geometry.
- `/family` Triptych (`family.tsx:606-921`): fixed px canvas, manual scale/margin mapping, no
  viewBox.
- `family/doc-pane.tsx:169-197`: a CSS-transform camera with ResizeObserver + zoom clamp.
- Two independent pointer-drag implementations (`atlas.tsx:372`, `family.tsx:652`).

Resolved 2026-08-15: `lib/affine-frame.ts` is the pure seam for finite bounds, union, uniform fit,
Y-up/Y-down orientation, renderer-neutral matrix output, and exact forward/inverse point mapping.
Triptych, the citation doc pane, atlas/zone-plan, sheet canvas, and RHVAC bounds now consume it;
Triptych uses `viewBox` and native SVG CTM inversion for plane dragging. Domain projection and
rendering stay outside. A stateful pan/zoom camera was deliberately not added — compose one over
the frame when a real user-controlled camera earns it.

### 7. Anti-theme: the route shape (the pattern all three secretly share)

All three converge on the same anatomy, stated cleanest by takeoffs
(`atlas.tsx` header comment): **the route owns the world and every host call; the view renders a
`World` and calls back through a typed `Actions` interface; scope narrowing is chips, never
hiding; fixture lanes are explicit URL choices, never fallbacks.** Family's `FamilyStore` seam +
`?mock` is the same idea; families skipped the seam (no mock lane, asserted at
`families.tsx:235`).

Candidate: not a framework — a written **route pattern** (in `apps/web/AGENTS.md`, currently 3
lines) naming: route = adapter (world + verbs), feature dir = model + view, seam interface for
store, fixture lane convention (`?mock` / `?source=fixture` → pick ONE spelling), state-lane
choices (react-query for host reads, route-state for agent-shared docs, useState for session
ephemera). Future routes get this shape for free instead of re-deriving it.

### 8. Anti-theme: chat-plugin readiness

Only `/family` is registered (`workbench/route-chat-plugins.tsx:59`). `/takeoffs` and `/families`
have zero state outside the React tree — nothing for a plugin to read. The wire exists and is
good (route-state slices, hydrate-then-stream, `Atom.family` sharing). The path for the other
routes is not a rewrite: each route's canonical doc (takeoff's `World` + overlay, families'
scope/plan/receipts) becomes a route-state slice with commands, exactly as `/family` did.
Blocker worth naming: MasterTable-internal filter state (theme 1) and component-local proposal
state are invisible to any plugin.

### 9. Honesty chrome is a design language — half extracted

Seam/Live chips (TWO idioms: `takeoff/seam.tsx` children-based vs `families.tsx:232` op-based),
`ReadCell`'s mandatory `cellReason`, teach-tooltips on every control, the four-state room/family
state dot with the one-alarm hue budget (`STATE_META` original in atlas, extraction in
`master-table/cells.tsx`, families consumes the extraction, takeoffs still uses the original).
Candidate: finish the extraction, one Seam chip, and write the hue-budget law into the design
system route (it's currently only enforced by taste).

### 10. Token dialects — three ways to write a hairline

- shadcn tokens (`border-border`, atlas) vs paper aliases (`var(--paper)`, family/families) vs
  raw inline `style={{ border: "0.5px solid var(--line-2)" }}` (all of `ops/**`,
  `instances.tsx`, and `sentence.tsx`'s 26 inline styles).
- The `@theme inline` `--color-cat-*` utilities exist precisely to end bracket-var usage;
  `ops/**` never adopted them.
- Type scale is three utilities (`tele`, `tele-label`, `section-label`); every body size is raw
  arbitrary px — the design-system exhibit itself has the highest arbitrary-px count (28).
- `--radius-sm` computes to a negative value (`styles.css:157`); Google Fonts is a remote
  blocking `@import` (`styles.css:1`).

Candidate: pick one dialect (Tailwind utilities over tokens; promote the missing type steps to
utilities), then a mechanical sweep. This is prerequisite polish for every other primitive.

### 11. Host-call facades — familyfoundry.ts is the pattern, once

`host/familyfoundry.ts` (83 LOC: typed per-domain façade over `callHostRpc`) is what the
architecture doc asks for, and nothing else follows it: takeoffs calls `scripting.execute` with
C# strings (self-declared shim, `takeoff/scripts.ts:1-3`), five inline `callHostRpc` call sites,
five separate non-`/call` fetch paths each with ad-hoc error handling, and `host/issues.tsx`'s
good 7-variant error UI adopted by only 4 of 11 surfaces. Web-side candidate: per-domain façades
+ universal `HostIssuePanel` adoption. The `takeoffs.*` typed ops themselves are host-side work
(takeoffs SHIMS #1).

## Clear gaps — small, sharp, now

1. **Dead plugin registration**: `/family-types` route is deleted but
   `route-chat-plugins.tsx:52-55` still registers it → `chat-shell` will iframe a 404; ~120 LOC
   of unreachable renderer + a test asserting the dead registration. (The route-STATE contracts
   stay — family SHIMS shim 7 — but the web registry entry is pure orphan.)
2. **`setBusy(null)` outside `finally` ×3** in `families.tsx` — verb error wedges the route.
3. **Retired-but-bundled**: `target-chip.tsx` (275 LOC, superseded by Sentence);
   `ui/dropdown-menu.tsx` (253 LOC) + `ui/tooltip.tsx` mounted only in the design-system
   exhibit; `@tanstack/react-form` declared, zero imports.
4. **`PROFILE_READ_LIMIT = 40` silently slices** (`families.tsx:382`) while its docblock promises
   "nothing truncates silently".
5. **`timeAgo` ×6 copies** (`family/live.tsx`, `schedule-grid.tsx`, `settings.tsx`,
   `instances.tsx`, `host/target-ui.tsx`, schedule-grid plugin) — plus takeoffs' `.slice(0,10)`.
6. **`/` index TOOLS lists 6 of 13 routes** — `/takeoffs` is unreachable except by typed URL.
7. **Esc-handler with input-guard ×3**, each with a different guard list.
8. ~~**`fmtNum` twice, number-parse twice**~~ — CLOSED 2026-08-15: `takeoff/cells.tsx` deleted,
   every caller consumes `master-table/model.ts`'s stricter pair.

## Ignored work (noted, not scheduled — SHIMS style)

- Takeoffs' inline-C#-via-`scripting.execute` stays until `takeoffs.*` host ops exist
  (takeoffs SHIMS #1-3); the web façade theme (11) does not block on it.
- The Mastra/route-state transport vs host-RPC split (two origins, two error models) is real but
  is a product/architecture call, not a web-primitives cleanup.
- `workbench/provider.tsx` (670 LOC) + `adapter.ts` (963 LOC) chat internals: untouched by this
  wave.
- Per-route stale-time literals in `host/queries.ts` are hand-tuned, not a policy — fine for now.
- No body type scale exists; tokenizing it fully is part of theme 10's sweep, but reworking every
  route's typography is not.
