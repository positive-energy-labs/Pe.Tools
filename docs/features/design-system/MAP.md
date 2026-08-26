# targeting-grammar — round 1 map

Open frontier for the 2026-08-19 targeting-grammar effort (rulings live in LEDGER.md Decided;
this file dies when the effort ends).

## Round 1 — binding-sentence head on /takeoffs (BUILT, awaiting kaitpw verdicts)

Question: do four directional clauses (subject · reads · writes · syncs · world) stay readable
at head-rail width inside `AddressingBar`?

Canon: `apps/web/src/targeting/head.tsx`; `/takeoffs` mounts `TargetingHead` in
`apps/web/src/routes/takeoffs.tsx`.

- `variant=a` — one sentence, joiner grammar + mono glyphs (the ruling under proof)
- `variant=b` — reads:/writes: clauses (the rejected alternate, built to be beaten by eyes)
- `variant=c` — subject-only sentence + connection chip strip (the scale hedge)

Real-data notes (what the manifest exposed):
- `.r10` binding has NO legal option source — canon sync panel is a raw typed path
  (`takeoffs.tsx` sync panel); the proto renders it as an unbound picker whose empty text names
  the missing host op. This is the legal-options-law violation the manifest exists to kill.
- Views/zones options come real from `raw.views` / `world.zones`; fixture lane derives
  pseudo-views from `world.lanes`.

## Verdicts (round 1, kaitpw 2026-08-19)

- **a wins** (one sentence) — but liked elements of all three.
- Noun ORDER is granularity, big → small: world → rvt → view/rfa. Not subject-first.
- Glyphs (← → ⇄) are NOT clear enough for read/write. Wants a positioned annotation ABOVE
  each noun (read / write / sync / connect-attach). Direction taxonomy needs its own thought.
- "into zones" exposed a missing mechanism: pick MULTIPLE of a thing easily. Deferable
  component work, but the framework should be shaped for it now (code is the spec).
- The sentence hides WORKFLOW-STAGE relevance: auditing zones needs no .r10 attached;
  /families doesn't always build a json profile or push to Revit. A binding's relevance is
  stage-dependent and the sentence should say so.

## Round 2 — fixtured paradigm protos (in flight)

Grill answers (kaitpw): two-axis taxonomy but EXPERIMENT (direction is nullable — world and
the host rvt an rfa opens from have none); NO stage-model winner (verbs-demand hides state,
declared-stages too rigid, dim-idle is noise on rarely-used tails) — proto makes it
switchable; keep joiners AND annotations tentatively, ruling after the matrix fan-out;
products = takeoffs · family · families · chat · settings.

First attempt BUILT: `/targeting-proto` (routes/targeting-proto.tsx, fully fixtured, no host).
Drive: `http://localhost:3000/targeting-proto` —
- bottom pill / arrows: `form=joined` (joiners + annotations above nouns) vs `form=slots`
  (annotations replace joiners, labeled boxes)
- stage buttons (adopt · audit · sync) remount verb sets; `idle: hide|dim` toggles the
  verbs-demand vs show-but-dim relevance models live
- zones slot = the multi-pick seed (checkbox popover, "n of m zones")
- granularity order world → rvt → view → zones → r10 per round-1 verdict

Round-2 verdicts (kaitpw 2026-08-19):
- **form=joined wins** (joiners + annotations above nouns). Slots retired.
- **idle=dim wins** over hide — the full binding set stays scannable, undemanded muted.
- The stage SCRUBBER is loved as a way to scrub the workflow; **manifest-defined steps**
  are warming from experiment toward candidate canon.
- Layout ruling for round 3: ALL products on ONE page; `?variant` is reserved for genuinely
  different PARADIGMS; playing with a product's own paradigm (stage scrub, idle, picks)
  happens in place on the page.

## Round 3 — paradigm matrix (in flight)

`/targeting-proto` restructured: `src/targeting-proto/model.ts` holds the five product
manifests (takeoffs · family · families · chat · settings); each `?paradigm=` is a
whole-page rendering of all five. Baseline = round-2 winner. Fan-out agents each owned one
paradigm file; product semantics come from the fixtures, never invented.

ALL SIX BUILT (tsc green, 2026-08-19). What each asks the judge:
- **baseline** — joined sentence + per-product stage scrub (round-2 winner, the control).
- **rail** — stages as grid columns, noun chips SPAN the stages that demand them. Judge:
  is span-width ("world spans everything, r10 only hangs off sync") the fact the baseline
  buries? Does 5 nouns × 3 stages stay legible; does settings read as the same paradigm?
- **manifest** — the census table IS the head (noun · bound-to · direction · liveness ·
  demanded-by); GLOBAL stage scrubber; sentence demoted to a footnote. Judge: which artifact
  does the eye consult first (footnote first ⇒ paradigm concedes to baseline)? Is a global
  scrub across products a real question? Does the demanded-by column make scrubbing optional?
- **circuit** — per-product wiring diagram; direction = the wire (chevrons/duplex pair),
  detached = physical gap + hollow connector, rank = nesting depth. Judge: is duplex-vs-
  bidirectional learnable; does it beat the sentence on glanceability enough to earn ~6x
  the vertical space?
- **patchbay** — safety by geography: reads dock left, writes right (loud by weight),
  channel nouns in a top chassis, sync/read+write as full-width bridge cables. Judge:
  does left=safe/right=blast survive fixtures where most nouns are bridges (takeoffs,
  family)? Is gap-vs-flush liveness legible at 12px? Does settings read small or empty?
- **plugin** — five products as chat cards; sentence compressed into the card head; unbound
  demands become pea's dialogue; verbs gate on their own demands; picker expands inline.
  Judge: does takeoffs' 5-noun head still read as a sentence in a card? Does generated pea
  prose feel like a workflow moment? Inline picker vs popover on a conversation surface?

Cross-paradigm questions for the sitting: which paradigm answers "what does this page
reach" fastest cold; which one is the CHAT-PLUGIN answer (plugin card head is the
compression test); does any beat baseline enough to displace the sentence, or do they
donate mechanisms (span-lifetime, demanded-by column, geography) back into it?

## Verdicts (round 3, kaitpw 2026-08-20)

- **baseline** — good base. Stays the control; sentence style preferred over every rival.
- **rail** — the PARADIGM survives (shows what capability the page has at any moment); the
  vertical noun list is retired (looks bad).
- **circuit** — retired as a layout (loses clarity). DONATES the arrow symbology: the arrow is
  a candidate home for progress / current state (animated strobe while a verb runs).
- **manifest** — retired (wall of text).
- **patchbay** — retired as a layout. Its DIRECTION of visual organization (direction as
  geography) is worth one more exploration.
- **plugin** — strong. Keep: mode changes the verb set; one paradigm reused on every surface.
  Retire: inline attach options — the picker stays a dense dropdown/popover.
- **Reframe (kaitpw epiphany)**: most bindings are a WATERFALL (world → rvt → rfa/view;
  module/dir → file) where only the final choice is immediately relevant. This fights the
  flat "every noun in one sentence" reading; explore before the next round.
- **Target shape**: one component, toggleable between 2–3 display modes that emphasise
  different things. The goal is a FRAMEWORK: (1) consistency/predictability on every UI,
  (2) fastest possible prototyping of a new route, (3) stub-vs-real legibility after
  promotion. Opinionated, batteries included.

## Round 4 — views of one manifest (in flight, 2026-08-20)

Grill answers (kaitpw): Q1 ancestor visibility OPEN (4+ slot sentences are unwieldy, but
"everything at a glance" feels safe — prototype decides); Q2 path = URL state is the intent,
but rounds keep all products on one page; Q3 more views while exploring; Q4 declared stages,
user-switched, AND demands gate PANES (a pane drawing from an out-of-scope source is
disabled) — new ruling candidate; Q5 page-level derived seam chip ("reads a fixture until X");
Q6 add a disk-rooted product.

Model v2 (`targeting-proto/model.ts`): links form a FOREST via `parent`; a link with `dir` is
an ENDPOINT; ancestors are context. Seams DERIVED: `options === null`, `source === "fixture"`,
`run === null`. Panes declare `draws`. Sixth product `specs` = `repo › dir › file`, no host.
Shared kit (`kit.tsx`): `useBindings` (re-picking a parent clears descendants), `useRunner`
(mock in-flight → strobe source), popover `Picker`, `SeamChip`, `paneState`.

Drive: `http://localhost:3000/targeting-proto?view=` — `sentence` (a/b/c ancestor treatments
in place: full · hoisted prefix · per-endpoint breadcrumb) · `board` (stage strip with
readiness meter, verb lane, pane strip) · `flow` (reads left, page centre, writes right,
arrows strobe in flight) · `card` (chat plugin compression at 560px). Census footer on every
view = repo-wide seam census. Round-3 code is snapshot branch `proto/targeting-round3`.

ALL FOUR BUILT (tsc green, 2026-08-20). Builder findings worth the judge's time:
- sentence (measured, takeoffs @1440): a=923px · b(hoist)=966px · c(crumbs)=1181px intrinsic.
  HOISTING DOES NOT SAVE WIDTH on takeoffs (rvt is both ancestor and endpoint, so it prints
  twice); what it buys is ordering (identity first), what it costs is granularity order.
  Under a 640 clamp b wraps worst (fused atoms). Takeoffs is the only product with teeth.
- card: takeoffs' head wraps to two rows at 560px — reads as a STANZA, not a sentence. Q1
  answer from the fixtures: hoist the dominant chain, crumb the strays (crumb-only is the
  failure mode; hoist-only cannot represent a forest). Pea narration earns its line only when
  a demand is missing (noise on fully-bound stages).
- board: readiness meter in the stage strip (`adopt 0/1 · audit 1/3 · sync 0/2`) is the eye's
  first stop on takeoffs/family; on products with one verb per stage it decorates. Verb as a
  ROW (verb · demand chips · refusal) reads as a checklist. Defect: `world › rvt` prints 3×.
- flow: of 12 endpoints 8 are duplex, 1 pure write — geography survives as HONESTY (an empty
  left rail = "nothing here is read-only") not economy. Strobe is the strongest mark of the
  round ("which binding is being touched now", legend-free, grayscale-safe). Builder's own
  recommendation: flow does not ship as a layout; it grafts the strobe into the sentence.
  Open ruling: is a MOVING dash a different slot from the static SEAM dash (R13b)?
- Shared fixes landed after reports: kit `Picker` used non-existent `t-body`/`t-mono` (now
  `t-value`/`face-mono`); `sharedPrefix` now returns the DOMINANT chain (longest prefix shared
  by ≥2 endpoints) — views that hand-rolled `hoistedPrefix()`/`hoistable()` can drop them.
- Primitive gaps (design-system ledger Owed candidates): gated pane label (disabled-but-
  readable, reason required); in-flight mark / BusyBar; dense `Switcher` tier + secondary
  metric slot; `FactChip` caption size; `Picker` align prop; `AddressingBar` owning the
  identity-outranks-controls basis; one-line rail empty.

Builders: Herdr session `targ-r4`, one Opus agent per view; reports in
`.artifacts/tmp/targeting-r4/<view>.md`.

## Verdicts (round 4, kaitpw 2026-08-20)

- **sentence stays the primary presentation.** Q1 RULED: **hoisted** wins (b). Crumbs lack
  verbage; full is too verbose.
- **board** — horizontal stage strip with readiness meter + vertical verb list with notes to
  the right is "really good". Side-finding: the whole targeting surface should be postured as
  an ARTIFACT (artifact-frame law, solid ground) — a machine-operated object carrying state.
- **flow** — "the best reframe of the sentence paradigm". Needs visual refinement and a real
  rule for WHICH SIDE a connection sits on (takeoffs: the rvt and a picker on the same side
  confuses). Strobe survives.
- **card** — not a mode. It absorbs the rulings and renders as one of the 2–3 landed modes;
  a pea integration (notes) may ride alongside.
- **New exploration**: collapse a waterfall into a SINGLE INPUT. Caveats to design for: what
  is picked vs unpicked; is the slot picked all the way through; what lives beneath the final
  pick; an option relevant to two sentence slots (shared ancestor). Other compressions of
  sentence/state should be explored too.

## Round 5 — single-input paths, side rule, artifact posture (BUILT 2026-08-20, awaiting verdicts)

Grill answers (kaitpw): glance law = first glance shows only the critical, look harder /
hover for the important-but-not-now; Q12 side rule accepted; Q13 all three inputs; Q14
three views (card retired into a pea slot), board refined + brutalist. Built by the
orchestrator, no delegation.

Drive: `http://localhost:3000/targeting-proto?view=sentence|board|flow`.
- **kit**: `PathInput` — ONE input per path; closed = leaf (or "<ancestor> first" in caution
  when the chain is not picked through); open = `segmented` (breadcrumb row + one list,
  auto-advance) · `columns` (Finder, one column per level) · `search` (palette; results are
  whole paths; `pickPath` binds every level). Keyed by leaf; a shared ancestor re-picked from
  either chain updates both (state is per link). `StageStrip` (meter, hard cells), `PaneStrip`,
  `peaNote` (only when a wired verb is blocked by an unbound demand). In-flight = opacity
  pulse on the noun (Q10 taken as recommended: dashed stays seam).
- **sentence**: hoisted prefix as one mute `PathInput showAll`; one input per endpoint;
  direction·liveness as a mute second-look caption; artifact frame (head sentence · body
  stage strip + verbs + pea line · foot panes + receipt). Input shape switch in place.
- **board**: artifact; hard ink rules; grid `verb · needs · state`; demands as mono words
  (∅ = unbound, dashed underline = seam); busy = ink bar; prefix hoisted once.
- **flow**: SIDE RULE = grammar clauses: context → head line; SUBJECT (read+write) → inside
  the page block; reads → left; writes·syncs → right (sync = both heads). Progress = a dot
  travelling the shaft in the data direction; detached = gap + hollow connectors.
- Round-4 `view-card.tsx` was deleted before snapshotting (its report survives in
  `.artifacts/tmp/targeting-r4/card.md`; the three surviving views are on disk).

Questions for the sitting: which input shape wins (and does the answer differ for the
identity prefix vs an endpoint)? Is "<ancestor> first" the right closed state for a
half-picked path? Does the subject-inside rule read on takeoffs and family? Is the board
brutalist enough, or too much?

## Adoption lag

- `/takeoffs` canon head: not adopted (still TargetGate + typed r10 path).
- `/family`, `/chat`: untouched this round.

## Next-round candidates

- Compression test: narrow viewport / long doc names — does variant a wrap per the
  identity-outranks-controls law or shrink?
- Three-home layout sketch (right rail = sections) — deferred out of round 1; sentence claim
  first.
- Manifest type promotion (`Binding[]` into canon) blocked on a round-1 winner.

## Round 6 — promotion: `/takeoffs` on the manifest (BUILT 2026-08-24, branch `takeoff-frontier`)

The proto stays here (`/targeting-proto`, six fixtured products). The canon landed on the
`takeoff-frontier` worktree as `apps/web/src/targeting/` (`model.ts` · `kit.tsx` · `head.tsx`)
with `/takeoffs` as the case study. What changed between proto and canon:

| proto | canon | why |
|---|---|---|
| `Link.options` static, `Link.bound` seed, `source: fixture` | `Link` is static contract only; a `Feed` per link (`options`, `state: live·fresh·stale·loading·error·fixture`, `at`) comes from the route | manifest = serializable; feeds = projections of queries |
| kit owns binding state | route owns it (URL search: `view`, `zones`, `dir`, `r10`, `stage`); kit owns the waterfall | Q2 ruling, shareable address |
| `verb.run` mock | `run` through `useVerb` (serialized); `refuse()` per-verb gate; `nav` verbs | real refusals in order: unwired → unbound → stale → gate |
| `.r10` seam (`options: null`) | new host op `rhvac.list {dir}` | the seam cost 40 lines to discharge — the manifest made it a line item |
| sentence · board · flow views | `TargetingHead mode=sentence|board`; flow not promoted | flow awaits its side rule refinement |
| `sharedPrefix` = most-shared | longest chain shared by ≥2 | takeoffs hoists `world › rvt` once; `rvt` endpoint back-references |

Drive: `http://localhost:3001/takeoffs?source=fixture` (frontier dev server) ·
`?head=board` · `?input=columns|search`. Live lane: bind a world in the sentence.

Stress findings (usability of the primitives):
- A link whose options need a NEW host op is the expensive case; everything else was a
  query + a `Feed` mapping (≈10 lines per link).
- `multi` links + URL: comma list; fine.
- Panel-opening verbs (adopt, sync) do not fit `run: Promise` cleanly (busy flashes) —
  a verb kind gap, recorded in the takeoffs ledger.
- Two homes for "which zones": the Atlas selection vs the `zones` binding. The binding should
  drive the Atlas; not done in this round (Atlas is 2000 lines).
- Fixture lane: `folder`/`r10` are unsourced seams by construction — the seam chip reads
  "folder, r10 unsourced", which is the honest state.

## Round 7 — terminals are the sentence (BUILT 2026-08-24, `takeoff-frontier`)

kaitpw's round-6 notes reframed the head; rulings taken as built:
- **Terminals are the sentence.** A link with `dir` is a TERMINAL (what the user thinks about);
  a link without one is a TRUNK (how you get there). Trunks never print; they are the picker's
  crumbs. Two terminals under one trunk share its binding. Direction lives on the terminal only,
  so the trunk carries no read/write claim (`rvt` is trunk, not a clause — the "editing rvt"
  back-reference is gone). `sharedPrefix`/hoisting deleted.
- **Incomplete pick** prints where it stopped: `<deepest bound> › <next placeholder>` in
  caution (`model.progress`). Complete = leaf only.
- **One picker shape**: crumbs · search · list; Enter picks the first hit and auto-advances.
  Columns/search modes and `?input=` deleted.
- **Board is not a mode**: the stage strip's trailing `▾` expands the verb rail in place into
  verb · needs · state. `?head=` deleted.
- Takeoffs head now: `from [ZONING PLAN]  into [pick zones]  syncing [pick a folder › …]`.

Open for the sitting: does the caution `A › placeholder` closed text read as "half-picked" at a
glance? Should search span every remaining level (whole-path results) or stay per level?
Flow view: promote as a projection over `terminals()` + trunks once the side rule is restated
for trunk-vs-terminal (the old subject clause no longer exists).

## Route-state cutover goal (2026-08-25, kaitpw → orchestrator, Herdr session `cutover`)

Goal form. Worktree `~/source/repos/Pe.Tools-cutover-all`, branch `goal/route-cutover` from main `5a3a6a7`+docs. Evidence under `.artifacts/goal/route-cutover/`.

Status 2026-08-25 ~13:00 (resumed after the 03:55 session loss): NUMBER 5/5 routes on route stores (`/takeoffs` slice declared, `/family`, `/families`, `/settings`, `/chat` in-realm panes); route-file `useState|useRef|useReducer` residue 0; shim count 0 (no-scope fallback, iframe, `writeRouteState`, `readRouteState`, workspace scope all deleted); big ideas I1–I7 ruled in `.artifacts/goal/route-cutover/IDEAS.md`, friction in `FRICTION.md`. Waves 5–9 each had a fresh-eyes purge critic; two builder verdicts were overturned by critics (S-A producer, S-B closure claim). Remaining: final re-critique and PR.

```
MISSION   /family, /families, /settings, /workbench (chat) run on a route store like /takeoffs (ADR 0009; A1: all
          page state in the store), each route's agent-shared slice declared once, and every targeting-primitive
          demand those routes raised is addressed. Never: a second writable truth beside the store, a compat shim
          left standing, a proof claimed without its lane. parameter-links, param-tables, schedule-grid keep
          triangulating and only inherit shared primitives.
NUMBER    routes cut over, of 5 (/takeoffs counts once its plugin slice is declared). Beside it: component-local
          state sites on those routes (census wave 0 → 0), shim count, LOC delta.
EYE       a purge critic (Codex) reads every wave's diff before the verdict; one browser observation per route at
          the end. Eye outranks number when honesty is in question.
GATES     `vp test` on touched dirs + tsc exit 0 from apps/web; codegen unchanged; no `pnpm install`, no `vp check --fix`;
          ledgers per `docs` (three sections, one-line entries, cross-route gaps in design-system).
WIDTH     2–3 builders per wave, 60–90 min box; critics 20 min; alarm at 2×.
DRY       two waves that retire nothing end it; polish is a stop.
ABSENT    assumed rulings, each re-openable by kaitpw:
          - /family Q1–Q8: all recommendation A (closures over route store; Dir gains duplex; family/store.ts first;
            profile = URL truth with host→URL projection; pick writes binding; feed honesty is a precondition;
            replace old head keeping validation chip in aside; rewrite → observe → rule ≥2-route bar).
          - FeedState becomes ready|loading|error + declared Feed.seam; live/fixture become lane facts, not states.
          - Immediate refusal of a second verb is LAW: runVerb stays and is extracted to state/route-store.ts with
            hostRead and the feed projector; /family pays for the extraction.
          - Labels: public graph nodes and actions only.
          - Apply-arming (previewedProfile) moves to the route doc.
          - Workspace scope, the iframe, defineCommitCommand: decided from wave-0 census, not by fiat.
          - Out of scope: host sessionId, the diagram, takeoff geometry tuning, small nits.
LEDGER    design-system (cross-route rulings + owed), family / takeoffs (application), host `/settings` section,
          agent (chat). Wave verdicts land as Decided/Tried & rejected lines, never here.
```

Waves (rough; reshaped after each verdict):
0. Census ×3 (routes' state homes · store-generic extraction · plugin door) — instrument first.
1. Demiurge shapes for `state/route-store.ts` + store↔`RouteStateSpec` relation (one Fable apostle); ruling.
2. Build: route-store extraction + FeedState honesty + `family/store.ts` + /family on manifest; purge critic.
3. Build: /families, /settings stores; purge critic.
4. Build: /workbench chat on stores + plugin door; purge critic; browser observation; ≥2-route bar ruling.
