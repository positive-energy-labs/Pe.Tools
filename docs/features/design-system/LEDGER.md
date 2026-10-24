# design-system ledger

Route and navigation sections rebuilt 2026-10-22 against `a553a15a`; unrelated design rulings remain. Git holds the chronology; historical proof was not rerun.

The one-system design cluster: the design LANGUAGE (raw values in `apps/web/src/base.css`, projected by `design-lang.css`, grammar in `components/lang/`, page anatomy in `components/anatomy/`), the `/design-system` route and its satellites, the front door (`/`), and the document lab (`/doc-lab`).

**This ledger owns every cross-route design-language and primitive gap.** Route ledgers name their own applications and evidence; they never restate a ruling or a gap that lives here. A rule lives in exactly one home: a type, a check, a swatch specimen, or `.agents/skills/lens.house/SKILL.md`. `docs/design/SURFACE-PHILOSOPHY.md` indexes those homes.

## Decided
- 2026-10-24, kaitpw: "i think i wanna make basically every even vaguely list-ey scrollbar in our app to be replaced by this" and "there is never a native scroll bar on anything with our special one". The kit has one projection scrollbar. It replaces the native scrollbar on every list-like scroller, and the two never coexist. It merges the gutter minimap and the chat lens bar. Its frame tracks scroll with no lag, is half the old width, and has a translucent fill. Projections are data: the ducts systems list shades each item by its notification count. Design round in `.artifacts/runs/kit-raise-20261023/design/`.
- 2026-10-24, kaitpw: "i want to start moving prob both fix and set into the notif total". The ducts notification total counts fix and set items.
- 2026-10-24, kaitpw: "the virtualization needs a waaay bigger padding". Virtualized lists render a much larger overscan. The design round sets the number in viewport heights.
- 2026-10-24, kaitpw: "i wanted it on the floaters, not the panes, its looks super stupid on the panes too, for the floaters it should be on the inner bottom corner of a resizable floater (keys should prob not be resizable)". Panes have no corner grips. A resizable floater has one resize grip at the bottom corner that faces the pane interior. The floater kind declares resizability: the globe resizes, the keys floater does not. Supersedes the wave 8 pane corner grips.
- 2026-10-24, kaitpw: "i kinda liked the older darker red damage better". Damage uses the earlier darker red, as one token for DOM, SVG and the 3D scene.
- 2026-10-23, I2/L3: Damage uses promoted opacity on one document clock (`damage-beat.ts`); reduced motion keeps static marks. Trailing damage facts truncate and hide before the title loses its 12ch floor. `--pe-alarm` restores the shared `#b3140a` damage red from `55b0df71` in both themes. The swatch carries 200 damaged rows; `damage.test.tsx` and `damage-compositor-motion` guard these rules.
- 2026-10-23, N6: Pane seam drags hold picture layout and scale its retained contents until release; WebGL size changes and drawing share one frame so ResizeObserver cannot expose a cleared buffer. React commit counts alone do not certify stillness.
- 2026-10-23, D18, kaitpw: "a title and a sentence is prob the right schema". A Pea claim carries a short title and one sentence. The title shows on the working surface. The sentence shows one hover or one press away. This keeps the zero-sentence rule on the working surface, and claims are not an exception to it. Owner: `ductClaimSchema` in `ts/packages/agent-contracts/src/ducts.ts`.
- 2026-10-23, L3/P1: Kit `Table` stacks labelled cells below 36rem while retaining header controls and grid navigation; Help documentation uses that table and suppresses its own teaching registrations. TU3 browser re-check remains owed.
- 2026-10-23, L1/P1: Chat headers use `Pane` title tabs and grouped actions in desktop and dialog; New thread carries the visible word `new`, and scope stays in the kit list search row.
- 2026-10-23: List search reserves the measured top stack on the scrollport; headers reduce to one slot before they consume the last row. Input width takes priority over search control words. Chat palette, ducts systems and inbox inherit these defaults.
- 2026-10-23, N1/N6: `PaneSplit` previews pointer resizing through `--pane-size` and commits size/collapse at release; `PictureStage` isolates unchanged picture inputs from sibling updates. Profiler regressions cover 20 drag steps and sibling composer send; browser camera/focus proof remains owed to the wave-8 integration pass.
- 2026-10-23, L2/L3, r6 counsel reading, re-openable: `FloaterSpec.kind` makes pictures (including globe/maps) resizable and legends fixed. One grip sits diagonally opposite the anchored corner (`tr` to `bl`, `br` to `tl`, and conversely), facing the pane interior. Chosen size persists per route/pane/floater; CSS fits it to the field without overwriting that choice. `PaneResizeHandle` keeps only its CSS-centred glyph and full drag seam. `data-minimap="rows"` scopes gutter CSS; native intrinsic popup sizing contains the unfolded/folded globe and clamps to the field. Browser evidence: kit-raise wave9 `floater-geometry-r6.md`.
- 2026-10-23, N7: Hover travel protects the hull of departure and the actual popup rectangle; pointer contact inside that rectangle retains the parent across portal transitions, and nested hints clear the whole parent box. Tab enters references, Shift+Tab returns, final Tab exits in page order and closes, and Escape closes and returns. Subject presses share hover/focus reach and grace, with outline-only landing and no filled reference pill or word box.
- 2026-10-23, N1/I5/L3: Tooltip footnotes keep their containing evidence open; hints flip before shrinking below min-content; folded Floater content uses a fixed, field-bounded portal and keyboard focus with preventScroll (O3, LN-INPUT, D02/O1; browser re-check owed in kit-raise wave 7).
- 2026-10-23, Tutorial reads mounted kit facts from `lang/teach.ts`; controls own keys, search syntax, modes and alternate views, so help follows page state without route-owned lists.

- 2026-10-23, L3: List labels truncate with full text on reach; `listColumns` declares measure priorities once, kit container queries own widths and yielding, and visual tree indentation caps at four levels (Systems tree and quantity readings).
- 2026-10-23, I1: `subjectName` uses names and kinds instead of identities; `healFindings` folds a repair into one row with all subjects and covered finding keys. Inbox titles use structured subjects, and picture pins share the repair number.
- 2026-10-23, N6/L3: `Pane` derives one fixed work chip from `useWork`, `aria-busy` and `data-reading=pending`; promise-returning `Button` presses own busy state and local `OutcomeLine` receipts, refusals and errors. Composer refusals stay under Send; `PictureReadout` reserves its title row. `kit-census.guard.test.ts` rejects status text in floaters and composer interstitials. Browser placement remains unproven.

- 2026-10-23, L4/I2: `scene/grounds.ts` owns subject/context presets and bounds-scaled fog; resting marks obey depth, lit subjects permit x-ray, and glow cuts out full-resolution mesh coverage with half-resolution blur. Census row `scene-ground-presets` rejects local colour/opacity literals.
- 2026-10-23, I2: `damage-mask-depth` requires the halo mask to share the skin's `SURFACE_DEPTH` bias; otherwise base-depth competition punches coverage holes and leaks glow across faces. Native equipment 6105264 reproduced the failure at yaw 230/elevation -15; the material test pins both offsets.
- 2026-10-23, N1: Kit `LiveOrbit` publishes released gestures only beyond three screen pixels or a 0.5 percent zoom ratio; selection alone never writes a viewport.
- 2026-10-23, N5: `PictureStage` owns perspective and parallel projection through its layer Switcher and O key; `viewportCodec` carries the projection so links and history restore it.
- 2026-10-23, N7/L2/L3: Hover travel uses kit HOVER_GRACE; Floater folds by field container size; declutter owns bounded annotation placement, with subject hover prioritizing dropped captions.

- 2026-10-23, I4: A picture `Pane` derives its crumb from its scope title, `PictureReadout` subject and selection, and `PictureStage` selection state. `PaneCrumb.segments` remains only for a scope the picture cannot know.
- 2026-10-23, I5: A picture `Pane` supplies its projected selection box, or pane rectangle, through the reach channel. `SubjectPopoverContent` uses it across sibling panes; routes do not provide `SubjectBox`.
- 2026-10-23, N7: `Scene3D` and plane-stage native targets share the kit row reach channel. Ducts retains aggregate lighting and footnote numbering.
- 2026-10-23, N6: `listOf` carries a Reading's retained observation and lifecycle into lists and tables; census row `reading-list-adapter` rejects local extraction that drops that lifecycle.
- 2026-10-23, N4: Row renderers infer native targets from element identity and numeric keys within the captured RevitScope; census row `row-revit-inferred` rejects redundant identity callbacks.
- 2026-10-23, I2: `rowDamage` owns declared cell/verdict roll-up independently of hidden columns; plan and mesh damage consumers read the row model.

- 2026-10-23, P1: `Pane picture` requires a legend; `Scene3D` and plane hosts require a readout slot; `PictureStage` requires the go-to slot; zero-argument `useStage` reads its node and verbs from that context. Kit keeps `useScopeGestures` private; the existing `ScopeGestures` component declares scoped gestures with these rendered slots.

- 2026-10-23, I2, `kit-census.guard.test.ts` / `css-damage-owner`: Damage selectors and pulse have one kit CSS owner.
- 2026-10-23, I1, `kit-census.guard.test.ts` / `subject-fallback-ids`: Subject fallbacks cannot interpolate raw element or region ids.
- 2026-10-23, L2, `kit-census.guard.test.ts` / `picture-furniture-floater`: Corner furniture uses Floater; registered picture marks use class selectors, independent of token order.
- 2026-10-23, L4, `kit-census.guard.test.ts` / `surface-plane-inferred`: Supporting planes are inferred; detached native portals state why their plane is explicit.
- 2026-10-23, L3, `kit-census.guard.test.ts` / `kit-hover-layout`: Hover and focus CSS cannot change layout dimensions.
- 2026-10-23, N7, `kit-census.guard.test.ts` / `web-hover-handler`: Pointer handlers require domain or timing ownership; five SVG geometry paths share one reason.
- 2026-10-23, N7, `kit-census.guard.test.ts` / `kit-reach-block`: One kit CSS reach block declares rest, reach, hover and focus.
- 2026-10-23, I6, `kit-census.guard.test.ts` / `t-prose-ratchet`: Each reviewed prose exception has a per-file ceiling dated 2026-10-23.
- 2026-10-23, N3, `kit-census.guard.test.ts` / `nav-list-kit`: Navigation lists use kit; static messages and tutorial keys state their exceptions.
- 2026-10-23, N4, `kit-census.guard.test.ts` / `list-owner`: Kit owns landing attributes and list-search persistence.
- 2026-10-23, N3, `kit-census.guard.test.ts` / `slash-owner`: ListView arbitrates slash; composer slash remains text editing and skill selection.
- 2026-10-23, I5, `kit-census.guard.test.ts` / `native-title-hint`: SVG hints use kit instead of native title elements.
- 2026-10-23, I4, `kit-census.guard.test.ts` / `crumb-handbuilt`: PaneCrumb owns scope and selection breadcrumbs.
- 2026-10-23, N2, `kit-census.guard.test.ts` / `scene-keys`: Scene owns frame, gesture-history and history-key policy.
- 2026-10-23, N4, `kit-census.guard.test.ts` / `revit-target-attr`: Kit owns Revit target declarations, including transparent boundaries.

- 2026-10-23, `LeaderDiagram` owns monotone segment-to-label leaders, including composed Table rows; ducts imports it for fan facts and loss breakdowns (house laws 4 and 10).
- 2026-10-23, N7 reach uses kit `reach.ts` and `[data-reach="rest|reach|hover|focus"]`. The reach block in kit `lang.css` owns hover paint. Rows, subject text and the web scene adapter share the existing scoped channel; `ReachStore` stays private to kit.

- 2026-10-23, kit-raise N8 and CSS ownership, requested by kaitpw: `useMinimap` at `@pe/kit/lang/minimap` gives `ListView` and `MasterTableBody` one gutter overview at 200 shown rows. The threshold is provisional under M1. Virtual ranges drive the viewport; section/tree heads and `data-damage` drive marks. Pointer and keyboard jumps use `list.reveal()` or the table virtualizer plus `land()`. The 200-damaged-row specimen lives in `lang-list.tsx`. `design-guard.test.ts` checks authored class ownership across its complete CSS entry/import graph. Contextual overrides of shared classes require a file/class reason and stale exceptions fail. Column-header rest rules belong to `button.css`; their interaction paint stays in the single reach block. `REACH_STATE_OVERRIDES` permits only `dl-button`, `dl-cell`, and `dl-verdict` state rules inside that block without assigning another class owner. `lens.css` alone owns `chat-tail-floater`.

- 2026-10-23, kit-raise N4: kit `RevitTarget` requires the displayed observation scope and owns layout-transparent target boundaries. `Row revit`, `FactChip revit`, and `SubjectText` tokens inherit that scope through portals. The web root retains the one Selection Box / Select menu; null and non-native scopes still refuse native actions. The specimen is `lang-list.tsx`; `kit-census.guard.test.ts` rejects hand-authored target attributes; the scope helper is private to the native menu.

- 2026-10-23, I5: the subject owns overlay geometry through kit `SubjectBox`; public `SubjectPopoverContent` omits `side` and `align`, while kit keeps placement internals private. Popover and HoverCard share one open slot, and Escape stays inside that slot (or its active editor). `facing` projects actual placement to row order. SVG marks use kit `SvgTip` with a short word instead of a native title. Consumers include ducts bars, schematics, family views, rooms and takeoff; placement and legibility still require the browser pass.

- 2026-10-23, kaitpw leaves Space Escape-to-3D pending a personal ruling. The production pass preserves that behavior; no navigation fix in this pass changes its meaning.

- 2026-10-23, counsel for kaitpw's doctrine (docs/design/SURFACE-PHILOSOPHY.md N1, I2), from propagation slice S1: kit focus never scrolls (`focusQuiet` in `kit/lib/utils.ts`); a list or table scrolls to its cursor only when a key moved it or a reveal named it, never on hover, refresh or resize, and a list starts with no cursor. The 2D counterpart of the stage's critical-damage burn is the kit damage mark: `Row damage="<word>"`, `row: () => ({ damage })` in `useList`, `Table damage={(row) => word ?? null}`: a static alarm outline and wash, a synchronized opacity beat, and a trailing damage word that yields before the title. Blocking rows only; calm rows stay calm. The master table virtualizes at 60+ rows (`Table keep(row)` holds rows a picture or connector points at); `SubjectBox` supplies inherited subject geometry so overlays open away without a call-site override. PROVEN[browser production harness, 2000 rows, a4c0728e, 2026-10-23]: mount 1192 → 64–91 ms, row click no long task, scroll p95 16.9 ms.
- 2026-10-23, owed shell/kit corrections: `TableFrame` filters use Shift+F; F remains framing on spatial stages. Closed list search and committed keyword search hand ArrowDown to rows; Escape retains its existing layers. `ArtifactFrame` supplies its default flex fill, table summaries shrink, and `PaneStrip` spends metadata/control space before identity. `PaneSplit` reserves the gutter and both minima; named support panes collapse to rails, with Family's Doc pane declaring its rail. `Floater` tests all earlier siblings and readout docks even without a legend. Native hover hints use `TooltipHint`; the native-title guard is green. Browser evidence and residual live-route limits: `.artifacts/runs/browser-20261023-shell-kit/REPORT.md`.

- 2026-10-23, **provisional, counsel while kaitpw away**: list search is literal whitespace-separated keywords (AND, case-insensitive; element IDs exact) plus explicitly picked equality pills. Typing `air:` stays text. This supersedes the list-kit query-grammar ruling of 2026-10-22; tables retain their grammar.
- 2026-10-23, **provisional, counsel while kaitpw away**: inline completion and a visible Filter button expose the same field/value picker. Only an explicit value pick commits; cancellation preserves the original text and pills. One equality per field; a new value replaces that field in place. Show zero-count values disabled, with counts under the other active conditions.
- 2026-10-23, **provisional, counsel while kaitpw away**: Escape closes completion first, then clears keyword text, then removes the last pill, then hands focus to the rows. Empty-input Backspace reopens the last pill in place for editing (value selected, counts live); Escape restores it, a second Backspace on the emptied value removes it (supersedes "Backspace removes the last pill", per kaitpw's slice brief). Clear search (× in the bar) removes keywords and all pills. IME confirmation does not pick a suggestion, move a cursor or activate a row; the guard sits in the collection's key layer, so every input-owned list inherits it.
- 2026-10-23, **provisional, swarm slice D**: list search and the table query share one completion primitive set: the caret-anchored `ListPopup`, `CompletionGhost` (the untyped remainder after the caret; Tab or → at the end takes it) and `Matched` (typed characters at full ink, the rest ink-2; weight is reserved for unsaved, house law 6). A typed word suggests matching values across every field (`Air type: Supply · 143`) and matching fields; row one is the typed words with their count, cursored, so Enter keeps them, which keeps the explicit-pick ruling intact. Pills sit inside the box and an edited pill keeps its place. The field menu opens on a click into the empty box, ↓, or Filter, never on focus alone; the placeholder names the fields and an unfocused bar shows its `/` key. The grammars stay separate by ruling: tables parse, lists take literal words plus pills.
- 2026-10-23, **provisional, counsel while kaitpw away**: each list owns one versioned JSON search field in the URL (`v:1`, `keywords`, `pills`); typing replaces after 250 ms idle, explicit picks and clears publish immediately. Retire the old query keys without a grammar migration. Restored unsupported versions, fields and operators refuse visibly; sort stays separate. Chat's non-archived default is an explicit Scope: All pill.
- 2026-10-23, **provisional, counsel while kaitpw away**: Systems starts with Air type, Price status and Needs a fix. Needs a fix means at least one scoped inbox Fix row holds the price; `systemsNeedingFix` reuses `triage` and `holding`, including non-blocking Heal rows and shared-system scope. Unpriced alone is not a defect. Adopters are Systems, Rulings, system tree, Inputs and chat threads.

- 2026-10-22, list latency: input echo stays local, filtering runs in a transition, and `useList` publishes typing after 250 ms idle. Ducts and chat replace the address. Ruling action/detail JSX is built only where mounted/open.
- 2026-10-22, thread sidebar correction: the pane header owns Ctrl+K and New thread beside Threads/World. Threads uses a flush body; search and rows share its edges. Keyword/pill controls below search supersede the interim horizontal filter row (2026-10-23). Keep the darker side/search surfaces and main's dim-surface hairlines; do not restore a separate action row or padded filter block.

- 2026-10-22, list kit ruling: one data-owned `useList` and one virtual `ListView` extend the collection core. Navigation lists use address-owned search and sort, counted filters, and sticky collapsible sections; the keyword/pill ruling of 2026-10-23 supersedes their initial table query grammar. Selection is single except where bulk verbs exist. Virtual lists have no paged tails. Row stage uses a left-edge mark and bold title; inline ruling details stay in the row. Supporting sidebars recede at the pane boundary with existing surface tokens; search and sticky heads take a distinct existing plane. Ducts holds Rulings, rooms holds Feedback, chat's former Inbox scope means Attention, and the Home/tray ledger is Activity.

- 2026-10-22, visited route tabs retain independent Page and DOM state through React Activity. Hidden tabs release Effects and Pea leases and cannot initiate navigation or actions; actions admitted while visible still finish their original Work bookkeeping. Closing a tab disposes its owner. Shared reading lifetime belongs outside these retained trees, so keeping a tab mounted is never the data freshness rule.
- 2026-10-22, route primitives distilled (muse, kaitpw: "yes I like it all ... i love love love the deep address idea"). Goal: deep modules with clean interfaces; route primitives exist so a product can be POC'd quick and dirty and every product shares one navigation idiom a user's knowledge transfers across. The contract splits by owner: a field kernel in `agent-contracts`, one address file per route beside its domain, no domain constants in the contract. Callers reach a route through one deep `address(route)` object (`schema`, `read`, `write`, `link`, `history`, `agent`, `transition`), never loose helpers; new capability grows as a method on it. Entity-route machinery leaves `route/manifest.ts` for its own module; pure duct logic lives in `ducts-domain`, the manifest only declares and wires; one plane viewport serves Space, Rooms and Takeoffs; a layers field declares its own on-set default. Every route adopts the contract (entity routes via an `entity-wave-c` rework, the thin routes, the C# Pods link) as a stress test: each adoption records what the primitive or the route lacked. Rejected: generating addresses from C# (no consumer for the crossing); dropping the package for TanStack `validateSearch` (Pea reads and sets fields host-side, without the web app).
- 2026-10-22, thin routes adopt the route contract (L5 stress test of the distillation). `/duct-loss`, `/parameter-links`, `/captures`, `/data-tables`, `/settings`, `/ops`, `/`, `/bind`, `/pea` declare every navigable key; `/rooms` gained its inbox filter and pinned card. Routes with no manifest (Home, Settings, Ops, Bind) now own a Page through `useAddressPage(route)` and a file route through `routeFile(route)` (`route/address-page.ts`), so Back/Forward, the history rule and Pea's lease are the same as a manifest route's; `useRouteLease(route, page, { facts })` mounts the lease in one call. Pea leases `/duct-loss`, `/captures`, `/data-tables`, `/settings`, `/` (all keys settable except Settings `session`); no lease, each deliberate: `/ops` (admin door, Pea runs ops through `pe_do`), `/bind` (binding is the person's press), `/pea` (the chat is where Pea reads its thread; a thread tab never holds it), `/parameter-links` (its only Page key is the profile rail's fold; Pea edits the draft through the route's actions). Dead keys deleted: Parameter Links `view` and `demo` were declared and read by nothing. Left as widget mechanics, not fields: Takeoffs atlas table query/sort and layout toggles, Takeoffs partition-review selection, the Home ledger's open groups (shared with the tray), Ops request form values, the Data Tables draft. The C# Pods link now derives from the contract (see Owed).
- 2026-10-22, route tabs retain canonical Places with explicit target and work; the route URL owns the active Place and chat docks beside it. Thread memory never stores active focus. Counsel's implementation choice under autonomous authorization: stable tab IDs permit distinct Places on the same route, per-tab last writer wins, and a later adjustment may reopen a tab closed in another window; exceeding twelve tabs refuses rather than evicting another Place.
- 2026-10-22, spatial coordination: null viewport means fit the displayed subject without writing the resolved pose during render. Plan and iso preserve yaw, pivot and zoom; cardinal looks replace yaw. Human and Pea transitions reject explicit incompatible mode/viewport pairs alike; URL restoration may recover an invalid pose to fit and never replays native actions.
- 2026-10-21, shared route implementation authorization (thread `3e493705-4c3a-4996-9e1a-175a24cf201a`, kaitpw: "i want you to do them all autonomously with a sol and opus swarm on fast"): replace React-owned Page with one route-owned reactive View model, not a second writable copy. Derive URL and Pea projections from shared field definitions with independent access policies. This supersedes today's "Page stays React state" and "Pea sets exactly a route's url keys" rulings below. Work remains host-owned; View transitions never replay native actions.
- 2026-10-21, implementation interpretation under that authorization: the active route's Place owns the URL; browser workspace focus is local, while thread tab memory is durable. Native reading actions use the displayed observation's exact document and existing element references, with no active-document fallback. Select and Selection Box retain distinct effects and truthful outcomes.
- 2026-10-21, spatial views muse (kaitpw: "agree on all"; consumers: space, ducts, rooms, takeoffs, families minimap, chat lens). The nouns: a **field** is the large thing navigated (table, plan, scene, transcript); a **viewport** is where in it you are, one of three kinds, `scroll`, `plane` {scale, tx, ty}, `orbit` {yaw, elev, pivot, zoom}; a **minimap** is a small picture of the whole field with the viewport box, and a click on it writes the viewport; a **floater** is a corner surface over a pane, a minimap is one kind and a picture swap another; a **mode** is a pane's exclusive stance; a **layer** is a toggleable overlay, and an underlay is a layer that paints first; a **subject** is what the route is about; an **answer layer** is a spatial verb's answer drawn. Shape S2: viewport, mode, layers and subject are Page keys built by helpers that also emit their zod and URL rule; `Pane` draws one standard strip for modes, floaters and layers from props; `Scene3D` is cut from the spike's `space/canvas.tsx` (three.js, `BatchedMesh`) as the one 3D renderer and the ducts SVG orbit (`ducts/proto/orbit/`) retires, its globe becoming an `orbit` minimap; a WebGL canvas sets `data-revit-ids` on itself from the raycast under the pointer, so the element menu serves it with no new door. Rejected: manifest-declared panes now (collides with the 2026-09-15 line below, grows out of S2 later); viewport in Effect atoms beside Page (a second writable model; the render ack is the proof Pea moved the page).
- 2026-10-21, kaitpw: Pea sets exactly a route's `url` keys. The hand registry `routeViews` in `agent-contracts/src/route-view.ts` folds into the manifest; a Pea patch is a navigation and one history entry; the word resolver (a system name, "frame FC-17", "look from north") lives on the manifest page key. Page stays React state behind `setPage` (`route/use-route.ts`); no atom.
- 2026-10-21, kaitpw: the viewport rides the address as kind-typed keys. A continuous gesture (wheel, drag, orbit) writes with `replace`; a named move (frame, preset, minimap click, mode swap, a Pea patch) pushes. Table scroll never pushes; `selected` already does.
- 2026-10-21, kaitpw: a link inside help prose is a take-me-there. The help page closes on the click (`route/help.tsx`), so the row it lands on is what the person sees; a help that stays open over its own answer is wrong on every route.
- 2026-10-21, the element menu: anything that stands for Revit elements answers right-click with Revit's own verbs, **Selection Box (BX)** and **Select**, and answers BX under the pointer or focus; double-click stays free. A surface only declares its ids (kit Row/Tree/List/Inbox `revitIds`, or `revitTarget(ids)` on any element); one delegate at the app root (`apps/web/src/revit/element-menu.tsx`) serves every route, and `revitScope(doc)` on a route root names its document. Selection Box selects, section-boxes `{3D}` (else `{3D - username}`, else a made "Pe 3D") with a generous margin and zooms to fit (`revit.context.show-elements`); Select only selects (`selectOnly`). kaitpw: "the context menu actually feels like the most revit-familiar ux", "i hate adding random buttons everywhere"; verdicts: BX + plain Select, double-click free, kit-wide. The one visible door stays where a selection must offer Revit in plain sight (`SelectionBoxButton`, the ducts selection strip). Consumers: ducts (tree, rules, inputs, fans, inbox, split bars, claim chips, drawing).
- 2026-10-21, ducts round, cross-route laws kaitpw stated while verifying `/ducts` (route evidence in `docs/features/ducts/LEDGER.md`):
  - The Situation draws every verb that reaches outside the route, the same button as in the page, adapting to the selection. kaitpw: "its always been my intention that the situation exposes every single button that reaches outside of the route just for the sake of visibility", "it should never feel like an effectful button can be hidden away". Consumers: ducts, families.
  - A link lands on its row: a `selected=` that only highlights the picture is a defect; selecting a thing opens and highlights every row that names it, and every selection offers "show in Revit". Consumers: ducts, rooms, takeoffs.
  - A collapsed diagnostics group carries a key: one chip per kind with its count, and picking a chip filters both the rows and the picture's annotations; with no chip picked the picture annotates only what has a verb. kaitpw: annotations "rly busy the view in a way that makes it super hard to navigate". Consumers: ducts, spatial views.
  - A person's own typing is the decision; propose-then-stage stays for an agent's proposals and for engineering rulings. Edits accumulate as a pending list shown old → new before one write, and a refused item says why. Consumers: ducts, schedules.
  - Explanation prose belongs in the tutorial, never as a row on the page. kaitpw: "prose like this should live in tutorial".
  - A missing value never draws as zero: the cell reads "no drop" with the reason on hover (law 2 of `lens.house`, applied).
  - Humans see names, never ids: the firm's tag parameter labels units; group ids leave the UI.
- 2026-10-19, lock shade (kaitpw: "tables pinned first col should get a shadow when its pined"): when a table scrolls sideways, the scroller sets `data-scrolled-x` (`ts/packages/kit/src/components/master-table/table.tsx`). The last `data-lock` cell in the head and every row then casts a 6px shade gradient over the rows under it. At rest there is no shade. The rule is `::before`, because a body cell's `::after` is its inset row rule (`lang.css`, THE LOCK SHADE). PROVEN[browser, no-revit pair 5175, d5cb0f3a + working tree, 2026-10-19]: shade opacity 0 at scroll 0 and 1 at scroll 200, on the right edge; the row rule is still 1px.
- 2026-10-19, picker polish round 12 (kaitpw: "i think i like the new will width search. but not should be right, and more button-ey or a press. the the input box must get at least some sort of color designation. or maybe inset shadows"):
  - A list's search bar is a well: `--pe-recess` ground plus `--shadow-well` (`inset 0 1px 2px var(--pe-shade)`, `ts/packages/kit/src/base.css`).
  - `SearchControl` has a `trail` slot, and `List` has `searchTrail` (formerly `searchLead`). The `not` toggle is a framed press at the bar's right end. At rest it stands on the page ground; pressed, it sinks into the well with an ink-2 border.
  - A press on a hover-opened `HoverCard` trigger keeps it open; a second press closes it (`ts/packages/kit/src/components/lang/hover-card.tsx`).
  - After a press, hover hints wait until the pointer moves. A layout-only mousemove has no movement and does not count (`tooltip.tsx`, test `ts/packages/kit/tests/tooltip-still.test.tsx`, red without the rule).
  - Query-box suggestions are sized as a picker (18–20rem). Composer caret menus stay `autocomplete`.
  - The dialog content grid is `grid-cols-[minmax(0,1fr)]`, so a wide row truncates and never scrolls a dialog sideways. This fixes the Pea thread palette (`ts/apps/web/src/components/lang/dialog.tsx`).
  - Typing an option column's name in the query box still offers operators. That is kept: the box writes text, while the column menu implies `is` (counsel, re-openable).
  - PROVEN[browser, no-revit pair 5175, d5cb0f3a + working tree, 2026-10-19]: the thread palette is 510px with no overflow; a hover then a click leaves the workbench open; `not` sits 5px from the popup's right edge and reads `aria-pressed=true` with the inset shadow; the column-head frame shows on hover with the label fixed at x 232.67. PROVEN[deterministic, same commit]: kit 112 tests pass; web 449 pass, and the one failure is other sessions' native-title hits.
- 2026-10-19, table controls round 12 (kaitpw: "i prefer the main body font we had before. i think it was just the headings and title that i dont", then "fold yes and regular ink-2"):
  - The body sans stays Open Sans, loaded from Google Fonts in `ts/apps/web/src/styles.css`. The trial fontsource faces and the font switcher are deleted.
  - `TableFrame` has no title in its head. `label` is the frame's accessible name only. A pane, a tutorial or a separate label element names the table.
  - The head is the fold: one line of chips that ends "+N more". Focus, or an open picker, unfolds the line into a drawer across the full frame width, above the grid and below popups. Code: `useFoldCount` in `ts/apps/web/src/components/master-table/table-frame.tsx`, CSS `[data-table-fold]` in `ts/packages/kit/src/components/lang/lang.css`.
  - Column heads (`role-colhead` in `ts/packages/kit/src/base.css`) are Open Sans regular in ink-2. Candidates seen: `.artifacts/runs/deterministic-20261019-table-protoui/shots/heads-r12.png`.
  - The schedule row-number gutter has no sort, because row order is the schedule's own order (`ts/apps/web/src/route/schedules/columns.tsx`).
  - PROVEN[browser, no-revit pair 5175, d5cb0f3a + working tree, 2026-10-19]: no title in the frame, 32px head, heads at weight 400 in ink-2, the drawer opens absolute with a 22px lead. PROVEN[deterministic, same commit]: kit 111 tests pass; web 449 pass, and the one failure is the native-title guard on `components/lang/conversation.tsx` and the control-surface prototypes, both from other sessions.
- 2026-10-19, table controls round 11 (counsel, re-openable; kaitpw ruled head variant A "is best, but i still dont rly like it"): column heads are plain labels at rest and wear the control frame only on hover, focus-visible or open, with a transparent border reserved so nothing shifts (`base.css` `[data-colhead-trigger]`); the header row is exactly `--item-h` with its hairline drawn inside (`master-table-header.tsx`); a body row is exactly `--item-h` and a cell never pads vertically (the 28px rows were the specimen fixture's `py-1`); `role-titlebar` is sans at `--type-title-size` strong, the serif default is gone; `Rail` gains `size="control"` (32px comfort, 28px dense) and `ArtifactFrame` uses it for head and foot, because a frame inside a route is subordinate to the route rail (`--rail-h` unchanged). `SearchControl` has two faces from placement: `framed` (default, a table's title bar) and `bar` (full-bleed command line inside a popup or pane, used by `List`); the crumb band, the bar and the rows share one inset. PROVEN[browser, no-revit pair on 5175, 2026-10-19: header row 24 = body row 24, header text x 21 = cell text x 21, frame head 32px]; PROVEN[deterministic, kit 111 tests]. Evidence `.artifacts/runs/deterministic-20261019-table-protoui/{polish-r11-lang,head-r11,geometry-r11}.md`, shots in `shots/`.
- 2026-10-19, table controls round 10, counsel defaults in an autonomous session (re-openable by kaitpw): table typography is A (serif `role-titlebar`, sans `role-colhead`); B's uppercase columns were superseded in round 2 and C's mono labels contradict mono-means-measured, so the `?type=` switcher is deleted. The Filters trigger keeps its word. Named default filters are done as built (`QueryVocabulary.filters`, chip detail `default`). A column with declared options opens on its values with `is` implied, `not` writes `!=`, and `is empty` plus the sort rows follow under `other`; its operator rung draws no crumb. A suggestion row's hint is a short fact and its explanation goes to the list description, never the meta slot. `SearchControl` focuses its input only for clicks inside its own DOM, because React bubbles portalled picker rows through it. A picker popup gives initial focus to its search input, not the first lead button. PROVEN[browser, no-revit dev pair on 5175, d5cb0f3a plus working tree, 2026-10-19: Filters › Shared opens on values at 288px with crumbs `Shared › value`, focus in the picker search, no second popup]; PROVEN[deterministic, kit 114 tests, 2026-10-19]. Evidence: `.artifacts/runs/deterministic-20261019-table-protoui/{polish-r10-a1,polish-r10-a2,cleanup-r10,census-r10}.md`.
- 2026-10-19, kaitpw on the table head after seeing round 10: head variant A (column headers plain at rest, the control frame only on hover, focus or open; header row at body row height; sans title at the chrome rung, the serif goes; one title line with the controls) "is best, but i still dont rly like it"; the column headers "look too blocky/low res"; a new bundled sans is to be found (Open Sans is not bundled and falls back to Segoe UI). Picker search inside a popup returns to a full-bleed command line (`SearchControl face="bar"`), while a table's search stays `framed`; the face comes from placement, never the call site. Round 11 builds these on the specimen with `?font=` and `?weight=` switchers.
- 2026-10-19, table controls round 9 verdict: pickers stay compact with hard width limits and little variation between levels. Shared picker width is 18–20rem, capped by available viewport width. Descriptions do not affect intrinsic width; wrap long tokens, clamp to two lines, and expose full text through their floating hint.
- 2026-10-19, table controls round 8 verdict: preserve optional item explanations, render them only when present, and distinguish them from the row's trailing facts. Empty List descriptions and footers draw neither space nor separators. Column explanations stay on the column header's floating hint. Sort rows show priority as metadata, not a sentence repeated below.
- 2026-10-19, table controls round 7 verdict: NOT is an attached control on the operator picker's search field, using the same leading-segment composition as Filters. Preserve polarity across binary value picks; comparisons keep their direct meaning.
- 2026-10-19, table controls round 6 verdict: put shown/total row counts in the search placeholder, let search use remaining title-bar space, keep its glyph beside the input, integrate the filter chooser as its leading segment, add inner padding, and superscript sort direction/rank beside column titles. Named default filters must remain visible and removable expressions of the same query; their reusable representation is under review.
- 2026-10-19, table controls round 4 verdict: unify action identity, availability, invocation, keyboard bindings, menu hints, and Tutorial through the existing kit scope machinery. Include ordinary cell navigation in automatic discovery. Picker surfaces own purpose-specific sizing, focus, dismissal, and ladder behavior; table filters must use the full composition. Search needs a persistent shared control frame. The user authorizes revising standards at their shared source rather than adding table exceptions.
- 2026-10-19, table controls round 2 verdict: retain the accepted interaction layout, require a distinct table title, and place query controls at the right of its title bar. Explore title and column typography as shared roles; restore stronger column ink. Column pickers use the standard picker without a heading, put negation and explanations in its footer, collapse binary opposites behind negation, and close after a completed choice. Cells expose context actions derived from their column capabilities. Narrow headers must remain separate and readable. Supersedes round 1's acceptance of the title's uppercase column-label treatment.
- 2026-10-19, table controls round 1 verdict: retain the current inline query layout, leaning toward C; expose a hover workbench derived from each table's capabilities, reuse existing conditions and purpose-specific autocomplete, and make header buttons integrate filtering. Uppercase is acceptable; paired arrow glyphs and prototype-only design exceptions are rejected. See [round frontier](MAP.md).
- 2026-10-14, owner kaitpw, item 6: a Revit session with unknown product documents gets a non-selectable explanation that Pe.Tools must be installed and Revit restarted; a known empty session keeps its empty state; [document picker](../../../ts/apps/web/src/route/situation-ladder.tsx).
- 2026-10-14, owner kaitpw, item 5: Send carries idle, running and refused state without a status word; one footer under the draft holds send, target or attachment refusal in compact and full composers, and the refused Send has a caution tone and TooltipHint; [composer](../../../ts/apps/web/src/chat/composer.tsx).
- 2026-10-14, owner kaitpw, item 4b: suppress a notice card only while a visible, focused Pe.Tools surface shows its thread; five-second presence beats expire after ten seconds, and attended items still advance the tray cursor; [notices](../../../ts/apps/host/src/notices.ts).
- 2026-10-14, owner kaitpw, item 4a: notice cards anchor at the top-right of the primary work area so they do not cover the composer; [CardBoundsFor](../../../dotnet/Pe.Host.Tray/NoticeWindow.cs).
- 2026-10-14, tray pop round 2 rulings (owner, live on the tray frontend): E the bare hint is the default hover preview; H the content peek stays; F the page miniature stays in principle but its render was empty for the owner (owed); G status-first not yet ruled.
- 2026-10-14, tray pop round 2: owner accepts 350 ms hints, 500 ms preview opening and 200 ms closing, with hover inspection and click/Enter interaction. Native hint titles across web and kit become kit Tooltips; semantic iframe titles and aria-label names remain. The native-title guard holds hints at zero.

- 2026-10-14 (round 2), with no installed app a tray hand-off opens an Edge app window (`--app=`) at the exact page asked for, never the startup page; the install prompt lives only in Settings > Host. Settings with no section opens what waits, else the first group whose header disagrees (caution/alarm), else nothing; a group the person closes stays closed.

- 2026-10-14, kaitpw: Settings replaces Machine as the machine/app destination. One accordion owns Revit, Update, Share, providers, Host/startup, Notifications, Appearance and diagnostics; `?section=` selects its group. Tray Settings stays local. This supersedes the earlier canonical-Machine/custom-panel presentation, not the underlying owners of values.
- 2026-10-13, one router-independent AppBar takes a surface capability record; allowed mounts, commands, field and Settings scope are data rather than tray-specific branches (`navigation/surface-host.tsx`, `navigation/app-bar.tsx`). Page options reject stale writes after unmount; durable preferences retain their owner. Theme stays browser-profile-owned.
- 2026-10-13, the latest compact shell uses a horizontal control rail inside the one Situation drawer, not a hamburger or second popup. Normal WCO dragging wins on empty topbar ground; interactive controls stay no-drag. Actual tray geometry comes from stable WebView2 and DWM through the surface adapter, never a polyfilled browser WCO API. Browser geometry does not establish native pointer/DPI acceptance.
- 2026-10-13, navigation B is current: one route/search field, grouped shortcuts, divider, conditional feedback Cancel and Settings. Resting width fits content with a 9rem minimum and 14rem cap; active search uses that width. The anchored list shares its query and edge, keeps 24rem where possible and fits the viewport. Focus restoration alone does not open it; click/type, Enter or ArrowDown may. Escape/outside dismissal clears query. Older 20/32rem designs are superseded.
- 2026-10-13, Situation is neutral ground with route-owned sentence, verbs, Work and log. Hover/focus and the real page-picker lifecycle hold the same mounted drawer, with 500 ms departure grace; pin docks it into flow. Hidden/hosted routes cannot publish the active hold. Global search does not claim page-picker focus. Archived observations do not claim current Revit health.
- 2026-10-13, `HotkeyCommand` admits click and key through one callback. Page Ctrl+K remains scoped; Ctrl+Shift+K searches globally; Alt+/ opens Tutorial; Ctrl+. toggles Situation; Ctrl+Shift+. starts Feedback. Above 700px show written chords, otherwise proportional drawn modifiers and terminal keys; keep written accessible labels. Home uses the favicon and Pea its chat icon. Browser tabs omit custom Back/Forward; installed standalone/WCO retain them. Native caption dimensions remain browser-owned.
- 2026-10-13, navigation groups tools by engineering task; A-Z removes groups but keeps Works attached. Global and Pea palettes share one List implementation. Immutable thread IDs are searchable/copyable; titles never stand in for identity. Compact thread rows retain target/provider context; the full sidebar remains expanded. Exposure labels do not certify quality or availability.
- 2026-10-13, directory query/exposure/sort are shareable URL state; Work disclosure is local. Visible controls and Settings write the same validated state without dropping unrelated parameters. Actual Work discovery/resume remains Owed.
- 2026-10-13, shared-shell boundaries: AppBar owns one bottom hairline; stable control attributes survive popup focus-guard siblings. Native caption exclusion governs usable width; unavailable geometry gets ordinary chrome. Compact Open owns inner scrolling so its sticky commit remains reachable. The composer shares conversation gutters, not the timeline rail. Edge blank-space overscroll is stopped at the app document/root pane, leaving portable foundation scrolling alone.
- 2026-10-13, historical browser evidence covered 340/480/760/1280px shell controls, inner-scroll recovery and real-thread composer alignment; a refreshed dev SPA showed one native row. Native wheel, hover/drag crossing, thin-border resize, multimonitor DPI and installed caption behavior remain distinct acceptance gaps. Browser measurements and screenshots are not native proofs.
- 2026-10-13, ribbon organization retains existing commands until a concrete replacement exists (`ButtonRegistry.cs`); browser launches require exact Target selection rather than invented identity. Windows Edge is the primary WCO/PWA target, Chrome optional. Manifest identity stays stable and theme-color follows the resolved bar. Native link/codecs and installed shell checks remain Owed.
- 2026-10-12, the canonical agent address is `/pea`, manifest key `chat`; this changes neither conversation nor Work identity. Navigation A won for task discovery with B's resume-work affordance. Multiple Works/nesting remain open. Global controls stay in global chrome; page verbs do not move there merely to fill a bar.

### ADV2-S3 owner provenance, restored verbatim

These rows are byte-for-byte text from `34bd5e17`. The searchable comment preserves the pre-purge row id. A later ruling can supersede behavior, but it does not erase the owner's words or attribution.

<!-- ADV2-S3 R16 -->

- 2026-10-12, recents slice of `@` landed: `recentRows` in `ts/packages/agent-contracts/src/mention.ts` makes `recent` capability rows from Revit's recents (`recent:<path>`, `recent:cloud:<region>/<projectGuid>/<modelGuid>`), drops `.rte` templates and any document already open (the `doc:` row wins), labels families, and counts a local path's words once so an open document wins a shared search; `mentionOf` gives `openWith` = the recent's own path or `cld://` source, which the host's open verb takes as-is. The catalog caches recents 5 minutes with a 2 s budget. `pe_do` refuses a recent and points Pea at opening it. The `@` menu shows a Recent group. PROVEN[deterministic: contracts 130, mcps 105, web chat 38; live read-only on a private host against 109 real recents, `pea find Fowlkes Studio` returned the cloud row, 2026-10-12]; UNPROVEN[kaitpw's dev host serving them; Pea opening a recent end to end].

<!-- ADV2-S3 R17 -->

- 2026-10-12, kaitpw: recent documents are the next `@` slice (Revit's recents, read without a running Revit, carry local paths and cloud model ids). Cloud browsing for Pea is wanted ("as long as pea ends up having some way to browse the cloud that's all that matters") and follows the standing rule that Pea's Revit verbs go through the host catalog as SDK verbs with receipts (`docs/features/agent/LEDGER.md`), not a Pea-only CLI path: the SDK browses companies, projects and folders by name through a signed-in Revit (`pe-revit doc list --cloud --hub NAME --project P --folder PATH`, each entry returning its next browse command and an `exactSource` for `doc open`; bridge route `/doc/cloud`). It belongs to the paused Revit document-control rework when it regrounds.

<!-- ADV2-S3 R20 -->

- 2026-10-12, kaitpw rules `@` (Fable's design): a mention never retargets; it is a stable pointer carrying its key plus a timestamped snapshot of facts, so the first hop lands aligned. `pe_find` is the one index every mention source joins as rows; the first slice is open documents plus the five existing `pe_find` kinds (op, route-doc, route-command, pod, skill), then recent documents, open views (needs an op), cloud (needs APS). kaitpw: "the piece that really brings it together is the unification of the interface across pea web, the pea cli, and the pea mcp" — one search, one mention shape and one resolver serve all three doors. PDF attachments open in the browser's own viewer; no PDF library for now.

<!-- ADV2-S3 R23 -->

- 2026-10-12, kaitpw: "any message sent while pea is going simply interrupts. no queue." This supersedes the same day's ruling for B's persistent pending queue and commit `77ee6f91`. The host owns the interrupt: a prompt on a running thread cancels the turn, then starts the new one. The cancel verb is Stop and wears the alarm tone while a turn runs.

<!-- ADV2-S3 R24 -->

- 2026-10-12, kaitpw deletes the chat Trace lane: the framed in-place tool expansion replaces it. The copy press on a code block head is an icon-only button.

<!-- ADV2-S3 R25 -->

- 2026-10-12, kaitpw: "closed session should not be a valid target." The live document inventory is the authority and a saved thread target is only a request: a closed session or document is never offered by a picker, a "New thread on this target" verb, or the Target filter (closed targets collapse into one "Closed" option), and a thread bound to one shows it missing.

<!-- ADV2-S3 R26 -->

- 2026-10-12, kit base round 5, kaitpw rules: greyed menu items show no refusal sentence ("the menu refusal messages are way too long. i say delete all together"); this overrides house law 3 for menu items, and the reason stays one hover away. Auto-settle stays one-thread and out of scope; kaitpw intends it as an app-wide setting. Deselecting threads is broken and owed a fix. An opened tool call reads as part of its call row inside one frame, its mono is a size smaller, done/failed align to the far right, and the rollup row's icons sit centred.

<!-- ADV2-S3 R28 -->

- 2026-10-12, kit base round 4, kaitpw rules: reasoning ("Thought process") belongs to the same collapsible run as the tool calls; tool rows reserve no hover-control space because they never show the control cluster; snooze, settle and mark unread work on a multi-selection, and with several threads selected every verb that cannot apply stays listed but greyed with its reason. The model picker opens on the model, a model pick advances to effort, and the effort pick closes it (`HeadLadder` `closeOn` = the first trait, or the model when there is none; landed with `chat/head-chips.test.tsx`).

<!-- ADV2-S3 R30 -->

- 2026-10-12, kit base round 3, kaitpw rules: unread is its own filter toggle beside Target, Provider and State. Images and files cross to the model ("we solved it back in the mastra days but i guess we lost it now"); the attach button stays and Send stops refusing them. The model picker always opens on the model crumb; an off toggle is left out of its trigger; picking a model closes it. The threads sidebar still shows no border on the live app and owes one. A row's three-dot menu takes the state/time slot in place rather than floating mid-row, so that slot reads as the row's state and its verbs.

<!-- ADV2-S3 R32 -->

- 2026-10-12, kit base round 2, kaitpw rules on round 1: the model picker is one ladder whose crumbs are provider › model › effort › speed (each trait its own rung; "flat just makes it completely unnavigable"), and the separate traits chip goes; `Ladder` gains a control face so the composer stops restating the frame. Anything on the artifact ground draws an always-on hairline ("it feels too jank otherwise"). Sidebar shelf heads stick to the edge they leave by, top and bottom; pressing a head scrolls its shelf into view and must never read as a dead press. Row hover and selection fills reach past the text by the inset, so text never touches a fill edge. The target filter leaves the search row and joins the list as header-like rows: target, provider and state filters that reflow at narrow widths. Fork moves to the composer's bottom row beside attach and send. Send stays framed when it refuses and commit-filled when it can send (Fable default, kaitpw undecided). Fixture examples owed for attachments and skill use. Open: what `@` addresses; kaitpw's Occam cut is open documents and route plugins.

<!-- ADV2-S3 R33 -->

- 2026-10-12, kit base round 1 landed (Fable swarm, main, uncommitted): `Button` has no `disabled` prop, twelve sites now carry a refusal sentence or `busy`; `card.tsx` deleted; one chrome rung (`--type-small-size` 12px, navigation/conversation/composer type tokens deleted, `--gutter` 8px, `.t-upper` strong, two chrome weights); `Pane` declares the 8px inset once and no sidebar child pads, measured tab, search, group label and row label all at x=17; Snoozed and Settled are `NavigationGroup stick="bottom"` heads, footer buttons deleted; the composer box reads work, text, then one bottom row (model, traits, document, status, plan; attach, cancel, send), `ComposerCaption` is `ComposerRow`, `composer.css` folded into `conversation.css`, revert is a framed `Undo2` button; every framed control draws the `dl-control` hairline (`button.css` scopes the transparent edge to `:not(.dl-control)`). PROVEN[compile + deterministic, ts/apps/web 0 errors, 57 chat and kit tests, 2026-10-12]; PROVEN[browser, hostless web dev server, `/chat?demo=send`, `.artifacts/runs/ui-base-20261012/r1/shots/final-light.png`]. Open for kaitpw: the thread-head fork verb is now framed beside three quiet icons; send is framed when it refuses and commit-filled when it can send; pending-request options are framed buttons with a 4px gap; `Ladder` has no control face so the composer restates `.dl-control` for its pickers; the Archived shelf does not stick; the `lang-chat.tsx` navigation specimen sits outside a `Pane`.

<!-- ADV2-S3 R34 -->

- 2026-10-12, kit base round 1, kaitpw rules on the round-0 base ("i like it all"): button labels stay lowercase as the data says; one geometry for every route, no density switch until a table feels too loose; the plain action button is `framed` (hairline, no fill), no tinted kind; `Button` has no native `disabled`, a refusal is the only inert state and the type makes a reasonless inert button unrepresentable; the per-pane key card stays gone, Help is the key listing. From the live-app annotations: one chrome rung (12px) for tabs, group heads, triggers, counts, kbd, buttons and search, with weight and ink the only differentiators, titles 15; a pane's inner inset equals the pane separation (8px), declared once on `Pane`, and every child aligns to it; Snoozed and Settled are ordinary group heads that stick to the bottom of the scroller while collapsed, footer buttons deleted; the composer's model, effort and target move to the bottom row beside send, revert is a framed icon button, review stays a nav link; the composer input row joins the kit's `conversation.css`; `card.tsx` deleted. Harvested source rulings stay owed until the base settles.

<!-- ADV2-S3 R35 -->

- 2026-10-12, kit base round 0 (Fable, swarm on main, uncommitted; kaitpw rules at the muse). Seven judgements in `.artifacts/runs/ui-base-20261012/BRIEF.md`, landed: one palette and one type ladder in `base.css` (the chat `comfort` values are `:root`; `[data-density="dense"]` holds 16 geometry tokens; `useDensity` deleted); one `Button` (`components/lang/button.tsx`, label required, refusal replaces the tooltip, kinds quiet/framed/commit/nav) replaces `Press`, `ActionButton` and `IconPress` across 102 files; `Pane` is a header, a scrolling body and an error boundary (12 props, was 22; collapse moved to `PaneSplit`; the pane key-card engine is gone, keys register through `ScopeKeys` from `route/keys`); kit headers are three lines (comment lines 881 to 605) and each primitive's CSS sits beside its tsx (`cell.css`, `conversation.css`, `navigation.css`, `pane.css`, `button.css`; `lang.css` 1270 to 365); the composer is DOM only (423 to 197 lines) over `useAttachments` and `useSlashMenu`; `Band` left the kit for `components/work/band.tsx`. Rulings harvested from the deleted source headers are listed per lane in the run folder, not yet folded here. PROVEN[compile + deterministic, ts/apps/web 0 errors, 252 tests pass, 2026-10-12]; browser: chat fixture and `/design-system` and `/schedules` mount on a web dev server with no host (`shots/`), UNPROVEN against a live host.

<!-- ADV2-S3 R36 -->

- 2026-10-12, kaitpw places question Answer/Skip actions at the panel's bottom right using house action controls, with Answer carrying the commit mark. The question owns Enter inside its region (including text fields); Enter on Skip declines. Single-choice fields expose radio semantics with arrow/Home/End navigation and Space selection; Tab reaches other fields and actions. Required-field and in-flight guards apply to keyboard and pointer alike, without submitting the surrounding chat draft. Production-component browser fixture and focused tests: `.artifacts/runs/chat-refine-20261012/`.

<!-- ADV2-S3 R37 -->

- 2026-10-12, kaitpw refines promoted chat: two dense rows place normal-weight title top left, activity plus age top right, muted smaller target bottom left and provider bottom right. Untargeted rows leave the target slot empty. New thread moves to an icon beside search, superseding the footer-only ruling below; fixed Snoozed/Settled shortcuts open and scroll to their existing shelves. Latest-turn navigation leaves the header for the lens rail and a small floater above the composer, visible only away from the tail. Attachment and send controls align with the last input line. Woke marks observed snooze expiry or activity-driven exits until the thread is visited; the current contract has no durable wake reason, so reload retention remains unproven. Focused checks and browser shelf/scroll interaction evidence: `.artifacts/runs/chat-refine-20261012/`.

<!-- ADV2-S3 R38 -->

- 2026-10-12, kaitpw selects B's persistent pending queue and authorizes chat R3 promotion on main. Chat now uses the D type and color register, pane-view tabs, title-first thread rows with independent activity/unread marks, one counted uninterrupted tool sequence, reserved hover/focus message controls, composer-owned pending requests, and feedback/machine controls in the real tutorial. Existing request IDs, targets, question drafts, staging, thread lifecycle, queued sends and trace inspection remain connected. Evidence: `.artifacts/runs/chat-promote-20261012/`.

<!-- ADV2-S3 R39 -->

- 2026-10-12, kaitpw accepts the D-baseline recommendations provisionally: retain D type, icons, lists and pane borders; collapse uninterrupted tool calls into count plus latest activity; reserve hover/focus message controls below prose; put pending actions on the composer; use state glyphs and independent unread emphasis in thread rows; align gray truncated targets under titles; keep only New thread in the sidebar footer; place feedback and installation facts under Help. Round 3 compares pending-work placement in [chat-r3.html](prototypes/chat-r3.html). These fixture mocks guide later web normalization; Trace/World placement and production integration remain open.

<!-- ADV2-S3 R40 -->

- 2026-10-12, chat rudiments protoui round 1 (variants in `.artifacts/chat-density/round1.html`: 0 now, A one ladder, B ledger grid, C inspector). Ruled by kaitpw: B leads ("of rop i like B the best"). The user's own messages sit on the right side. The floating composer stays, but its parts need one home ("its started growing a lot of parts that i dont know how to fit into it"). The top-right control cluster holds global controls only, never a page verb. A bottom status bar reads more put together than floating chrome, but only content that is always important may spend vertical space. Open: one register or two, row height, the home of run state, and the scope of a rudiment rethink. Round 2 builds full-chrome variants of B.

<!-- ADV2-S3 R41 -->

- 2026-10-12, chat polish swarm (kaitpw: "brutally utilitarian, I need a little more friendliness"). Ruled by kaitpw: rounded corners read cheap, so surfaces, rows, fills, popovers, bubbles and code are `--radius` (2px) and only freestanding controls wear the one `--control-radius` (3px, `rounded-control`); switcher, input, select trigger and framed presses are one `.dl-control` family with one height, border, radius and inset; single-icon verbs are `IconPress` and the answering harness is `ProviderMark`; chat thread management copies T3's shelves (Pinned, Active, Snoozed, Settled; Snoozed and Settled collapse by default) and its row menu over the host lifecycle routes, replacing the All/Attention/Pinned/Archive filter. Defaults awaiting kaitpw (numbered lists in `.artifacts/chat-polish/{foundation,sidebar,transcript,composer}.md`): a `comfort` density register (`[data-density="comfort"]` in `base.css`, set document-wide by `useDensity`) redeclares the ladder for chat only (small 11.5, prose 13, navigation 14, conversation 15, title 18, rows 28, controls 32) while dense stays the app default; two-line rows that show a target line only when targeted; consecutive plain tool calls fold into one counted row; verb labels are sentence case via `t-sentence`; Send takes the commit fill. Supersedes the three-line rows and 14px reading role of the 2026-10-11 line below.

<!-- ADV2-S3 R45 -->

- 2026-09-26, kaitpw: targeting or selecting a subject revalidates it. Choosing a view on `/rooms` reads it at once, with no refresh press; the same holds for schedules and every route. Families is the one exemption, for performance. This refines the 2026-09-22 freshness ruling (re-read on focus only when the document is marked changed): a new target is a new reading, not a re-read under the hands. Where the two still disagree, this one wins and the 2026-09-22 line is re-openable.

<!-- ADV2-S3 R81 -->

- 2026-09-16, A `mermaid` fence renders as a diagram inside `Code`, with a source and render toggle in the head. The renderer is `beautiful-mermaid`, because it takes `var(--pe-*)` colors and needs no live DOM; official `mermaid` needs a live DOM, rejects `var()` colors, and leaks an element on each failed render. The fence renders once it closes and shows its source while open. `gantt`, `pie`, and `mindmap` stay as source. A closed fence that fails to parse renders collapsed to its head band with `invalid diagram` and a `show source` toggle, because invalid mermaid is hard to read as text (kaitpw). D2 (5.85 MB wasm), PlantUML, and Structurizr (JVM) are rejected (`.artifacts/handoffs/render-blocks-20260916/diagram.md`).

<!-- ADV2-S3 R83 -->

- 2026-09-15, `JsonEditor` is the one editable JSON surface, controlled `value`/`onChange`, paint under a transparent textarea in a shared grid cell (kaitpw: "yes agree" to the tanstack worktree). Read-only paint and editing stay two exports of one module, never one component with an editable flag, because a textarea owns caret, selection, and undo and paint is a pure function of a string.

<!-- ADV2-S3 R86 -->

- 2026-09-15, One word says whether Revit can answer. The host lamp reads `Revit attached` or `Revit not attached`, and `/instances` marks a world `not attached` when the SDK census sees the process but no host session holds it. The SDK bridge proves only that the payload loaded; scripts and operations need the host bridge, so no surface reports ready or connected on SDK evidence alone. Consumers: `route/shell.tsx` lamp, `instances/route.tsx` phase column.

<!-- ADV2-S3 R89 -->

- 2026-09-15, No superseded primitive system may remain at merge: alternate state owners, targeting grammars, mutation doors, compatibility APIs and their supporting exports must be removed. Low-priority product work may remain unfinished, but cannot retain a competing primitive. Preserve unresolved operation evidence; do not erase data or invent success to make legacy removal appear complete.

<!-- ADV2-S3 R90 -->

- 2026-09-15, The evidence rule applies to current operation receipts, which retain original request identity and unknown outcomes. The user expressly authorized discarding 66 old RP rows without archive for this greenfield cutover; no legacy migration, census or forensic read surface remains.

<!-- ADV2-S3 R139 -->

- 2026-10-05 — The Revit facsimile (`apps/web/src/revit/`, specimens at `/design-system/revit`) is
  a deliberate foreign body: stateless components that compose fake Revit chrome (ribbon, options
  bar, Properties palette, TaskDialog, classic modal) for explainers, with no images. It is not
  house style. Its literals live in the `--rv-*` block of `base.css` (the one file that may name a
  colour); `revit.css` consumes only those tokens and is exempt from the house value rules by name
  in `design-guard.test.ts` (`SKIP_FILES`); its classes still register through `styles.css` and
  its TSX is scanned. Nothing outside `revit/` may consume `--rv-*` or `.rv-*`. Re-openable:
  decided in an autonomous session against three critic rounds on Autodesk Help screenshots
  (`.artifacts/revit-mock/critic-*.md`), not by kaitpw.

<!-- ADV2-S3 R140 -->

- 2026-10-05 — Revit facsimile ground truth is kaitpw's own Revit 2025 on Windows 11 at 200%
  (`.artifacts/revit-mock/ref/user-*.png`), not Autodesk Help images. Colours are sampled from
  those captures. Control lines are one device pixel (`--rv-hair: 0.5px`). Text is Segoe UI at
  9pt (12px: titles, grids) or 8pt (10.5px: buttons, labels, trees, group titles), and the app's
  `font-size-adjust` is reset inside `.rv`. A dialog is mocked by pinning pieces with `RvAt` at
  coordinates read off a 200% capture: subtract the window frame origin, then halve.
  `.artifacts/revit-mock/compare.py` and `align.py` render the specimens at device scale 2 and
  report per-line offsets. Mechanical Settings, Edit Shared Parameters and Routing Preferences
  sit within 1px per text line. Re-openable, as above.

<!-- ADV2-S3 R144 -->

- 2026-08-16 — Standing mode preference (kaitpw): light is the preferred palette but dark reads
  with better contrast, and the fix is ground/background tokens — never re-tuning accents per mode.

<!-- ADV2-S3 R152 -->

- 2026-08-31 — Density round 1 winner **C (extreme)**: "honestly extreme is the best" (kaitpw).
  20px list rows, 10px caption/label/value at 1.2 line-height, 11px prose at 1.4, 2px cell edge
  padding. Folded into `base.css` `:root`; the 24px middle variant and the throwaway switcher were
  deleted on verdict. Consequence: caption, label and value now share one 10px size and differ
  only by face, case and weight — see open questions.

<!-- ADV2-S3 R153 -->

- 2026-08-31 — Proposal-state demiurge (round 2, kaitpw: "B definitely, + D, and no denied
  state"): the trichotomy (`agent-contracts/src/trichotomy.ts` — proposal → staged → committed,
  `review` marks aside) is the ONE proposal lifecycle. No `denied` state: a denial clears the
  proposal and the cell shows the real value again. No `written` state: commit clears `staged`;
  saved/unsaved and fresh/stale carry what those two tried to say. Family's
  `ProposalVerdict`/`CellVerdict` (`family/world.ts:145`) and the proposal-flow fixture's
  `review` are parallel machines owed deletion; one shared reader derives `StateCellProps` from
  a trichotomy cell so routes cannot re-derive the mapping. `cap{readonly,excluded}` collapse to
  locked + reason; `nohome` stays — it draws the seam. `stagedBy` plumbs from `proposal.by`.

<!-- ADV2-S3 R154 -->

- 2026-08-31 — REVIEW IS DELETED from the trichotomy (ruled kaitpw: "staged + attention doesn't
  seem load bearing… I don't really want pea to be able to flag staged"). The cell is two fields,
  `proposal | staged`. Staging IS the human's approval; validation is DERIVED from the value,
  never stored; pea's disagreement channels are chat or the COUNTER-PROPOSAL — proposal and
  staged both standing with different values draws pea's fold alone (`data-contest`, no body
  wash) and says `pea proposes X` in the facts. The commit/save attention gates, the
  low-confidence refine, pea's `review` mask path, and `CellReview` are all gone; old persisted
  docs parse unchanged (zod strips the dead key).

<!-- ADV2-S3 R155 -->

- 2026-08-31 — Per-cell grounding stays even when several cells cite one OCR block (kaitpw).
  The card-scale footline may not wrap a cell to two lines: it collapses to hover; the 10px
  floor forbids shrinking it. Locate is the cell's own `onLocate`; family's rail locate icon
  (`family/marks.tsx`) dies into it.

<!-- ADV2-S3 R166 -->

- 2026-09-01 — Re-cutover grill verdicts (kaitpw). (1) Takeoffs opens the cutover, amending the
  2026-08-31 seam order; chat follows. Pea-takeoffs integration lands within two sessions and is
  the real test of the state model. (2) Fixture lane spells `?source=fixture`, resolved by the S2a
  lane resolver, deliberately unadvertised in UI ("obscured unless u know"). (3)
  `StateCellProps.placeholder` ships with `onLocate`; `ProposedCell` dies — same precedent as the
  rejected `<Text>` wrapper. (4) `chat-appearance` is ruled a `lang/` primitive and improved
  systemically, not folded into `chat/`.

<!-- ADV2-S3 R167 -->

- 2026-09-01 — CellSelect adopts `Combobox`; the native `<select>` popup exception is REJECTED
  (kaitpw). Perf gate: the popup stays unmounted when closed (base-ui default) and a cell mounts
  the Combobox machinery on edit, not one root per resting cell; row heights on `/takeoffs` are
  re-measured after adoption.

<!-- ADV2-S3 R169 -->

- 2026-09-01 — Front-door lamp lineup verdict (kaitpw): **L3 instrument cluster wins** ("instrument
  cluster for header is best"). The demoted `t-label t-upper` wordmark is REJECTED — the title
  "should be bigger", and the same complaint covers `/takeoffs`' route label. Direction: the
  display face the user likes on the h1 (`face-display`, Spectral) at a smaller tier — `t-head`
  24px, which nothing wears yet. Canon rewrite of L3 WAITS on the route-title demiurge (title may
  move into the targeting kit with the targeting flow expanding below when a manifest exists);
  the lineup stays mounted until then. Canon fixes already landed: wordmark tier, UpdateButton
  `commit → act`, ThemeToggle nowrap, front-door page frame `px-6` inset.

<!-- ADV2-S3 R170 -->

- 2026-09-01 — Type-tier lineup round 1 verdict (kaitpw, on the live `/takeoffs` fixture): **D is
  KILLED** ("too loose" — the roomier caption leading fights density). A and B retire — "honestly
  can't tell much of a difference", which is itself the round's finding (the tier words do no
  visible work). **C advances** ("does feel less busy which is nice") with one amendment owed
  before adoption: C's mono text is "all a bit too dim" — the caption bundle's `ink-mute` must
  brighten (candidate: `ink-2`) in round 2. Not yet canon; the throwaway lineup stays mounted.

<!-- ADV2-S3 R171 -->

- 2026-09-01 — Route-title demiurge: **S2 ADOPTED pending spike** (kaitpw: "yes s2 is what i
  imagined"). `RouteHead` lives in the targeting kit: the route name at `t-head face-display`
  (paying the owed "route heads have no head" line), with the targeting sentence/flow expanding
  below when a manifest exists and the name standing alone when none does; `aside` carries chrome
  like the front-door instrument cluster. Front door and product routes share the primitive. The
  header lamp reads targeting's world facts (`targeting/world.ts` already consumes `host/fleet`),
  retiring the lamp's private 5s `usePeInfo` poll. S1 (bigger label) and S4 (no titles) killed;
  S3 (name inside `Product`) killed for taxing manifest-less routes. Spike consumers: `/takeoffs`
  and `/`. The S2a shell mounts RouteHead when it lands.

<!-- ADV2-S3 R173 -->

- 2026-09-01 — **C2 ADOPTED** (kaitpw: "yes adopt c"): composite roles are the sub-prose tier
  model. `t-label` = upper + tracked + medium + ink-2; `t-caption` = mono + ink-mute→**ink-2
  floor** + tabular; `t-value` = plain ink; one word dresses the whole look and the bundle beats
  call-site fragments. Mono floor: no mono text below `ink-2` unless genuinely absent/disabled.
  Canonization rewrites the bundles into the tier owners (`base.css` + `design-lang.css`), fixes
  the call sites C makes visibly wrong, and deletes the throwaway lineup.

<!-- ADV2-S3 R174 -->

- 2026-09-01 — The instrument cluster (host lamp · release · theme) is ROUTEHEAD CHROME, not
  front-door chrome (kaitpw: "I also wanted the instrument cluster there too"). `RouteHead`
  renders it on the name line on every route; `aside` remains for extra route chrome. This
  raises the priority of collapsing the lamp's private poll into targeting's world facts.

<!-- ADV2-S3 R177 -->

- 2026-09-01 — TWO-AXIS TYPE (grill verdict kaitpw, SUPERSEDES the C2 ADOPTED and C2 CANONIZED
  lines above; evidence `.artifacts/handoffs/2026-09-01-critic-design.md`): the three 10px
  sub-prose tiers were never size tiers — they collapse to one size word `t-small`, with
  `face-mono` (machine measured) and `t-upper` (section head) as OPT-IN marks. Mono returns to
  the marked case (95 `t-caption`+`face-mono` pairs were redundant; 799 mono spans marked
  nothing). The ink floor moves into the tone layer so a claim about meaning always outranks a
  tier; the `:not()` escape at `base.css` is deleted — it listed five `text-*` classes with zero
  real uses and lost to every `data-tone` site (`(0,3,0)` beats `:where()`'s zero), silencing
  the targeting head's unbound caution and `FactChip.tone` entirely.

<!-- ADV2-S3 R178 -->

- 2026-09-01 — TONE AND GROUND CANON (grill verdict kaitpw): `data-tone`/`data-surface` are the
  ONE meaning vocabulary. The `text-alarm|caution|done|pea|commit` tone utilities and the four
  `bg-page|artifact|recess|select` ground colors leave `@theme` (`design-lang.css`); a ground is
  legal only where it rebinds `--pe-on`, so a wash never mixes against the wrong plane.

<!-- ADV2-S3 R179 -->

- 2026-09-01 — DECLARED-ONCE GUARD (grill verdict kaitpw): `design-guard` asserts no class is
  declared in two of `base.css`, `design-lang.css`, `lang.css`. The 16 restatements, the `veil`
  hover contradiction (utility made it an always-on wash), the diverged `t-title`/`t-head`/
  `t-display` bundles, and the dead `squiggle-*`/`ghost-drift`/`page-wrap` classes fall to it.

<!-- ADV2-S3 R180 -->

- 2026-09-01 — `chat-appearance.ts` is DELETED (grill verdict kaitpw, SUPERSEDES the 2026-09-01
  "ruled a `lang/` primitive" line): 73 numbered positional slots, 72 with exactly one consumer,
  `threadPalette4` already missing — a className bag, not a primitive. Class strings return to
  their JSX; the ~4 genuine roles (thread row active/quiet, doc sub active/quiet, `emptyMark`)
  are promoted to named homes.

<!-- ADV2-S3 R181 -->

- 2026-09-01 — OPACITY RULED (verdict kaitpw, option 1a): opacity is legal only as the 0<->100
  visibility pair of a transition on floating chrome (pane halo `lang/pane.tsx:167`, shortcut
  card `:224-225`); any value between is de-emphasis and stays counted. The `opacityDim` regex at
  `design-adherence.test.ts:93` now skips `opacity-0`/`opacity-100`; the baseline is re-stamped
  at the new count. Refines the 2026-08-29 "not a de-emphasis mechanism" line, does not replace it.

<!-- ADV2-S3 R182 -->

- 2026-10-04, kaitpw: THE ADDRESS IS GENERATED FROM THE MANIFEST. A route names the Page keys the URL carries in `manifest.url`; `route/url.ts` derives the TanStack `validateSearch` reader and `stripSearchParams(defaults)` middleware from the page schema (Standard Schema, so zod is the one source), and `useRoute` syncs both ways: a Page move pushes one history entry per place, an address move (Back, Forward, a link) moves the Page. Every url key needs a default so a bare route URL stays bare. Replaces the hand-written `useEntityUrl`, `entitySearch` and per-route search shims; `url: false` on `useRoute` is for chat panes and seeds, which own no address. `view` is the declared home for UI variants. Proven on `/rooms` stage in a browser (push, strip, Back, Forward). Owed: port `/ducts` on `feat/pressure-drop` to `url` keys when it merges.

<!-- ADV2-S3 R203 -->

- 2026-09-01 — EXECUTION-SCOPE LAW (grill verdict kaitpw; evidence
  `.artifacts/handoffs/2026-09-01-critic-{chat,contracts}.md`, both critics independently):
  every Revit execution carries an exact document contract. The persisted binding is the
  restart-stable SDK selector; it resolves to a live session id AT COMMAND TIME, and
  `HostRpcCaller` always receives a target — an untargeted caller is a defect
  (`takeoffs-commands.ts` built one; the takeoffs store's `setBindings` never wrote `world`).
  A route binds ONE document. Chat is task-scoped and may touch MANY documents across a task;
  every touch is transparent and traceable in the transcript.

<!-- ADV2-S3 R204 -->

- 2026-09-01 — Transcript tool cards are AUDIT RECORDS (grill verdict kaitpw): a card retains
  the event/receipt its turn observed. Overlaying the current live `route.slice` onto an old
  card (today's `tool-names.tsx` behavior via `sessionState={{}}` at `aui.tsx`) is a defect —
  a receipt that changes after the fact is not a receipt. Falls to the chat reducer demiurge.

<!-- ADV2-S3 R205 -->

- 2026-09-01 — APPROVAL SETTLEMENT is server-only (grill verdict kaitpw): the host is the one
  authority; the client never clears the gate itself — it renders in-flight until the host's
  `permission_resolved` event (`harness/threads.ts`). Superseded by ADR 0015 (2026-10-12): the
  patched agent-runtime settlement and `display_state_changed` are deleted.

<!-- ADV2-S3 R206 -->

- 2026-09-03 — CHAT PRIMITIVE (2026-09-01) is SUPERSEDED (verdict kaitpw): it named a mechanism
  (`{threadId, epoch, sequence}`, one reducer) and that mechanism was built and deleted in two
  days. The chat transport verdicts live in `docs/features/agent/LEDGER.md` (CHAT TRANSPORT S1).

<!-- ADV2-S3 R207 -->

- 2026-09-01 — ONE ROUTE SPEC (grill verdict kaitpw: "this was the biggest thing I wanted to
  demiurge"): a `CollaborativeRouteSpec` from which UI verbs, Pea commands, the server route
  registry, and the chat-plugin registry all DERIVE; one provider owns world resolution, doc
  atoms, picker state, and head rendering. Targeting rides every route — tool-like routes mount
  the manifest, docs-like routes (`/`, `/design-system`) are name-plus-cluster only. Lands
  AFTER the execution-scope law so command scoping is in the spec from day one.

<!-- ADV2-S3 R208 -->

- 2026-09-01 — PANE SLOTS + TWO-TIER HOTKEYS (demiurge verdict kaitpw: "yes s3"; evidence
  `.artifacts/handoffs/2026-09-01-census-{pane-hotkeys,tutorial-panes}.md`): the route spec
  declares pane SLOTS (key, kind, title) — structural identity that joins Pane, tutorial
  measure, and product manifest; title string-matching dies. Hotkeys are two-tier: navigation
  keys (focus, Escape, j/k/a/d) are pane-owned page code acting on page atoms; route VERBS
  derive from the spec, and a verb's chord is declared on its command. The route document
  gains ZERO fields from the pane/hotkey/tutorial cluster. S1 (all keys spec-derived), S2
  (spikes as-is, second vocabulary), S4 (persist focus/tutorial in the doc) are killed.
  The provider owns the manifest and a pane-element registry keyed by slot when ONE ROUTE
  SPEC lands; until then `manifest-ref.ts` is the named interim shim.

<!-- ADV2-S3 R210 -->

- 2026-09-01 — Tutorial round-2 projection: INK ADOPTED, rails and badges KILLED (demiurge
  verdict kaitpw: "yes ink", ruled on state shape): ink is the only projection that gives the
  chart base's `hot` emphasis state its writer; `ChartArea` consumes `hot` under every
  projection, so rails would leave a dangling producer. Rails' epitaph: a static duplicate of
  on-demand emphasis; adds geometry, answers no state question.

<!-- ADV2-S3 R211 -->

- 2026-09-01 — `activePaneAtom` is NEVER (demiurge verdict kaitpw: "do it never as long as ts
  hotkeys still scopes and focuses properly. occam"): pane focus scoping belongs to
  `@tanstack/react-hotkeys` DOM targets alone (the 2026-08-31 keyboard law's one door). The
  spike's `activePaneAtom`, `AtlasPageState.activePane`, and `Pane.onActivate` do not port —
  the atom had a producer and no consumer. Re-open only if a surface needs to READ focus and
  DOM targeting cannot answer it.

<!-- ADV2-S3 R243 -->

- 2026-09-11 — Route chrome rulings (kaitpw). The lamp shows host status only. Beside it sits one route-wide control group: tutorial, inspector, settings later, theme; the host lamp leaves that group once it is a dev-only concern. The inspector is a dev tool that a stranger still reads at first glance, and it lives in the control group, never inline. `/instances` is a standalone route and the same component is the body of any route that needs Revit and has no resolved Target.

<!-- ADV2-S3 R244 -->

- 2026-09-11 — Composition laws (kaitpw). Judge nouns only composed on a real page; per-noun variants out of context are not judgeable. Every picker is searchable, sortable and keyboard-navigable. Every label states its relationship to the other nouns. No fact is shown more than twice on a page, ideally once, and that one placement is deliberate. Color, motion and marks carry role, identity and provenance. Concept and flow outrank polish. Why: the 48 per-noun variants of 2026-09-11 did not resonate; the old targeting sentence (branch `proto/targeting-round3`, `components/sentence.tsx`) did, because it folded every noun into one readable line.

<!-- ADV2-S3 R245 -->

- 2026-09-12 — UX revival rulings (kaitpw): display as little as possible with clear disclosure. The six architecture nouns need not become six visible elements. A continuous, readable sentence remains a strong candidate; connective language may carry status and staged work.

<!-- ADV2-S3 R251 -->

- 2026-09-15 — Chat's send is a Situation action (kaitpw: "it uses primitives the way i want, keep it that way"). Its look is not liked; a children slot on the verb may replace the rendering later. Not a button component of its own.

<!-- ADV2-S3 R252 -->

- 2026-10-08 — Feedback picker (`components/feedback-picker.tsx`, mounted at the root): pick one element, write a note, send. Built on `react-grab/primitives` for hit testing and component context, `modern-screenshot` for the picture. Notes go to PostHog as `ui_feedback` through host `POST /pe/feedback` (kaitpw: "notes go to posthog").

<!-- ADV2-S3 R253 -->

- 2026-10-08 — Feedback send waits on PostHog and keeps the popover and typed note on failure (kaitpw: a note that vanished on a failed send is state lost forever). Enter sends, Shift+Enter breaks a line, like a chat composer. An outside click does not dismiss; Esc and cancel do.

<!-- ADV2-S3 R254 -->

- 2026-10-08 — Feedback picks one element only; no whole-panel selection (kaitpw: "no to whole panels").

### Global navigation, app bar, Situation (2026-10)

- 2026-10-22, the current navigation rulings are consolidated in Decided above, beside the route ownership decisions. The former duplicate chronology is in git. Settings supersedes Machine, the horizontal Situation rail supersedes the hamburger, and the 14rem field supersedes earlier widths.
- 2026-10-13, one 24px control register replaces `data-density="dense"`; a compact Table recipe waits for a real table that needs it. Refused controls expose their reason on hover and keyboard focus. These are shared primitive obligations, independent of shell placement.

### Pea chat and kit base (2026-10)

- 2026-10-22, [ADR 0021](../../adr/0021-one-access-switch-and-document-targets.md) supersedes the timed composer grant pill and revoke popover. Targeted document names provide visible consent; one access switch owns writes. K9 remains until native all-document rollback proof, as recorded in the agent ledger.
- 2026-10-15, a window whose readings go quiet says so and converges: a reading unanswered 30 s marks the stream dead and reconnects with backoff (1 s to 30 s); tab wake after 5 s hidden or `online` resyncs; on reopen the thread shows "This thread is not current; re-reading it from the host." until a fresh copy lands. One readings connection owns the thread list too. Owner saw two windows of one thread disagree for minutes. [Readings](../../../ts/apps/web/src/readings.ts). Live two-window behavior UNPROVEN; the readings stream has no heartbeat, so an idle dead stream is caught only by wake/online.
- 2026-10-12, `@` mentions: a mention never retargets; it is a stable pointer with its key plus a timestamped snapshot, so the first hop lands aligned. `pe_find` is the one index every mention source joins as rows; one search, one mention shape and one resolver serve Pea web, CLI and MCP. `ts/packages/agent-contracts/src/mention.ts` holds `mentionSchema`, `documentRows`, `recentRows`, `mentionOf`. `GET /pe/capabilities` re-reads sessions each request (`doc:` rows live, ops and pods cached 30 s); recents cache 5 min.
- 2026-10-12, `recentRows` drops `.rte` templates and any already-open document (the `doc:` row wins). `pe_do` refuses a `doc:` or `recent:` row and points Pea at opening it. Cloud browsing for Pea goes through the host catalog as SDK verbs with receipts (`docs/features/agent/LEDGER.md`), not a Pea-only CLI path.
- 2026-10-12, PDF attachments open in the browser's own viewer (`workbench/open-pdf.ts`), no PDF library. One kit `FileChip` (`components/lang/chip.tsx`) draws a file in composer and transcript. Images and files cross to the model as ACP blocks (`promptBlocks` in `ts/apps/host/src/harness/threads.ts`); `attachmentRefusal` refuses a kind the agent's `promptCapabilities` lacks.
- 2026-10-12, a prompt on a running thread interrupts: ACP `session/cancel`, wait up to `INTERRUPT_MS` (10 s), then start; past that, 409 with a sentence. No queue. The cancel verb is Stop and wears the alarm tone. Send never refuses for a running turn.
- 2026-10-12, the chat Trace lane is deleted; the framed in-place tool expansion replaces it. The copy press on a code block head is an icon-only button.
- 2026-10-12, a closed session or document is never a valid target. The live inventory is the authority; a saved thread target is a request. Pickers, "New thread on this target" and the Target filter never offer a closed one (they collapse to one "Closed" option); a bound thread shows it missing; Send refuses (`targetClosure`).
- 2026-10-12, one `Button` (`components/lang/button.tsx`): label required, no native `disabled`; a refusal is the only inert state and a reasonless inert button is unrepresentable. Kinds quiet/framed/commit/nav; the plain action button is `framed` (hairline, no fill). Labels stay lowercase as the data says. Greyed menu items show no refusal sentence (kaitpw: delete all of them); the reason stays one hover away (overrides house law 3 for menu items). Review stays a nav link; revert is a framed icon button.
- 2026-10-12, one palette and one type ladder in `base.css`. One chrome rung (`--type-small-size` 12px) for tabs, group heads, triggers, counts, kbd, buttons, search; weight and ink are the only differentiators; titles 15. `--gutter` is 8px. `Pane` declares its 8px inner inset once and every child aligns to it. Every framed control draws the `dl-control` hairline; anything on the artifact ground draws an always-on hairline (`outline: 1px solid var(--pe-line)`; `design-guard.test.ts` fails artifact paint outside the plane rule).
- 2026-10-12, surfaces, rows, fills, popovers, bubbles and code use `--radius` (2px); only freestanding controls use `--control-radius` (3px, `rounded-control`). Switcher, input, select trigger and framed presses are one `.dl-control` family. Rounded corners read cheap.
- 2026-10-12, the model picker is one `HeadLadder`: provider, model, then one rung per provider trait (`Ladder` faces `word | control`). It opens on the model, omits an off toggle from its trigger, and closes on the first trait pick (`closeOn`). Fork sits in the composer bottom row beside attach, cancel, send. The composer reads work, text, then one bottom row; attach and send align with the last input line.
- 2026-10-12, thread management copies T3: shelves Pinned, Active, Snoozed, Settled (Snoozed and Settled collapse by default and stick to the bottom as ordinary group heads). Shelf heads stick to the edge they leave by; a stuck-head press opens and scrolls its shelf. `threadVerbs` in `chat/thread-navigation.ts` is the one rule for row verbs; multi-select applies pin, settle, snooze, mark read and archive to all and reports "N of M threads changed"; verbs that cannot apply stay listed greyed. Unread is its own filter toggle beside Target, Provider and State; the filters are header-like rows in the list that reflow at narrow widths, and a target filter changes the roster only. A row's menu replaces the state/time slot in place. Auto-settle stays per thread (kaitpw intends it as an app-wide setting).
- 2026-10-12, rows: two lines, normal-weight title top left, activity plus age top right, muted target bottom left (empty when untargeted), provider bottom right. New thread is an icon beside search. Latest-turn navigation lives in the lens rail and a small floater above the composer. Woke marks observed snooze expiry until the thread is visited. Row hover and selection fills reach past the text by the inset. Mobile uses the existing dialog over the full-width conversation.
- 2026-10-12, transcript: reasoning ("Thought process") joins the same collapsible run as tool calls (`conversation-sequences.ts`: "3 tools · 2 thoughts"); prose, attachments and other speakers break a run. An opened tool call reads as part of its call row inside one frame: its mono a size smaller, done/failed at the far right, the rollup row's icons centred. Hover controls render only on messages with text, image or file parts; tool rows reserve no hover-control space. The user's messages sit on the right. A leading `/name` prompt draws as a skill chip.
- 2026-10-12, question panel: Answer/Skip sit bottom right, Answer carries the commit mark. The question owns Enter in its region (including text fields); Enter on Skip declines. Single-choice fields expose radio semantics with arrow/Home/End and Space. Required and in-flight guards apply to keyboard and pointer alike.
- 2026-10-12, one `Pane` is header, scrolling body and error boundary; collapse lives in `PaneSplit`. Keys register through `ScopeKeys` from `route/keys`; the per-pane key card is gone, Help (Alt+/) is the key listing. Each primitive's CSS sits beside its tsx. `Band` lives in `components/work/band.tsx`, not the kit. `card.tsx` is deleted.
- 2026-10-12, one geometry for every route; no density switch.
- 2026-10-11, failed uses alarm, waiting uses caution. The chat rail reserves one height for app chrome and keeps status in its trailing slot.
- 2026-10-09, machine control plane primitives: `PidChip`, `ShapeCells` over `FactChip` (`components/lang/process.tsx`), `Accordion` (`accordion.tsx`), `LegStrip` with dashed not-observed stages (`leg-strip.tsx`), `SwitchRow` with its refusal on the surface (`switch-row.tsx`). The version chip and 380px shell are product owners in `machine/`, not kit.

### Feedback picker (2026-10)

- 2026-10-08, `components/feedback-picker.tsx` (mounted at the root): pick one element (never whole panels), write a note, send. `react-grab/primitives` does hit testing, `modern-screenshot` the picture. Notes go to PostHog as `ui_feedback` through host `POST /pe/feedback`.
- 2026-10-08, send waits on PostHog and keeps the popover and typed note on failure. Enter sends, Shift+Enter breaks a line. An outside click does not dismiss; Esc and cancel do. The picker owns capture and portals its Cancel/Escape into the bar (corner fallback only without a bar host).
- 2026-10-08, `.pick-mark` (`lang.css`) is the target mark: hover veil plus a 2px full-ink outline, captured as drawn.
- 2026-10-08, web builds keep function names (`rolldownOptions.output.keepNames`, +8.5% raw client JS) so a note names the picked component in installed builds.

### Route and state architecture

Rebuilt 2026-10-22 against `a553a15a`; these are decisions and proof boundaries, not a second kernel specification.

- 2026-10-22, one shared address declaration and one Page owner prevent competing state. `RouteManifest.address` projects URL and agent field policy; `createViewOwner` owns Page changes. Named moves push history, gestures replace, and URL restore never replays actions. Owners: `agent-contracts/src/route-address.ts`, `web/src/route/view-owner.ts`, `route/url.ts`.
- 2026-10-22, Pea reaches a mounted Page through `route/view-bridge.ts` and `mcps/src/pea/capability-tools.ts`. A rendered lease acknowledgement proves accepted Page values; it does not certify a refreshed Reading or native effect. `?thread` identifies the lease relationship, not document authority. A route's one Target and ADR 0021's thread target set have different owners; neither contradicts the other.
- 2026-09-10, six nouns organize route behavior: Target, Work, Reading, Action, Page and View. A route controller owns dependent transitions. One manifest serves controls, shortcuts and Pea; an empty name-only manifest is valid. Actions return structured refusals. A second action while busy refuses rather than races; `Busy | Idle` remains Owed.
- 2026-09-15, the head projects authoritative state; no fabricated counts or parallel policy. SDK owns session/document identity and native receipts, Pe.Tools owns semantic actions, and the browser projects them. [ADR 0009](../../adr/0009-one-atom-registry-per-app.md) governs the shared registry. Completed transcript cards retain their historical result, never the live route slice; permission settlement is server-only (ADR 0015).
- 2026-09-15, Work uses revision admission. Semantic actions and durable receipts own external effects and recovery; Work does not duplicate that protocol, and operation status does not advance its revision. Optimism requires measured latency. `?work=` identifies Work; durable document Work uses Address rather than openId.
- 2026-09-22, addressless Work is ephemeral, keyed by exact session/openId and registered for cleanup across host recreation. Save As migrates it; document close produces a dismissable receipt. A missing session is not evidence of close. Native Save As/close proof remains Owed.
- 2026-09-22, Readings are shared caches, including bound local files. Model freshness uses a per-document change mark, not elapsed time; focus does not replace a Reading under the person's hands. Disconnection is distinct from stale data. Target/subject changes revalidate except Families, whose exemption is for performance (2026-09-26). The 750 ms trailing-edge native behavior still needs proof.
- 2026-09-22, measured cell edits stage values in the Reading document's display unit. Unit text stays as typed until commit; a read-only host parse supplies Revit's rendering, and a parse refusal stages nothing. This shared cell contract serves Schedules, Family and Families.
- 2026-09-22, route/stage/pane/region scopes arbitrate hotkeys by innermost live focus. Hidden panes are inactive. People choose stages; routes without stages declare panes directly. Tutorial geometry and authored guidance remain separate work.
- 2026-09-15, seeds are read-only rendering inputs and cannot prove receipts. Acceptance needs actual controls and durable outcomes. The historical RP targets remain incomplete behavior journeys: Chat A/explicit B/A; Takeoffs chosen-document open, zone adoption and partition with honest recovery; Schedule Grid edit, review, native apply and readback. Native RHVAC sync was excluded; engine defects must not erase staged edits.
- 2026-09-12, Chat needs no Revit; individual operations gate their requirements. Preparation stays interactive; completed actions retain target and change evidence. Display only what helps the current goal: live draft/apply does not force a Pod choice, while capture, member editing and publication expose the Pod they manage (2026-09-19).
- 2026-09-11, judge primitives composed on real pages. Pickers are searchable, sortable and keyboard-driven; facts appear at most twice per page, and labels explain relationships. Concept and flow outrank polish. Tutorial/inspector/theme are shared chrome; installer/update belong to the shell.
- 2026-09-09, Family absorbed Family Types. Priority normalization routes are Chat, Takeoffs, Family, Families and Settings. kaitpw's usefulness ranking was Schedule Grid/Chat/Families for MEP users and Instances/Families/Chat with scripting and Family Foundry for BIM managers; investment did not certify stability. Settings, Chat and Ops remain foundational utilities.
- 2026-09-01, the unadvertised fixture spelling is `?source=fixture`; deciding the competing `none` spelling remains Owed. This is a proof input, not a user mode.

### The Situation (route head)

- 2026-09-13, the route head is the Situation (`route/situation.tsx`): what I touch, where I am, what is staged, what I can do next. The sentence carries the stage as its first word and target slots as operable words; a ladder collapses to its terminal; the full path is the breadcrumb inside that slot's picker. Every slot wears an io mark `r`, `w` or `rw` (literal letters beat words and glyphs). No verb phrase in the sentence; stage, staged Work and verbs are not clauses.
- 2026-09-13, the chain lamp reads session › document (deepest healthy segment lit, first broken one in caution with its reason); host connectivity left product chrome 2026-10-09 (`route/situation-lamp.tsx`). It reads the Revit chain only; filesystem ladders never enter it. Exception routes (`/`, docs) show title plus lamp.
- 2026-09-13, verbs live in one verb row (compact with page-state counts, expandable to a stack with reasons). The stack is how an unhealthy document explains itself. An inline button elsewhere is the same verb with a narrower scope; body layout never gates a verb.
- 2026-09-13, a refusal, busy state and done receipt are one flag primitive: a popover growing from the pressed thing, shifting nothing. Refused persists until the next press or Esc; busy carries stop; done fades. A failing target slot grows the same popover with its recovery inside. No toasts. A busy flag's stop cancels the wait only (`/call` has no cancel lane) and the late result lands as its own log row.
- 2026-09-13, staged Work is a band whose frame Situation owns (`work` prop: count, noun, revision, read freshness, discard, commit, conflict with `reload`) and whose body the route fills. The commit verb's flag grows from the verb row. Silence means fine: at rest only sentence and verb row show; "more" unfolds a ledger.
- 2026-09-13, one page log at the bottom of every route holds every route event and opens receipts, replacing per-widget activity disclosures. Marks: dotted underline is an operable word, dashed an empty slot (derived values dashed too), caution means the world disagrees, bold is unsaved, mono is machine-measured.
- 2026-09-14, Chat has no route head; its composer head is built from Situation's exported parts (`ChainLamp`, `Verb`, `useDocumentLadder`) in `chat/composer-head.tsx`. Send is the manifest verb run through the route owner; Pea proposals render as a band under the composer with allow/refuse buttons. The document ladder reads `useInventory()`; the host session id and openId stay in `?target=`, never in the sentence. In-stream approval buttons are dead.
- 2026-09-13, `/instances` stays a plain launch-and-control route; a document that needs initialization never redirects there, the verb stack carries the recovery.
- 2026-09-14, Family and Families wear the Situation: stages are page state driven by the stage picker (Family `author`/`evidence`, Families `scope`/`review`); `build` is an author verb, `capture`/`plan`/`apply` evidence verbs; Families' `plan` is every-stage and `apply` review-only.
- 2026-09-15, Chat's send is a Situation action, not a button component of its own (kaitpw: "it uses primitives the way i want, keep it that way"). Its look is not liked; a children slot on the verb may replace the rendering later.
- 2026-09-14, a verb's input comes from `Ctx`, never a store wrapper. Pure projections a manifest needs live in the manifest. The file ladder is a filesystem ladder: a sentence slot, never in the chain lamp; a parse error marks the slot caution.
- 2026-09-16, Chat's composer head shows actual turn state; Threads and World are view modes, not stages. Chat's Situation stays on the composer so targeting stays beside approvals.

### Panes and surfaces

- 2026-10-23, every spatial picture speaks the /ducts stage language (propagation slice S5: `/space`, `/takeoffs`, `/rooms`). A click selects and never moves the view; a click on empty ground keeps the selection and Esc clears it; F (and double-click in 3D) is the only frame; the selection is the 3D orbit pivot; Alt+Left/Right step view history. Selection facts and the at-rest summary live in `@pe/kit/lang/readout` (top left, hairline edge); the key legend docks bottom left as `pane-legend`. Every fit lands clear of both: private `clearPose` in `scene/stage-controller.ts` in 3D, `usePlaneViewport` (below or beside the readout, whichever is larger) in 2D. The shared keys are `scene/stage-controller.ts`; the history chords are `scene/view-history.ts`. SVG damage uses kit `lang.css` `[data-damage]` (the kit Row/Table burn's 2D twin, same beat). The `/space` axis Esc still returns to 3D, pending kaitpw.
- 2026-09-17, the closed grammar is `Surface` -> `PaneSplit` -> `Pane` -> artifact. `Surface` owns the viewport, 8px perimeter and optional scroll-away head; `PaneSplit` owns recessed 8px gutters and resizing; `Pane` owns the 24px rail, focus/help outline and 8px body inset (`flush` for edge-owning artifacts). A repo guard pins workspace slots to these. No competing workspace composer.
- 2026-09-16, `Rail` is the one head band (24px); `--gutter` and `--rail-h` own spacing. Active `Pane` focus is a thin outline in the gutter (stronger with help open) that paints above the gutter on every edge. `Pane` has a `flank` kind, owns suspension and render failure recovery (`boundaryKey`), and renders its rail unless `headerless`. `MasterTable` owns one rail plus an optional filter row.
- 2026-09-16, narrow tutorials keep the spatial pane map with horizontal scroll. The scroll-away route head stays. The composer has its own halo and keyboard-help region.
- 2026-09-16, switching Chat threads keeps each thread's unsent text and attachments (React `Activity`); an unloaded thread shows explicit loading in a stable shell. Large tool results may load fully on expand; the transcript result stays authoritative.
- 2026-09-15, `Code` (`components/lang/code.tsx`) is the one read-only highlighted block everywhere (head band: language, copy, line count, "show all"). `JsonEditor` is the one editable JSON surface (paint under a transparent textarea); read-only paint and editing stay two exports. `@tanstack/highlight` is the only highlighter (C# via `defineLanguage`). `Code` stops tokenizing above 64 KB. One `stringify` beside `Code`.
- 2026-09-16, a `mermaid` fence renders inside `Code` via `beautiful-mermaid` (takes `var(--pe-*)`, no live DOM) with a source/render toggle. It renders once the fence closes; `gantt`, `pie`, `mindmap` stay source. An invalid closed fence collapses to its head with `invalid diagram` and `show source`.
- 2026-09-15, one word says whether Revit can answer: no surface reports ready on SDK evidence alone; scripts and operations need the host bridge.

### The language

- 2026-08-29, product code authors GEOMETRY, TYPE (`t-*`, `face-*`, `t-upper`) and INK (`text-ink|ink-2|ink-mute`); meaning hues, fills, strokes and elevation need a primitive. Enforced by `design-guard.test.ts`. A `<Text>` primitive is rejected.
- 2026-08-29, every `lang/` primitive has a closed variant set via `tailwind-variants` (`lib/tv.ts`) and takes no `className`; hand CSS survives only where the cascade is the law (`StateCell` precedence). `components/ui/` is folded into `components/lang/`; chat views live in `chat/`. A losing prototype variant is deleted on verdict.
- 2026-08-16, `StateCell` grammar: tasteful fills over outline borders (border scarcity makes the arming strip ceremony); one cell grammar at three scales. Palette: every role on shared OKLCH lightness/chroma bands, alarm alone off-band; light|dark sibling renderings; light preferred, dark contrast fixed in ground tokens, never per-mode accents. PE character is warm paper, earthy secondary, mono voice, pea green.
- 2026-08-16, carried-in motif meaning beats internal consistency: locked is greyed italic; squiggle is not-settled; plain underline is a citation. A proposal is a whole-cell event; nav splits three ways; icons work in verbs and outcomes and break table ergonomics inside cells. Cell-body treatment is reserved for pea proposals and uneditable/disabled; artifact frames wrap large interactive chunks. The user gets NO identity hue.
- 2026-08-16, type model: [ADR 0004](../../adr/0004-type-tier-model.md); verdict column and tone union: [ADR 0005](../../adr/0005-verdict-column-and-tone-union.md). Two-axis type: sub-prose is one size word `t-small` with opt-in `face-mono` (machine measured) and `t-upper` (section head); the ink floor lives in the tone layer.
- 2026-09-01, `data-tone`/`data-surface` are the one meaning vocabulary; tone utilities and ground colors are out of `@theme`; a ground is legal only where it rebinds `--pe-on`. `design-guard` asserts no class is declared in two of `base.css`, `design-lang.css`, `lang.css`.
- 2026-08-28, three control kinds: `Verb` is a world action with tone and required `reason`; `Press` is surface machinery and mints no tone; furniture claims no affordance it lacks. Export/PDF/SVG verbs are `act`; `commit` stays the one filled blue. A user-placed review flag is `caution`; `alarm` is reserved for the model disagreeing.
- 2026-08-28, broken lines have three roles in `base.css`: `seam` (declared with nothing real behind it, the one UI broken edge), `reference`, `void`. Dashed is the seam slot only; no call site names a pattern. Opacity is legal only as the 0/100 visibility pair of a transition on floating chrome; locked is italic + `ink-mute`.
- 2026-08-29, cell: `shown` reading plus bound `authority`; drift is `shown.value !== authority.value` (`StateCellProps`).
- 2026-08-31, ONE proposal lifecycle: `agent-contracts/src/trichotomy.ts` (proposal, staged, committed). No `denied`, `written` or `review` state; staging IS approval; validation is derived. Pea's disagreement is chat or the counter-proposal (both standing with different values draws pea's fold alone, `data-contest`). Per-cell grounding stays (the card-scale footline collapses to hover rather than wrap a cell); locate is the cell's own `onLocate`.
- 2026-08-31, scrollbar law: `:where([data-pe], [data-pe] *)` in `base.css` sets thin, trackless bars whose thumb appears on hover; the page body bar is hidden (`no-scrollbar`); a `Pane` shows one bar (`scroll="clip"` plus an inner scroller).
- 2026-08-31, a row's rule costs no height: `hairline-b-inset` (`design-lang.css`) draws it as an `::after` inside the cell. `MasterTable` uses separate borders. Two cell insets: `--item-pad-x` (2px) and `--item-mark-pad-x` (10px, for cells whose body carries a mark). Sortable table headers wear `t-upper` with no hover veil; the header facet trigger fills its cell, chevron right, mono choices; a zone's state bar is fixed width with proportional segments, never wider for more rooms.
- 2026-08-31, a pane header is chrome: `meta` is a short machine fact (truncated, native title), orientation is `help`, and a verb's reason is a `title` there (`VerbChrome`), never inline prose. Header controls share the item height. A framed press owns its inset and item height. `components/lang/switcher.tsx` is the only switcher.
- 2026-08-31, typography default law: bare text lands in-system; tiers are deviations from a good default. Phase 3 laws (in `apps/web/AGENTS.md`): body sets the value tier (`@pe/web#type-sweep`); meaning color rides `data-tone` (+`data-wash`); selection rides `aria-selected`/`aria-expanded`/`aria-pressed`/`data-selected`; lines and planes are `hairline-*`, `boundary-*`, `data-surface`; one `light-dark()` per token, dark mode is class plus inline `color-scheme`. New vocabulary lands as role + guard + failing check + ledger line in one commit.
- 2026-09-01, `CellSelect` adopts a Combobox; a native `<select>` popup is rejected. The popup stays unmounted when closed; a cell mounts the machinery on edit. `StateCellProps.placeholder` ships with `onLocate`.
- 2026-09-01, route heads: `RouteHead` renders the route name at `t-head face-display` with the instrument cluster (lamp, release, theme) on the name line of every route; `aside` carries extra chrome.
- 2026-09-01, `chat-appearance.ts` is deleted: class strings return to their JSX.
- 2026-09-01, adopted laws, each at a code home: every product route is reachable from the front door; a human invokes every crossing into the live model (staging IS approval); a rejected cell commit restores the prior value and states the reason beside the cell; a route owns its world and host calls.
- 2026-09-01, Pane slots: the route spec declares pane slots (key, kind, title) joining Pane, tutorial measure and manifest; title string-matching dies. Tutorial overlay is variant A (a measured chart of live `[data-slot="pane"]` rects with leader lines), ink projection; generated instructions read the `Product` manifest.
- 2026-09-10, keys are one registration shape across three tiers via `keyMeta({name, description, tier, region?, refusal?})`; the help page `route/help.tsx` (Alt+/) reads live registrations.
- 2026-08-16, the `design-guard` test IS the lint (the web app has no CI). Every guard category is a hard zero with no prototype exemption. A gate matching one spelling measures nothing. Class discipline is proved by compiling candidates against the app's real CSS graph. The swatch is generated from recipe metadata (every `tv` variant renders). A ratchet must fall as well as refuse to rise. Every TSX file under `apps/web/src` stays under 400 lines, split by region, and a split file is named for what it draws. One authority stops at the language boundary (a law with two readers drifts). modern CSS (`@layer`, `@scope`, `oklch`, container queries) binds the distilled system and code being cut over; lesser routes adopt when touched. The adherence baseline must shrink substantially on the priority routes (zero not required), and the check reopens whenever its signals feel wrong.

### Where a rule lives and the Revit facsimile

- 2026-08-29, taste that code cannot hold lives in `lens.house` (figure, referents, ten laws, authoring ladder), invoked on any UI edit.
- 2026-10-05, the Revit facsimile (`apps/web/src/revit/`, specimens at `/design-system/revit`) is a deliberate foreign body, not house style: one declarative spec and one renderer, `revit.js` (plain JS with JSDoc so pages load it unbuilt). A window is a JSON value (`dialog`, `palette`, `task`, `ribbon`); state words `disabled`, `selected`, `checked`, `open`, `default`; ids derive from text; `set`, `diff`, `compare`, notes. Literals live in the `--rv-*` block of `base.css`; `revit.css` consumes only them and is exempt by name in `design-guard.test.ts` (`SKIP_FILES`). Nothing outside `revit/` consumes `--rv-*` or `.rv-*`. Pages consume `.rv-*` through `/pages/revit.css`.
- 2026-10-05, facsimile ground truth is kaitpw's Revit 2025 on Windows 11 at 200% (colors sampled; 0.5px control lines via `--rv-hair`; Segoe UI 9pt/8pt; `font-size-adjust` reset inside `.rv`; pin with `at` boxes read off a 200% capture). Re-openable: decided in an autonomous session, not by kaitpw.

## Tried & rejected

- 2026-10-22, writing the renderer-derived Ducts pose into Page superseded the accepted Pea snapshot before its render acknowledgement. The paired owner/renderer probe and browser reproduced the timeout. Keep resolved fit in scoped renderer observations; do not weaken receipt freshness to accommodate a second Page write.
- 2026-10-19, the Finder two-layer picker (`List columns={2}`, next rung previewed beside the current one, ArrowRight walks in). Built and browser-proven in round 10 (`.artifacts/runs/deterministic-20261019-table-protoui/finder-r10.md`), scrapped by kaitpw the same day: hover moves the cursor, so every crossed row would recompute the preview, and the ladders where it would matter (Situation session › document › view, families › types) read from the host, so previews cascade into request waterfalls; the local ladders that could preview for free have three to five items. Re-propose only with a rung-level cache and a pointer-idle delay.
- 2026-10-14, pop round 1 A-D failed the lineup: all four repeated title, kind, metadata and inspection link. Round 2 at `/design-system/popovers` compares bare Document identity, a Page render, Pod trust first and scrollable Reading content; each names its killing condition. No motif has owner approval yet.

- 2026-10-13, individual command icons and font-dependent modifier glyphs in the app bar: busy. Navigation A (separate product picker) and C (shortcuts before route/finder) lost to B.
- 2026-10-12, a persistent pending-message queue (commit `77ee6f91`): superseded by interrupt-and-restart ("no queue").
- 2026-10-12, a flat model picker ("completely unnavigable") and a separate traits chip.
- 2026-09-16, overlay composer (B): z-level defect. Enclosure-everywhere (C): wrong for panes.
- 2026-09-16, official `mermaid` (needs a live DOM, rejects `var()` colors, leaks an element per failed render), D2 (5.85 MB wasm), PlantUML and Structurizr (JVM).
- 2026-09-11, the route-noun standing line (`[tone dot] [verdict] — [sentence]`, 48 per-noun variants): a head, not a surface (no plural verdicts, no `loading`, no past fact); superseded by the Situation. "Just clicks" over scrubbers and invented history survived.
- 2026-09-10, a green suite without the real runtime called an admission path closed; drive the real host before calling one closed.
- 2026-10-05, a separate facsimile package and an `h`-parameterised renderer: one file beside `base.css` and an HTML string won.
- 2026-09-15, `prism-react-editor` for JSON editing: uncontrolled write model (caret and history reset on new `value`), range highlight is a search hit, extra dependency for bracket matching.
- 2026-09-15, a universal mutable route object or one route-wide lifecycle: hides the difference between authored Work, observed Readings, Page navigation and external Action outcomes. Compose owners instead.
- 2026-09-15, a common pane layout or a mandatory proposal/staged/committed workflow for every route. Ownership and head projections are shared; layout and workflow stay per route.
- 2026-09-15, completing every product as RP acceptance (an indefinite merge gate).
- 2026-09-13, Situation variants that lost: the key/value ledger as the head, an always-visible breadcrumb rail, stage as tabs over the verb gutter, refusal as a line under the verb row or as the verb's label, staged Work in a right margin (cannot inline into Chat). The prior `WorkingHead` (three registers stacked, GUID labels): "horrendous".
- 2026-09-09, the claim that document keys and receipts alone prevent every stale read or duplicate mutation: keys separate open lifetimes; Effect refresh orders reads within one lifetime; host admission and request identity govern retries.
- 2026-09-01, `activePaneAtom`, rails and badges as tutorial projections, spec-derived-only hotkeys, persisting focus/tutorial in the route doc, `denied`/`review` proposal states, a `<Text>` wrapper, `ProposedCell`, the demoted `t-label t-upper` wordmark.
- 2026-08-31, a collapsed border on `MasterTable` (the seam at the locked column), a border on `td` for the row rule (adds 1px), `scrollbar-width` declared once at `[data-pe]` (does not inherit).
- 2026-08-15, the TanStack Spreadsheet example as the table component (~4.8k lines for a headless-model need); `@tanstack/react-table` stays pinned. Documentation-as-UI exhibits (4,510 LOC); a route unreachable from the front door is the leading indicator of dead code. Speculative seams that PAID, do not re-litigate: `ops/synthetic.tsx`; the authoring test is "what makes this obviously wrong if the future never comes?".
- 2026-08-16, palette and specimen losers: Base 1 (isolated tokens so well the round stopped judging a product); round-1 a/b/c/d (donated verb grouping, the outcome decoration, the axis-splitting law, proof dark was underdefined); round-2 p1 (1.38:1 light wash, chroma-only dark alarm fails deuteranopia), p2 (moved `done` out of pea's family), p4 (dropped brand blue); mode-invariant accents read muddy.
- 2026-08-16, viz hues carrying state, blue as a provenance/busy hue, `hover:text-destructive` on removers, a `bg-primary` brand lamp: each spent a meaning hue on affordance or identity. `title=` as a prose vehicle (63 of 176 titles were multi-sentence). Dashed as a general "provisional" mark. oxlint as the token lever (a dependency-free walk in the test lane instead).
- 2026-08-16, "delete all copy and re-evaluate": too broad; per-route purge with typed destinations. A shared targeting-controller hook across routes (controllers differ in picker state and navigation). A typed manifest as a wire contract before an agent consumes it.
- 2026-08-29, guards a dead object can satisfy (`LANG_EXPORTS`), hand-written consumer counts on swatch frames, moving a monolith as "splitting" it (the swatch lost 100 specimens), and checkers loading the wrong CSS graph (a checker's loader is part of its claim).
- 2026-10-08, react-grab `freeze()` during feedback picking (halts the note popover); `.pick-mark` in `--pe-line-2` (vanishes); rasterizing `document.body` (drops `<html>` styles, 10px crop error; rasterize `document.documentElement`).

## Owed

- 2026-10-23, kit-raise guards browser pass: verify subject popover alignment, picture legend/readout docks, held-picture readout freshness, and gesture legends after the wave-4 integration. Compile and source census do not prove geometry or camera feel.

- 2026-10-23, kit-raise minimap browser pass: verify gutter placement, visible damage/head ticks, keyboard/drag landings, and long grouped/tree lists with external scrollers. The implementation slice is restricted to compile and deterministic lanes by WAVE3/WAVE2; no visual or frame-budget claim is made.

- 2026-10-23, system-switch acknowledgement under 100 ms is proven only for three warm production handler-to-two-RAF cases (40.8/42.4/53.5 ms); cold/all-system and native input-to-first-paint bounds remain unproven. See the [production report](../../../.artifacts/runs/final-20261023/REPORT.md).
- 2026-10-23, parameter-table native acceptance remains unproven: the production route uses an explicit fixture; FOM working prose and reference formatting still need the doctrine pass on real populated state. See the [production report](../../../.artifacts/runs/final-20261023/REPORT.md).

- 2026-10-23, strict production acceptance is not complete for all nine routes: the 25-item route matrix, light screenshots at 1600/1024, dark evidence and explicit unproven cases are in the [production report](../../../.artifacts/runs/final-20261023/REPORT.md); universal menu/link/popup, hue/hairline, zero-shift and per-search proof remains open.
- 2026-10-23, production Space sparse capture at 1024 has a largely blank main field while four floaters occupy its corners; distinguish framing from occlusion with projected native geometry before choosing a fix. Broader native scene coverage and worker-inclusive memory/long-session soak remain unproven; see the [production report](../../../.artifacts/runs/final-20261023/REPORT.md).

- List-search acceptance: final production Project A tree input measured 12.4 ms median, 25.3 ms worst and 315.2 ms last-key-to-URL including 250 ms debounce. Every search bar, completion/row keyboard parity and assistive technology remain unproven; kaitpw may reopen the provisional rulings. See the [production report](../../../.artifacts/runs/final-20261023/REPORT.md).
- N6 pane commits remain over budget in production: system switch 299 ms, selection 108 ms, view publication 61 ms, local Work delivery 382 ms worst tasks. Three final row hovers had no observed long task. Global pricing, healing and triage remain in the worker; affected-system repricing is not cheap because groups, reductions and physical circuits cross display systems. Changed pane projections and drawing need further work; see `TODO: N6` in [screen.tsx](../../../ts/apps/web/src/ducts/proto/e/screen.tsx) and the [production report](../../../.artifacts/runs/final-20261023/REPORT.md). HTTP Work persistence remains unproven on this read-only lane.
- Cleanup: original residue `C:/Users/kaitp/.t3/worktrees/Pe.Tools/t3-cf6c5b17` remains after automatic approval review rejected removal with `blocked by policy`; this pass also unregistered its completed child checkouts but Git could not delete residue at `t3-77e6ac0b`, `t3-236e2c3a`, `t3-ab5704e0` and `t3-f6e17c7c` under the same worktree parent. Reports were copied into the [production report](../../../.artifacts/runs/final-20261023/REPORT.md) evidence directory; no child runner remains.
- Deep-link refinements from thread `0dd3a645-c2e9-4a84-b730-7f968ea02dc8`: decide whether an explicit same-route destination should select an exact existing Place before reusing the held tab (`workbench/tabs.ts`); validate known product-route search through the contract at `navigation/model.ts` `admittedDestination`, while preserving Pod-authored/design-system paths and fragments. These are scoped follow-ups, not part of the verified route-owner cut.
- Generated 2026-10-22 (L5): the C# link producers read `dotnet/Pe.App/Host/PeRoutes.generated.cs`, projected from the route contract by `pnpm codegen:routes` in `ts/packages/agent-contracts` and held fresh by a test there. Still owed: C# does not yet build values through the contract's codecs (it joins escaped strings), so a route with a coded key (a viewport, a layers list) cannot be linked from C# until the table carries codec names.
- Native acceptance limits: Ducts membership browser checks used synthetic system assignments, so real-model membership remains unproven. Nested-link actions remain unavailable until the native reference DTO can express their path. Incomplete/truncated family refusal through the rendered menu and Selection Box framing in pixels still need browser/native acceptance; exact identity, native box geometry and one-Undo restoration have separate controlled-dev proof.
- 2026-10-21, primitive gaps kaitpw named at the end of the ducts round (consumer named per line; this ledger owns the gap):
  - A numeric input with its unit as one primitive (cfm, in-wg, in-wg per 100 ft, ft): `StateCell` `measured` has `displayUnit` but `numeric` has no unit; the ducts Inputs section and the design-friction popover draw units as loose text. Consumers: ducts, rooms, takeoffs.
  - Route settings already have manifest `options` / `globalOptions` and [SettingsProjection](../../../ts/apps/web/src/settings/options.tsx). Decide their tutorial presentation and audit consumers that still draw private controls; do not add a parallel settings store or imply universal adoption. Route effects likewise stay on `RouteAction.does` and semantic actions, not a new runner.
  - The tutorial as the projection of the manifest: beyond keys and panes it should draw the intended flow from the stage order, the verbs and the slots, each with a description slot in the manifest or action definition; today `docs` is one JSX blob per route and only `/ducts` fills it.
  - Example links derived from the bound document's read: a tutorial case names an engine code, and the route finds live instances of that code in the current snapshot and links them; the same mechanism is a candidate surface for owed and audit views. Today the ducts cases carry element ids from the example project.
  - Button taxonomy: nothing distinguishes read from write, severity, size or performance cost, or UI state from external state, so "too many random buttons everywhere" (kaitpw). Candidates: context menus app-wide for secondary verbs, one verb grammar in the kit, and a mark per axis. Consumers: every route.
  - Spatial kit, what is still owed after the 2026-10-22 cut on `feat/spatial-kit` (landed: `page-keys.ts` helpers and `routeAddresses` fields, `Pane` strip with `pane-strip.tsx`/`floater.tsx`/`minimap.tsx`, `scene/*` with `Scene3D`, the ducts picture on meshes, rooms/takeoffs plane viewports with minimaps, the families minimap floater, `/space` on the kit; run ledger `.artifacts/runs/spatial-kit-20261021/RUN.md`): the chat lens adopts the `scroll` minimap contract without a re-skin (its ref-driven dial needs more than a few lines); the mesh tint follows the ducts `encoding`; `ProtoProps.doc` is dropped once `ducts/route.tsx` stops passing it; every mesh claim is UNPROVEN until kaitpw drives a live capture on the dev session.
  - A public way to track features and roadmap, and a home for settings: the duct-cases scratchpad's status chips (handled, owed, open, fixed) are the seed; the tutorial is the interim home.
  - Inbox promotion: the ducts `Inbox` (verb-grouped rows with a collapsed diagnostics key) and the Write review list (old → new per item, refusal reason) are route-local and belong in the kit beside `Tree`.
- Tree disclosure (2026-10-20, ruled by kaitpw in the ducts UI round: "the ascii looks horrible", this kind gets "the classic vertical line to illustrate the span"): the one tree is kit `Tree` and `Row depth` in `ts/packages/kit/src/components/lang/row.tsx`, a lucide chevron that rotates on open, one `data-depth` indent-guide rule in `lang.css`, and a cut row title shown in the row's Tooltip. `components/lang/accordion.tsx` drops its `▸ ▾` glyphs. Specimen on `/design-system/list`. It lives on throwaway branch `proto/ducts-ui-r1` at commit 00e816ef; owed: cherry-pick that one commit to canon, then every list that draws its own chevron or glyph (census owed) moves onto it. Consumer routes: ducts explorer and inbox. Known defect in that commit: `Row` wraps itself in its Tooltip only after it measures a cut title, and the late wrap swallows the first chevron press on that row; the ducts prototype passes `title` always as a workaround, the fix belongs in `row.tsx`.
- Table controls promotion: obtain kaitpw?s confirmation or revision of round-10 counsel defaults, then land the scoped kit/table/specimen/ADR0020/guard cluster. Keep unrelated work separate. Any retained no-Revit review launcher needs an owner-aware shutdown; historical PIDs and ports are not current custody.
- Picker and table cutover, from `census-r10.md`: 17 popups bypass `PopupFrame` (raw Base UI Popover in `navigation/chrome-settings.tsx:41`, `navigation/popover.tsx:16`, `route/situation-{marks,verbs,lamp}.tsx`; `components/lang/command-palette.tsx:36`; five HoverCards; two hand-rolled panels), 5 search inputs bypass `SearchControl` (`navigation/app-bar.tsx:289`, `components/lang/navigation.tsx:25`, `navigation/directory.tsx:220`, two specimens), 14 bare `Table` sites draw no frame and three draw their own counts (`integration-table.tsx:157` hard-codes "13 params · 3 types", `takeoff/atlas-table.tsx:75`, `ops/views/detail/schedules.tsx:88`); `rowCount` is passed only by `families/pivot.tsx:337`. The caret suggestion list under the table search still sizes as `autocomplete` (28rem) against the round 9 band. `list-census.test.ts` catches none of this; grow it to raw Popover, HoverCard, bare Table and bare search input. `MAP.md:32` and `:135` still describe `pivot-rules.ts` and `ConditionBox` as live.
- Mojibake repair (2026-10-19): an earlier cleanup lane wrote cp1252 into six web files. The repair restored them; `ts/apps/web/src/chat/manifest.ts` has one mojibake run that is already in HEAD and is still owed.
- Picker polish (2026-10-19): unproven in the browser are the column-head frame under keyboard focus-visible and dark mode for the search well and the `not` press. A stationary pointer under a shrinking list is proven deterministically only.
- Item 11, native notice reply clipping: current-source browser fixture grows from 102 to 194 CSS pixels for five lines and emits updated heights through the existing ResizeObserver; the native field failure is not reproduced. On the release tray, focus a reply, type five lines, and confirm the final line and Send remain visible through growth and preview opening. [Height reporting](../../../ts/apps/web/src/machine/notice.tsx), 2026-10-14.
- 2026-10-14, pop r3: every floating surface lifts in dark through the one `--shadow-float` token (`--pe-shade` black 70% and a 10% white `--pe-lift` edge in dark; light unchanged). G status-first stays (owner). The F miniature was empty because `sandbox=""` blocked scripts and the owner's newest Page draws only with script; it now runs `allow-scripts` on an opaque origin. Ruled shape: E bare hint is the default resource preview, G when the resource declares state, H when it declares content, F only for Pages.

- 2026-10-14, wave T: recheck installed tray caption exclusion at actual 100/125/150% monitor DPI. Checkout WebView2 proof uses zoom equivalents on a 200% monitor; `TrayWindow.ProjectTitlebar` and `navigation/app-bar.css` own the rule.
- 2026-10-13, installed acceptance for the shared shell: real Edge PWA geometry and native tray resize/minimize/close, compact Pea and same-address full-window handoff. Dev native SPA single-row framing is observed; installed behavior remains separate. Experimental WebView2 WCO still reports zero browser geometry on runtime155; production uses stable WebView2 and measured DWM frame geometry through the explicit surface adapter. Thin-border resize and multimonitor DPI acceptance remain owed.
- Ctrl+Shift+K search: prototype unifies Tools, Works and Pea threads, with fixtures labelled. Wire actual instance discovery and typed resume after the interaction verdict; `RouteWorkspace.list()` currently exposes route registrations, and thread summaries have `harnessClient().threads()`. Recheck `/pea` client rendering and search interaction when the browser automation host is available.
- Navigation promotion: browser proof at `.artifacts/runs/browser-navigation-20261013/` covers the canonical directory, compact palette, explicit destination reset, real history and theme-color synchronization. The refreshed dev Host serves real Pea summaries; nine older hash-only Work files cannot be discovered from their stored bytes. They remain exact-key readable; a future canonical write preserves identity for discovery. Live saved-Work resume remains unproven because this store has no indexed Work rows. Arbitrary named Work destinations need explicit route consumers before resume links can be offered.
- Native acceptance: the user's screenshot confirms the earlier prototype's active Edge WCO. The promoted bar's native dragging, geometry at display scaling changes and resulting caption-control colors still need installed-window acceptance. Automatic approval review blocked visible Edge launch; browser tests prove only the emitted theme-color hint. Ribbon compile is blocked by the foreign `CmdCloseModel.cs` reference to missing pinned SDK types `Holdings` and `CloseOutcome`; no Revit payload was deployed or reloaded.
- Retire the dev review launcher only after the owner finishes (`tools/dev-tray.ps1`, authenticated host shutdown). The historical handover recorded an intentionally retained watcher/launcher; no current process ownership is inferred from its old PIDs.

### ADV2-S3 owner provenance, restored verbatim

These rows are byte-for-byte text from `34bd5e17`. The searchable comment preserves the pre-purge row id. A later ruling can supersede behavior, but it does not erase the owner's words or attribution.

<!-- ADV2-S3 R296 -->

- 2026-10-12, kaitpw, installed 0.7.21 help overlay (Alt+/) on /chat: four "COMPOSER · KEYS" cards and region boxes drawn on top of each other ("1 threads" over "3 composer"). Cause: `chat/composer-bank.tsx:47` keeps one `Composer` per visited thread inside `<Activity mode="hidden">` so drafts survive, and every hidden composer still mounts `<Pane id="composer">` plus `<ScopeKeys>`, so the overlay reads N composer regions and measures hidden panes to a zero rect. Fix at the overlay: list and measure only visible panes (`checkVisibility()` or an `offsetParent` test), never per composer. Also the help text is behind the composer: it still describes `/` as "skill commands" only, and says nothing about the new `/` and `@` behaviours; kaitpw to say what they do now before the `says` strings are rewritten.

<!-- ADV2-S3 R303 -->

- Kit base round 0 (2026-10-12): table routes (`/schedules`, `/data-tables`, `/families`, `/takeoffs`, `/param-tables`, `/parameter-links`) render at the comfort geometry until something sets `data-density="dense"`; portalled menus need it on the document root. Fold the harvested rulings (`.artifacts/runs/ui-base-20261012/{register,button,kit-prose,pane}.md`) into this ledger once kaitpw says which still stand. Lower the stale adherence baselines (`hostBelowRoute` 6 to 4, `opacityDim` 9 to 8, `longTitle` 26 to 21). `chat/composer.css` input-row rules belong in `conversation.css`. `ts/apps/web/AGENTS.md:43` still describes two registers. `card.tsx` is `rounded-lg` on the landing page against the square-surface rule.

<!-- ADV2-S3 R307 -->

- **IMPORTANT, deferred by kaitpw 2026-10-01 (his scope is bigger than this line):** a firm-wide catalog store fed by cited Pea proposals. Pea finds the manufacturer document for each product in a model, the grounded-doc engine (`/doc-lab`) parses it, and Pea proposes values (first: air-terminal pressure drop by model, size and airflow; then equipment static, coil, filter and valve drops) each citing the page and table cell. A person approves, edits or rejects beside the highlighted PDF; approved tables live in one firm-wide store reused across projects, and a script interpolates them onto every matching instance with provenance. Why: native duct pressure drop needs a drop on every terminal and unit connector, and per-product tables (a few dozen) replace per-instance entry (hundreds per model).

<!-- ADV2-S3 R315 -->

- Chat prompt suggestions wait until kaitpw has example prompts that are proven to work.

<!-- ADV2-S3 R334 -->

- 2026-09-01 pane/tutorial refinements (kaitpw at the merge verdict: "some refinements need to
  be done on the pane+hotkey stuff"; the integration wave itself LANDED — report
  `.artifacts/handoffs/2026-09-01-integrate-pane-tutorial-report.md`): specific refinements are
  not yet enumerated by the owner. Known candidates from the wave's own audit: tutorial pane
  tags read kind-fallback labels ("visual", "room") instead of pane titles — the measure join
  labels want the pane's rendered title; the shortcut card renders disabled rows unmuted; a
  non-string hotkey renders the literal word `custom`; card placement has no scroll or
  `ResizeObserver` repositioning. Ink hover emphasis and final rendered geometry are still
  UNPROVEN on the browser lane (hidden-tab limits; needs one visible-tab pass).
  `manifest-ref.ts` rides as the named interim until the ONE ROUTE SPEC provider owns the
  manifest and pane-element registry; pane slot declarations enter `CollaborativeRouteSpec`
  when it lands.

<!-- ADV2-S3 R356 -->

- `Combobox` needs major improvement (kaitpw 2026-09-01, ruled with the CellSelect adoption): the
  cell keyboard/commit contract, filling-trigger parity with the header facet, chips density, and
  whatever the takeoffs cutover surfaces. It is now the one menu primitive, so its debts are
  cross-route.

<!-- ADV2-S3 R396 -->

- `/takeoffs` has "a lot of obvious problems" (kaitpw, 2026-08-31, unenumerated). Ruled to its
  phase-4 cutover round, not before: route fixes on an unsettled density law get redone. Family
  rows whose identity cell wraps to two lines still break the 20px rhythm (`density round 1`,
  measured); nowrap/ellipsis lands at the same cutover.

### Navigation and installed shell

- Ctrl+Shift+K search: wire real instance discovery and typed resume (`RouteWorkspace.list()` and `instances()` in `ts/packages/runtime/src/route-workspace.ts`); saved-Work resume is unproven and named Work destinations need route consumers before resume links.
- Installed-shell acceptance in a real WCO/PWA window: native dragging, display-scaling geometry, caption-control colors under the `theme-color` hint, and full-face Cancel at 400px with active feedback (`ts/apps/web/src/navigation/app-bar.tsx`).
- Multiple Works per route and their nesting are open (2026-10-12).
- Per-route command palettes mirroring route verbs for `/families`, `/family`, `/schedules` (user ruling 2026-09-22); built on `components/lang/command-palette.tsx`.
- Help overlay (Alt+/) draws one "COMPOSER · KEYS" card per visited thread because `chat/composer-bank.tsx` keeps hidden `Composer`s mounted; list and measure only visible panes in `route/help.tsx`. Then rewrite its `says` strings once kaitpw states what `/` and `@` do.
- Situation polish gaps in `route/situation.tsx`: ledger values arrive as route strings so a path or timestamp cannot wear mono (type `ledger` as measured or prose); `[data-tone]` in `lang.css` is a zero-specificity `:where` rule that any ink utility beats; the chain lamp lies by omission on demo-lane pages (needs a "demo" word); no rule for what the head loses first below ~58rem; the state gauge popover outgrows the viewport once the inspector is not DEV-only; the commit flag needs a ruling on "a handful" of edits; the page-log `target` row prints host session id and openId.

### Pea chat

- Live proof against a real Claude Code or Codex turn and a real Revit session: interrupt, attachments, and `@` `doc:` rows with a `pe://` block (`ts/apps/host/src/harness/threads.ts`, `ts/packages/agent-contracts/src/mention.ts`).
- Attachments: move the composer's 5 MB and 10-file limits into the contract and enforce them in `POST /prompt`; record `promptCapabilities` in the provider probe so a brand-new draft refuses before the thread exists.
- `/instances/readings` (serves `recents`) mounts only with the Revit routes (`ts/apps/host/src/app.ts`, `instancesReadingsRoute`), so a host without Revit answers 404 and `@` shows no recents. Decide whether Revit-free SDK readings mount in every host mode.
- `@` menu: `mentionFace` (`ts/apps/web/src/chat/use-mentions.ts`) stands in for real op display titles; the op catalog should carry them from the C# operation. `GET /pe/capabilities` reports `at` as now on cache hits and a document mention's `takenAt` is the composer's last inventory sighting (`mention.ts`); give each source its own taken-at.
- `@` sources past the first slices: open views (needs an op), cloud (needs APS). Pea opening a recent end to end, and kaitpw's dev host serving recents, are unproven.
- Rulings owed from kaitpw: Send framed when refusing and commit-filled when it can send (Fable default); auto-settle as an app-wide setting; the round-1 opens (thread-head fork framed beside quiet icons, pending-request options as framed buttons with a 4px gap, the Archived shelf does not stick, the `lang-chat.tsx` navigation specimen sits outside a `Pane`).
- Fold the rulings harvested from the deleted kit headers (main checkout `.artifacts/runs/ui-base-20261012/{register,button,kit-prose,pane}.md`) once kaitpw says which still stand.
- Woke surviving a reload is unproven: the contract has no durable wake reason.
- Send's swallowed provider errors (`sendPrompt`) belong in the page log.
- The live Chat dock projection may move into each route View; completed transcript cards keep reading only their recorded result.
- Chat prompt suggestions wait for example prompts proven to work.
- Large tool outputs (MB-range element lists) render whole; `Code`'s 64 KB gate is interim. The fix is a bounded output contract on the tool result.
- Refine chat navigation and conversation recipes into the house system after real use (route-local CSS is an interim seam).
- Exploration: one proposal review surface in the Situation head shared with Chat, consolidating the Work band, Chat `ProposalHead` and `FamiliesProposalsBand` under one Work and cell-transition owner; shape and placement undecided.

### Routes and Work

- September cutover residue, retained from the folded route/workspace/keys reports: prove parent-sized Surface/shared PaneSplit gutters on embedded and standalone routes, finish the SidePane caller census, and audit remaining global keyboard handlers in Family/Families/Runs against current `route/keys.ts`. Resolve private Chat kbd/docs remnants and narrow Tutorial overflow versus stacked regions. Deterministic consumer checks never proved browser geometry, keyboard reachability or the final integrated suite.
- Fixture coverage: synthetic/demo URLs must name a real seed; a live URL is not fixture coverage. Historical fixture-census correction classified `/lab` as a prototype, not a static fixture, and left five live routes uncovered. Re-census the current routes/seeds before treating that inventory as current. Preserve the schedule-fixture lesson: shared document addresses leaked prior Reading/revision/capture identity across isolated hosts; use distinct logical addresses. `9f77fca` fixed the deterministic seam, not native queue behavior.

- Split `route/spec-editor.tsx` along its sections. The historical 730-line count and deleted line-budget allowlist are not current constraints; the decomposition obligation remains.
- The `/schedules` spec pane unmounts instead of hiding (`TODO:` in `route/entity.tsx`): `SpecEditor` works while rendering.
- `/family` learns the change mark from subscription time, not its last read's taken-at (its capture is a member write); give its capture the `families-matrix` envelope.
- Revit-backed proof of the change mark: on `/schedules`, two model edits under 750 ms apart draw "changed in Revit" after the second.
- Revit-backed proof of ephemeral Work: stage in an unsaved project, Save As (lifetime line goes, cell survives); close a second unsaved project (receipt with count). Premise: `OpenDocumentIdentityTests.Open_identity_survives_saveas_but_not_close_and_reopen`.
- Recover surface coverage lost in the 2026-09-22 SCAFFOLD sweep across route, Chat/grounded-doc and host assertions. Use git deletion history rather than competing 54/28/18 inventories. Each surviving behavior needs a CDP journey, MCP/HTTP check or visible readout; test deletion proves none of them closed.
- Deterministic fixtures for Data Tables, Ops, Parameter Links, Runs and Schedule Grid; review URLs alone do not prove pane geometry.
- True backend cancel for `/call`: stop cancels only the wait (`ts/apps/web/src/host/client.ts` and the host `/call` route take no `AbortSignal`).
- Exact valid document pins and A/B switching have controlled Families browser/native proof. Still exercise malformed and closed targets through the rendered UI and verify the remaining address/carry consumers; source and HTTP refusal checks do not close those browser cases. See [review proof boundaries](../../research/2026-10-22-routing-and-pea-review.md#evidence-and-limits).
- The session shorthand `?target=session-…` resolves `ambiguous` while `revit.matrix.loaded-families` walks `EditFamily` documents; rule whether shorthand pins to the project document once resolved. That op has no failure preprocessor or `DialogBoxShowing` handler, and a family warning blocked the Revit API thread for 15 minutes (2026-09-14); suppress warnings in the op and move bridge reconnect off the API thread.
- Complete the file ladder (an explicit `.r10` path is accepted today) and prove the Work band conflict state. A nonempty human-staged Families band, A/B switch retention and Home/Back retention have controlled browser/native proof; target removal and Pea refusal remain unproven. See [review proof boundaries](../../research/2026-10-22-routing-and-pea-review.md#evidence-and-limits).
- Family demo lane (`/family?demo=plan`): the file slot shows "choose a family file" where `box.family.json` should be seeded.
- Situation rulings owed: a dense Instances view inside a large picker opened from the chain lamp; whether health and resolution changes belong in the page log. `FlowMatrix` (`route/flow.tsx`) upgrades to SVG edges past ~8 readings or once reading-to-reading edges are typed.
- `busy` is a runtime refusal; make it a type (`Busy<A> | Idle`).
- Instances (2026-09-10): advance the installed Bootstrap (user authority) and run the native Instances journey; dispose of the two legacy in-flight rows in the product database; diagnose the Instances first-click miss.
- Live-lane proof of the route-store cutover on `/takeoffs` and `/chat`. `/takeoffs` has "a lot of obvious problems" (kaitpw 2026-08-31, unenumerated); Family identity cells still wrap to two lines.
- Settle the unruled targeting instrument treatment from `f459801e` / deletion `43ff94b0` against the current Situation head (`route/situation.tsx`). The address cutover does not itself settle that visual ruling.
- Product follow-up after RP merge: extend the Situation motif to low-priority routes, finish file-picker ergonomics, fill incomplete frozen seed slots. None authorizes a competing Work, Reading or Action owner.
- Tutorial and teaching: review route orientation prose, pane guidance and tutorial geometry with the user (hotkey and pane-map infrastructure are not the authored experience). Manifest View coverage and inspector provenance gaps need a final disposition after source review.
- `use-route.ts` evicts the `own` revision chain by insertion order past 256 entries, so a long-lived page degrades from bound to stale; bound by observation, not count.
- A firm-wide catalog store fed by cited Pea proposals (deferred by kaitpw 2026-10-01, scope larger than this line): Pea finds each product's manufacturer document, the grounded-doc engine (`/doc-lab`, `ts/apps/web/src/routes/doc-lab.tsx`) parses it, Pea proposes values (first: air-terminal pressure drop by model, size, airflow; then equipment static, coil, filter, valve drops) citing page and table cell; a person approves beside the highlighted PDF; approved tables live in one firm-wide store and a script interpolates them onto instances with provenance. See `docs/features/ducts/`.
- 2026-10-22, kernel follow-ups after `a1007918`, consolidated from L1-L5 and entity adoption. No item below is native proof:
  - Web: consolidate repeated route search/middleware declarations. URL restoration uses the Page transition in [view-owner.ts](../../../ts/apps/web/src/route/view-owner.ts) and [url.ts](../../../ts/apps/web/src/route/url.ts). Two seeded Chrome journeys at `9da061c3` prove the selected refresh/reconnect/worker continuity cases; two-thread switching, native arming and other consumers retain their separate [proof boundaries](../../research/2026-10-22-routing-and-pea-review.md#evidence-and-limits).
  - Contract: align optional Page fields with schema output and provide escaping list/sort/JSON codecs where comma-separated names and empty items fail. Dependent Page resets run during URL restoration; review remaining consumers without treating that repair as universal adoption.
  - Lease, `route/view-bridge.ts`: allow refusal based on current Page/facts, including unsaved Pods typing and nonexistent output; declare facts descriptions. `agent.finds` and the one `useRouteLease` mount are landed source, not remaining work.
  - Contract: admit app-owned address fields such as `?inspect` with access policy; export entity field types rather than borrowing Schedules' Page type.
  - Kit: one TableState adapter for query/sort/hidden/selection instead of store-specific projections (`schedules/lease.ts`, `families/store.ts`, `family/store.ts`, Takeoffs); declare plane orientation; resolve the `ducts-domain` dependency preventing duct constants leaving the route contract.
  - Guard: reject raw `navigate({ search })` writes that bypass Page ownership. The removed entity History/view/selection copies demonstrate why it is needed.
- Entity-wave-c's unported obligations remain open: History Readings on Schedules and Family (rulings 57-58, host `history`); catalog Work identity (51); Pea planning Families (50, actor policy); `commitIn="verbs"` and narrow log (V14-V16); pivot cell focus; and the Cite inspector. Branch presence is not delivery.

### Language and primitive gaps (single owner)

- **Outcomes are orphans**: `OutcomeLine` carries no verb, actor, time, target or item list; blocks `/instances`' attributed ledger rail and `/workbench`'s owed-approval lane.
- The gutter marker (SURFACE-PHILOSOPHY section 4) is unbuilt: "a human decision is queued here" and "this row is unreachable" are row facts.
- The cell menu primitive (`CellListSelect` in `components/lang/list-popup.tsx`) owes the cell keyboard/commit contract, filling-trigger parity with the header facet and chips density.
- Three host severities (Info/Warning/Error) map onto one caution; "host disconnected" has no axis; view-trust facts (temp hide/isolate, hidden filter/workset, unloaded link) ride hand-picked caution tones; no "distrusted region" treatment for spatial views.
- Preview freshness (`previewed`/`reviewed`/`applyReady`, "pea previewed, a human must re-run") is state with no mark; page-level "unsaved" has no home beyond a caution `FactChip`.
- No primitive for a three-way exclusive choice that can be empty (looks good / not sure / looks wrong / not judged); no grammar for "this apply will remove N rows".
- LEGAL-OPTIONS LAW (ruled 2026-08-19) is unbuilt: every input offers only options valid in that slot, read from the live document.
- Session-drive verbs are unruled ("open in Revit", "open view", "reveal json in IDE"), as is `ownerRoute` navigation from a binding noun's popover.
- A compact table mode is ruled but unbuilt: hairline rows, mono values, one line per cell, no scope strip (see the 2026-10-13 density row: mint it on the first table that feels too loose).
- Rule whether a transient twin highlight differs from selection, and write the rank clause the non-hue-channel law implies. Border-budget edge cases: is the write-verb group an artifact frame; are readonly testimony cards.
- Untested compositions: only proposed+drift is proven (staged+stale, grounded+drift, refused+proposed are by precedent). Interaction states (hover, focus, selected, editing) are undesigned as a system. Consolidate the state vocabulary; each new word costs the user.
- `Verb` has no icon-only or render-prop form; a busy-and-refused verb is unrenderable. `NarrowChip` owns removal but nothing owns re-adding.
- `MasterTable` remainder: `CellStateKey` deriving axes from on-screen rows, row-level proposal marking beyond `rowClassName`, multi-select, per-cell width, URL-addressable filter/sort/query (`MasterTableState` is component-local).
- Rebuild the trichotomy reviewer on `StateCell`; the proposal-flow satellite stands in. One shared reader derives `StateCellProps` from a trichotomy cell; family's rail locate (`family/marks.tsx`) folds into `onLocate`. A catalogued chart/series consumer for `--viz-1..6` (`CoverageBar` is the designated first). Per-domain host-call facades on the `ts/apps/web/src/host/familyfoundry.ts` pattern.
- Census `components/anatomy/annotation.tsx` (28 variants for the Lens, a second grammar) against the kit before a 29th. Rule whether an overlay mark is an `annotation` variant rather than a `Press` tone.
- Collapse the Escape handlers (`takeoff/atlas.tsx`, `family/workspace-core.ts`) into one keyboard policy.
- Mono-floor and ADR 0004: caption, label and value share one size and differ by face, case and weight; decide whether the three tiers stay as roles or two merge before rewriting the ADR table.
- Primitive gaps from the 2026-08-30 ports: no inline stale/error caption, no pane-availability mark beyond the ink ladder; `Section` has no tier slot, `CounterExample` no struck variant, `OutcomeLine` lost `dropped`/`partial`, `ArmingStrip` cannot show armed-at/by or plan age.
- `routes/grilles.tsx` hand-rolls a Set multi-select (families' copy is gone).
- Add a swatch specimen for `data-derived` (dashed, world-reported) on `list-popup.tsx` words beside the popover specimens.

### Guards, proof and housekeeping

- 2026-10-23, kit-raise run (waves 2–8, branch `t3/kit-raise`, run folder `.artifacts/runs/kit-raise-20261023`):
  - Refresh marks pending 601 ms late (proof/checklist7.md D11): `ts/apps/web/src/readings.ts:607` `acquire(refresh)` starts acquisition without a synchronous pending mark; the kit chip and readout slot are ready and wait on that line. Owner: readings.
  - Purge debt: work +335, camera +284, overlay +278, teach +202, capture +136, tips-fix +422, tutorial +110, floater-geometry +113 net lines; the fold slice recovered ~5. One purge pass over kit pane/button/tooltip/teach owners is owed.
  - Capture rules (Fine retry by bounding-box coverage, nearest-first context, completeness advisory) are compile and synthetic-test proven only; the real-model read (SA 71 flex tubes, context omitted count) waits on the next `pe-revit session hr`.
  - Scene look (context ground, fog steepness, x-ray reserved for the lit subject) is proven for state, not for taste: one real-model eye pass by kaitpw.
  - `ts/tests/e2e/route-chaos.test.ts` needs `CHAOS_PRODUCT_ROOT`; not run on this branch. `ts/apps/host/tests/dev-takeover.test.ts` fails with ENOTEMPTY on temp-dir cleanup on main b8905f6e too (environmental; host owner).
  - Fold the sibling-certified readout carry forward: done in retain-fix (kit readout slots); the route-chaos journey must be replayed once on main.
  - Worktree residue on disk under `C:/Users/kaitp/.t3/worktrees/Pe.Tools/t3-*` (node_modules locks); git registrations pruned.

- From slice S5, the Rooms pane-level Escape workaround, TableFrame F versus stage-frame collision, and list completion versus row ArrowDown/Enter parity still need kit-owner resolution. The stale floater early-return description is retired: current `useYield` checks earlier floaters and docks; the native sparse-scene visual gap is tracked separately. Delayed enrollment subscriptions are fixed and native Space selection was measured; large-scene shell cost remains unproven. See the [production report](../../../.artifacts/runs/final-20261023/REPORT.md).
- List-kit browser proof covers the 355-row specimen, chat, and saved Chadds systems, Rulings and tree. Priced Inputs/fans still need browser proof with tables beside the snapshot; directory, Activity, sessions, Work lines, parameter changes and rooms Feedback have deterministic coverage but no individual browser pass. Evidence and baseline check failures: `.artifacts/handoffs/2026-10-22-list-integration.md` (2026-10-22).
- Remove the retired list-core checkout residue at `C:/Users/kaitp/.t3/worktrees/Pe.Tools/t3-4fac501b`: Git removed its worktree registration, but directory removal failed and automatic approval review blocked the explicit cleanup. No process remains from that child; evidence was copied to the list-kit checkout before retirement (2026-10-22).
- Remove the fold baseline residue at `C:/Users/kaitp/.t3/worktrees/Pe.Tools/t3-66cadcc6-fold-baseline`: Git removed its worktree registration, but directory removal failed and automatic approval review blocked cleanup; baseline test output is in `.artifacts/runs/kit-raise-20261023/wave6/fold-baseline.log` (2026-10-23).

- Adherence ratchet re-floored 2026-10-13 (wave I) after the A/B/C/D/F1/G/P merges, because the baseline had gone stale in both directions. Debt that ROSE and is owed to its owners: `escHandler` 1 to 3 (`chat/thread-palette.tsx`, kit `cell.tsx`, kit `master-table/query.tsx`); `busyState` 2 to 4 (`chat/composer-pending.tsx`, `chat/question-form.tsx`, `machine/pea.tsx`, `lab/synthetic.tsx`; `runVerb` is the bracket); `inlineColor` 47 to 50; `dlLeak` 0 to 9 (`dl-*` named in `chat/composer-pending.tsx`, `workbench/moments.tsx`, `navigation/app-bar.tsx`, `components/work/band.tsx`); `fatRoute` 9 to 10 (`routes/design-system_.revit.tsx` 618 lines is the worst). Dropped and lowered: `opacityDim` 9 to 8, `longTitle` 26 to 20. The guard also scans `packages/kit` now, so kit moves count against the areas they landed in. `hostBelowRoute` holds at 6 (`route/use-route.ts` `callHostRpc` came with the Pod-authored routes). `test-bar` holds 93 scaffolded web tests as its ceiling (the 2026-09-22 value of 16 assumed a sweep that never ran).
- Verify the 1,681 comment lines deleted under "dated rationale is git history": confirm none was a `FOOTGUN:` or a trap no code site now carries.
- Fix the guard misreports: the inline-color regex in `ts/tests/repo-guards/src/design-adherence.test.ts` and the class guard's `AUTHORING` filter counting typography/shape utilities as "meaning, fill and stroke". Lower stale adherence baselines (`design-adherence.baseline.json`).
- Headed-browser proof that scrollbar gutter reservation causes no layout shift (headless Chrome gives overlay bars); one visible-tab pass for tutorial ink hover and final geometry. Browser-lane proof of the two-axis type migration (ten former `t-value face-mono` sites moved to `ink-2`), the 11px prose tier and dark mode against the laws, and screenshot proof for the cluster (the record is DOM testimony). The style-regression census still owes `/family` and `/settings`.
- `lens.house` holds prose the route used to show; move what renders back to the route.
- Review the class allowlist increases Fable recorded for five route files: visual debt, not validated layout.
- Name sweep, one commit per item: `scope` naming a `WorkKey` at ten sites; `ScopeStore` persisting `scope:${threadId}`; `bridgeSelector`; `OpenDocumentCount` beside `OpenDocuments`; the `schedule-grid` literal in `bridge-protocol.ts`; `TakeoffPromotionFacts` on the generated wire; two `Thumbnail` components; two `ListPopup` specimens; two synthetic zone worlds.
- Rule one fixture-lane spelling (`?source=fixture` or none). `/family`, `/families`, `/settings`, `/ops` have no fixture lane; porting them needs a controlled Revit session.
- "Update check unavailable" conflates endpoint 500, dead network and a dev proxy with no host (`ts/apps/web/src/machine/update.tsx`, `host/install.ts`). Decide the front door's brand dot: a real host lamp or gone.
- Write the route pattern into `ts/apps/web/AGENTS.md` (a pattern, not a framework). Chat internals `workbench/provider` and its adapter are untouched by every pass.
- Feedback picture rasterizes the whole page per send (2.5-6 s on `/design-system`; untested on canvas, 3D, iframe routes), and travels as an inline data URL that PostHog shows as text (`components/feedback-picker.tsx`).
