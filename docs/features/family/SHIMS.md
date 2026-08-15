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

## Intentional gaps (deliberate, not scheduled)

- **No profile editor UI.** Profiles are input/output artifacts (files); authoring is by hand
  or via projection. A profile-authoring surface is its own product decision.
- **No artifact viewer.** Bulk apply surfaces per-family receipt rows (ops run, params
  changed, diff summary, artifact dir via `host.shell.open`); the 13-artifact bundles stay
  on disk.
- **No pea proposal engine in `/families` v1.** Proposals/citations are `/family`'s trust
  layer; the fleet route's trust layer is plan provenance + receipts.
- **`/api/pdf-audit/map` deleted, `/api/pdf-audit/parse` kept.** Proposals come from pea via
  route state; the heuristic/direct-Anthropic mapper was a placeholder.

## Harvest gates — family-types deletion checklist

`/family-types` (and `pdf-audit` local store, `/family-audit`, `/family-doc`) are deleted
only when each item below is grafted into `/family` or explicitly waived here:

- [ ] `formula.ts` + `formula.test.ts` — client-side Revit formula validator (invalid-ref /
      cycle-with-draft-spliced / type-refs-instance), ported wholesale, param source retargeted.
- [ ] Per-edit non-blocking `family.editor.apply {dryRun:true}` advisory check.
- [ ] Tri-state review toggle UI (none→good→attention) per cell.
- [ ] Client-side push gate with human-readable blocked reason (server stays the enforcer).
- [ ] `save` ported onto `defineCommitCommand` (per-key failure attribution,
      failures-stay-staged, dedupe) replacing the hand-rolled all-or-nothing save.
- [ ] `acceptAll` batch verb.
- [ ] Structured commit receipt in UI ("Pushed N · M failed") + verbatim dispatcher `hint`
      as a distinct teaching channel.
- [ ] Store-seam + `?mock` provider implementing the same store interface.
- [ ] Parameter Inspector (formula ancestry, associations, ParameterIdentity badge) and the
      snapshot fields that feed it.
- [ ] `@formula`-as-a-first-class-cell idiom (formula column) reconciled with /family's
      value-XOR-formula law.
- [ ] Pin/Esc grounding focus model + measured-vs-estimated reticle distinction in the doc pane.

## Sentence harvest (from quarry/poc-2026-07 sentence-chat POC)

- [ ] Family slot (`… <family> from <doc> <world>`), conditional on doc kind; `/families` →
      `/family` navigation is filling this slot.
- [ ] Profile slot for `/families` (`auditing <doc> against <profile> in <world>`).
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
