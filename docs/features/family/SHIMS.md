# Family — shims, intentional gaps, harvest gates

The two family routes are the web homes of the two proven FF products:
`/families` = FFMigrator (fleet: master table → profile → plan → gated apply → receipts; projection closes the prep loop),
`/family` = FFManager (one family, lane chosen by the bound document: live .rfa vs authored family.json).
An entry leaves this file only when the replacement ships or the gap is closed.

**Lane law (locked).** `/family` is ONE route with two lanes, and BINDING IS THE CHOICE — the
lane is displayed as a chip beside the sentence, never offered as a toggle. The document slot
lists the authored `family.json` documents and, whenever the bound session's ACTIVE document is
a family document, one live entry ("the open family editor"). The AUTHORED lane is everything
that existed before: anatomy triptych, matrix, doc pane, validate, build, evidence. The LIVE
lane derives its model from `family.editor.snapshot` and renders the SAME matrix, formula
column, review/staging machinery, doc pane, and inspector — with no anatomy (a live family has
no authored constituents to draw), no build/evidence lane, and no `validate` (there is no
document to validate). CAPTURE IS THE BRIDGE: in the live lane the capture verb promotes
(`capture_evidence`'s `modelJson` → `settings create`, whose own open binds the result), landing
the user in the authored lane of the same family. That is the only crossing.

## Shims (temporary, each names its replacement)

1. **master-table duplicated from takeoff-fresh.** The takeoff atlas table (column filter chips,
   ColFilter selects, commit-on-blur cells, state column idiom) is ported into
   `apps/web/src/components/master-table/` because takeoff-fresh is not on main yet.
   Replacement: when takeoff merges, both routes consume ONE shared component; the takeoff
   atlas migrates onto this copy, not the reverse.
2. **`host.shell.open` adoption.** Generic typed op (path in, OS default app). Takeoffs'
   "Launch RHVAC" button migrates onto it when takeoff merges. Receipts in `/families`
   link artifact dirs through it.
3. **Sentence slot config is still per-call-site.** The POC's config-driven slot declaration
   (verb, accepted doc kinds, wants-family/wants-profile) is generalized only as far as the
   two family routes need. Replacement: every plugin route declares its sentence via config.
4. **Profile schema validation is web-side fail-fast only.** Stale OneDrive profiles surface
   named diagnostics in the picker, no auto-migration. If most of the library turns out
   stale, that pain is the signal to build an upgrade lane — revisit then, not before.
5. **Profile picker enumeration is unproven against a live host.** `settings.tree` DOES expose
   the profile library — `familyfoundry.plan` parses `DesiredFamilyMigrationProfile`, whose
   registration is `{ moduleKey: "CmdFFDesiredMigrator", rootKey: "profiles" }` — and the picker
   reads it plus one `settings.document.open` per entry (capped at 40) so each option carries its
   real validation issues as a `disabledReason`. None of that has been exercised against a live
   session yet; if the module turns out unreachable from the web the slot renders empty and this
   entry becomes a real gap. Replacement: the step-3 live proof below.
6. **LIVE-lane staged edits are TAB-LOCAL.** The authored lane stages into `route:settings`
   fields, which pea shares and every tab sees. The live lane has no document for
   `route:settings` to own, so `useFamilyEditorLane` keeps the SAME `FieldState` shape and the
   SAME JSON-Pointer keys in local React state (`patchFields`, exported from `family/store.tsx`,
   is the one implementation). Consequence, stated plainly: **pea cannot propose into the live
   lane** — the review trichotomy renders there, but only the human ever fills it. Replacement:
   either a `fields` map on `route:family` (a contract change, so it needs a live-proven reason,
   not a guess), or the promotion path — capture to an authored document and let pea propose
   there, which is what the capture bridge is for.
7. **`route:family-types` contracts and its pea handlers are RETAINED, deliberately.** The
   `/family-types` route is deleted, but the slice is not orphaned web state: `packages/mcps`
   registers its `parse_spec`/`refresh_snapshot`/`push` handlers in `pea/routes.ts`, the chat
   surface still renders `FamilyTypesChatPlugin` against it, and
   `packages/agent-contracts/src/family-types.ts` is the home of `specDocSchema` (imported by
   `family.ts`) and `parameterIdentitySchema` (imported by `parameter-links.ts`). Deleting the
   slice would break pea's tools for no gain, so it stays and this entry names why. Replacement:
   retire it when pea's family editing runs through the live lane's own commands.

## Intentional gaps (deliberate, not scheduled)

- **No profile editor UI.** Profiles are input/output artifacts (files); authoring is by hand
  or via projection. A profile-authoring surface is its own product decision.
- **No artifact viewer.** Bulk apply surfaces per-family receipt rows (ops run, params
  changed, diff summary, artifact dir via `host.shell.open`); the 13-artifact bundles stay
  on disk.
- **No pea proposal engine in `/families` v1.** Proposals/citations are `/family`'s trust
  layer; the fleet route's trust layer is plan provenance + receipts.
- **Grouped-cards view dropped** with `/family-matrix`; the master table's clusters + filters
  cover the audit story, and one table beats two view modes of the same facts.
- **Per-family checkbox pre-picker dropped** with `/family-matrix`. Categories + placement are the
  draft scope; narrowing to individual families is the TABLE's job (family search, column filters),
  not a second picker that competes with it. The matrix budget is still sized to the resolved
  family list, so nothing truncates silently.
- **Per-family plan flags are limited to "no actions".** `familyfoundry.plan` reports diagnostics at
  PROFILE level, not per family, so the apply gate is: clean diagnostics globally, and every
  included family has at least one lowered action. Richer per-family flags need a per-family
  diagnostic channel on the op, which is not a shim — it is a contract change if it is ever wanted.
- **`/api/pdf-audit/map` deleted, `/api/pdf-audit/parse` kept.** Proposals come from pea via
  route state; the heuristic/direct-Anthropic mapper was a placeholder.

## Harvest gates — family-types deletion checklist (CLOSED)

Every gate below is grafted or waived, so the routes are gone. Deleted: `routes/family-doc.tsx`,
`routes/family-types.tsx`, `routes/family-audit.tsx`, `routes/family-model.tsx` (already only a
redirect to `/family`), `src/family-types/`, `src/pdf-audit/`, `routes/api/pdf-audit/map.ts`,
`src/lab/kit.tsx` (its only importer was `family-types/mock.ts`), `src/lab/mock.ts` (its synthetic
table fixtures lost their final consumer; the one surviving `BBox` shape moved into `estimate.ts`),
and `src/host/family-doc.ts`
(the untyped-ish snapshot/apply adapter, superseded by `family/live.tsx`, which calls the same
two ops through the generated typed client AND carries per-edit outcomes + dryRun).

Kept, with the import-graph reason: `routes/api/pdf-audit/parse.ts` + `parse.$parseId.ts` (the
parse lane `family/doc-pane.tsx` and pea's `family-commands`/`route-state-commands` both fetch),
`src/grounded-doc/` (parse cache + types + the `/doc-lab` and `/design-system` surfaces),
`src/lab/estimate.ts` (the calibrated cell-geometry estimator `doc-pane` depends on), and the
`route:family-types` contracts + mcps handlers (shim 7 above).

- [x] `formula.ts` + `formula.test.ts` — landed at `apps/web/src/family/formula.ts` (+test).
      Param source retargeted to the authored model via `authoredFormulaParams(familyParameters,
      sharedParameters)`; the `FamilyTypesParam` dependency is gone (a local `FormulaParam` shape),
      and an authored param with no `isInstance` counts as TYPE, so the type-refs-instance law
      still applies. 15 tests (the original 12 + 3 for the retarget and ancestry).
- [x] Per-edit non-blocking `family.editor.apply {dryRun:true}` advisory check — `check` /
      `advisory` on `LiveLaneApi` (`apps/web/src/family/live.tsx`), fired from `FormulaCell`'s
      commit in `routes/family.tsx` and rendered on the SAME clay dot as the client
      validator's problems, prefixed "Revit:" so the host's verdict is named as the host's.
      LIVE lane only; the authored lane keeps the client validator + the `validate` command.
- [x] Tri-state review toggle UI (none→good→attention) — `ReviewMark` in `routes/family.tsx`,
      on every value cell AND the formula cell; writes a `review` patch beside the staged edit.
      Human edits still auto-write "good"; the toggle is how a human demotes to "attention".
- [x] Client-side push gate — `saveBlockedReason` in `routes/family.tsx` disables save with
      "nothing staged" / "N fields need attention" on the button and in the status strip. The
      route:settings `save` command stays the enforcer.
- [ ] ~~`save` ported onto `defineCommitCommand`~~ — **WAIVED.** `defineCommitCommand` has no
      async post-run hook (`stamp` is synchronous and receives neither the target nor an RPC
      caller) and abandons `ctx.setDoc` on any abort, so settings' re-open-after-write
      canonicalization and its "fold the fresh host validation in, THEN throw" path cannot be
      expressed without smuggling both into `run`, whose contract is one transaction returning
      per-key failures. The hand-rolled save stays; a whole-document write has no per-key
      failures to attribute anyway.
- [x] `acceptAll` batch verb — "accept all" button beside the open-proposal count in
      `routes/family.tsx`; stages every open proposal in one write and skips already-staged fields.
- [x] Structured commit receipt — "Saved N · M failed" in the status strip, the dispatcher
      `hint` rendered verbatim on its own line (distinct from the error text), and the Sentence
      `receipt` prop fired with "saved N fields to <doc>".
- [x] Store-seam + `?mock` — `apps/web/src/family/store.tsx` (`FamilyStore`, `useLiveFamilyStore`,
      `useMockFamilyStore`) + `apps/web/src/family/mock.ts` (a copy of the showcase family fixture
      plus two proposals with citations). `/family?mock` renders with no host, pea, or dispatcher.
      The seam covers only what `/family` reads — deliberately not a general provider abstraction.
- [x] Parameter Inspector — `apps/web/src/family/inspector.tsx`, rendered in the side area when a
      parameter row is pinned (Esc unpins). Every fact is derived client-side from the AUTHORED
      model: ancestry by tokenizing authored formulas with the validator's own tokenizer,
      associations from solids/planes/connectors/arrays/nested, identity from familyParameters vs
      sharedParameters. No new contracts, no host round trip.
- [x] `@formula`-as-a-first-class-cell — a leading `= formula` column (ahead of "family value") in
      the type matrix. A formula-backed param has an EDITABLE formula cell and locked per-type
      value cells; editing stages `/familyParameters/<name>/formula`. Client validation is
      ADVISORY: invalid-ref / cycle / type-refs-instance, plus a value-XOR-formula warning when
      the param still carries per-type values, all on a clay dot whose tooltip is the problem
      text. Nothing blocks staging — the host's validate/save is the final word.
- [x] Pin/Esc grounding focus model + measured-vs-estimated reticle distinction —
      `apps/web/src/family/doc-pane.tsx` + the focus state in `routes/family.tsx`. Hover
      grounds (`onCite`), clicking a cell's `¶N` badge PINS (`onPin` → `pinnedCite`, which
      outranks hover and survives the pointer leaving), and Esc unpins FIRST, then deselects
      the pinned parameter — one key, two steps, never both. The pane draws corner-bracket
      reticles whose style carries the provenance the box edge already carried: solid for
      parser-measured geometry, dashed for an interpolated estimate, with a "pinned · esc"
      affordance in the caption.

## Sentence harvest (from quarry/poc-2026-07 sentence-chat POC)

- [x] Family slot (`editing the open family editor — <family> in <world>`) — a `SlotSpec` on
      `/family`'s Sentence, LIVE lane only, listing `revit.catalog.loaded-families` and calling
      `family.editor.open` + re-snapshot on pick (`sentenceSlots` in `routes/family.tsx`,
      `families`/`openFamily` on `LiveLaneApi`). The world is spoken ONCE — by the sentence's
      own world clause — so neither the live document entry nor the family slot repeats it.
      `/families` fills the slot by navigation: a table row click navigates to
      `/family?family=<familyId>`, and `/family` opens that family in the bound session's
      family editor on mount. The URL is the whole handoff — no cross-route state store.
- [x] Profile slot for `/families` (`auditing <doc> against <profile> in <world>`) — built on
      `SlotSpec`; the document reads as flat text (session truth, not a picker), the profile slot
      picks from the settings library, and apply success fires the sentence receipt.
- [ ] Derivation-cost subtitles in the doc picker ("opens instantly" / "boots a 2025 world").
- [ ] Sentence-as-receipt: on commit the sentence briefly becomes
      "committed <change> on <doc> · just now", then relaxes.
- Law: the sentence carries targeting NOUNS only; the sole status exception is pea's live
  loop state as the prefix. Scope/filter state lives in table chips, never the sentence.

## Typed-ops law

Inline C# via `scripting.execute` is always a shim. This feature ships typed bridge ops from
day one: `familyfoundry.plan`, `familyfoundry.apply` (profile-in + explicit familyIds +
planHash drift echo), `familyfoundry.project`, `host.shell.open`. Live-Revit proof of the
apply lane is a step-3 gate, recorded here until run.

- [ ] Live proof: plan → apply → receipts on a sandbox project (FreshRevitProcess lane).
- [ ] Live proof: `/family`'s LIVE LANE end to end — the live document entry appearing when a
      family is open, `family.editor.snapshot` → matrix, a staged value + a staged formula
      through `family.editor.apply` (including a DELIBERATELY bad edit, to see "Saved N · M
      failed" with the failed edit still staged), the `{dryRun:true}` advisory, the family slot
      calling `family.editor.open`, `/families` row → `/family?family=<id>`, and capture →
      authored doc. **Unproven: none of it has met a live host.** The AUTHORED lane is proven
      through `/family?mock` end to end (open → edit → review → accept all → save receipt →
      inspector → doc pane), which is exactly the half that needs no host.
