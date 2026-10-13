# design-system ledger

Rebuilt 2026-10-13 as current truth; git holds the timeline.

The one-system design cluster: the design LANGUAGE (raw values in `apps/web/src/base.css`, projected by `design-lang.css`, grammar in `components/lang/`, page anatomy in `components/anatomy/`), the `/design-system` route and its satellites, the front door (`/`), and the document lab (`/doc-lab`).

**This ledger owns every cross-route design-language and primitive gap.** Route ledgers name their own applications and evidence; they never restate a ruling or a gap that lives here. A rule lives in exactly one home: a type, a check, a swatch specimen, or `.agents/skills/lens.house/SKILL.md`. `docs/design/SURFACE-PHILOSOPHY.md` indexes those homes.

## Decided

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

- 2026-10-13, the `[data-density="dense"]` register is deleted (ruled round 0, superseded round 1, only the laws specimen used it). One 24px control register. Re-mint a compact Table recipe only on the first table that feels too loose. Supersedes the 2026-08-31 20px-row density round and its two-height split (`--item-h` and `--control-h` are both 24px); a surface that needs another height names it here before authoring one. The 2026-08-31 density law stands (kaitpw): denser and smaller is better; conventional accessibility sizes do not fit this use.
- 2026-10-13, a disabled action's refusal reason shows in the kit `Button` tooltip on hover AND keyboard focus. One motif for every refused verb.
- 2026-10-13, the route name and search are one topbar input. Click or type opens the shared compact navigation List under it; Ctrl+Shift+K and Find focus the same input. The popup matches the field when wider than 24rem, else 24rem, capped at viewport width minus 16px. Escape and outside dismissal clear the query. Plain focus and picker focus restoration never open it; ArrowDown or Enter opens it from keyboard focus.
- 2026-10-13, the user selects navigation B: route title and shared tools/Works/Pea-thread finder, four grouped shortcuts, a divider, conditional Cancel feedback, then Settings. The A/C comparison branches and switcher are removed. Individual command icons are gone for good. General favicon, Pea chat, Search and Settings icons stay.
- 2026-10-13, `HotkeyCommand` uses one admitted callback for click and key. The four shortcuts (Situation, Page, Find, Tutorial) change faces at the same bar boundaries: written chords above 700px, proportionate drawn modifier symbols in one keycap at 700px and below. No font-dependent Unicode glyphs; tooltips keep the names. Terminal keys: letters and slash 13px semibold in the 12px centered slot; period is a centered filled circle. Menu chords align right.
- 2026-10-13, chords: page Ctrl+K stays scoped, Ctrl+Shift+K searches globally, Alt+/ opens Tutorial, Ctrl+. toggles Situation, Ctrl+Shift+. starts Feedback.
- 2026-10-13, the full-width AppBar shell owns the bottom hairline; its inner nav is the usable WCO-width container. Settings placement is keyed by a stable control attribute, never sibling position (Base UI focus guards add siblings). Pea's page Surface frame is removed (its top border doubled the underline); page Surface is neutral ground.
- 2026-10-13, Home uses the actual favicon, Pea keeps its chat icon, the visible brand prefix is deleted. Browser tabs omit custom Back/Forward; installed standalone/WCO keeps them. Inspector, theme, feedback and Machine share one compact Settings menu.
- 2026-10-13, Situation is a neutral control surface, not an artifact frame. Hovering the bar outside editing controls reveals the existing sentence, verbs, Work state and log; the drawer holds hover across nested portals (native DOM boundaries, 500ms departure grace). Pinning docks the same mounted body above the route and consumes viewport height. Escape dismisses; picker menus sit above it. The original action components stay mounted across disclosure and docking. Hosted and standalone tools keep their local controls.
- 2026-10-13, the page picker publishes its real open lifecycle to Situation: Ctrl+K reveals the head under the picker without pinning; closing releases the hold. Hosted and hidden route owners cannot publish it. Pea keeps composer-owned Situation and its thread picker. Global search never claims the picker hold.
- 2026-10-13, Situation keeps its name; its state indicator projects the route owner (archived observations, unbound targets, bound documents, running actions, attention). Archived observations never claim current Revit health. Meaning color persists; the change pulse respects reduced motion.
- 2026-10-13, app-scoped `overscroll-behavior: none` on the document and root content pane fixes Edge blank-space overscroll. Portable foundation consumers keep their scrolling.
- 2026-10-13, production navigation and WCO for Windows Edge (Chrome optional): `navigation/app-bar.tsx` owns Back/Forward, Home, a Pea shortcut beside Home, compact product/Work lists, search and route-owned help/state. The window-navigation info icon is removed. Native caption controls keep browser-owned dimensions. Page `theme-color` follows the resolved bar color. The canonical manifest adds WCO with standalone fallback and keeps its install identity.
- 2026-10-13, Ctrl+Shift+K and Pea Ctrl+K share `components/lang/command-palette.tsx` and its compact List body; setup supplies rows, grouping, actions. The directory keeps task groups in workflow order; A-Z drops groups and sorts two columns with each tool's Works. Tool metadata lives in popovers. Exposure labels stay provisional and never certify maturity or availability.
- 2026-10-13, product-grouped ribbon: `ButtonRegistry.cs` keeps all 21 existing command registrations and adds seven product launches. No command is removed without a concrete replacement. New browser entries require explicit target selection and never invent an executable document identity.
- 2026-10-12, the agent surface is named Pea; `/pea` is its canonical URL (manifest key stays `chat`). Ctrl+Shift+K searches tool destinations, Works and Pea threads together with result kind and context visible. Conversation and Work identity do not change with the address.
- 2026-10-12, navigation serves an engineering designer finding a tool by task first. Round 1: A wins (index as navigation); B's resume-work affordance joins it. Route metadata opens in a popover.
- 2026-10-12, the top-right control cluster holds global controls only, never a page verb. A bottom bar may spend vertical space only on always-important content.

### Pea chat and kit base (2026-10)

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

- 2026-10-04, the address is generated from the manifest: a route names Page keys in `manifest.url`; `route/url.ts` derives `validateSearch` and `stripSearchParams(defaults)` from the page schema; `useRoute` syncs both ways (one history entry per place). Every url key needs a default. `url: false` is for chat panes and seeds. `view` is the home for UI variants.
- 2026-09-10, route primitive vocabulary is six nouns: Target, Work, Reading, Action, Page, View. Scope, Document, World, Verb, Feed, Lane, Link, Slot, Bound, Multi, Stage, Store, Resource, fixture are dead words (Stage survives as Situation vocabulary, 2026-09-15). RPs compose them through a small declaration and a controller; the controller owns dependent transitions.
- 2026-09-10, `RouteManifest` is the type; every `routes/*.tsx` exports `manifest`. An empty manifest (`key`, `name`) is valid and renders the route name; outlier routes (runs, grilles, data-tables, param-tables, design-system, doc-lab, protos) stay as standard routes, none deleted. Actions return a `Refusal { code, message }`, never throw; `busy` stays a runtime refusal. Installer and update UI belong to the root shell, not the route head. Session identity stays one branded string. `?work=` is the only Work-identity query. Work keys by Address, not openId. Seed and demo wire is plain JSON.
- 2026-09-10, a bound local file is a Reading kind; edits stage in Work. `@tanstack/react-query` is removed from `apps/web`; every host read is a Reading on the one stream, so two caches cannot disagree. `ResourceFrame` with gap frames is the transport.
- 2026-09-22, every entity route declares stages (`EntityRouteView.stages` required). `line-budget.guard.test.ts` (`ts/tests/repo-guards/src/`) holds top-level `apps/web/src/route/*.ts|tsx` to 600 lines. Stages are optional: a route with none declares panes directly; only the person changes the stage.
- 2026-09-22, hotkeys resolve on a scope tree: route, optional stage, pane, nested region. Focus picks the innermost live node; the innermost binding wins. A hidden pane's node is inactive under React `Activity`. A repo guard refuses any hotkey outside a scope node. `@tanstack/react-hotkeys` is the one registration door; raw `addEventListener("keydown")` is banned in routes. `activePaneAtom` is never.
- 2026-09-22, freshness is a per-document change mark, not a timer: `BridgeDocumentNotifier` publishes the trailing edge of a 750 ms throttle, the host marks that document's Readings changed, a surface draws "changed in Revit" with `r` to re-read. A focused surface is never re-read under the hands. A detached bridge is "disconnected", not "stale".
- 2026-09-26, targeting or selecting a subject revalidates it (a new target is a new reading); Families is the one exemption, for performance. Wins over the 2026-09-22 re-read-on-focus-only rule where they disagree.
- 2026-09-22, addressless Work is ephemeral, keyed by exact `{ session, openId }`, registered in the store so host recreation cannot lose its cleanup. The first staged item draws a lifetime line; Save As migrates the Work silently; the close draws a dismissable receipt. No confirm dialog, no title keying. A connected session with no documents still closes Work; a missing session does not prove closure.
- 2026-09-22, the Reading is the cache shared by every pane that draws it. The schedule grid's read is the `refresh` verb run by the pane, never a button. An action's reason shows on hover and focus.
- 2026-09-22, measured cells are one cell kind (`components/lang/cell-state.ts`) used by `/schedules`, `/family`, `/families`. A bare number stages in the column's display unit and never calls Revit. Text with a unit shows as typed until commit, then one read-only host parse returns Revit's rendering. Parse failure is a cell-local refusal; nothing stages. The staged value is `{ value, unit }`. The display unit is Revit's for the Reading's own document.
- 2026-09-22, shared action declarations own prose; every catalog operation has a renderer or an explicit rawByDesign decision.
- 2026-09-15, Work writes use expected revisions. External effects and recovery belong to semantic actions and `ActionJournal` receipts; Work envelopes keep no second external-operation protocol. Operation status never advances a Work revision. Optimistic rendering only when measured latency demands it.
- 2026-09-15, the head is a pure projection of authoritative route state: no shims, fabricated status/counts, mock state or ad hoc adapters. Shared semantic facts feed human controls, hotkeys and Pea; none declares its own policy. SDK owns process/session/document identity and native receipts; Pe.Tools owns semantic actions; the browser projects.
- 2026-09-15, no superseded primitive system stays after merge (alternate state owners, targeting grammars, mutation doors). Seeds are read-only proof inputs: a seeded action refuses "frozen seed is read-only"; the demo lane proves render and parity, never a receipt.
- 2026-09-15, RP acceptance tests ownership and control contracts on representative callers (Chat, Takeoffs' front half, Family integration), not complete products. Acceptance uses real buttons and durable receipts; seeds, mounted composers and direct backend commands do not count.
- 2026-09-01, execution-scope law: every Revit execution carries an exact document contract. The persisted binding is the restart-stable SDK selector, resolved to a live session id at command time; `HostRpcCaller` always receives a target. A route binds one document; Chat is task-scoped and every touch of a document is traceable in the transcript.
- 2026-09-01, transcript tool cards are audit records: a card keeps the event or receipt its turn observed, never the live `route.slice`. Approval settlement is server-only: the client renders in-flight until the host's `permission_resolved` (ADR 0015).
- 2026-08-19, three-home addressing: the sentence carries external bindings; page memory carries the rest; the route document carries what an agent shares.
- 2026-08-25, all page state lives in the route store, one `AtomRegistry` per app ([ADR 0009](../../adr/0009-one-atom-registry-per-app.md)). A page atom holds a primitive or an identity-stable value with one writer. Refusing a second verb is law (`runVerb` records `busy`).
- 2026-08-26, route-doc identity is `(route, Address)`; `?thread` is only a view. `Address` is `cloudModelGuid ?? absolute path`; a `Reading` is `{ at: Address, version, observedAt }`. `agent-contracts/route-doc.ts` exports pure `applyPatches`, `guardCommand`, `commitDoc`; `RouteWorkspace` is only their shell. `RouteStateWriteResult` is a union on `ok`; refusals are `kind: "refused"`. Address comparison lives beside `Address` and treats GUID case and Windows path case and separators alike.
- 2026-09-01, one route spec: UI verbs, Pea commands, the server route registry and the chat-plugin registry derive from one declaration (the mechanism is now `RouteManifest`); tool routes mount the manifest, docs-like routes (`/`, `/design-system`) are name plus cluster. Every route is meant to be Pea-drivable; an address declares only params something consumes.
- 2026-09-01, the fixture lane spells `?source=fixture`, deliberately unadvertised in UI ("obscured unless u know"). The "none" spelling is the open half (Owed).
- 2026-09-12, Chat needs no Revit; requirements gate individual operations. Each option ladder is one searchable breadcrumb input that keeps leaf identity. Chat targeting sits around the composer; targeting primitives compose inline in Chat. Pea's inline UI expresses target, staged Work and action stage; preparation stays interactive and completed actions keep their historical target and changes.
- 2026-09-12, display as little as possible with clear disclosure; the six nouns need not become six visible elements. kaitpw prioritizes repeatable browser journeys through real routes and backend over accumulating unit suites.
- 2026-09-19, users manage only resources relevant to their current situation or goal: live draft plan/apply needs no Pod choice; capture, member editing and publishing expose the Pod because it is the managed resource. Stages and signals advance through working user interactions; reversible assumptions stay explicit until use resolves them.
- 2026-09-09, acceptance scope: Chat runs a real turn on default document A, an explicit per-call document B, then A again without changing the default; Takeoffs covers chosen-document opening, zone adoption, partition execution and honest loading/fresh/stale/error/recovery (native RHVAC sync excluded); Schedule Grid gets one complete cell edit, reviewed change, native apply and readback, recording Revit engine bugs without chasing them and preserving staged edits. A compact activity summary derives from existing owners; a read-only highlighted raw-file view goes where file ownership exists. A new Settings mode and Families plan-derived proposed-change UX are deferred.
- 2026-09-11, route chrome: one control group holds tutorial, inspector, theme (its "lamp shows host status only" clause is superseded by the 2026-09-13 chain lamp and the 2026-10-09 host removal). `/instances` is a standalone route and the body of any route needing Revit with no resolved Target. Composition laws: judge nouns only composed on a real page; every picker is searchable, sortable, keyboard-navigable; no fact shown more than twice per page; every label states its relationship to the other nouns; color, motion and marks carry role, identity and provenance; concept and flow outrank polish.
- 2026-09-09, Family Types is retired, absorbed by Family. Surviving Family Types handlers are retirement candidates, not authority to revive it. Priority routes: Chat, Takeoffs, Family, Families, Settings. Routes outside them are touched only in normalizing crusades. kaitpw's ranking (value and investment, not proven stability): invested UX effort Takeoffs, Chat, Family, Families; MEP-user usefulness Schedule Grid, Chat, Families, then Param Tables and Parameter Links; BIM-manager usefulness Instances, Families, Chat, with scripting and Family Foundry. Foundational utilities: Settings, Chat, Ops and the chat-plugin/route-state system.

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

- Split `route/spec-editor.tsx` (730 lines) along its sections and drop its `LINE_BUDGET_ALLOW` row in `ts/tests/repo-guards/src/line-budget.guard.test.ts`.
- The `/schedules` spec pane unmounts instead of hiding (`TODO:` in `route/entity.tsx`): `SpecEditor` works while rendering.
- `/family` learns the change mark from subscription time, not its last read's taken-at (its capture is a member write); give its capture the `families-matrix` envelope.
- Revit-backed proof of the change mark: on `/schedules`, two model edits under 750 ms apart draw "changed in Revit" after the second.
- Revit-backed proof of ephemeral Work: stage in an unsaved project, Save As (lifetime line goes, cell survives); close a second unsaved project (receipt with count). Premise: `OpenDocumentIdentityTests.Open_identity_survives_saveas_but_not_close_and_reopen`.
- The 54 SCAFFOLD test files deleted in the 2026-09-22 test bar sweep need surface tests (CDP journey, MCP call, host HTTP) or visible readouts for what they asserted; recover from git (`git log --diff-filter=D --name-only` around that sweep).
- Deterministic fixtures for Data Tables, Ops, Parameter Links, Runs and Schedule Grid; review URLs alone do not prove pane geometry.
- True backend cancel for `/call`: stop cancels only the wait (`ts/apps/web/src/host/client.ts` and the host `/call` route take no `AbortSignal`).
- An exact `?target=` survives the router only by re-serialising and lands double-encoded (`routeSearch` in `route/route-owner.ts`); give it a plain `session/openId` grammar.
- The session shorthand `?target=session-…` resolves `ambiguous` while `revit.matrix.loaded-families` walks `EditFamily` documents; rule whether shorthand pins to the project document once resolved. That op has no failure preprocessor or `DialogBoxShowing` handler, and a family warning blocked the Revit API thread for 15 minutes (2026-09-14); suppress warnings in the op and move bridge reconnect off the API thread.
- Complete the file ladder (an explicit `.r10` path is accepted today). Prove the Work band conflict state with real staged edits; the band with `count > 0` is proven by compile and Takeoffs `?demo=sync` only (no seed stages rows).
- Family demo lane (`/family?demo=plan`): the file slot shows "choose a family file" where `box.family.json` should be seeded.
- Situation rulings owed: a dense Instances view inside a large picker opened from the chain lamp; whether health and resolution changes belong in the page log. `FlowMatrix` (`route/flow.tsx`) upgrades to SVG edges past ~8 readings or once reading-to-reading edges are typed.
- `busy` is a runtime refusal; make it a type (`Busy<A> | Idle`).
- Port `/ducts` (on `feat/pressure-drop`, unmerged) to `manifest.url` keys when it merges.
- Instances (2026-09-10): advance the installed Bootstrap (user authority) and run the native Instances journey; dispose of the two legacy in-flight rows in the product database; diagnose the Instances first-click miss.
- Live-lane proof of the route-store cutover on `/takeoffs` and `/chat`. `/takeoffs` has "a lot of obvious problems" (kaitpw 2026-08-31, unenumerated); Family identity cells still wrap to two lines.
- `targeting/**` (instrument cluster, direction glyphs, stage strip; deleted by `43ff94b0`, base `f459801e`) is undecided; screenshot the route head at the base in a worktree before ruling.
- Product follow-up after RP merge: extend the Situation motif to low-priority routes, finish file-picker ergonomics, fill incomplete frozen seed slots. None authorizes a competing Work, Reading or Action owner.
- Tutorial and teaching: review route orientation prose, pane guidance and tutorial geometry with the user (hotkey and pane-map infrastructure are not the authored experience). Manifest View coverage and inspector provenance gaps need a final disposition after source review.
- `use-route.ts` evicts the `own` revision chain by insertion order past 256 entries, so a long-lived page degrades from bound to stale; bound by observation, not count.
- A firm-wide catalog store fed by cited Pea proposals (deferred by kaitpw 2026-10-01, scope larger than this line): Pea finds each product's manufacturer document, the grounded-doc engine (`/doc-lab`, `ts/apps/web/src/routes/doc-lab.tsx`) parses it, Pea proposes values (first: air-terminal pressure drop by model, size, airflow; then equipment static, coil, filter, valve drops) citing page and table cell; a person approves beside the highlighted PDF; approved tables live in one firm-wide store and a script interpolates them onto instances with provenance. See `docs/features/pressure-drop/`.

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
