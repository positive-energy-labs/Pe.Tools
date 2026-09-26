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
- 2026-09-26, kaitpw: targeting or selecting a subject revalidates it. Choosing a view on `/rooms` reads it at once, with no refresh press; the same holds for schedules and every route. Families is the one exemption, for performance. This refines the 2026-09-22 freshness ruling (re-read on focus only when the document is marked changed): a new target is a new reading, not a re-read under the hands. Where the two still disagree, this one wins and the 2026-09-22 line is re-openable.
- 2026-09-22, Every entity route declares its stages and no route file exceeds its line budget. `EntityRouteView.stages` is required (`route/schedules/stage.ts`, `families/stage.ts`, `family/stage.ts`); the route and stage chord nodes are one `KeysNode` fed by `manifestChords`/`stageChords`, `useScopeKeys` still the one door. `tests/repo-guards/src/line-budget.guard.test.ts` holds every top-level `apps/web/src/route/*.ts|tsx` to 600 lines. `route/situation.tsx` split into `situation-marks`, `situation-lamp`, `situation-ladder`, `situation-verbs`, `situation-grids`; `route/use-route.ts` into `route-owner`, `route-work`, `route-target`; importers name the file, no barrel.
- 2026-09-22: Shared action declarations own prose, and dirties names declared Reading resources. Ops uses browser-only facts from semantic-actions.ts because its selected operation determines target needs; it does not add an executable workflow. Every catalog operation has a renderer or an explicit rawByDesign decision.
- 2026-09-22, C4: ephemeral Work is registered in the store so host recreation cannot lose its cleanup obligation. WorkKey declares one binding; Save As carries a separate source hint. A connected session with no documents still closes Work, while a missing session does not prove document closure. Marks retain disconnect uncertainty only while their session remains in inventory.
- 2026-09-22, the last three route assumptions are ruled as built: the Reading is the cache shared by every pane that draws it (the host stamps taken-at and the change mark once); the schedule grid's read files a capture, so it is the `refresh` verb run by the pane, never a button; an action's reason shows on hover and focus, and the 2026-08-16 inline reason is retired. No `ASSUME(kai)` remains in `apps/web/src`.
- 2026-09-22, measured cells are one cell kind in `components/lang/cell-state.ts`, consumed by `/schedules`, `/family`, and `/families`; other cell kinds stay possible. A bare number stages with the column's display unit at once and never calls Revit. Text with a unit symbol shows as typed until commit, then one read-only host parse of that cell returns Revit's rendering, and the cell shows that. The parse is owned by Effect and cancelled by a re-read. Parse failure is a cell-local refusal with the reason; nothing is staged. The staged value is `{ value, unit }`; the typed text is not kept (one optional field later if missed).
- 2026-09-22, the display unit is whatever Revit shows for the Reading's own document: a schedule field's `FormatOptions`, else the document units for its spec; a family or families cell uses the units of the document the Reading came from (an open `.rfa` has its own project units; `/families` reads from the project and shows the project's).
- 2026-09-22, hotkeys resolve on a scope tree: route, then optional stage, then pane, then any nested region a pane declares. Focus decides the innermost live node and the innermost binding wins. A hidden pane's node is inactive while it stays mounted under React `Activity`. A repo guard refuses any hotkey registered outside a scope node. This replaces the fixed three tiers in `route/keys.tsx` (ops ledger 2026-09-15).
- 2026-09-22, stages are an optional layer: a route with none declares panes directly, a route with one draws no switcher. Only the person changes the stage; nothing derives a stage from Work state, and revealing a pane moves no focus.
- 2026-09-22, freshness is a per-document change mark, not a timer. The C# `BridgeDocumentNotifier` publishes the trailing edge of its 750 ms throttle, the host marks that document's Readings changed, and a surface draws "changed in Revit" with `r` to re-read. A pane re-reads on focus only when marked; the `OnFocus` policies `fresh`, `maxAgeS`, `as-is` and `STALE_S` are deleted. A focused surface is never re-read under the hands. A detached bridge is shown as disconnected, not as stale.
- 2026-09-22, addressless Work is ephemeral: an unsaved document owns Work keyed by its exact `{ session, openId }`, lost when that lifetime ends. The first staged item draws a lifetime line ("unsaved document; Work lives until it closes; save to keep it"); Save As migrates the Work to the new Address silently; after the close the route draws a dismissable receipt naming what was discarded. No confirm dialog, no title keying.

- 2026-09-19, Users manage only resources immediately relevant to their current situation or goal. Storage and execution mechanics must not require unrelated resource selection. Live draft plan/apply does not require choosing a Pod; capture, member editing and publishing expose the Pod because it is the resource being managed.
- 2026-09-19, Advance stages and signals through working user interactions while the existing batch closes. Code and user-surface checks establish the direction; reversible assumptions remain explicit until practical use resolves them.

- 2026-09-17, Normalize production routes onto the closed `Surface` -> `PaneSplit` -> `Pane` -> artifact grammar. `Surface` owns the viewport and 8px perimeter; `PaneSplit` owns recessed 8px gutters and resizing; `Pane` owns the 24px rail, focus/help outline and standard 8px body inset; an explicit `flush` mode lets edge-owning artifacts fill the pane. Delete competing layout owners and target a net-negative total diff, including guards.
- 2026-09-17, Run the normalization as one frozen foundation followed by disjoint Terra route waves and one serial Chrome-agent proof lane. Temporary layout regressions are allowed during the cutover, but the merged result must expose no relevant abnormality in deterministic, static, DOM, interaction or visual verification.
- 2026-09-17, The production cutover is closed. Delete both competing workspace composers (`PaneWorkspace` and anatomy `Workspace`); a repo guard now pins workspace slots to `Surface`, `PaneSplit`, `Pane` and `Rail`. Chrome DOM proof covered 17 routes at 1280px and 720px with one 8px `Surface` perimeter, 24px rails, no pane intersections or document-width overflow, and a solid focus halo above the gutter. Narrow proof also covered the tutorial's contained spatial scroll, the scroll-away head, a table, a trusted code block's owned horizontal scroll, and the composer's help card/tab. The shared help timer now survives React strict-effect cleanup, and its collapsed tab occupies the gutter instead of the composer sentence.

- 2026-09-16, Use the prototype A `tone=line` treatment: a thin focused-pane outline, stronger while keyboard help is open. The halo must paint above the gray gutter on every edge, including the right; gutter siblings must not cover it.

- 2026-09-16, Narrow tutorials retain the spatial pane map with horizontal scrolling; do not replace it with a stacked list.
- 2026-09-16, Preserve the scroll-away route head. The workspace fills the viewport after the head scrolls away; its initial bottom extending below the viewport is intentional.

- 2026-09-16, Chat's composer head shows actual turn state such as ready, running, waiting for the user, or failed. Threads, Trace and World remain view modes; Chat does not invent selectable workflow stages.

- 2026-09-16, Shared rails are 24px. Tables have one artifact header for title, search, modes and actions, with an optional deliberate filter row. The composer has its own halo and keyboard-help region rather than highlighting the whole transcript pane.

- 2026-09-16, Adopt unification lineup A: page-ground panes in the shared gutter root with the composer in flow. The user rejected overlay B and supplied a screenshot of table cells painting over its composer. Gutter and halo colors remain to be refined; shared rails are 24px.
- 2026-09-16, Large tool results may load their full content on expand, provided the original result remains available. Receipts cannot replace transcript results because many tool calls have no receipt; use the transcript's authoritative result source.

- 2026-09-16, Switching Chat threads retains each thread's unsent text and attachments without adding a separate persistence source. Evaluate React 19.2 Activity as the native retention boundary. Selecting an unloaded thread shows explicit loading for that thread inside a stable shell; the thread sidebar remains populated. Evaluate Suspense at pane/workspace boundaries as part of the shared design, not only a Chat repair.

- 2026-09-16, The unification review follows systemic causes across the repo; commits after `fb5643d6a15b9470273e55c3ad926850d99d6f99` are evidence, not scope limits. Prefer deeper shared fixes and less code over accumulating local repairs. Record all findings in the owning feature.
- 2026-09-16, Chat's Situation stays on the composer because targeting context must remain beside approvals and proposals. Its default head stays one header high; the thread sidebar must project the same route-owned selection exposed in the sentence.
- 2026-09-16, Pane separation uses a shared gutter including the viewport perimeter, with room for the focus/help halo and resize handle. The suggested 8px gutter and 6px halo are provisional visual tuning values. Intermediate route breakage is allowed while restoring consistent height and responsive layout contracts.
- 2026-09-16, Two concurrent Fable 5.1 low partners lead surface and runtime design. Both may delegate through Herdr to Opus/Sol low and Terra high swarms, never to more Fables. The runtime review measures Chrome CSS/layout/paint/render costs alongside transport and lifecycle. Meaningful design ambiguity returns to the user. See `UNIFICATION.md` for the active review brief.

- 2026-09-16, `--gutter` and `--rail-h` own shared surface spacing. Pane owns the selected line treatment and its stronger help state.
- 2026-09-16, `Rail` is the one head band. `ArtifactFrame` owns its rail through `head` and `headTrail` slots.
- 2026-09-16, active `Pane` focus uses an outline in the gutter.
- 2026-09-16, `Pane` has a `flank` kind for a collapsed regional title and retained shortcuts.
- 2026-09-16, `Pane` owns suspension and render failure recovery. A changing child target passes `boundaryKey`.
- 2026-09-16, `Surface` owns perimeter spacing and the optional scroll-away head; PaneSplit and PaneWorkspace own interior composition. Remove generic Surface grid tracks and SurfaceCell wrappers.
- 2026-09-16, `MasterTable` owns one rail and an optional filter row.
- 2026-09-16, `Pane` renders its rail by default. `headerless` is the intentional opt-out, and `ArtifactFrame.foot` uses the rail top edge.
- 2026-09-16, A `mermaid` fence renders as a diagram inside `Code`, with a source and render toggle in the head. The renderer is `beautiful-mermaid`, because it takes `var(--pe-*)` colors and needs no live DOM; official `mermaid` needs a live DOM, rejects `var()` colors, and leaks an element on each failed render. The fence renders once it closes and shows its source while open. `gantt`, `pie`, and `mindmap` stay as source. A closed fence that fails to parse renders collapsed to its head band with `invalid diagram` and a `show source` toggle, because invalid mermaid is hard to read as text (kaitpw). D2 (5.85 MB wasm), PlantUML, and Structurizr (JVM) are rejected (`.artifacts/handoffs/render-blocks-20260916/diagram.md`).
- 2026-09-15, A code block is a machine-operated object and wears the artifact frame. `Code` (`components/lang/code.tsx`) is the one read-only highlighted block for every language and every site: chat fenced blocks, tool call in/out, trace lane, atom inspector, receipts, ops output. Its head band holds the language on the left and copy, line count, and "show all" on the right. `Code` owns the height clamp; the container owns show/hide. Consumers: `workbench/aui.tsx`, `workbench/lens/context-strip.tsx`, `actions/receipt.tsx`, `ops/operation-pane.tsx`, `route/inspector.tsx`, `state/owner-inspector.tsx`.
- 2026-09-15, `JsonEditor` is the one editable JSON surface, controlled `value`/`onChange`, paint under a transparent textarea in a shared grid cell (kaitpw: "yes agree" to the tanstack worktree). Read-only paint and editing stay two exports of one module, never one component with an editable flag, because a textarea owns caret, selection, and undo and paint is a pure function of a string.
- 2026-09-15, `@tanstack/highlight` is the only highlighter. C# gets a `defineLanguage` grammar because Pods are C# scripts. `Code` stops tokenizing above 64 KB and shows the first slice with one "show all" press; the systemic fix for large tool outputs is Owed below.
- 2026-09-15, One `stringify` beside `Code`; `Code` takes a string so the byte count is visible to the caller.
- 2026-09-15, One word says whether Revit can answer. The host lamp reads `Revit attached` or `Revit not attached`, and `/instances` marks a world `not attached` when the SDK census sees the process but no host session holds it. The SDK bridge proves only that the payload loaded; scripts and operations need the host bridge, so no surface reports ready or connected on SDK evidence alone. Consumers: `route/shell.tsx` lamp, `instances/route.tsx` phase column.
- 2026-09-15, RP merge acceptance tests the fundamental ownership and control contracts, not complete products. Chat, Takeoffs' front half, and Family's structural integration are representative callers. Downstream Takeoffs sync/export, the rewritten Family engine's full behavior, tutorial polish, and low-priority route completion are not merge gates unless they expose an RP invariant defect.
- 2026-09-15, The head is the user's anchor on RP truth: a pure projection of authoritative route state. No shims, fabricated status/counts/readiness, mock/demo state, or ad hoc semantic adapters in the head; moving fabrication into a helper does not satisfy this rule. Formatting and private widget interaction mechanics remain presentation concerns.
- 2026-09-15, No superseded primitive system may remain at merge: alternate state owners, targeting grammars, mutation doors, compatibility APIs and their supporting exports must be removed. Low-priority product work may remain unfinished, but cannot retain a competing primitive. Preserve unresolved operation evidence; do not erase data or invent success to make legacy removal appear complete.
- 2026-09-15, The evidence rule applies to current operation receipts, which retain original request identity and unknown outcomes. The user expressly authorized discarding 66 old RP rows without archive for this greenfield cutover; no legacy migration, census or forensic read surface remains.
- 2026-09-15, RPs compose Target, Work, Reading, Action, Page and View through a small declaration, a dedicated controller and rendering views. Classify by meaning and lifetime. The controller owns dependent transitions; choosing a document must not require components to sequence cleanup calls. Shared interaction state belongs to its Page owner; private widget mechanics need not become authored Work.
- 2026-09-15, Shared semantic facts feed human controls, hotkeys and Pea; do not independently declare policy, requirements or outcomes for each projection. Presentation may add labels, grouping and scoped counts; execution revalidates authoritative inputs. The current implementation must be audited against this rule, not assumed to meet it.
- 2026-09-15, SDK owns process/session/document identity, custody and native lifecycle receipts; Pe.Tools owns semantic actions spanning native/file steps; the browser projects those owners. Matching SDK pins alone does not prove the consumer has removed old lifecycle authority.
- 2026-09-15, Each target ladder is one input, with the full path available inside its picker. The lamp reports diagnostics rather than owning targeting. Chat remains usable without Revit; requirements gate individual actions. The same RP motif composes at the route head and around the Chat composer.
- 2026-09-15, Seeds are frozen route moments supplied outside the head through the same legitimate state contracts and owners. No interactive scenario framework or total per-action seed map is required for merge. Seed renders cannot stand in for live mutation proof.
- 2026-09-15, RP acceptance uses real buttons for the relevant behavior and durable receipts for claimed native mutations. Track production and tests/fixtures separately, ownership and public-entity topology, and exact retired/remaining primitive paths; LOC and hook counts alone do not establish simplicity or correctness. Preserve concurrent Fable work in attribution.
- 2026-09-15, Prepare about seven conceptual commits from the reviewed, main-reconciled tree, keeping Family and Takeoffs engines distinct from RP ownership/UI. Discard intermediate shapes, reversals and one-file repair history; combine dependent groups rather than introduce temporary shims. The user runs Fable's pre-merge review after squash alignment and Sol review; no merge verdict is implied by this decision.

- 2026-09-13, the route head is the **Situation**: one component that says what I touch, where I am, what is staged and what I can do next. Grilled and mocked in four prototype rounds (git history holds them); `route/situation.tsx` is the component.
- 2026-09-13, the Situation sentence carries the **stage as its first word** and the target slots as operable words with prose joiners the route declares ("Auditing rooms in 2 views across 3 zones"). No verb phrase like "Take off from"; it is noise. Stage, staged work and verbs are not sentence clauses: at three clauses the sentence is too long and holds the wrong responsibility.
- 2026-09-13, a **ladder collapses to its terminal** in the sentence ("2 views", never "Sample House / 2 views"). The full path is the breadcrumb inside that slot's picker. One picker per ladder.
- 2026-09-13, every target slot wears an **io mark** superscript, `r`, `w` or `rw`, so read-versus-write is a first-glance fact. Literal letters win over words and glyphs for compactness.
- 2026-09-13, the **chain lamp** replaces the host lamp: one instrument reading host › session › document, deepest healthy segment lit, first broken segment in the caution hue with its reason ("project-a · needs init"). It reads the Revit chain only; filesystem ladders (Settings) never enter it. Exception routes (`/`, `/chat`, docs) show title plus chain lamp and no Situation.
- 2026-09-13, verbs live in one **verb row** under the sentence: compact by default with the page-state count in the button ("Partition 10", "Commit 4"), expandable to a **stack** with one verb per line and its reason or page state at right. The stack is how an unhealthy document explains itself ("Initialize · writes 4 shared parameters"; "Refresh · project-a needs initialization first") without leaving the route.
- 2026-09-13, verbs are declared and run in one place; an inline button elsewhere on the page (a plan floater) is the same verb with a narrower **scope** and its scoped count. Body layout must never gate a user from a verb; the Situation row always can run it.
- 2026-09-13, a refusal, a busy state and a done receipt are one **flag** primitive: a popover that grows out of the thing pressed and shifts nothing. Refused persists until the next press or Esc; busy lives while running with a stop; done fades. A failing target slot grows the same popover with its recovery inside. No toasts, no status line.
- 2026-09-13, staged Work is a **band** under the verb row whose frame the Situation owns (count and noun, work revision, read freshness, commit, discard, revision conflict with reload) and whose body the route fills. The Commit button's flag summarizes the same Work for a handful of edits; beyond that it opens the band. Right-margin placement is dead: it cannot inline into Chat.
- 2026-09-13, silence means fine. At rest the Situation shows the sentence and the verb row only. "more" unfolds the sentence into a ledger of the same slots plus session, path and read freshness.
- 2026-09-13, one **page log** at the bottom of every route holds every route event (target, stage, verb, refusal, work) and opens receipts from a row. It replaces per-widget activity disclosures; Chat's composer "more" links to it.
- 2026-09-13, Chat has no route head. Its **composer head** is the whole Situation: "Pea on project-a" with the document's health, a document-only target, Send as the one verb with the same flag. Pea proposals render as the Work band at the composer, not in the stream, so the replay story has one location.
- 2026-09-13, marks: dotted underline is an operable word, dashed is an empty slot, the one caution hue means the world disagrees, bold is unsaved, mono is machine-measured.
- 2026-09-13, `/instances` stays as a plain launch-and-control route. A document that needs initialization never redirects there; the Situation stays and the verb stack carries the recovery.
- 2026-09-14, the **Picker** is rebuilt from the 2026-09-08 targeting kit on plain levels (`route/picker.tsx`: `PickLevel {key,label,placeholder,options,note,multi,picked,pick}`): one popover per ladder, breadcrumb of levels, search only past six options, ☑/☐ for multi, empty states name the reason ("read the document first"). The old kit's typed target model is not brought back because a level is just options and a pick.
- 2026-09-14, the document ladder reads `useInventory()` (bridge sessions) for its words: the session level shows the `pe-revit` id (`sdkSessionId`), the document level shows the title; the host session id and openId stay in `?target=` and never in the sentence.
- 2026-09-14, the Situation sets type on the kit ladder only: sentence `t-title` with bold operable words, ledger and details `t-prose`, popups `rounded-lg ring-1 ring-line` on `data-surface="artifact"`. No call-site pixel sizes.
- 2026-09-14, the **Work band** is a `work` prop on `Situation` (`{count, noun, read, discard, body}`): the Situation draws count and noun, revision (`rN` or `unwritten`), read freshness, discard, the commit verb, and the conflict state with `reload`; the route passes only its body. The commit verb's flag grows from the verb row, never from the band, so one verb has one flag. Takeoffs' own band is deleted.
- 2026-09-14, a busy flag carries **stop**. `/call` has no cancel lane, so stop cancels the wait, marks the outcome `stopped`, logs "the host may still finish", and the real result lands later as its own `late · …` log row. Proven on Takeoffs `refresh`: stopped at 0.5 s, `late · ran` five seconds later.
- 2026-09-14, the root "Changed elsewhere" banner is retired in favor of the band's conflict state with reload (`handle.work.reload` clears the conflict and dirties the work reading). Owed until `routes/__root.tsx` is edited.
- 2026-09-14, Family and Families wear the Situation. Family's stage (`author` "Authoring", `evidence` "Reconciling") and Families' stage (`scope` "Scoping", `review` "Reviewing") are page state the stage Picker drives; store memory holds no stage word. `build` is an author verb; `capture`, `plan`, `apply` are evidence verbs; Families' `plan` is every-stage and `apply` is review-only.
- 2026-09-14, a verb's input comes from `Ctx`, never from a store wrapper: Family's `plan`/`build` read `page.file`, `apply` reads the live plan from the `family` Reading. A verb the Door ran with `{}` was a verb no one could run from the head.
- 2026-09-14, pure projections a manifest needs (`projectReadings`, `latestPlanOf`, `applyRefusalOf`) live in the manifest; the store imports them. A store that owns the projection a `ready` needs forces a cycle or a copy.
- 2026-09-14, the file ladder is a filesystem ladder: it is a slot in the sentence (a Picker over what the family host lists), never in the chain lamp, and a parse error marks the slot caution and the ledger, not `health`.
- 2026-09-14, Chat's composer head is built from the Situation's exported parts (`ChainLamp`, `Picker`, `Verb`, `useDocumentLadder`) in `chat/composer-head.tsx`, not from `Situation` itself: Chat has no stage word, no `?target` binding and one verb. The document ladder takes a `binding` (bound ref + bind) so a route whose target lives outside `?target` (the thread head) reads and writes its own.
- 2026-09-14, Chat's Send is the manifest verb run through the route owner from both the head button and Enter; the verb's rest refusal is "Session is not ready" or "Pea is working", and the prompt is checked on the press because the composer draft, not the route page, is its input. The provider's `sendPrompt` is the run body (it re-reads a pending thread); its swallowed errors are owed to the page log.
- 2026-09-14, Pea proposals render as the band under the composer verb row with the same allow/refuse ActionButtons and `resolveApproval`; the stream keeps only the `ask_user` question. In-stream approval buttons are dead.
- 2026-09-14, `route/working-head.tsx`, `chat/scope-line.tsx`, `chat/world-badge.tsx` and `chat/activity.ts` are deleted; the composer's own Send/Stop buttons are dead.

- 2026-09-13: One shared working-context component must join target ladders, staged work, stages, actions and expandable observations/outcomes on route heads and inline Chat. The old targeting kit is a starting point; separate noun widgets and a reduced Chat-only target line miss the intent. Human engineering context leads; the route body keeps its authored meaning.

- 2026-09-13: Work in priority order Chat, Takeoffs, then Family/Families. After launch and ownership foundations, explore the shared route head on real data while bounded backend repairs run in parallel. Preserve authored route scenarios before changing representation. Acceptance requires real UI controls through the backend; seeded/query-injected state and direct backend commands do not count.
- 2026-09-12, user prioritizes repeatable Chrome Agent browser journeys through actual routes and backend over accumulating unit suites. Keep only meaningful ownership/recovery checks for merge; synthetic seeds and a mounted composer do not establish a working native or provider chain.
- 2026-09-12, route cutover acceptance requires the real workspace and its head to share one RouteHandle; Page defaults come from the declared schema. Takeoffs now supplies its handle to all shell variants. Deterministic evidence: `src/route/shell.test.tsx` and `src/takeoff/ownership.test.tsx` under apps/web. This proves Page/action ownership only, not native actions or a complete route cutover.

- 2026-09-08: Begin integration before Family's engine review finishes. Takeoffs input is private snapshot `9f4d03a` from `d9fb18b` plus its 40 completed dirty/untracked feature files; its branch, index and files are untouched. Exclude the stray `0` file. Reconcile this snapshot against the later official merge. User interjections steer ongoing work unless they explicitly stop or replace it.
- 2026-09-08: Bridge v21 publishes tracked open documents, including inactive/cloud/unsaved documents. Open IDs use the SDK tracker's per-document state bag. One fresh controlled R2026 test proves wrapper lookup, SaveAs continuity, and close/reopen invalidation. Capture document state on the event thread and publish it before invalidation to prevent consumers refetching the old inventory. Host deterministic tests pass 19/19 and wire tests 13/13. Operation dispatch remains active-document-only until its execution guard is replaced.

- 2026-09-08: Build route targeting on `codex/route-primitive` from `8c7ddfc` while Takeoffs and Family finish their feature branches. Integrate their merged main once before consumer cutover. Main remains available for release preparation. The accepted model and operator decisions are in `route-primitive-fable.html` sections 1–4 (the markdown spec was folded into it on 2026-09-10).
- 2026-09-08: The route foundation uses an exact call target and a session-keyed inventory. Address comparison belongs beside `Address` and treats GUID case and Windows path case/separators consistently. Purge review removed the unused read wrapper; use Effect's existing timeout and cancellation at the first real consumer. Contracts tests 28/28, existing web target/scope/store tests 15/15, contracts package checks pass. These are deterministic proofs, not a Takeoffs product fix.

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
- 2026-08-31 — REVIEW IS DELETED from the trichotomy (ruled kaitpw: "staged + attention doesn't
  seem load bearing… I don't really want pea to be able to flag staged"). The cell is two fields,
  `proposal | staged`. Staging IS the human's approval; validation is DERIVED from the value,
  never stored; pea's disagreement channels are chat or the COUNTER-PROPOSAL — proposal and
  staged both standing with different values draws pea's fold alone (`data-contest`, no body
  wash) and says `pea proposes X` in the facts. The commit/save attention gates, the
  low-confidence refine, pea's `review` mask path, and `CellReview` are all gone; old persisted
  docs parse unchanged (zod strips the dead key).
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
- 2026-08-31 — SCROLLBAR LAW, AMENDED after measurement: `scrollbar-width` does NOT inherit, so
  the one declaration at `[data-pe]` styled the root and every inner scroller computed `auto`. It
  lives at `:where([data-pe], [data-pe] *)` — one declaration still, zero specificity so
  `no-scrollbar` wins. `scrollbar-color` inherits and rides along.
- 2026-08-31 — A ROW'S RULE COSTS NO HEIGHT. A border on a `td` adds to the row box, so a 20px row
  with a 1px bottom border measures 21px — the density verdict cannot hold while the separator is a
  border. `hairline-b-inset` (`design-lang.css`) draws it as an absolutely-positioned `::after`
  inside the cell: costs no height, travels with a sticky cell, and composes under a focus ring
  (a `box-shadow` would have been replaced by Tailwind's ring). `.dl-cell[data-scale="row"]` drops
  its `calc(var(--item-h) - 1px)` fudge — a row-scale cell is the whole `--item-h`. Measured:
  `/takeoffs` 173/173 rows at 20px, `/family` 13/13.
- 2026-08-31 — TWO CELL INSETS, both named: `--item-pad-x` (2px) is the cell edge, and
  `--item-mark-pad-x` (10px) is for a cell whose BODY carries a mark — pea's fold, the unsaved
  square — which needs room for it. `locked` draws no mark and takes the plain edge. The census
  found five values in the wild (2, 4, 6, 10, 0); it reads 2px + the three marked cells now.
- 2026-08-31 — A PANE HEADER IS CHROME: a verb's reason renders as `title` there, never as inline
  prose. The un-gagged commit verb (2026-08-16) keeps its visible refusal in ceremony strips, where
  settled law gives it room; a 32px header has none — measured, `/family`'s action row was 48px
  inside a 32px header with two 36ch paragraphs overlapping the verbs. Implemented as the
  `VerbChrome` context that `Pane` provides around its actions, not at call sites. Re-openable: a
  header that wants the visible refusal back needs a taller header first, which is a ruling.
- 2026-08-31 — TWO HEIGHTS, no third yet (round-1 reshape, from the verdict "standardize a general
  list-item height... two, three max"): `--item-h` (20px) sizes every list-shaped row — table row,
  select/combobox/command menu item, pick-list item, `Verb` — and `--control-h` (24px) sizes every
  freestanding control (input, select trigger, combobox chip holder). Both live in `base.css`
  beside `--space-unit`. A surface that needs a third height names it here before authoring one.

- 2026-09-01 — Re-cutover grill verdicts (kaitpw). (1) Takeoffs opens the cutover, amending the
  2026-08-31 seam order; chat follows. Pea-takeoffs integration lands within two sessions and is
  the real test of the state model. (2) Fixture lane spells `?source=fixture`, resolved by the S2a
  lane resolver, deliberately unadvertised in UI ("obscured unless u know"). (3)
  `StateCellProps.placeholder` ships with `onLocate`; `ProposedCell` dies — same precedent as the
  rejected `<Text>` wrapper. (4) `chat-appearance` is ruled a `lang/` primitive and improved
  systemically, not folded into `chat/`.
- 2026-09-01 — CellSelect adopts `Combobox`; the native `<select>` popup exception is REJECTED
  (kaitpw). Perf gate: the popup stays unmounted when closed (base-ui default) and a cell mounts
  the Combobox machinery on edit, not one root per resting cell; row heights on `/takeoffs` are
  re-measured after adoption.
- 2026-09-01 — The four candidate laws from goal `design-normalization-2` are ADOPTED, each at a
  code home rather than `lens.house` prose (the skill holds only what code cannot): every product
  route reachable from the front door (candidate guard: route census vs the front door's TOOLS
  list); a human invokes every crossing into the live model (already the trichotomy — staging IS
  the approval); a rejected cell commit restores the prior value and states the reason beside the
  cell (StateCell contract, proven at the takeoffs cutover); a route owns its world and host calls
  (the S2a shell's lane/binding resolvers).

- 2026-09-01 — Front-door lamp lineup verdict (kaitpw): **L3 instrument cluster wins** ("instrument
  cluster for header is best"). The demoted `t-label t-upper` wordmark is REJECTED — the title
  "should be bigger", and the same complaint covers `/takeoffs`' route label. Direction: the
  display face the user likes on the h1 (`face-display`, Spectral) at a smaller tier — `t-head`
  24px, which nothing wears yet. Canon rewrite of L3 WAITS on the route-title demiurge (title may
  move into the targeting kit with the targeting flow expanding below when a manifest exists);
  the lineup stays mounted until then. Canon fixes already landed: wordmark tier, UpdateButton
  `commit → act`, ThemeToggle nowrap, front-door page frame `px-6` inset.
- 2026-09-01 — Type-tier lineup round 1 verdict (kaitpw, on the live `/takeoffs` fixture): **D is
  KILLED** ("too loose" — the roomier caption leading fights density). A and B retire — "honestly
  can't tell much of a difference", which is itself the round's finding (the tier words do no
  visible work). **C advances** ("does feel less busy which is nice") with one amendment owed
  before adoption: C's mono text is "all a bit too dim" — the caption bundle's `ink-mute` must
  brighten (candidate: `ink-2`) in round 2. Not yet canon; the throwaway lineup stays mounted.

- 2026-09-01 — Route-title demiurge: **S2 ADOPTED pending spike** (kaitpw: "yes s2 is what i
  imagined"). `RouteHead` lives in the targeting kit: the route name at `t-head face-display`
  (paying the owed "route heads have no head" line), with the targeting sentence/flow expanding
  below when a manifest exists and the name standing alone when none does; `aside` carries chrome
  like the front-door instrument cluster. Front door and product routes share the primitive. The
  header lamp reads targeting's world facts (`targeting/world.ts` already consumes `host/fleet`),
  retiring the lamp's private 5s `usePeInfo` poll. S1 (bigger label) and S4 (no titles) killed;
  S3 (name inside `Product`) killed for taxing manifest-less routes. Spike consumers: `/takeoffs`
  and `/`. The S2a shell mounts RouteHead when it lands.

- 2026-09-01 — RouteHead spike PROVEN (report `.agent-reports/route-head-spike.md`; browser lane,
  both consumers, light+dark). S2 landed cheaper than costed: `TargetingHead` hands itself to
  `RouteHead` (`nameless` stops the recursion), so every sentence/flow consumer became an S2 route
  head with zero call-site edits. Front door is canon: `RouteHead "Positive Energy"` + L3 cluster
  aside; L1/L2 and the switcher deleted. Post-spike fixes (orchestrator, browser-verified):
  `Product.name` is a proper noun — "Takeoffs"/"Instances" corrected; the manifest-case name
  gutter is `pt-2` (ascender clip measured gone at 1440×699; rows still 50/50 at 20px). Owed from
  the spike: re-read remaining `Product.name`s at their features; `/settings`, `/family`, `/ops`,
  `/instances` heads converted but unrendered; TWO `aside` slots at two altitudes share one name
  (rename `TargetingHead.aside` — candidate `fact` — before S2a adopts); chat's `mode="line"`
  small label is the same datum drawn two ways, rule it; the lamp's private 5s poll still owed its
  collapse into targeting world facts.

- 2026-09-01 — **C2 ADOPTED** (kaitpw: "yes adopt c"): composite roles are the sub-prose tier
  model. `t-label` = upper + tracked + medium + ink-2; `t-caption` = mono + ink-mute→**ink-2
  floor** + tabular; `t-value` = plain ink; one word dresses the whole look and the bundle beats
  call-site fragments. Mono floor: no mono text below `ink-2` unless genuinely absent/disabled.
  Canonization rewrites the bundles into the tier owners (`base.css` + `design-lang.css`), fixes
  the call sites C makes visibly wrong, and deletes the throwaway lineup.
- 2026-09-01 — The instrument cluster (host lamp · release · theme) is ROUTEHEAD CHROME, not
  front-door chrome (kaitpw: "I also wanted the instrument cluster there too"). `RouteHead`
  renders it on the name line on every route; `aside` remains for extra route chrome. This
  raises the priority of collapsing the lamp's private poll into targeting's world facts.

- 2026-09-01 — C2 CANONIZED (report `.agent-reports/type-canon.md`; browser + deterministic
  lanes). The three sub-prose tiers are composite bundles in both owners; the bundle beats
  call-site fragments by sitting outside `@layer`; the ink floor carries a `:not()` escape for
  meaning hues and `t-value` declares NO color (alarm spans 55 → 55, guarded). The four
  section-head spellings collapse onto `t-label` alone; `t-upper` is retired on sub-prose tiers
  (still legal on `t-value`+). Signatures: takeoffs 47 → 42, swatch 32 → 26. Throwaway lineup
  deleted. Un-migrated breakage censused by grep, not seen: `/families`, `/family`,
  `schema-to-field-render`, rest of `/design-system` (falls to their cutovers). The `.R10` 20px
  leading anomaly is still untraced. TWO OPEN VERDICTS from the round: (1) mono rose 766 → 799
  spans — every caption is now mono by bundle, and mono was already the majority face, straining
  the "mono is the marked case" law; (2) the stage strip lost its ink-dim "verbs ready" signal to
  the mono floor — if that read matters, the replacement is a mark, not a dimmer ink.
- 2026-09-01 — Cluster falsification, owed to the S2a shell: a document-gated route (`/instances`,
  and likely `/family`, takeoffs live lane) renders its refusal ABOVE `TargetingHead`, so
  `RouteHead` and the host lamp never mount — absent exactly when "is the host alive" is the
  question. Either the gate moves below the head or the shell mounts `RouteHead` above the gate.

- 2026-09-01 — TWO-AXIS TYPE (grill verdict kaitpw, SUPERSEDES the C2 ADOPTED and C2 CANONIZED
  lines above; evidence `.artifacts/handoffs/2026-09-01-critic-design.md`): the three 10px
  sub-prose tiers were never size tiers — they collapse to one size word `t-small`, with
  `face-mono` (machine measured) and `t-upper` (section head) as OPT-IN marks. Mono returns to
  the marked case (95 `t-caption`+`face-mono` pairs were redundant; 799 mono spans marked
  nothing). The ink floor moves into the tone layer so a claim about meaning always outranks a
  tier; the `:not()` escape at `base.css` is deleted — it listed five `text-*` classes with zero
  real uses and lost to every `data-tone` site (`(0,3,0)` beats `:where()`'s zero), silencing
  the targeting head's unbound caution and `FactChip.tone` entirely.
- 2026-09-01 — TONE AND GROUND CANON (grill verdict kaitpw): `data-tone`/`data-surface` are the
  ONE meaning vocabulary. The `text-alarm|caution|done|pea|commit` tone utilities and the four
  `bg-page|artifact|recess|select` ground colors leave `@theme` (`design-lang.css`); a ground is
  legal only where it rebinds `--pe-on`, so a wash never mixes against the wrong plane.
- 2026-09-01 — DECLARED-ONCE GUARD (grill verdict kaitpw): `design-guard` asserts no class is
  declared in two of `base.css`, `design-lang.css`, `lang.css`. The 16 restatements, the `veil`
  hover contradiction (utility made it an always-on wash), the diverged `t-title`/`t-head`/
  `t-display` bundles, and the dead `squiggle-*`/`ghost-drift`/`page-wrap` classes fall to it.
- 2026-09-01 — `chat-appearance.ts` is DELETED (grill verdict kaitpw, SUPERSEDES the 2026-09-01
  "ruled a `lang/` primitive" line): 73 numbered positional slots, 72 with exactly one consumer,
  `threadPalette4` already missing — a className bag, not a primitive. Class strings return to
  their JSX; the ~4 genuine roles (thread row active/quiet, doc sub active/quiet, `emptyMark`)
  are promoted to named homes.
- 2026-09-01 — OPACITY RULED (verdict kaitpw, option 1a): opacity is legal only as the 0<->100
  visibility pair of a transition on floating chrome (pane halo `lang/pane.tsx:167`, shortcut
  card `:224-225`); any value between is de-emphasis and stays counted. The `opacityDim` regex at
  `design-adherence.test.ts:93` now skips `opacity-0`/`opacity-100`; the baseline is re-stamped
  at the new count. Refines the 2026-08-29 "not a de-emphasis mechanism" line, does not replace it.

### Route and state architecture (cross-route, owned here)

- 2026-09-09 — Confirmed finish scope after the pause: fully cut over every retained route to the shared targeting, authored Work, readings, per-view state and operation contracts now. Concentrate complete product-workflow acceptance on Chat and Takeoffs; do not redesign every product.
- 2026-09-09 — Chat acceptance must demonstrate a real turn using default document A, explicit per-call document B, then default A again without changing the default; retain the agreed temporary-document ownership, route-pane and navigation/recovery requirements.
- 2026-09-09 — Takeoffs acceptance covers chosen-document opening, zone adoption, partition execution and honest loading/fresh/stale/error/recovery behavior. Native RHVAC sync closure is excluded from this goal; existing actions still follow shared contracts, and demos do not require real RHVAC files.
- 2026-09-09 — Schedule Grid gets one complete cell edit → reviewed change → native apply → actual readback workflow. Record encountered Revit-side engine bugs and stop pursuing those engine fixes in this goal; preserve staged edits and expose the failure. Richer proposal generation remains later product work.
- 2026-09-09 — Include a compact TargetingHead activity summary with expandable detail, retaining local failure and empty-state explanations; derive it from existing reading/operation owners rather than add a log owner. Include a readonly highlighted raw-file view where file ownership already exists. Defer a new Settings mode and Families plan-derived proposed-change UX.

- 2026-09-09 — Scope reset: the user paused route-unification implementation for grill/demiurge. Chat and Takeoffs are the immediate product priorities. Finish the shared foundation without treating every route's product refinement as part of this goal; the exact remaining acceptance scope is still undecided.
- 2026-09-09 — User priority ranking, highest first: invested UX/UI effort — Takeoffs, Chat, Family, Families; usefulness to MEP Revit users — Schedule Grid, Chat, Families, then Param Tables and Parameter Links; usefulness to BIM managers — Instances, Families, Chat, with scripting and Family Foundry also important.
- 2026-09-09 — Foundational utilities are Settings, Chat and Ops, plus the chat-plugin/route-state system. These priority rankings describe value and investment, not proven stability; the user reports that the routes have not yet been reliably stable.
- 2026-09-09 — Family Types is a retired product direction absorbed by Family. Surviving command handlers or chat reviewers are retirement candidates, not authority to revive or migrate a separate Family Types product.

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
- 2026-09-15, Work writes use expected revisions. External effects and recovery belong to semantic actions and their ActionJournal receipts; Work envelopes must not retain a second external-operation protocol. Add optimistic rendering only when measured latency demands it.
- 2026-08-26 — The route-document machine owns no product meaning: `agent-contracts/route-doc.ts`
  exports pure `applyPatches`, `guardCommand`, `commitDoc`; `RouteWorkspace` is only their shell.
- 2026-08-27 — `RouteStateWriteResult` is a discriminated union on `ok`. Store producers that
  refuse produce `kind: "refused"`, never a bare `Error`.
- 2026-08-28 — Three control kinds, no fourth: `Verb` is a world action with a tone and a required
  `reason`; `Press` is surface machinery and mints no tone; furniture may not claim an affordance
  it does not have. Export/PDF/SVG verbs are `act` — `commit` stays the one filled blue.
- 2026-08-28 — A user-placed review flag is `caution`. `alarm` is reserved for the model disagreeing.

- 2026-09-01 — EXECUTION-SCOPE LAW (grill verdict kaitpw; evidence
  `.artifacts/handoffs/2026-09-01-critic-{chat,contracts}.md`, both critics independently):
  every Revit execution carries an exact document contract. The persisted binding is the
  restart-stable SDK selector; it resolves to a live session id AT COMMAND TIME, and
  `HostRpcCaller` always receives a target — an untargeted caller is a defect
  (`takeoffs-commands.ts` built one; the takeoffs store's `setBindings` never wrote `world`).
  A route binds ONE document. Chat is task-scoped and may touch MANY documents across a task;
  every touch is transparent and traceable in the transcript.
- 2026-09-01 — Transcript tool cards are AUDIT RECORDS (grill verdict kaitpw): a card retains
  the event/receipt its turn observed. Overlaying the current live `route.slice` onto an old
  card (today's `tool-names.tsx` behavior via `sessionState={{}}` at `aui.tsx`) is a defect —
  a receipt that changes after the fact is not a receipt. Falls to the chat reducer demiurge.
- 2026-09-01 — APPROVAL SETTLEMENT is server-only (grill verdict kaitpw): the patched Mastra
  settlement (`@mastra__core` `respondToToolApproval` wasArmed hunk) is the one authority; the
  client never clears the gate itself — it renders in-flight until `display_state_changed`.
- 2026-09-03 — CHAT PRIMITIVE (2026-09-01) is SUPERSEDED (verdict kaitpw): it named a mechanism
  (`{threadId, epoch, sequence}`, one reducer) and that mechanism was built and deleted in two
  days. The chat transport verdicts live in `docs/features/agent/LEDGER.md` (CHAT TRANSPORT S1).
- 2026-09-01 — ONE ROUTE SPEC (grill verdict kaitpw: "this was the biggest thing I wanted to
  demiurge"): a `CollaborativeRouteSpec` from which UI verbs, Pea commands, the server route
  registry, and the chat-plugin registry all DERIVE; one provider owns world resolution, doc
  atoms, picker state, and head rendering. Targeting rides every route — tool-like routes mount
  the manifest, docs-like routes (`/`, `/design-system`) are name-plus-cluster only. Lands
  AFTER the execution-scope law so command scoping is in the spec from day one.
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
- 2026-09-01 — Tutorial-overlay protoui round 1 (worktree `protoui-tutorial-panes`, commit
  `a63b221`): variant **A (chart)** ADOPTED as the base — a measured minimap of the live
  `[data-slot="pane"]` rects with leader lines to hotkey cards. Variants B (in-situ), C
  (timetable), D (live) KILLED; C's verbs-with-refusals section and D's route-as-sentence
  section survive as chimera parts of A (round 2). The overlay's two data authorities: the
  rendered DOM for geometry, the `Product` manifest (`targeting/model.ts`) for generated
  instructions — pane `draws`, slot `needs`, live `runner.canRun` refusals. (Carried from the
  worktree ledger at merge; the worktree copy is retired with the worktree.)
- 2026-09-01 — Tutorial round-2 projection: INK ADOPTED, rails and badges KILLED (demiurge
  verdict kaitpw: "yes ink", ruled on state shape): ink is the only projection that gives the
  chart base's `hot` emphasis state its writer; `ChartArea` consumes `hot` under every
  projection, so rails would leave a dangling producer. Rails' epitaph: a static duplicate of
  on-demand emphasis; adds geometry, answers no state question.
- 2026-09-01 — `activePaneAtom` is NEVER (demiurge verdict kaitpw: "do it never as long as ts
  hotkeys still scopes and focuses properly. occam"): pane focus scoping belongs to
  `@tanstack/react-hotkeys` DOM targets alone (the 2026-08-31 keyboard law's one door). The
  spike's `activePaneAtom`, `AtlasPageState.activePane`, and `Pane.onActivate` do not port —
  the atom had a producer and no consumer. Re-open only if a surface needs to READ focus and
  DOM targeting cannot answer it.

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

- 2026-09-09 — Route refinement keeps exact Target, shared authored Work, and per-view page memory; the host owns Operation lifetime separately. Work may reference operations, but operation status must not advance its authored revision. First cutover proofs are Takeoffs partition recovery across remounts and Pea's explicit per-call document detour without changing the frozen turn default.
- 2026-09-10 — Route primitive vocabulary is six nouns: Target, Work, Reading, Action, Page, View. Scope, Document, World, Verb, Feed, Lane, Link, Slot, Bound, Multi, Stage, Store, Resource, fixture are dead words; `route-primitive-fable.html` section 1 is the spec until the code is. Why: the branch built the round-4 target contract beside the round-1 nouns, and a route author had 27 concept groups to learn.
- 2026-09-10 — The empty manifest is valid: a route with only `key` and `name` renders its name and the host lamp. Outlier routes (runs, grilles, data-tables, param-tables, design-system, doc-lab, protos) stay as standard routes on that manifest; none is deleted.
- 2026-09-10 — A bound local file is a Reading kind (`{kind: "file", id, content}` with raw, token, parsed, parseError, drift); edits stage in Work. `@tanstack/react-query` is removed from `apps/web`; every host read is a Reading on the one stream. Why: two caches let a stale Query value render beside a fresh Reading with nothing to say which is right.
- 2026-09-10 — `ResourceFrame` with gap frames is the accepted transport; the round-1 `PeFrame`/`seq` envelope is superseded. Session identity stays one branded string because the broker id already hashes pid and process start.
- 2026-09-10 — Hotkeys and pane help are in scope: `chord` lives on the Action, the shell registers every chord in one loop through `@tanstack/react-hotkeys`, and the help overlay reads live registrations. The hand-written `Alt+1..n` keymap in `proto-tutorial/measure.ts` is the defect this fixes.
- 2026-09-10 — The manifest type is `RouteManifest` and every `routes/*.tsx` exports it as `export const manifest`; TanStack keeps the `Route` name. Actions return a `Refusal { code, message }`, never throw; `busy` stays a runtime refusal (owed: `Busy<A> | Idle` as a type). Installer and update UI belong to the root shell, not the route head. One `host-status` Reading at the host's 5s cadence feeds both the gate and the lamp.
- 2026-09-10 — Seed and demo wire is plain JSON; a Work doc that holds a Date or Map owns that in its zod schema. `?work=` is the only Work-identity query; `?workspace=` and `?pin=` are gone. Work keys by Address, not openId (law 6). Takeoff's `WorldLane` is a Revit plan view and is `ModelView`; the takeoff model keeps `Model*` names, not `World*`.

- 2026-09-11 — Route chrome rulings (kaitpw). The lamp shows host status only. Beside it sits one route-wide control group: tutorial, inspector, settings later, theme; the host lamp leaves that group once it is a dev-only concern. The inspector is a dev tool that a stranger still reads at first glance, and it lives in the control group, never inline. `/instances` is a standalone route and the same component is the body of any route that needs Revit and has no resolved Target.
- 2026-09-11 — Composition laws (kaitpw). Judge nouns only composed on a real page; per-noun variants out of context are not judgeable. Every picker is searchable, sortable and keyboard-navigable. Every label states its relationship to the other nouns. No fact is shown more than twice on a page, ideally once, and that one placement is deliberate. Color, motion and marks carry role, identity and provenance. Concept and flow outrank polish. Why: the 48 per-noun variants of 2026-09-11 did not resonate; the old targeting sentence (branch `proto/targeting-round3`, `components/sentence.tsx`) did, because it folded every noun into one readable line.

- 2026-09-12 — UX revival rulings (kaitpw): display as little as possible with clear disclosure. The six architecture nouns need not become six visible elements. A continuous, readable sentence remains a strong candidate; connective language may carry status and staged work.
- 2026-09-12 — Each option ladder is one searchable breadcrumb input, including session/document/view and filesystem root/module/subdirectory/file. Picking a leaf must retain its exact identity.
- 2026-09-12 — Chat remains usable without a Revit document or session. Revit requirements gate individual operations. Local-file editors may follow this rule. Chat targeting belongs around the composer; the prior whole-body gate is superseded for Chat.
- 2026-09-12 — Targeting primitives also compose inline in Chat. Pea's inline UI expresses target, staged work and action stage. Preparation stays interactive; completed actions retain their historical target and changes.
- 2026-09-15, RP review fixes preserve Stage as Situation vocabulary, immutable transcript evidence and visible failures. The final producer audit supersedes repair of the retired Work replay protocol: delete that protocol and keep external uncertainty in ActionJournal. Renaming Situation remains deferred.
- 2026-09-15 — Seeds are read-only proof inputs (counsel ruling under user delegation, "i defer to u"; re-openable). A seeded action refuses "frozen seed is read-only"; the demo lane proves render and parity, never a receipt. The `Ctx.external`/`Ctx.command` demo neutralizers are dead under this ruling and are deleted; the host `demo-lane.scenario` suite asserts render and parity only.
- 2026-09-15 — Chat's send is a Situation action (kaitpw: "it uses primitives the way i want, keep it that way"). Its look is not liked; a children slot on the verb may replace the rendering later. Not a button component of its own.

## Tried & rejected

- 2026-09-16, Overlay composer (B) is rejected for its z-level defect. Enclosure-everywhere (C) is rejected for panes.
- 2026-09-15, `prism-react-editor` for the JSON editor (worktree `proto/json-prism`): uncontrolled write model needed a `held` freeze so a new `value` did not reset caret and history, range highlight was a search hit not a decoration, and it added a dependency for bracket matching that settings-sized files do not need.
- 2026-09-15, A universal mutable route object or one route-wide lifecycle hides differences between authored Work, observed Readings, Page navigation and external Action outcomes. Compose their owners instead; storage placement is not a substitute for semantic ownership.
- 2026-09-15, A common pane layout and a mandatory proposal/staged/committed workflow do not fit every route. Shared ownership and head projections are the substrate; product layout and workflow remain route-specific.
- 2026-09-15, Completing every product as RP acceptance made this worktree an indefinite merge gate. Exercise representative callers to falsify RP contracts, and track product-engine/UX debt separately.
- 2026-09-13, Situation variants that lost (prototype rounds, git history): the key/value ledger as the head (honest but never explains; survives only as the sentence's "more" unfold); the always-visible breadcrumb rail (the full ladder at rest is noise; survives only inside pickers); stage as tabs over the verb gutter (loses to stage-as-first-word); refusal as a line under the verb row or as the verb's own label (both shift the row); staged Work in a right margin (cannot inline into Chat).
- 2026-09-13, the prior `WorkingHead` (prose plus a native select, wrapped underline buttons, a status string and a `<details>`): three visual registers stacked, GUID labels, no document health. User verdict "horrendous".
- 2026-09-09 — Rejected the Fable report's claim that document keys and receipts alone prevent every stale read or duplicate mutation. Keys separate open lifetimes; Effect refresh orders reads within one lifetime; host admission and stable request identity govern retries. Browser transport loss does not establish an unknown executor outcome.

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

- 2026-09-10 — Instances lifecycle runs through the SDK's caller-owned admission (`--request-file` under the journal step id, recovery by `op result --request-file`); Instances route commands are retired in favor of `workflow:instances.*`. Consumer pin is the local route candidate `0.1.0-beta.152.route.20260910-0035`; `beta.153` does not contain that source, so merging to main needs a later normal pin carrying both. `route-primitive-fable.html` is implemented truth only. Owed: advance the installed Bootstrap (user authority) and run the native Instances journey; dispose of the two legacy in-flight rows in the product database; diagnose the 14 stable web reds against a whole baseline; diagnose the Instances first-click miss.
- 2026-09-10 — The host's legacy census keyed its config by store identity while Mastra hands consumers a proxy, so every real admission was refused; keyed by storage id now, with a deterministic test. A green suite did not catch it because tests build journals without the Mastra runtime: drive the real host before calling an admission path closed.
- 2026-09-10 — Demo-lane browser proof landed: `apps/host/tests/demo-lane.scenario.test.ts` enumerates every seed from the manifests and asserts landmark, refusal parity on chord and button, fire, outcome line, no page error (21/21). It found a live chat defect (workbench never handed `session` to the chat manifest, so `send`/`cancel` always refused) and four seed defects. The primitive gained `ctx.command` and `ctx.external`, both neutralized under a seed; the demo lane subscribes no live Readings. `chat-flow` was asserting the retired scope/pin vocabulary and was rewritten, not the product. `routes/-chat.test.tsx`, `-instances.test.tsx`, `families/authored-rows.ts` deleted.
- 2026-09-11 — Route-noun proto round (48 throwaway variants, `apps/web/src/design-system/proto/`, uncommitted): the standing line `[tone dot] [verdict word] — [one sentence]`, then at most one affordance which is the fix, then a `▸ record` disclosure, is the head shape that transfers across Target, Work, Reading, Action, Receipt, Shell, Keys and Seed. It is a head, not a surface: it cannot hold plural verdicts, has no honest word for `loading` or `checking`, and has no slot for a past or continuous fact. "Just clicks" replaces scrubbers and invented history: every lifecycle state is reached by 4 to 9 real user acts, each logging one spoken outcome line; a disabled control carries its refusal as its reason. Verdicts and tables: `.artifacts/handoffs/proto-nouns-20260911/ROUND-1.md`, `ROUND-2.md`. User promotion verdict still owed.
- 2026-09-10 — Keys are one registration shape across three tiers (route manifest chord, pane `shortcuts`, widget `useHotkeys`) via `keyMeta({name, description, tier, region?, refusal?})`; pane keys gained `says` and `refusal` (a refused key reveals the card). The help page `route/help.tsx` (Alt+/) is rebuilt over registrations: measured panes with leaders per region, manifest chords in a band, `manifest.docs` below. No root manifest until a navigation chord exists; chat's palette and mode chords are tagged surface chords, not actions.

## Owed
- 2026-09-26, `master-table` does not virtualize rows. It froze at about 6,500 rows on `/ducts`, so that route lists the selected group only. Consumer: `/ducts`.
- 2026-09-22, split `route/spec-editor.tsx` (717 lines) along its sections and drop its `LINE_BUDGET_ALLOW` row in `line-budget.guard.test.ts`.
- 2026-09-22, the test bar sweep deleted 54 SCAFFOLD test files with no surface replacement. Each behavior they asserted needs a surface test (CDP journey, MCP tool call, host HTTP) or a visible readout. Recover the assertions from git: `actions/receipt`, `components/lang/band`, `components/lang/code`, `components/lang/diagram`, `components/lang/list`, `components/lang/pane`, `components/lang/rail`, `components/lang/unstage-all`, `components/master-table/cell-select`, `components/master-table/table`, `design-system/band-matrix`, `design-system/band-specimen`, `design-system/list-specimen`, `design-system/specimens/recipe-grid`, `instances/cluster`, `instances/launch-proposal`, `lib/affine-frame`, `lib/schema-to-field-render/array-field`, `lib/schema-to-field-render/object-field`, `lib/schema-to-field-render/table-field`, `route/action-scope`, `route/bound-closed`, `route/bound-closed-head`, `route/bound-closed-schedules`, `route/document-ladder`, `route/entity-route`, `route/family/draft`, `route/family/manifest`, `route/help`, `route/ladder`, `route/plan-stale`, `route/runs-list`, `route/schedules/freshness`, `route/schedules/live`, `route/schedules/live-stale`, `route/schedules/partial-push`, `route/schedules/rail-click`, `route/schedules/rail-freshness`, `route/schedules/retained-hydration`, `route/schedules/seams`, `route/schedules/stale-chat`, `route/schedules/stale-overwrite`, `route/schedules/stale-resolve`, `route/scope`, `route/shell`, `route/spec-editor`, `route/spec-editor-save`, `route/stage-chord`, `route/target-gap`, `route/thread-target`, `route/use-route`, `route/verb-input`, `settings/schema-form`, `state/atom-inspect`.
- `/family` learns the change mark from the moment it subscribes, not from its last read's taken-at, because its capture is a member write; a page opened long after a change starts "current" until the next change. `/families` is exact since 2026-09-23: its matrix is a `families-matrix` Reading whose envelope carries the read's taken-at and body id, with the body fetched over RPC (MAP ruling 3). Fix for `/family` is the same envelope over its capture.
- Revit-backed proof of the change mark: in a dev session on `/schedules`, two model edits under 750 ms apart must draw "changed in Revit" after the second (the deleted `st2-stale` journey's successor; no no-Revit lane can raise a mark).
- Revit-backed proof of ephemeral Work: stage in an unsaved project, Save As, the lifetime line goes and the cell survives; close a second unsaved project, the receipt draws with its count. Premise test: `OpenDocumentIdentityTests.Open_identity_survives_saveas_but_not_close_and_reopen`.
- The `/schedules` spec pane still unmounts instead of hiding (`TODO:` at `route/entity.tsx`): `SpecEditor` does work while rendering and never settles hidden.
- Add deterministic fixtures for Data Tables, Ops, Parameter Links, Runs and Schedule Grid. Review URLs alone do not prove their pane geometry or states.
- Chat prompt suggestions wait until kaitpw has example prompts that are proven to work.
- Large tool outputs (element lists in the MB range) are rendered whole. `Code`'s 64 KB gate is the interim; the real fix is a bounded output contract on the tool result itself.
- Product follow-up after RP merge: extend the Situation motif to low-priority routes, finish file-picker ergonomics, and improve incomplete frozen seed slots. These do not authorize a competing Work, Reading or Action owner.
- Review the design class allowlist increases recorded by Fable for five route files. They are explicit visual debt, not evidence that the layout has been validated.
- The live Chat dock projection may move into each route View when those views are consolidated; completed transcript cards must continue to read only their recorded result.
- Tutorial/teaching follow-up: hotkey registration and pane-map infrastructure are not the authored learning experience. Review route orientation prose, pane guidance and visible tutorial geometry with the user; this is deferred product UX, not an RP merge gate. Manifest View coverage and inspector provenance gaps need a final disposition after source review rather than automatic implementation of every old spec clause.

- 2026-09-14, Situation polish round 2 (`route/situation.tsx`, uncommitted on `codex/route-primitive`), gaps under the paint:
  - The type ladder has no middle rung: the head is 24px and everything else 10px or 11px. A rung is a kit decision (`base.css`), not a call-site one.
  - Ledger values arrive as route strings, so a path, a revision or a timestamp cannot wear mono (law 6). Type the `ledger` value as measured or prose.
  - `[data-tone]` in `lang.css` is a zero-specificity `:where` rule, so any ink utility on the same element wins silently (bit the fold head). Bump it once in the kit.
  - The chain lamp reads "host · unknown" for the life of a demo-lane page; the lamp needs a "demo" word so it stops lying by omission about the lane.
  - Instances (launch and control Revit) is a separate route with a weak entry from the head. Idea to rule on: a dense Instances view inside a large picker that opens from the chain lamp, so launching a session is one press from where its absence is shown.
  - The Work band with `count > 0` and the vertical verb projection's `dispatches` column are proven by compile and by Takeoffs `?demo=sync` only; no seed stages rows.
- 2026-09-14, Situation polish round 3 (`route/situation.tsx`, `route/flow.tsx`, uncommitted on `codex/route-primitive`), gaps under the paint:
  - Rule whether health and resolution changes belong in the page log; target, stage, Work and action events already have owners.
  - `FlowMatrix` is a relation matrix (action → dirties reading, marks per reading), not a wiring diagram. Upgrade path is SVG edges when a route carries more than ~8 readings or when relations between readings (derived-from) get typed on the manifest; today the manifest has no reading→reading edge to draw.
  - The state gauge popover stacks Ledger, Flow and the inspector to ~44rem wide and taller than the viewport; it needs tabs or a drawer once the inspector stops being DEV-only.
  - Below ~58rem the right half (live + log) wraps under the verb board; there is no rule yet for what the head loses first on a narrow screen.
- Complete the file ladder (an explicit .r10 path is accepted today).
- True backend cancel for `/call`: stop only cancels the wait (`host/client.ts` and the host `/call` route take no `AbortSignal`; Revit keeps running the operation).
- Prove the band's conflict state with staged edits (the root `RouteConflictBanner` is already gone; zero references on 2026-09-15).
- An exact `?target=` (JSON open ref) survives the router only by re-serialising: TanStack JSON-parses search values, so `routeSearch` stringifies the object back and the URL lands double-encoded (`target=%22%7B%5C%22kind...`). Give the exact target a plain grammar (`session/openId`) so the URL reads like the session shorthand.
- The session shorthand target (`?target=session-…`) resolves to `ambiguous` while `revit.matrix.loaded-families` walks family documents (each `EditFamily` adds a transient document to the inventory), so the Situation drops to "choose a session" mid-op and the page state resets. The exact target holds; rule whether shorthand should pin to the project document once resolved.
- `revit.matrix.loaded-families` runs `EditFamily` per family with no failure preprocessor or `DialogBoxShowing` handler: on 2026-09-14 a family warning ("Constraints between geometry in the family can behave unpredictably…") blocked the Revit API thread for 15 minutes, the op never completed, and the add-in's bridge supervisor could not reconnect because it also runs on the Revit task queue. Suppress or auto-dismiss warnings inside the op and move the reconnect off the API thread.
- Work band with `count > 0` is unproven: the project-a clone has no views or zones to stage against.
- Family demo lane (`/family?demo=plan`): the file slot shows "choose a family file" while the handoff report expects `box.family.json` seeded.
- The commit flag does not yet summarize a handful of edits (needs a ruling on "a handful").
- The page-log `target` row prints the host session id and openId, not the session word and document title.

- `Picker` gained `derived` (a dashed underline: the bound value was reported by the world, not chosen; house law 8) for the chat to-line on 2026-09-06 without a swatch specimen; add one beside the popover specimens on `/design-system`.
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
- 2026-09-01 grill execution, remaining after the canon + scope merges landed on main
  (design-guard 0 red, reports `.artifacts/handoffs/2026-09-01-{design-canon,execution-scope}-report.md`):
  the chat reducer demiurge (includes audit-record cards and the host event-ledger epoch —
  `bridge.ts` `eventSeq` resets on restart and the browser's `lastSeq` gate then rejects valid
  events) and the one-route-spec demiurge. Browser-lane proof of the two-axis type migration is
  owed (deterministic + compile only so far); the ten former `t-value face-mono` sites moved to
  `ink-2` deliberately (mono-floor law).
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
  measured nowhere. (The menu-primitive decision closed 2026-09-01: Combobox.)
- Two web tests fail on main independent of the review deletion (found by the full-suite run,
  2026-08-31): `-chat.test.tsx` misses a "Context budget" button and `-families.test.tsx` misses
  the families summary line — debts of the annotation/density rounds, whose agents gated on
  targeted tests only. Diagnose and fix with the takeoffs cutover.
- The design guards misreport (found 2026-08-31 by the intent census,
  `.artifacts/runs/meaning-census-20260831/report.md`): the inline-color regex at
  `design-adherence.test.ts:107` backtracks past its optional quote, so 11 literal
  `transparent`/`inherit` values count as debt; the opacity regex counted keyframes as dimming (fixed; ruled 2026-09-01, see The language); the class guard's inverse `AUTHORING` filter counts 23
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
- `/family`, `/families`, `/settings`, `/ops` have NO fixture lane on either branch
  (`?source=fixture` falls back to the document gate); they cannot be censused or ported
  without a controlled Revit session. `/takeoffs` and `/instances` have real fixtures
  (corrected 2026-09-01: `instances/fixture.tsx` builds typed `SessionObservation` rows and
  `routes/instances.tsx` branches on `?source=fixture` — the earlier "no fixture" reading
  was stale).
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
- `Combobox` needs major improvement (kaitpw 2026-09-01, ruled with the CellSelect adoption): the
  cell keyboard/commit contract, filling-trigger parity with the header facet, chips density, and
  whatever the takeoffs cutover surfaces. It is now the one menu primitive, so its debts are
  cross-route.
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
  Decided 2026-09-01: the cell adopts `Combobox` and pays the keyboard/commit contract (see
  Decided); lands with the takeoffs cutover.
- Round 2 (2026-08-31) measured the round in real Chrome after the critic's pass: the scrollbar
  mechanism was FALSIFIED and fixed, the predicted +1px row was real and is fixed at the rule, the
  padding census is down to the two named insets, and 36/36 rail bars share one right edge.
  Evidence: `.artifacts/runs/delegate-20260831/chrome-report.md` §Round 2 + `chrome-shots/`.
- Still open from the measurement: 7 `/takeoffs` rows measure 24px with no descendant over 20px —
  the extra 4px is on the row box and is not isolated. One `/family` row measures 21px by design
  (the ghost-section opener's `hairline-t-2` boundary). The `/families` decision queue is still
  drawn in the pre-ruling idiom (12.5–15px rows, `border-collapse`) and belongs to that route.
- Gutter reservation on hover stays UNPROVEN: headless Chrome gives overlay scrollbars, so the
  "no layout shift when the thumb appears" claim needs a headed browser.

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
- Name sweep (Codex-grade, one commit per item): `scope` naming a `WorkKey` at ten sites; `ScopeStore` persisting `scope:${threadId}` after Scope became Target; `bridgeSelector`; `OpenDocumentCount` beside `OpenDocuments`; the `schedule-grid` literal in `bridge-protocol.ts`; `TakeoffPromotionFacts` on the generated wire; `help.tsx:3` header; two `Thumbnail` components; two `ListPopup` specimens; two synthetic zone worlds; mojibake at `bridge.ts:207`.
- `firstRefusal` in `route/refusal.ts` sorts by `REFUSAL_ORDER.indexOf`, so a code outside the list returns -1 and outranks `no-target`; make `REFUSAL_ORDER` provably exhaustive.
- `use-route.ts` evicts the `own` revision chain by insertion order past 256 entries, so a long-lived page degrades from truthfully bound to stale; bound by observation, not count.
- Command palette mirrors route verbs; one palette each for `/families`, `/family`, `/schedules` (user ruling 2026-09-22).
- `targeting/**` (instrument cluster, direction glyphs, stage strip; deleted by `43ff94b0`, base `f459801e`) is undecided; stand up a worktree at the base commit and screenshot the route head before ruling.
- Owed exploration (2026-09-23): a batteries-included proposal review surface in the Situation head shared with Chat. Consolidate the existing WorkBand/Situation work body, Chat ProposalHead, and FamiliesProposalsBand while keeping one Work and cell-transition owner; shape and placement remain undecided.
