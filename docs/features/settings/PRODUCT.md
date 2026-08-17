# /settings — find-the-product

Living doc for the settings-panes rounds. Single home for verdicts. Surfaces caught up: none yet —
round 1 in flight on worktree branch `worktree-settings-panes-2026-08`.

## What this product is (ruled before round 1, 2026-08-17)

Settings is **not a page product — it is a kit of easily-wired pane components** (generated form,
raw JSON editor, settings file tree) meant to be composed inside real routes: /families (very wip),
/family (wip), and eventually a web Schedule Manager (`CmdScheduleManager`'s browse → preview →
create loop is the strongest tree+form+json story we have). The /settings route **survives as the
thin "open any settings file" raw utility** — the full composition's reference consumer — while the
components are the real product. (User ruling, 2026-08-17.)

The precedent is the current /settings route: the substrate-backed trichotomy reviewer over one
JSON file. It taught us the state model (proposal → staged → save, pointer-keyed `fields`, the
route-state SSE bridge, the chat-plugin reviewer). Its layout — one flat field list under a
picker head — is the first thing to discard.

## Constraints carried into round 1

- **Contract fact:** there is no raw-content save for an *existing* document. `create` takes
  `rawContent` but fails if the path exists; `save` splices staged fields only. A whole-file write
  lane needs a new host-facing command → SHIMS when/if that lane wins.
- **Chat-plugin compatibility:** pea proposals arrive pointer-keyed into `fields` over SSE, and
  `SettingsChatPlugin` renders the same substrate in chat. Any raw-editing design that abandons
  pointer-keyed fields blinds the chat lane. This is a first-class judging axis for round 1.
- **Raw JSON editor:** `@tanstack/highlight` is read-only highlighting — the editor is the classic
  transparent `<textarea>` over a highlighted `<pre>`. One shared primitive; the *write model* is
  what varies.
- **Form-route head ruling (2026-08-16):** on a form route the pickers ARE the sentence. Round 1 is
  allowed to attack this (B retires the sentence for a tree).

## Round 1 — what is the composition?

Question: **how do form, raw JSON, and tree compose as panes — and what is the raw-edit write
story?** Both write models get built; the round rules. `?variant=` on /settings, shipping surface
stays the default. All variants ride one shared fixture (`settings-panes/fixture.ts`, a real
schedule-profile-shaped document with seeded proposals/staged/attention states) declared with a
fixture chip — variants must be comparable without a live host.

| v | frame | tree | form/json | raw-edit write model |
|---|---|---|---|---|
| A | modeful document | none — file picker chains the sentence | ONE pane, form ⇄ raw mode switch (pseudo-dimension law: two readings of one coordinate set) | parse-diff → staged fields, existing save gate |
| B | IDE workbench | real left tree pane (tree IS the addressing; sentence dies) | form center + raw right, both visible, synced | whole-file save lane (stubbed, gap recorded) |
| C | annotated file | thin popover from the sentence | the raw JSON IS the page; trichotomy renders as line-anchored gutter marks/overlays; approve/deny on lines; validation issues joined to lines (fixes audit #5) | edits parse-diff to per-pointer stage/sever |
| D | embedding proof | inside each host pane | two mock host panes (family-ish, schedule-profile-ish) each embedding the kit with minimal props | whichever props are smallest — the point is the prop contract |

### Round 1 built — 2026-08-17, awaiting rulings

All four variants ship behind `?variant=` (a/b/c/d; no param = shipping surface), verified
interactive on the worktree dev server. Flip order: `a → b → c → d`.

**Builder findings worth a ruling (surfaced during the build, before any flip-through):**

1. **Positional array pointers are unstable** (C): an array element insert/delete stages a
   shift-storm of index moves rather than one semantic change. A's dodge: equal-length arrays
   diff per index, length-changed arrays stage whole. A real fix wants identity-aware array keys
   (e.g. `parameterName`) — a schema/contract question, not a UI one.
2. **Arrays-are-leaves vs recurse-by-index** (B vs shipping): the shipping surface treats arrays
   as leaf values; B's flatten recurses into them so `/fields/2/columnHeader` is a row. The fixture's
   seeded attention field only addresses cleanly under B's reading. One rule must win.
3. **The kit contract that survived two consumers** (D): stateless panes — one
   `SettingsRouteDocument` in, pointer-keyed intents out (`onApprove/onDeny/onUnstage(pointer)`),
   zero owned state. The prescribed `onChange` on the JSON pane died unearned; A/B's write models
   are what would earn it back.
4. **Chat-plugin compatibility favors parse-diff** (A, C): both keep pointer-keyed `fields` as the
   one substrate, so pea/SSE/chat stay sighted through raw edits. B's whole-file lane goes blind
   while dirty and needs a new host op (`settings.document.saveRaw`) — it renders that dishonesty
   visibly as its experiment.
5. **No outcome kind for "the page refused your input"** (A): parse refusal rides `error`/caution;
   `refused` is reserved for the model disagreeing. Possible lang gap.
6. **Missing web lanes** (D): `revit.apply.schedule` has no web path (desktop runs
   `ApplyScheduleProfile` in a transaction); "open file in default app" has no web equivalent.

## Forensics — the missing form pipeline and the dead targeting lane (2026-08-17)

User report: shipped /settings cannot open a JSON, and the schema→form generation is gone.
Suspected the design sweep. **The sweep is exonerated on both counts** — both losses predate it:

| date | commit | what happened |
|---|---|---|
| 2026-07-13 | 1647344 | settings-prototype route retired for the substrate rewrite; `lib/schema-to-field-render/` (the form renderer), `useSchemaQuery`/`useFieldOptionsQuery`/`useParameterCatalogQuery`, settings-store/validation all deleted with it |
| 2026-07-14 | f2be5c9 | `packages/schema-core` purged as "dead" — it had just lost its only consumer |
| 2026-07-17 | e88bd26 | **the dev proxy deleted** from vite.config (worktree host-takeover work): `/call`, `/pe`, `/events` … → host:5180. From then on, browsing the vite origin directly gives a dead host lane — every op 404s, pickers empty, nothing opens. Only the takeover origin worked |
| 2026-08-16 | sweep | restyled the already-gutted route; changed neither ops nor pipeline |

**The host side never lost anything.** Live probes (2026-08-17, host on 5180):
`settings.workspaces` returns the full real catalog from
`C:\Users\kaitp\OneDrive\Documents\Pe.Tools\settings` (Global, AutoTag, CmdFFDesiredMigrator,
CmdFFManager, CmdFFMigrator, CmdScheduleManager schedules+batch, FamilyFoundry);
`settings.schema` for CmdScheduleManager returns the real draft-04 ScheduleProfile schema with
`x-options` (category-names, Remote resolver, Suggestion mode) — the Revit-populated enum
machinery intact. `settings.field-options` / `settings.parameter-catalog` never left the op catalog.

**Restored on this branch (all typecheck-green, 190 files clean):**

- vite dev proxy (env-overridable target, default `http://127.0.0.1:5180`) — fixes targeting for
  every host-backed route on the plain vite origin; takeover lane unaffected.
- `packages/schema-core` (from f2be5c9^): effective-node resolution ($ref/allOf/oneOf/anyOf,
  if-then-else, dependent schemas, data-aware), defaults, ui-mapper extensions
  (labels/hints/option-sources/order).
- `apps/web/src/lib/schema-to-field-render/` (from 1647344^): field-renderer + object/array/
  scalar/table fields + custom-renderer registry + field-metadata/state; `ui/tooltip` recovered;
  `@tanstack/react-form` re-added.
- The three schema queries back in `host/queries.ts`.

**Not yet done (alignment owed): wiring the pipeline into the shipped route.** The old renderer
rendered a whole document as a form; the shipped route renders flat pointer rows with trichotomy
state. The reconnect must marry them — schema-shaped form structure, field-options-fed inputs,
trichotomy state per field. That is exactly the A/B frame question of round 2.

## Component catalogue (owed by the settings product)

From the precedent, the recovered pipeline, and round 1:

- **SettingsFormPane** — the generated form: schema-core effective nodes → field renderers
  (scalar/object/array/table), enum/suggestion inputs fed by `settings.field-options`,
  trichotomy state (StateCell) per field, owed-marker gutter. The kit's centerpiece.
- **JsonPane** — `JsonView`/`JsonEditor` over @tanstack/highlight (built, round 1); line
  decorations for trichotomy/validation joinery.
- **SettingsTreePane** — workspace→module→root→dirs→files (round-1 sketch in B/D; needs canon).
- **Option combobox** — Suggestion-mode input with custom values (x-options contract); the old
  prototype had one inside scalar-field; canon `ui/combobox` exists — reconcile.
- **Validation joinery** — issues joined to fields/lines (C proved the line form; audit #5).
- **Already canon, reused**: AddressingBar/pickers-as-sentence, StateCell, FactChip, Verb,
  OutcomeLine, ArtifactFrame, EmptyState, useVerb.
- **Open**: `ui/tooltip` was purged in the sweep's hygiene pass and is now back only for the
  recovered renderer — fold its uses onto `title`/reason idioms or re-canonize it. Decide once.

### Verdicts (owed)

_(recorded here after the user flips through — which frame won, which write model, what B/C/D
donate, what got retired. Standing user direction 2026-08-17: A and B lead — "dual mode vs
side-by-side are two ways to view the same thing"; the tree concept stays; variants must wear
the real design system, not stand-ins.)_
