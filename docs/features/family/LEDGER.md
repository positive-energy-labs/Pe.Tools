# family ledger

## Decided

- 2026-07-04 — one addressing/units/result-record language spans all four family surfaces (loaded / instance / famdoc / nested); proven 3/3 by the mutation-spike pods. Two engine seams only: family-doc reconciler vs instance setter, and geometry as a payload-envelope tenant with its own dialect.
- 2026-07-04 — front door is declarative desired-state with a small imperative verb escape hatch; parked-transaction is the substrate choreography (edits families in place, one protocol) — re-derives the MEP-round verdict independently.
- 2026-07-16 — /family is THE one-family surface (authored + live lanes); /family-model, /family-types, and the POC routes are retired. Evidence carries a `from` stamp compared against the live versionToken — stale is shown, never silently trusted.
- 2026-08-16 — product reframe: a family is two substrates, PROFILE (portable text) and LIVE (in Revit); verbs are crossings, entries are peers, no pipeline. Portability = the text file; .rfa is never the portable unit.
- 2026-08-16 — `FamilyModel` (family.json) is the ONE portable profile schema; desired-state and FFManager/FFMigrator profiles are legacy. Patch semantics (omission = unchanged, null = delete) and coverage markers grow on it; selectors stay out of the document.
- 2026-08-16 — lane law: /family is one route, two lanes, binding IS the choice (chip, never a toggle); capture is the only live→authored crossing. Pea edits the profile only; proposals are ephemeral page state, never persisted; humans own every crossing.
- 2026-08-16 — the cross-type master table is THE interface; cell-state law: name × type are the grid, provenance (proposed/grounded/live/saved) is never a column — it renders as cell states/overlays. Ghost-row law: unbound bindable geometry props render as bottom-pinned ghost rows; binding promotes them.
- 2026-08-16 — typing beats proposing: a user edit on a proposed cell severs the proposal, no accept/deny. Drift vocabulary is six states; instance params drift like any other.
- 2026-08-16 — geometry readback from live Revit is out of scope (unreliable at acceptable cost); geometry is authored-side only and reaches Revit through the foundry-grade materialize ceremony (reason + planHash refusal + receipts, never hover-height).
- 2026-08-16 — role-token color layer adopted (COLOR-ROLES.md): triangle=proposal, dot=unsaved, underline=ground/drift; pea green for proposals, pe-blue commit+focus only.
- (undated, foundry era) — shared parameter declarations are name-first: authored profiles never carry SharedGuid/Identity/DataType/Tooltip for shared params; those facts come only from resolved shared-parameter definitions. (Name-as-identity and value XOR formula live in docs/design/family-model-spec.md.)
- 2026-08-16 — drill-in settled: entry via type-column header (Esc back); pane-header capture/apply are the ONLY crossing verbs; profile right-aligns, live left-aligns, meeting at the spine; anatomy stays a collapsible pane; verb/switcher/chip promoted to ui/ primitives.
- (undated) — /family(-ies) intentional gaps, deliberate not scheduled: no profile editor UI, no artifact viewer (receipt rows + `host.shell.open` instead), no pea proposal engine in /families v1, per-family plan flags limited to "no actions"; stale profiles fail-fast with named diagnostics in the picker — an upgrade lane is built only when that pain proves recurring.

## Tried & rejected

- 2026-07-04 — file-mirror and deferred-ExternalEvent substrates: both work but weaker than parking (unmirrored families unreachable; second poll protocol). FF's own apply path is unusable from scripts for project families (EditFamily under host txn).
- 2026-08-16 — linear-steps/journey-bar UI (variant B): actively confused; sunset. Family-value column: reads as a fourth type. Inline cell approve/reject buttons: shift content; rail marker (v3) won.
- 2026-08-16 — sibling-project activation from inside the live lane: unreliable in Revit, must NEVER be attempted; honest refusal instead (future entry: open .rfa from recents).
- 2026-08-16 — schema census: `familyfoundry.project` emits a shape `familyfoundry.plan` strictly rejects — project→plan→apply never worked end to end; all 51 on-disk FF profiles already fail strict parse at HEAD, so convergence breaks nothing.
- (undated) — `save` onto `defineCommitCommand`: waived — no async post-run hook, abandons setDoc on abort; the hand-rolled save stays.

## Owed

- Restore/finish the live substrate at HEAD (variant-e promotion went fixture-only; recoverable at 4b88ba4^) and run the live-lane e2e proof: snapshot → matrix → staged edits through `family.editor.apply` (incl. a failing edit), dryRun advisory, family slot, capture → authored doc. None of it has met a live host.
- Live proof of the foundry apply lane: plan → apply → receipts on a sandbox project (FreshRevitProcess); includes proving the profile-picker enumeration (`settings.tree` + per-entry `settings.document.open`) against a live host.
- Implement FamilyModel patch semantics, then the one-shot legacy-profile converter (MechEquip/ElecEquip/PlumbEquip essential; CustomFams first); `familyfoundry.project` retarget held until then.
- Materialize-profile-onto-ONE-family op path (foundry apply with familyIds=[one] vs a new op).
- State-model gaps: grounding link table, canonical drift primitive, evidence receipt shape (capture stamps versionToken null), family-level identity drift, profile dirty fact.
- `family.editor.apply` concurrency guard (snapshot-token echo), designed after the drift vocabulary — must speak the same agreement language the UI renders.
- Known live-lane defects: `family.editor.open` ProjectOnly vs FamilyOnly need; out-of-range commit failure indexes; rebuild-to-same-path Conflicts; validate tooltip claims SAVED but splices staged.
- Shims to retire: `route:family-types` contracts/handlers (when pea runs through live-lane commands); tab-local live staged edits (pea can't propose into the live lane); per-call-site sentence slot config; `host.shell.open` adoption by takeoffs.
- FF ParamDrivenSolids apply collapses per-type values of bound params — fix before relying on it.
- Product-lane gap from the mutation spike: no script primitive to target a specific project doc for writes (or a no-txn permission mode); dominant campaign cost, blocks concurrent agents.
- Round-4 builder friction: ghost literal's column home, ghosts in drill-in, bind-to-existing value preview, silent empty-commit refusals; whole-app role-token sweep.
- /families UX revisit (separate exercise); derivation-cost subtitles in the doc picker.
