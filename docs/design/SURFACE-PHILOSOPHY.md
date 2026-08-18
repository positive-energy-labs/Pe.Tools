# Surface philosophy

What our UI surfaces are for and how they should behave. Collected 2026-08-16 from three clean-room
rebuilds and roughly twenty retired prototypes, then checked against the code at that date.

These positions are settled. What lags is adoption: the newest surface expresses all of them, and
the older ones are behind it — some for migration debt, some because the pipeline underneath them
does not yet support the shape. Where this document and a shipping route disagree, the route is the
thing that is out of date. Contradictions worth knowing about are named in place, so you can tell a
settled position from a surface that has not caught up.

Beating a position here is a finding; record it.

**The ratchet.** This file is prose law; the `/design-system` route is the executable one. Any
position that *can* be rendered with a shipping canon component migrates into that route as a live
specimen, and collapses here to a one-line pointer — so the demonstration and the ruling can never
drift apart, and so a law nobody can render stays visibly unrendered. A position that can render
lives in the route; this file is the honest list of what can't (yet), plus the process rules that
never will. Where an unmigrated position is waiting on a specific component, it says so in place:
*(specimen owed when X ships)*.

The loop that produces surfaces is the `find-the-product` skill.

---

## 0 · What the surface is for

**The cross-cutting view is the product.** The host application is authoritative and shows one row
at a time. Our value is every entity × every attribute in one grid: filterable, sortable, editable
in place. Every exploration that made something other than the table primary — a queue, a tree, a
document, a pipeline — lost primacy to a table, repeatedly and independently. Several of them won a
pane; none of them won the page.

**Everything else is a mode of that table.** Detail views, per-item reconciliation, spatial views,
and inspectors are modes, drill-ins, and adjacent panes, not competing pages.

**The user cannot check our work by looking.** These surfaces assert things about a model the user
cannot verify by eye, and a wrong assertion is paid for later, in someone's construction documents.
A confident wrong number is worse than an awkward honest one. Most of §3 follows from this alone.

**The acceptance bar.** Someone new to the surface answers, in seconds and without tooltips: what am
I looking at, what state is it in, what would each verb do, and why is that one disabled. Tooltips
deepen; they never rescue. Tiebreak between two surfaces that both pass: speed through the path
taken most of the time.

**A surface unreachable from the front door rots.** Reachability from the index tracks liveness
better than any timestamp — if nobody can navigate to it, nobody notices it is wrong. Every route
deleted in the last purge wave was unlinked, and the surfaces carrying today's worst violations are
the ones you can only reach by typing a URL.

---

## 1 · State and vocabulary

The most-copied thing we have and the least uniformly adopted.

**Derive a row's state from the row's own facts.** A container's stage label says nothing about
whether any particular child needs a person. Rendering a parent's stage as a per-child indicator
produces rows that look identical while one needs work and one does not — the most expensive error
class we ship, because it is silently plausible. If the container label survives as a filter,
disclaim it where it renders.

**One vocabulary, rendered on every surface.** The same computed state should drive the list, the
spatial view, and the table column from one function, so a glance at the rail and a scan of the
table cannot disagree. Two coexisting progress signals means users read the wrong one; delete one.
Where this was skipped, one three-way state is currently drawn in two hue vocabularies — and one hue
means "proposal" in one and "alarm" in the other.

**"Not started" is a state, not a zero.** An entity with no rows yet renders as a labelled empty,
never as absence, or the untouched half of the project is invisible — and invisible reads as done.
→ rendered: `components/lang/empty.tsx` (`EmptyState`, required `story` + `exit`; specimen on
`/design-system/swatch`), and at cell scale the `fresh: "never"` rung (consolidation ruling R2).

**Compute agreement; do not remember it.** Drift, staleness, and agreement are diffs between two
readings, recomputed each render. A stored verdict goes stale exactly when it matters: a user edit
should visibly produce the same drift that the model moving underneath would.

**A parallel list is not a row set.** Derive rows from the model so a verb that changes the row set
shows its own effect — the row disappearing *is* the receipt.

**Sort by domain order where the column has one.** → rendered: `/design-system` §01, and live in
§04.

**A filter's vocabulary is stable under filtering.** → rendered: `/design-system` §01, whose exhibit
is the live table in §04.

---

## 2 · The pseudo-dimension law

A value has real dimensions — which attribute, which entity — and those are the grid. Everything
else you know about that value (proposed · grounded · live-in-the-model · unsaved) is a
**pseudo-dimension**, and it is not a column.

**Three columns that are all readings of the same coordinates are one column and a mode switch**,
and **the pseudo-dimension renders as cell state**. → rendered: `/design-system` §01 ("cell state,
not columns"), on the crucible cell that carries a proposal and a disagreement at once. The
operational half stays prose: key every substrate the same way (row × entity) and express each as
its own lookup function, so switching between them costs no layout.

**One meaning per shape, and a mark drawn by a different CSS mechanism still occupies the same
slot.** This is the rule most often broken in practice, including by the prototype that established
it: a proposal drawn as an inset box-shadow and a citation drawn as a text-decoration are two
underlines on one cell. Resolve collisions by explicit precedence, and make the explanatory text
match the precedence — a tooltip claiming a mark "stays put in every overlay" while another state
outranks it is worse than no tooltip.

**A bulk verb is disabled unless you can see its far side.** "Apply all" while the far substrate is
hidden is a blind commit; gate it on the overlay that shows what it will hit.

**Diff columns are legitimate; value columns are not.** A column carrying a row's worst agreement is
a diff and stays useful — you cannot filter a table by a colour. A column carrying the other
substrate's *value* is the thing to kill. At least one shipping surface still ships three value
readings of one coordinate pair as three columns.

---

## 3 · Honesty

**A stand-in announces itself and says what would replace it.** → rendered: `/design-system` §01,
on the dashed `FactChip`. The dashed edge is reserved for that one meaning; it is currently the
most over-subscribed visual in the codebase — dashed also means estimated, not-started,
needs-attention, held, void, and open-proposal depending on where you look. Do not add a ninth
meaning; if you need one, take a different slot.

**Keep the ledger of open stand-ins beside the feature** as Owed lines in `docs/features/<surface>/LEDGER.md`, one
numbered entry per gap naming what discharges it. Two rules make it citable across time: an entry
leaves the file only when the replacement ships, and numbers are stable — a closed entry is struck
and named, never renumbered. Other docs cite these by number.

**Make the claim a function of state, not a maintained flag.** One control can render under two or
three truth claims computed from whether a live connection exists and whether the record has a real
home yet. A hand-maintained "this part is fake" boolean drifts; a derived one cannot.

**Make unsafe paths inert by construction.** A fixture world whose records carry null identifiers
cannot be written through, whatever a handler forgets to check.

**Fixture data is a declared choice, never a fallback.** A failed live read shows its error. The one
acceptable shape of exception is a URL-gated mock lane that announces itself with a chip.

**Refuse rather than act unreliably.** Where the underlying capability is not trustworthy, a refusal
naming the reason and pointing at the legitimate path beats an action that works four times in five.

**Refuse per option, not per surface**, and **make the explanation a required constructor
argument.** → rendered: `/design-system` §01, with the counter-example — the same refusal drawn
through `ui/button`, which demands nothing and so ships greyed and mute.

**A silent refusal reads as an edit that vanished.** A rejected commit must visibly restore the
previous value *and* say why, near the cell, without resizing the row. Open defect: the shared cell
editor keeps invalid text in the box and never commits it, so every consumer inherits the failure.

**Provenance rides with the value, everywhere it appears.** → rendered: `/design-system` §01, on a
`StateCell` carrying its grounding footline.

**Turn freshness into work, not into a badge.** A stale or mismatched record becomes an item in the
same queue as everything else needing a person — counted, filtered, and blocking the same way. The
version to avoid ships today: staleness as a coloured span the save gate never consults.

**Provenance links are their own table.** Grounding a value in a source document is a fact about
where the number came from. Store it as a top-level link, independent of any proposal, or accepting
a proposal destroys the citation and "grounded but unproposed" becomes unrepresentable. Open defect:
the persisted contract still nests citations inside proposals, so they vanish on accept.

**Ceremony scales with blast radius.** → rendered: `/design-system` §01, pointing at
`/design-system/arming` — the satellite *is* this law, driven through unarmed → armed → refused →
re-plan. Still owed: a shipping consumer. `ArmingStrip` has none (SHIMS entry 3), so the ceremony
exists as a component and a demonstration but not yet as a path a user can take.

**Agents propose; humans cross.** The agent edits the portable document and links it to source text;
every crossing into the live model is a human action. Accepting stages — nothing has left the page —
so the commit is always a separate, explicitly-invoked verb, never a side effect of review.

**Typing beats proposing.** A user editing a proposed cell severs the proposal outright: no accept,
no dismiss, the user's value stands. Masking the proposal by render precedence is not the same thing:
discarding the edit resurrects it, which nobody expects. The older surface still masks. *(RULED
2026-08-16, consolidation R6: sever leaves NO cell trace — it is history, and history is not
computable from current facts. The record lives in the proposal ledger's settled "superseded" card;
`StateCell` will never grow a severed member. `/family` ships the behaviour.)*

---

## 4 · Layout and addressing

**Addressing is a sentence; narrowing is chips.** What the surface is pointed at reads as a line of
clickable nouns — the document, the entity, the world — and carries nouns only. Scope and filter
state live in table chips, never in the sentence. Chips narrow but never hide: every active
narrowing is visible and individually removable, so the user can always widen back out.
→ rendered: `components/lang/addressing-bar.tsx` (the five-slot head rail, R11; `/family` is the
reference adoption). Still open: `NarrowChip` owns removal and nothing owns re-adding.

**Under compression, identity outranks controls.** A crowded toolbar wraps rather than shrinking the
addressing line to a sliver. The buttons are what move.

**A commit's receipt can live in the addressing line**, replacing it briefly and relaxing back to
the nouns. Ordinary verbs need no separate receipt surface.

**Facts live next to the thing they describe.** A rail may carry navigation and container-level
counts; it may not become the home for facts about the current row. When one far-away rail holds
facts about several different things, collapsing anything orphans everything — put container facts
on the spatial view and row facts beside the table, and a collapse gesture then hides only what
lived in the collapsed thing.

**One home at a time.** A datum appears in exactly one place per mode — inline in the table *or* in
the panel, never both. Two homes means two renderers, and they diverge. *(Specimen owed when a
detail panel ships beside `MasterTable`; the law is about two surfaces and needs both.)*

**A mode's off-switch cannot live inside what the mode can hide.** A toggle inside a panel that
exists only while the cursor is on a row is unreachable in exactly the state you want to leave.

**One editor, one implementation.** When a value is editable in two places, extract the field so
fallback, constraints, and patch construction exist once. We currently carry three independent
inline editors that disagree about empty handling and refusal.

**Affordances do not move content.** Controls appearing inline shift the value under the cursor.
Prefer a dedicated gutter or an absolutely-positioned overlay. A gutter marker also makes the surface
scannable top-to-bottom without reading a single value, and is the only form that survives several
marks on one row — which is why it carries a count, and why the mark *locates* while the decision is
made where the evidence is. One row, several marks, no duplicated decision widget.

**Do not steal the caret.** Decorations inside an editable cell are non-focusable and suppress
mousedown, or the cell becomes untypeable.

**A floating element is capped to its container.** A card overlaid on a resizable pane scrolls inside
the pane's current height, or its verbs become unreachable at the default size.

**Drill in; do not navigate away.** Detail is a mode entered from a header and left with Esc, laid
out with the same primitive as the view it came from. A route change is for a genuinely different
scope, and between routes the URL is the whole handoff. *(Specimen owed when a drill-in mode ships
on `MasterTable`; the primitive has no mode seam today.)*

**Spatial views are load-bearing where the domain is spatial.** Without one, users construct geometry
in their head or push to the model to look. Real outlines, not colour squares — shape is identity.

**Cameras, not scroll.** For document panes, fly a fitted camera to a framed region and divide stroke
widths by scale so marks stay constant on screen. Scrolling a stack of page images cannot express
zoom, fit, or a citation's precision.

**Distinguish measured from estimated.** A mark derived from real coordinates and a mark derived from
a guess must not look the same.

**Design the empty states.** Distinguish "nothing in scope", which is the route's story, from
"filtered to nothing", which is the surface's own. They have different exits. Pickers with no options
say where options come from.

---

## 5 · Colour and type

Full rules in the header of `apps/web/src/design-lang.css` — the one place a colour of the
language is decided — rendered live in `/design-system` §02. (`COLOR-ROLES.md` is the
superseded ancestor.) Meaning is assigned in one place so that reconsidering a colour is a one-line edit;
components consume role tokens rather than raw palette. Deliberately alien prototype chrome, such as
a variant switcher, is exempt — it must not read as part of the design under review.

The four that shape a design rather than an implementation:

- **Selection and focus are a fill, never a hue.** Anything answering "where am I / what is lit" is a
  neutral fill.
- **One alarm.** Exactly one colour means "the model disagrees", and nothing else may wear it.
- **Agent proposals wear the agent's identity colour**, never the commit colour.
- **The only interactive blue is the verb that writes beyond the page.** Safe verbs never turn blue.

**Monospace means machine-authored literal text** — identifiers, paths, code, keys, measured numbers.
Type carries meaning on the same terms as colour.

---

## 6 · Primitives

**Extend the shared primitive; do not fork it.** Forks are cheap to start and expensive forever. The
standing census of forks and what the canon must absorb before it can abolish them is
[`../features/web-primitives/LEDGER.md`](../features/web-primitives/LEDGER.md).

**Capability should be presence-based.** A column descriptor where `sort` present means sortable and
`facet` present means filterable is legible at the call site and cannot desync from a parallel
capability flag.

**Sharing costs the consumer its keyboard and its layout freedom.** Folding a route onto a shared
table typically gains sorting, filtering, and chips, and loses knowledge of its own row order —
cursor movement must be re-plumbed through a callback so it walks the *visible* order — plus any key
binding the primitive now owns. Name the trade when you make it; discovering it later reads as a
regression.

**Primitive contracts have clauses the type signature does not show.** A cell renderer passed as a
component type remounts every cell — including the input being typed in — if its identity changes. A
control declared inside a render function gets a fresh identity each render and remounts under the
pointer. Write these at the call site; nobody will re-derive them.

**The surface's visible model should be readable and drivable from outside the component tree.**
Filters, sorts, and query held only in component state are invisible to the route, the URL, and any
agent plugin. A surface only React can see is not agent-operable, which is the whole point of these
tools. The seam for this exists on the table primitive and no shipping route supplies it yet.

**One consumer does not validate an API.** A prototype proves the design; it does not prove that the
primitive's *interface* survives a second caller with different needs. Promotion is finished when the
shipping consumers have migrated, not when the component compiles — until then expect the signature
to move.

**The second consumer is the evidence** — which speculative seams paid rent, which rotted, and the
tripwire test for authoring time, in
[`../features/web-primitives/LEDGER.md`](../features/web-primitives/LEDGER.md).

**Generalising at two consumers can cost more than it saves.** A shell abstracted over two similar
surfaces ended up unable to say anything specific about either, and both died together; the
single-purpose surface beside them became the ancestor of everything that shipped. Generalise when
the shared part is genuinely the same thing, not when two things merely rhyme.

**Prefer a specific affordance over a designed-but-unused slot.** We have canonized several slots on
the strength of a prototype — a pre-click cost preview, a column lock, a route-owned table state —
that no shipping surface has ever filled. The slot is not free: it is a promise in the type that
misleads the next reader.

---

## 7 · Route anatomy

The one structure three independently clean-roomed surfaces converged on:

- **The route owns the world and every host call.** The view renders a `World` and calls back through
  a typed `Actions` interface. Nothing below the route reaches the host.
- **Scope narrowing is chips, never hiding.**
- **Fixture lanes are explicit URL choices, never fallbacks.**

Convergence across independent builders is the strongest signal our prototyping method produces, and
this is the one it has produced. Start here.
