# family ledger

The family cluster: `/family` (THE one-family surface, authored + live lanes), `/families` (the
fleet lane — the `MasterTable` audit of every loaded family × every parameter), and
`ParamDrivenSolids` (the authored solid-geometry contract in `source/Pe.Revit.FamilyFoundry`).
Portable-profile schema: [family-model-spec.md](family-model-spec.md). Live-proven Revit API
behaviour: [GROUNDING-REVIT.md](GROUNDING-REVIT.md).

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
- 2026-08-16 — role-token color layer adopted (was `docs/design/COLOR-ROLES.md`, deleted 2026-08-17 — the laws now live in the `design-lang.css` header and the `/design-system` route; the doc survives in git history): triangle=proposal, dot=unsaved, underline=ground/drift; pea green for proposals, pe-blue commit+focus only.
- (undated, foundry era) — shared parameter declarations are name-first: authored profiles never carry SharedGuid/Identity/DataType/Tooltip for shared params; those facts come only from resolved shared-parameter definitions. (Name-as-identity and value XOR formula live in [family-model-spec.md](family-model-spec.md).)
- 2026-08-16 — drill-in settled: entry via type-column header (Esc back); pane-header capture/apply are the ONLY crossing verbs; profile right-aligns, live left-aligns, meeting at the spine; anatomy stays a collapsible pane; verb/switcher/chip promoted to ui/ primitives.
- (undated) — /family(-ies) intentional gaps, deliberate not scheduled: no profile editor UI, no artifact viewer (receipt rows + `host.shell.open` instead), no pea proposal engine in /families v1, per-family plan flags limited to "no actions"; stale profiles fail-fast with named diagnostics in the picker — an upgrade lane is built only when that pain proves recurring.

### Fleet lane (`/families`)

- 2026-08-16 — the plan verdict (`unplanned` / `outside profile` / `no actions` / `excluded` / `included` / `applied` / `failed`) is a ROW-level pipeline verdict, not a value's pseudo-dimension: only 1 of 7 words maps to a cell axis, so rendering them on the cell grammar would show six distinct states as "clean". it is a second legitimate column form, not a shim awaiting `StateColumn.word`. R5 then landed this as the typed `verdict:` clause on `MasterTable` and deleted the string-typed `stateColumn` renderer.
- 2026-08-16 — verdict tones ride the meaning band only: `--r-done` applied, `--r-alarm` failed, `--r-caution` included (queued actions are unsaved work), `--r-ink-mute` for the four quiet words. Commit blue deliberately NOT spent on `included` — the one filled blue belongs to the verb that writes.
- 2026-08-16 — derived/formula-driven cells dropped OFF the meaning band to `--r-ink-2` rather than land on a wrong role; `--r-done` is wrong (a formula does not *land*, it *computes*) and `cap: "readonly"` is a claim about the user, not the number. R4 then ruled derived is not a state — no `--r-derived`, ever.
- 2026-08-16 — outcome kind is DERIVED from the payload (`applyData?.refused ? "refused" : "error"`), never a maintained flag; `useVerb.fail(kind, text)` (R12) is the `lib/` half of the "outcomes are orphans" fix.
- 2026-08-16 — the head collapses to ONE rail in fixed order: route name as chrome · addressing sentence (clickable nouns, receipt replaces it briefly) · machine-measured `FactChip`s in rank order freshness→dirtiness→seam · the ONE verb whose blast radius is the whole page · fixture/seam chip right-aligned. A verb acting on one pane belongs in that pane's strip; anything that does not fit the five slots has a better home. `/families` recomposed onto `AddressingBar` — `apply` on the rail, `plan` and `project → profile` into the table strip.
- 2026-08-16 — `EmptyState` requires `story: "scope" | "filter"` and `exit` as constructor arguments, the same enforcement that makes `Verb.reason` work; 12 `/families` empties migrated, both `EMPTY_CLASS` constants deleted at zero consumers.
- 2026-08-16 — the two typed-but-unproven bridge ops wear `FactChip dashed`; the unbound/ghost states on this route deliberately do NOT (dashed is reserved for SEAM — design-system ledger, R13b).

### Authored solid geometry (`ParamDrivenSolids`)

- 2026-08-17 — the `ParamDrivenSolids` contract semantics (one public authored/serialized shape, semantic shape-specific authoring, runtime-only compiled plan, reference-plane-preferred sketch placement, deterministic name synthesis, normalized rectangle orientation, honest reverse-inference ambiguity, validate-before-mutate, independently testable seams) were distilled 2026-08-17 from the deleted `_GOALS.md` (authored 2026-04-06) and now live as doc-comments at their seams: `AuthoredParamDrivenSolidsSettings` (Models.cs), `ParamDrivenSolidsPlan` (Plans/), `AuthoredParamDrivenSolidsCompiler.Compile` (Resolution/), `ParamDrivenSolidsSnapshotCollector` (Capture/). Code is the spec; do not re-home them here.

## Tried & rejected

- 2026-07-04 — file-mirror and deferred-ExternalEvent substrates: both work but weaker than parking (unmirrored families unreachable; second poll protocol). FF's own apply path is unusable from scripts for project families (EditFamily under host txn).
- 2026-08-16 — linear-steps/journey-bar UI (variant B): actively confused; sunset. Family-value column: reads as a fourth type. Inline cell approve/reject buttons: shift content; rail marker (v3) won.
- 2026-08-16 — sibling-project activation from inside the live lane: unreliable in Revit, must NEVER be attempted; honest refusal instead (future entry: open .rfa from recents).
- 2026-08-16 — schema census: `familyfoundry.project` emits a shape `familyfoundry.plan` strictly rejects — project→plan→apply never worked end to end; all 51 on-disk FF profiles already fail strict parse at HEAD, so convergence breaks nothing.
- (undated) — `save` onto `defineCommitCommand`: waived — no async post-run hook, abandons setDoc on abort; the hand-rolled save stays.
- 2026-08-16 — (/families) a shared `EMPTY_CLASS` constant instead of a component: consistent-looking but nothing enforces the `title` and nothing separates "nothing in scope" from "filtered to nothing". Superseded by lang `EmptyState`.
- 2026-08-16 — (/families) migrating type-override cells onto the editable `StateCell`: an override-less cell would render EMPTY, claiming "no value" where the cell resolves to the authored one — a confident wrong statement. Left on `ProposedCell` + `TextCell`.
- 2026-08-16 — (/families) route title `FAMILIES` in `--clay-ink` (= `--r-alarm`) and the `included` dot in `--pe-blue` (= `--r-commit`): straight hue-law violations, not language gaps; both moved to neutral ink / caution rank. Reserved colours exist to make these findable.
- 2026-08-16 — (/families) forked `Verb` copy in `routes/families.tsx` deleted: it made `reason` optional and so shipped refusals with no explanation.

## Owed

- Restore/finish the live substrate at HEAD (variant-e promotion went fixture-only; recoverable at 4b88ba4^) and run the live-lane e2e proof: snapshot → matrix → staged edits through `family.editor.apply` (incl. a failing edit), dryRun advisory, family slot, capture → authored doc. None of it has met a live host.
- Live proof of the foundry apply lane: plan → apply → receipts on a sandbox project (FreshRevitProcess); includes proving the profile-picker enumeration (`settings.tree` + per-entry `settings.document.open`) against a live host.
- Implement FamilyModel patch semantics, then the one-shot legacy-profile converter (MechEquip/ElecEquip/PlumbEquip essential; CustomFams first); `familyfoundry.project` retarget held until then. SavedEquip is retained for its hand-extracted parameter tables — do not delete its profiles even where strict parse fails.
- Materialize-profile-onto-ONE-family op path (foundry apply with familyIds=[one] vs a new op).
- State-model gaps: grounding link table, canonical drift primitive, evidence receipt shape (capture stamps versionToken null), family-level identity drift, profile dirty fact.
- `family.editor.apply` concurrency guard (snapshot-token echo), designed after the drift vocabulary — must speak the same agreement language the UI renders.
- Known live-lane defects: `family.editor.open` ProjectOnly vs FamilyOnly need; out-of-range commit failure indexes; rebuild-to-same-path Conflicts; validate tooltip claims SAVED but splices staged.
- Shims to retire: `route:family-types` contracts/handlers (when pea runs through live-lane commands); tab-local live staged edits (pea can't propose into the live lane); per-call-site sentence slot config; `host.shell.open` adoption by takeoffs.
- FF ParamDrivenSolids apply collapses per-type values of bound params — fix before relying on it.
- pin as test: `ParamDrivenSolids` execution REFUSES unresolved or ambiguous inferred constraints (compile emits an Error diagnostic and `ParamDrivenSolidsPlan.CanExecute` is false) — the contract is asserted only by prose today.
- Product-lane gap from the mutation spike: no script primitive to target a specific project doc for writes (or a no-txn permission mode); dominant campaign cost, blocks concurrent agents.
- Round-4 builder friction: ghost literal's column home, ghosts in drill-in, bind-to-existing value preview, silent empty-commit refusals; whole-app role-token sweep.
- /families UX revisit (separate exercise); derivation-cost subtitles in the doc picker.
- Geometry metadata exposure (round-3.5, user-flagged 2026-08-16): the mocks flattened geometry to prose and the original route was already thin here. Required: editing a geometry constituent's metadata AND its parameter associations. Ghost-row law covers the param-BINDABLE properties; NON-bindable properties (direction, orientation, systemType, flowDirection, frame) want constituent focus → sidebar inspector editing, composed with the one-focus law. Fixture needs structured constituents (not strings) plus at least one unbound bindable dim.
- Saved/unsaved conveyance is still open (the cell-state law fixed the other three overlays): candidates are a per-cell unsaved marker + the header dirty fact.
- Live-values overlay: whole-table toggle that visually replaces draft values (the LIVE column dies); drift must stay legible per cell under the overlay. Unbuilt.
- Confirm nothing in `/families` still borrows `fresh: "unverified"` to mean "not started" — R2 ruled a `fresh: "never"` rung in and `/families` was ruled-discharged by riding the `verdict:` column instead. (verify)
- Two `/families` bridge ops are typed but never live-proven (the dashed seam chips are the standing admission).
- Phase-D 2026-08-17: `ArmingState.refused` wants `refusals: {code, says}[]` not one string; ArmingStrip owes a `building` in-flight phase and an unknown-outcome phase (an `ok` with no rfaPath is neither success nor refusal); refused-phase exit is hardcoded to `re-plan` and wants `exit: {label, onExit}`; "capture live" (a read) collides with "capture all" (a crossing); arming survives drill-in but cannot be initiated there — wants a ruling.
- Phase-C 2026-08-17: the dash law needs an explicit annotation scope (parts may dash only for void; datums and leaders are a different register); reference planes have no taxonomy rung (a hairline is a SEAM spend, not an identity); frames and the room point have no focus vocabulary (`Focus` is `param | part` only).
