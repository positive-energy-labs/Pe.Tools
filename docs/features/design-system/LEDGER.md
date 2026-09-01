# design-system ledger

The one-system design cluster: the design LANGUAGE (raw values in `apps/web/src/base.css`,
projected by `design-lang.css`, grammar in `components/lang/`, page anatomy in
`components/anatomy/`), the `/design-system` route and its satellites, the front door (`/`), and
the document lab (`/doc-lab`).

**This ledger owns every cross-route design-language and primitive gap.** Route ledgers name their
own applications and evidence; they never restate a ruling or a gap that lives here.

A rule lives in exactly one home — a type, a check, a swatch specimen, or
`.agents/skills/lens.house/SKILL.md`. `docs/design/SURFACE-PHILOSOPHY.md` indexes those homes.
Rebuilt 2026-08-29 after goal `design-normalization-2`; git history holds the timeline.

## Decided

### Where a rule lives

- 2026-08-29 — Taste that code cannot hold lives in `lens.house`: figure, referents,
  anti-referents, ten one-line laws, the authoring ladder. Invoked on any UI edit.
- 2026-08-30 — Product code authors GEOMETRY, TYPE (`t-*`, `face-*`, `t-upper`) and INK
  (`text-ink|ink-2|ink-mute`); meaning hues, fills, strokes and elevation need a primitive.
  Supersedes the 2026-08-29 "geometry only" ruling: the `{}` allowlist stripped ~1,100
  `t-*`/`face-*` sites (main: 684 + 422 outside `components/`; wt: 30) and left product text at
  browser defaults (`/design-system`: 122 text nodes at 16px, 0 on main). A `<Text>` primitive was
  rejected — no DX difference from a utility, and one more wrapper. Enforced by
  `design-guard.test.ts` (`meaning, fill and stroke utilities stay in components`, baseline `{}`).
- 2026-08-29 — Every `lang/` primitive carries a closed variant set declared with
  `tailwind-variants` (`tv`, vendored at `lib/tv.ts`) and takes no `className`. Hand CSS survives
  only where the cascade is the law (`StateCell` precedence, documented in `lang.css`).
- 2026-08-29 — `components/ui/` is folded into `components/lang/`: one grammar, no second tier.
  Chat views are product, and live in `chat/`.
- 2026-08-29 — A losing prototype variant is deleted on verdict; only the winner's rewrite lives.

### The language

- 2026-08-16 — Round-1 winner **e (cell states)** on whole-page legibility. Two load-bearing
  mechanisms: one cell grammar at three scales (chat card / table cell / arming strip), and
  tasteful fills over outline borders — border scarcity is what makes the arming strip ceremony.
- 2026-08-16 — Round-2 winner **p3 (wholistic bands)**: every role on shared OKLCH
  lightness/chroma bands so the palette reads as one system, alarm alone off-band. Cross-mode
  strategy is sibling renderings — per-role light|dark pair, identical meaning map, lightness
  free, hue within a named tolerance.
- 2026-08-16 — Standing mode preference (kaitpw): light is the preferred palette but dark reads
  with better contrast, and the fix is ground/background tokens — never re-tuning accents per mode.
- 2026-08-16 — Carried-in motif meaning beats internal consistency: locked is greyed italic;
  squiggle is not-settled while a plain underline is a citation; a proposal is a whole-cell event;
  nav splits three ways. Icons work in verbs and outcomes and break table ergonomics inside cells.
- 2026-08-16 — PE character is warm paper, an earthy secondary family, a mono voice, and pea
  green. All four are identity.
- 2026-08-16 — Weak anchors, deviate with cause and record it: cell-body treatment is reserved for
  pea proposals and uneditable/disabled; artifact frames wrap large interactive chunks.
- 2026-08-16 — The type model (tier × face × case, the weight law, the mono face law) is
  [ADR 0004](../../adr/0004-type-tier-model.md); the verdict column and the meaning-role tone union
  are [ADR 0005](../../adr/0005-verdict-column-and-tone-union.md).
- 2026-08-28 — Broken lines have three roles and one authority in `base.css`: `seam` is declared
  with nothing real behind it and is the one UI broken edge; `reference` and `void` are drawing
  vocabulary. No call site names a pattern.
- 2026-08-29 — Opacity is not a de-emphasis mechanism. Locked is italic + `ink-mute`.
- 2026-08-29 — A cell carries a `shown` reading and a bound `authority`; drift is
  `shown.value !== authority.value`, `stale` is superseded. The type is the spec (`StateCellProps`).
- 2026-08-31 — Density round 1 winner **C (extreme)**: "honestly extreme is the best" (kaitpw).
  20px list rows, 10px caption/label/value at 1.2 line-height, 11px prose at 1.4, 2px cell edge
  padding. Folded into `base.css` `:root`; the 24px middle variant and the throwaway switcher were
  deleted on verdict. Consequence: caption, label and value now share one 10px size and differ
  only by face, case and weight — see open questions.
- 2026-08-31 — Proposal-state demiurge (round 2, kaitpw: "B definitely, + D, and no denied
  state"): the trichotomy (`agent-contracts/src/trichotomy.ts` — proposal → staged → committed,
  `review` marks aside) is the ONE proposal lifecycle. No `denied` state: a denial clears the
  proposal and the cell shows the real value again. No `written` state: commit clears `staged`;
  saved/unsaved and fresh/stale carry what those two tried to say. Family's
  `ProposalVerdict`/`CellVerdict` (`family/world.ts:145`) and the proposal-flow fixture's
  `review` are parallel machines owed deletion; one shared reader derives `StateCellProps` from
  a trichotomy cell so routes cannot re-derive the mapping. `cap{readonly,excluded}` collapse to
  locked + reason; `nohome` stays — it draws the seam. `stagedBy` plumbs from `proposal.by`.
- 2026-08-31 — Per-cell grounding stays even when several cells cite one OCR block (kaitpw).
  The card-scale footline may not wrap a cell to two lines: it collapses to hover; the 10px
  floor forbids shrinking it. Locate is the cell's own `onLocate`; family's rail locate icon
  (`family/marks.tsx`) dies into it.
- 2026-08-31 — Takeoffs annotation round, the language-level pieces: the targeting head sits in
  outer scroll flow and the work area pins full-viewport (`anatomy/workspace.tsx`, all Workspace
  routes); `Press` grows `hover: veil|bare` and `frame: none|line`; sortable table headers wear
  `t-upper` with no hover veil; the header facet trigger fills its cell, chevron on the right
  edge, mono choices; `StateDot` gains `bar` — a zone's state bar is a fixed width with
  proportional segments, never wider for more rooms.
- 2026-08-31 — SCROLLBAR LAW (annotation round): one treatment for every scroller, declared once
  at `[data-pe]` in `base.css` — `scrollbar-width: thin`, no track, and a thumb that is invisible
  until the pointer is inside the scroller that owns it (`[data-pe] :hover`). The gutter is
  reserved either way, so nothing shifts. The page body's bar is hidden outright: the scroll-away
  `main` in `anatomy/workspace.tsx` wears `no-scrollbar`. A pane may show ONE bar: a `Pane` body is
  a flex column, so a call site that docks a region under a scroller uses `scroll="clip"` and its
  own inner scroller rather than nesting two.
- 2026-08-31 — PANE HEADER: `meta` is a SHORT machine fact (a count, a mode word, a key) and
  renders truncated with its own text as the native title; region orientation is `help`, which
  renders the header's `HelpTip`. Meta that overflows was the primitive's defect, not the call
  site's. Header controls share the item height: `Switcher` carries `--item-h` on the GROUP and
  fills it with its options (a 20px option inside a bordered group measured 22px beside `Verb`).
- 2026-08-31 — A framed press (`Press frame="line"`) owns its inset and the item height; a border
  at zero inset reads as a tight box. Switcher census: `components/lang/switcher.tsx` is the ONLY
  switcher — `param-tables/variants/switcher.tsx` (`VariantSwitcher`, a dev-only prototype dock
  with zero importers) was deleted, not folded.
- 2026-08-31 — `MasterTable` draws SEPARATE borders (`border-separate border-spacing-0`). A
  collapsed border belongs to the table, not the cell, so it does not travel with a sticky cell:
  that is the white seam at the locked column's left edge. Every cell already draws its own
  `border-b border-l` with `first:border-l-0`, so nothing doubles.
- 2026-08-31 — TWO HEIGHTS, no third yet (round-1 reshape, from the verdict "standardize a general
  list-item height... two, three max"): `--item-h` (20px) sizes every list-shaped row — table row,
  select/combobox/command menu item, pick-list item, `Verb` — and `--control-h` (24px) sizes every
  freestanding control (input, select trigger, combobox chip holder). Both live in `base.css`
  beside `--space-unit`. A surface that needs a third height names it here before authoring one.

### Route and state architecture (cross-route, owned here)

- 2026-08-19 — THREE-HOME ADDRESSING: the sentence carries external bindings (test: it survives the
  page closing and other software can touch it); page memory carries the rest; the route document
  carries what an agent shares. The full binding set lives in ONE sentence.
- 2026-08-24 — The targeting manifest is canon (`apps/web/src/targeting/`): a route declares a
  static `Product` (links · stages · panes), supplies one `Feed` per link, and keeps bindings in
  URL search. `TargetingHead` renders terminals only; trunks are the picker's crumbs. Seams and
  refusals derive, never declared twice.
- 2026-08-24 — All page state lives in the route store; no component-local exception. One
  `AtomRegistry` per app, [ADR 0009](../../adr/0009-one-atom-registry-per-app.md).
- 2026-08-25 — A page atom holds a primitive or an identity-stable value, one writer each; an
  object-valued atom loops the renderer.
- 2026-08-25 — Refusing a second verb is LAW: the host transaction cannot be interrupted, so
  `runVerb` refuses and records `busy`.
- 2026-08-26 — Route-doc identity is `(route, Address)`; `?thread` is only a view. `Address` is the
  Revit document identity (`cloudModelGuid ?? absolute path`) and `Reading` is
  `{ at: Address, version, observedAt }` — a world is a call target, never part of read identity.
- 2026-08-26 — Route-doc concurrency uses no locks and no sync engine: `expectedRevision` end to
  end, client `requestId` idempotency for external commands, an open-in-another-tab cue and a
  changed-elsewhere banner, `outcomeUnknown` as the crash barrier. Add an optimistic overlay only
  when measured latency demands it.
- 2026-08-26 — The route-document machine owns no product meaning: `agent-contracts/route-doc.ts`
  exports pure `applyPatches`, `guardCommand`, `commitDoc`; `RouteWorkspace` is only their shell.
- 2026-08-27 — `RouteStateWriteResult` is a discriminated union on `ok`. Store producers that
  refuse produce `kind: "refused"`, never a bare `Error`.
- 2026-08-28 — Three control kinds, no fourth: `Verb` is a world action with a tone and a required
  `reason`; `Press` is surface machinery and mints no tone; furniture may not claim an affordance
  it does not have. Export/PDF/SVG verbs are `act` — `commit` stays the one filled blue.
- 2026-08-28 — A user-placed review flag is `caution`. `alarm` is reserved for the model disagreeing.

### Enforcement

- 2026-08-16 — The design-guard test IS the lint: the web app has no CI, so token discipline holds
  by assertion in the deterministic lane, not by review.
- 2026-08-28 — Every guard category is a hard zero; there is no prototype exemption. Maintained
  scope is every `apps/web/src` TS/TSX/CSS/JSON surface, mounted routes and incubating variants
  alike. Disposable standalone artifacts (`docs/remote-factory.html`, `apps/web/docs/*.html`) are
  outside maintained-app adoption.
- 2026-08-28 — A gate that matches one spelling measures nothing (the dashed gate read kebab case
  and saw 8 of ~30 sites; the type gate read `px` only). One authority stops at the language
  boundary: `runs/visual-law.json` had two readers and every web gate stayed green while two
  surfaces drew the same law differently.
- 2026-08-29 — Class discipline is proved by compiling authored candidates against the app's own
  CSS graph (`styles.css` and its imports), not by regex. Three checks hold the boundary:
  unregistered classes (hard zero), the visual-utility allowlist (`{}`), and swatch coverage.
- 2026-08-29 — The swatch is generated from recipe metadata: every variant value of every exported
  `tv` recipe renders, asserted exhaustively. A new variant appears with no edit.
- 2026-08-29 — A ratchet must fall as well as refuse to rise. Both baselines assert staleness and
  print paste-ready JSON; a count that dropped is a failure until it is recorded.
- 2026-08-29 — Every TSX file under `apps/web/src` stays under 400 lines, split by region. A split
  file is named for what it draws, never for its parent plus a symbol.
- 2026-08-31 — Merge main into `review/design-system` wholesale; a clean-room happens only
  per-route during re-cutover. The branch tip is the latest restoration pass and a full replay
  re-pays the brute-force cutover cost. See `MAP.md` for the live phase plan.
- 2026-08-31 — Seam order after the merge: route-state demiurge first, design-system distillation
  second, route re-cutover third (chat, takeoffs, family, then families, settings). Unrestored
  routes bend to the system.
- 2026-08-31 — The SDK contract (generated operation catalog, session-census consumption) is
  fixed during the route-state demiurge. Only web-side state shape may change.
- 2026-08-31 — moderncss rules (`@layer`, `@scope`, `oklch`, container queries) bind the distilled
  system and re-cutover code only. No app-wide migration wave; lesser routes adopt when touched.
- 2026-08-31 — `spike/takeoffs-pane-hotkeys` is input only. Its pane-state, route-command, and
  hover-css implications are distilled into the route-state demiurge, then the branch is deleted.
- 2026-08-31 — `design-adherence.baseline.json` must shrink substantially for chat, takeoffs,
  family, families, and settings; literal zero is not required. The check itself is re-opened
  whenever its signals feel wrong and may be amended as the system changes.
- 2026-08-31 — Route shape S2a adopted pending the `/instances` spike round: a route shell owns
  address schema, lane, binding, and store lifetime. Layout slots (S2b) are deferred until the
  pane primitive grows `header` and optional `visual`. S1 (prose only) and S4 (store-first canon)
  are killed; S3 (generated routes) is deferred inside S2a's interface. Evidence:
  `spike/route-shell` report.
- 2026-08-31 — Keyboard law: raw `addEventListener("keydown")` is banned in routes;
  `@tanstack/react-hotkeys` is the one registration door, pane-scoped with mandatory labels.
  Enforced by a route guard when the shell lands.
- 2026-08-31 — URL law: a route's address schema declares only params something consumes. `thread`
  is not route-local: the wire layer consumes it for Pea drivability (`state/route-store.ts:331`
  raw `location` read). Under S2a `thread` moves to shared ownership beside root `doc`, and the
  shell hands it to the store through `ctx`; the raw read is retired then. Every route is intended
  to be Pea-drivable; do not delete `thread` validations before the shared owner exists.
- 2026-08-31 — Priority law: routes outside chat, takeoffs, family, families, settings are touched
  only in normalizing crusades; their specific holes wait for protoui/close rounds. Most lesser
  routes are ideas kept because code is the spec.
- 2026-08-31 — Route-state demiurge converged on S2a-core: the shell owns address schema (shared
  `doc` and `thread`), lane, and binding via ordered resolvers with the notYet/chrome/identity
  contract; the lane is the first resolver and carries a `reachesHost` capability, not a string.
  `store` and `useWorkspace` stay route-owned; that ruling is deferred to the first complex-route
  cutover. Evidence: `spike/route-shell`, three routes, two spike rounds. Canon build lands with
  the cutover, not as throwaway round 3.
- 2026-08-31 — Meaning-system demiurge round 1: M1 vocabulary extension adopted as core (register
  the missing roles, directional hairline first; fix the three guard bugs; ratchet honestly). M2
  modern-CSS mechanisms fold into M1 as implementation, not a competing rewrite. M3 (guard-fix
  only) and M4 (wrapper mandate) FALSIFIED by the intent census
  (`.artifacts/runs/meaning-census-20260831/report.md`).
- 2026-08-31 — Typography default law: unstyled text must land in-system. The language base layer
  sets the default face, size, and leading so a bare element is never browser-default; tiers
  (`t-*`, `face-*`) become deviations from a good default, not requirements. User: "the bad font
  shows most in the hidden places", named stake: the targeting dropdown's search text and "none
  found" text. Bar: near-zero boilerplate at call sites.
- 2026-08-31 — Density law: "in general denser and smaller is better, conventional accessibility
  sizes do not work well for our use-case." Layout debt (overflow, unequal list-item heights,
  elements not filling parents, missing edge padding, uneven text density) is a named demiurge
  subject; it enters instrument-first with a computed-style census on the priority routes.

- 2026-08-31 — Phase 3 closed: the design-language laws are settled and enforced. (1) Typography
  ground: the body sets the value tier; tiers are pinned at component recipes, defaulted at the
  body, restated nowhere; check is `@pe/web#type-sweep`. (2) Tone: meaning color rides
  `data-tone` (+`data-wash`); raw meaning utilities outside `components/` are a 0-baseline red.
  (3) Selection rides `aria-selected`/`aria-expanded`/`aria-pressed`/`data-selected`. (4) Lines
  and planes: `hairline-*` (with `-2`, `-faint`, `rows`), `boundary-*`, `data-surface`; the
  meaning allowlist is 2 deliberate entries, both commented in `family/workspace-table.tsx`.
  (5) Theme: one `light-dark()` declaration per token; dark mode is class + inline
  `color-scheme`. New vocabulary lands as role + guard registration + failing check + ledger
  line in one commit. Laws written into `apps/web/AGENTS.md`. Rounds 1-7 evidence:
  `.artifacts/runs/{meaning-census,meaning-round2,type-ground,tone-attr,tvalue-sweep,hairline-cont,surface-roles}-20260831/`.
- 2026-08-31 — Accepted small visual normalizations during phase 3, all named in reports: the
  cache-cap washes unified onto the canonical `data-wash` recipe; three former 0.5px
  `--pe-line-2` edges (attachment frame, reasoning rail, neutral blast badge) normalized to
  `--pe-line` under `hairline-*-faint`.

## Tried & rejected

- 2026-08-15 — The TanStack **Spreadsheet example** as the component: ~3,941 TS/TSX + 895 CSS lines
  of virtualization, merged cells, clipboard, fill, undo/redo and menus for a table that needed a
  headless model. `@tanstack/react-table` is pinned, never `latest`.
- 2026-08-15 — Documentation-as-UI exhibits (4,510 LOC, the single largest cut). A route nobody can
  reach from the front door is the leading indicator of dead code.
- 2026-08-15 — Speculative seams that PAID, do not re-litigate: `ops/synthetic.tsx` (the seam was
  behavioral — fan out N deps, per-dep status). The authoring test is not "can I name a future
  user?" but "what makes this obviously wrong if the future never comes?".
- 2026-08-16 — **Base 1** (byte-identical specimen isolating token scope): it isolated the variable
  so well the round stopped judging a product.
- 2026-08-16 — Round-1 losers and what they donated: **a** (control) verb grouping; **b** (colour
  nearly abolished) the outcome decoration direction; **c** (borrowed motifs) the axis-splitting
  law, though its palette was too saturated for PE; **d** (new palette) evidence that dark's
  character was underdefined.
- 2026-08-16 — Round-2 palette losers: **p1** capped light wash at 1.38:1 and rested dark
  alarm/caution on chroma alone (fails deuteranopia); **p2** moved `done` out of pea's family, a
  meaning change; **p4** dropped brand blue entirely. Mode-invariant accents read as muddy.
- 2026-08-16 — Viz hues carrying state, caught on three surfaces in one week; blue as a
  provenance/busy hue; `hover:text-destructive` on row removers; a `bg-primary` brand lamp beside
  the wordmark. Each spent a meaning hue on mere affordance or identity.
- 2026-08-16 — Dashed as a general "provisional/partial" mark: every spend was a different slot.
  Dashed is the seam slot only.
- 2026-08-16 — The user gets NO identity hue: authorship already rides four redundant channels.
- 2026-08-16 — `title=` as a general prose vehicle: 63 of 176 static titles were multi-sentence,
  the longest 366 chars, each fired on hover.
- 2026-08-16 — oxlint as the token-discipline lever: waived for one dependency-free walk inside the
  existing test lane. (Superseded 2026-08-29 by the compiler-backed checks, same verdict on eslint.)
- 2026-08-16 — "Delete all copy and re-evaluate from scratch": ruled too broad; the per-route purge
  with typed destinations is the adopted path.
- 2026-08-25 — A shared targeting-controller hook across three routes: the controllers differ in
  picker state and navigation, not only in product data.
- 2026-08-26 — Store-as-source and the typed manifest as a wire contract: a manifest is a web UI
  kit until an agent consumes it, and that consumer is the gate.
- 2026-08-29 — A guard that a dead object can satisfy: `LANG_EXPORTS` + `void LANG_EXPORTS` passed
  swatch coverage while rendering nothing. Coverage now requires a JSX mount.
- 2026-08-29 — A hand-written consumer count on each swatch frame, kept honest by a guard that
  forced it to equal the import census: prose in a check's uniform, and every unrelated file split
  broke it. A count earns its place only if it is derived at render.
- 2026-08-29 — Moving a monolith is not splitting it: the first specimen pass moved 2,365 lines
  into two files and the swatch silently lost 100 specimens (594 → 350 JSX tags). Region split or
  nothing.
- 2026-08-29 — The first unregistered-class census (855) was measured against
  `tailwindcss/theme.css + design-lang.css` instead of the app's real CSS graph, so classes the app
  ships (`h-*`, `face-*`, `z-*`) read as unregistered. A checker's loader is part of its claim.

## Owed

- `/data-tables` performs live Revit reads/writes with no document gate
  (`routes/data-tables.tsx:116-135`). Deferred by the 2026-08-31 priority law; falls to the S2a
  cutover crusade.
- 3 repo-guard reds ride on main (was 8 at the merge; `2a75f94` fixed opacityDim and the meaning
  population, `e099dc7` cleared rawMeaningColor to 0; `2833b95` cut rawLeading 5 → 3 and
  unregistered 11 → 9): `no raw leading utilities` 3 sites, `weight variables outside the
  foundation` 1 site (`workbench/lens.css:277`), `unregistered classes` 9 sites (overlaps the
  leading sites). Phase 4 pays.
- From the 2026-08-31 delegate critic (`.artifacts/runs/delegate-20260831/critic-report.md`),
  items no round-2 line owns: bare `/families` and `/settings` hard-404 to the router's generic
  Not Found — a mounted route must refuse in its own words (falls to the S2a route-shell
  cutover); scrollbar gutter no-shift needs a HEADED browser (headless Chrome gave overlay bars);
  the 11px prose tier and dark mode were never measured against the laws; hover/focus states
  measured nowhere. One menu primitive for the cell vs header dropdown POPUPS is still an open
  decision (chrome round §8).
- The `review` field's deletion from the trichotomy is argued (validation is derived, pea's voice
  is chat or a counter-proposal, staging is the approval, arming is the write gate) but NOT ruled;
  the counter-proposal rendering gap (proposal + staged both present draws nothing of pea's) rides
  with that ruling.
- The design guards misreport (found 2026-08-31 by the intent census,
  `.artifacts/runs/meaning-census-20260831/report.md`): the inline-color regex at
  `design-adherence.test.ts:107` backtracks past its optional quote, so 11 literal
  `transparent`/`inherit` values count as debt; the opacity regex at `design-adherence.test.ts:102`
  counts animation keyframes as dimming; the class guard's inverse `AUTHORING` filter counts 23
  typography/shape/accessibility utilities as "meaning, fill and stroke". Fix falls to phase 3
  with the meaning-system verdict.

### Style regression, main → review/design-system (opened 2026-08-30)

- `/design-system`, its swatch, `/` and `/takeoffs` (fixture lane) ported 2026-08-30: 0
  browser-default text nodes on each; takeoffs mono within 9 and ink-2 within 10 of main. `/runs`
  ported 2026-08-30: 0 browser-default text nodes in its empty-pool state. `/chat` ported
  2026-08-30: 0 visible app-owned browser-default text nodes in its empty-thread state. Still
  owed: `/family`, `/settings`.
- Targeting gaps (from `.artifacts/handoffs/takeoffs-port.md`): no primitive for an inline
  stale/error caption (main spent caution at the call site); no language-owned stage-strip
  rail/separator hairlines (main drew them with inline `token()` strokes, now dropped); no
  pane-availability mark beyond the ink ladder (main's ready underline and disabled italic).
  Main is the reference, not the code; zero guard violations is the bar.
- `/family`, `/families`, `/settings`, `/ops`, `/instances` have NO fixture lane on either
  branch (`?source=fixture` falls back to the document gate); they cannot be censused or ported
  without a controlled Revit session. `/takeoffs` is the only gated route with a real fixture.
- Port gaps (from `.artifacts/handoffs/ds-port.md`): `Section` has no tier slot, so a page head
  needs a second `t-head` line under it; `CounterExample` has no struck variant beyond the
  caption; `OutcomeLine` lost `dropped`/`partial`; `ArmingStrip` cannot show armed-at/by or plan
  age because the state model lacks them.
- Style-delta census per route (main :3001 vs wt :3000, computed styles + PNG) is the edge for
  every port; lives at `.artifacts/handoffs/style-delta.md` when run.
- `t-display`/`face-display`/`t-head` exist and nothing wears them; route heads have no head.
- `lens.house` holds prose the route used to show. The skill is philosophy; the route is the
  spec. Move what renders back to the route.

### From goal `design-normalization-2` (closed 2026-08-29 at `e60113b`)

- Read the diff of the 1,681 comment lines deleted under the "dated rationale is git history"
  ruling; confirm none of it was a `FOOTGUN:` or a trap that no code site now carries.
- `Press` collapsed to four tones, so `grounded-doc`'s image-overlay `locate`/`caution` marks
  became `neutral` and the world lane's `caution` became `quiet`. Rule whether an overlay mark is
  an `anatomy/annotation` variant rather than a Press tone.
- `components/lang/chat-appearance` carries the chat views' paint inside the kit after the views
  moved to `chat/`. Rule it a primitive or fold it.
- `components/anatomy/annotation.tsx` grew 28 variants for the Lens — a second grammar, uncensused.
  Census it against the kit before it earns a 29th.
- Four candidate `lens.house` laws, written but unruled: every product route is reachable from the
  front door; a human invokes every crossing into the live model; a rejected cell commit restores
  the prior value and states the reason beside the cell; a route owns its world and host calls.
- Screenshot-lane proof is owed for the whole cluster. Every eye claim on record is DOM testimony
  (innerText, element counts, console errors); the harness preview tool wedged on first call.

### Cross-route language gaps (the single owners)

- **Outcomes are orphans**: `OutcomeLine` carries no verb, actor, time, target, or item list.
  Blocks `/instances`' attributed ledger rail and `/workbench`'s owed-approval lane.
- The **gutter marker** (SURFACE-PHILOSOPHY §4): "a human decision is queued here" and "this row is
  unreachable" are ROW facts and the marker (count + locate) is not built.
- The `review: "attention"` axis: a staged value can be contested with nothing in the grammar
  saying so. Not `agree: "drift"` — the model holds no other value.
- Three severities onto one caution: host ops report Info/Warning/Error while the meaning band has
  one alarm (reserved: the model disagrees) and one caution.
- "Host disconnected" has no axis and no kind; routes hand-pick a chip tone for it.
- Preview freshness (`previewed`/`reviewed`/`applyReady`, including "pea previewed, a human must
  re-run") is real state with no visible mark.
- No home for page-level "unsaved" beyond a caution `FactChip`, where the unsaved thing is a nested
  document edited through selects.
- View-trust facts (temp hide/isolate, hidden filter/category/workset, unloaded link) have no axis
  and ride hand-picked caution tones.
- No blessed "distrusted region" treatment for spatial views; takeoffs' residue ruling covers
  held/absent area, not doubted addresses.
- No primitive for a three-way exclusive choice that can also be empty (a human verdict: looks
  good / not sure / looks wrong / not judged yet).
- No axis for "this apply will *remove* N rows" — a queued destructive write has no grammar.
- LEGAL-OPTIONS LAW (ruled 2026-08-19) is unbuilt: every input offers only the options valid in
  that slot, read from the live document, never a free field.
- SESSION-DRIVE VERBS unruled ("open in Revit", "open view", "reveal json in IDE"), and
  `ownerRoute` nav from a binding noun's popover to the route that owns it.
- The table language needs a ruled COMPACT MODE: hairline rows, mono values, one line per cell, no
  scope strip. The user ruled sheet-like consumers need a denser row than `MasterTable` offers.
- Rule whether a transient twin highlight differs from selection, and write the *rank* clause the
  non-hue-channel law implies rather than merely spirits.
- Border-budget edge cases: is the write-verb group an artifact frame? Are readonly testimony cards?
- Untested compositions: only proposed+drift is proven. Staged+stale, grounded+drift,
  refused+proposed are asserted by precedent alone.
- **Interaction states are undesigned as a system**: no hover/focus/selected/editing state exists
  in any fixture.
- Consolidation pass over the state vocabulary, squashing axes that can merge — every new state
  word is more for the user to learn.

### Component repairs

- `Verb` has no icon-only or render-prop form; a world action that must render as an icon alone has
  no home. A busy-and-refused verb is currently unrenderable.
- The addressing sentence: `NarrowChip` owns removal, nothing owns re-adding.
- `MasterTable` remainder: `CellStateKey` deriving axes from on-screen rows; row-level proposal
  marking beyond `rowClassName`; multi-select (families hand-rolls `pickedIds`); per-cell width
  control; URL-addressable filter/sort/query state (`MasterTableState` is component-local today,
  invisible to the route, the URL, and any chat plugin).
- Rule whether `ProposedCell` is the permanent wrapper for inherited resolution or
  `StateCellProps.placeholder` ships; add `onLocate` so a migrated proposal fold stays a hit target.
- The trichotomy reviewer rebuilt on `StateCell`; the proposal-flow satellite stands in for it.
- A catalogued chart/series consumer for `--viz-1..6`; ops `CoverageBar` is the designated first.
- Resolve whether `SidePane` and `PaneSplit` remain two primitives now that both live in `lang/`.
- Per-domain host-call façades on the `host/familyfoundry.ts` pattern, plus universal
  `HostIssuePanel` adoption.

### Duplication to collapse (recounted 2026-08-31, census `.artifacts/runs/route-census-20260831/report.md`)

- `timeAgo` is consolidated: one implementation at `lib/utils.ts:10-18`, five importers. Done.
- Global Escape handlers: three with input guards, every guard list different
  (`families/workspace.tsx:130-138`, `takeoff/atlas.tsx:129-155`, `runs/browser/model.ts:165-187`),
  plus one with **no** guard (`family/workspace-core.ts:84-94`). One keyboard policy owed.
- Two hand-rolled Set multi-selects remain: `families/store.ts:75` and `routes/grilles.tsx:37`.
- `ops/primitives.tsx` `DataTable<Row>` is a second, incompatible `Column<Row>` with 12 consumers;
  16 files still hand-roll a `<table>`.

### Annotation backlog (2026-08-31, dispatched to primitives)

Paid at the primitives; the rulings are above and the evidence is
`.artifacts/runs/delegate-20260831/chrome-report.md`. What the round did NOT close:

- The dropdown POPUP is still two languages: the triggers now read as one (mono, item height, 4px
  inset, chevron right), but `CellSelect` is a native `<select>` whose popup cannot be styled.
  Unifying it needs a menu-primitive decision — either the cell adopts `Combobox` and pays the
  keyboard/commit contract, or the native popup is accepted as the cell's one exception.
- Every claim in the round is DOM/geometry reasoning, not eye proof: no screenshot lane ran. The
  scroll-away rail, the seam, the flush bar and the hover-only scrollbar are unproven to the eye.

### Open questions carried forward

- The fixture lane has two spellings: `?source=fixture` and none at all (lane = whether a document
  is open). Rule one.
- Live-lane proof for the route-store cutover is partial: `/family`, `/families`, `/settings` are
  browser-proven; `/takeoffs` and `/chat` are not.
- Decide the front door's brand dot: it earns a real lamp (host connected?) or it goes.
- "Update check unavailable" conflates endpoint 500, dead network, and a dev proxy with no host.
- Write the route pattern into `apps/web/AGENTS.md` (currently 3 lines) — a pattern, not a framework.
- `workbench/provider.tsx` + its adapter (chat internals) are untouched by every pass so far.
- The 2026-08-31 density verdict collapsed caption/label/value to one 10px size. Either the three
  tiers stay as roles (face/case/weight only) or two of them merge; decide before the ADR 0004
  table is rewritten.
- `/takeoffs` has "a lot of obvious problems" (kaitpw, 2026-08-31, unenumerated). Ruled to its
  phase-4 cutover round, not before: route fixes on an unsettled density law get redone. Family
  rows whose identity cell wraps to two lines still break the 20px rhythm (`density round 1`,
  measured); nowrap/ellipsis lands at the same cutover.
