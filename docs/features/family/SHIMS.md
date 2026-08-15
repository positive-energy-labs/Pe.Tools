# Family — shims, intentional gaps, harvest gates

The two family routes are the web homes of the two proven FF products:
`/families` = FFMigrator (fleet: master table → profile → plan → gated apply → receipts; projection closes the prep loop),
`/family` = FFManager (one family, lane chosen by the bound document: live .rfa vs authored family.json).
An entry leaves this file only when the replacement ships or the gap is closed.

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
5. **`familyfoundry.*` is dialled dynamically from the web.** `apps/web/src/host/familyfoundry.ts`
   hand-mirrors the `FamilyFoundryHostContracts.cs` DTOs and calls `plan` / `apply` / `project`
   through `callHostDynamic`, because the checked-in typegen output does not carry them yet.
   Every function names the generated client that replaces it; `/families` marks each backed
   surface with a dashed `seam` chip. Replacement: a codegen run against a live host catalog.
6. **Profile picker enumeration is unproven against a live host.** `settings.tree` DOES expose
   the profile library — `familyfoundry.plan` parses `DesiredFamilyMigrationProfile`, whose
   registration is `{ moduleKey: "CmdFFDesiredMigrator", rootKey: "profiles" }` — and the picker
   reads it plus one `settings.document.open` per entry (capped at 40) so each option carries its
   real validation issues as a `disabledReason`. None of that has been exercised against a live
   session yet; if the module turns out unreachable from the web the slot renders empty and this
   entry becomes a real gap. Replacement: the step-3 live proof below.

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

## Harvest gates — family-types deletion checklist

`/family-types` (and `pdf-audit` local store, `/family-audit`, `/family-doc`) are deleted
only when each item below is grafted into `/family` or explicitly waived here:

- [x] `formula.ts` + `formula.test.ts` — landed at `apps/web/src/family/formula.ts` (+test).
      Param source retargeted to the authored model via `authoredFormulaParams(familyParameters,
      sharedParameters)`; the `FamilyTypesParam` dependency is gone (a local `FormulaParam` shape),
      and an authored param with no `isInstance` counts as TYPE, so the type-refs-instance law
      still applies. 15 tests (the original 12 + 3 for the retarget and ancestry).
- [ ] Per-edit non-blocking `family.editor.apply {dryRun:true}` advisory check.
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
- [ ] Pin/Esc grounding focus model + measured-vs-estimated reticle distinction in the doc pane.

## Sentence harvest (from quarry/poc-2026-07 sentence-chat POC)

- [ ] Family slot (`… <family> from <doc> <world>`), conditional on doc kind; `/families` →
      `/family` navigation is filling this slot.
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
