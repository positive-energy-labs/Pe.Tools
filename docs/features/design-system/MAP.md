# targeting-grammar — round 1 map

Open frontier for the 2026-08-19 targeting-grammar effort (rulings live in LEDGER.md Decided;
this file dies when the effort ends).

## Round 1 — binding-sentence head on /takeoffs (BUILT, awaiting kaitpw verdicts)

Question: do four directional clauses (subject · reads · writes · syncs · world) stay readable
at head-rail width inside `AddressingBar`?

Drive: `http://localhost:3000/takeoffs?proto=head&source=fixture&variant=a` (fixture lane;
live lane works too with a bound world). Arrow keys / bottom pill switch variants.

- `variant=a` — one sentence, joiner grammar + mono glyphs (the ruling under proof)
- `variant=b` — reads:/writes: clauses (the rejected alternate, built to be beaten by eyes)
- `variant=c` — subject-only sentence + connection chip strip (the scale hedge)

Code: `apps/web/src/takeoff/proto/binding-sentence-proto.tsx` + the `?proto=head` gate in
`routes/takeoffs.tsx`. Read-only — picks are proto-local, nothing writes.

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

## Adoption lag

- `/takeoffs` canon head: not adopted (still TargetGate + typed r10 path).
- `/family`, `/chat`: untouched this round.

## Next-round candidates

- Compression test: narrow viewport / long doc names — does variant a wrap per the
  identity-outranks-controls law or shrink?
- Three-home layout sketch (right rail = sections) — deferred out of round 1; sentence claim
  first.
- Manifest type promotion (`Binding[]` into canon) blocked on a round-1 winner.
