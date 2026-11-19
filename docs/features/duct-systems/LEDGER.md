# Duct systems ledger

## Decided

- 2026-11-16, MAP D9, kaitpw: "duct-systems". Product, folder, route id and Work key use that name. Old ducts Work is set aside with one notice, without migration.
- 2026-11-16, MAP Q7, kaitpw: "probably the chosen fans loss". Shared trunks show each fan's own priced loss, never a sum or an invented owner; R-SHARE uses combined airflow, and selection chooses the highlighted paths.
- 2026-11-16, MAP L2-4: network health and heal work without a fan. Unpriced systems ask the person to rule a fan to price the system; tree, bars and encodings consume fan results.
- 2026-11-17, RULES.md owner-queue item 8, kaitpw: "yes, layer by layer through the shared base; products talk only through contract." The shared ducts base exposes declared exports, downward dependencies hold, and peers meet through contract. See ADR 0046.

- 2026-11-03, the owner said, “neither should b allowable. we must prevent backflow. and it should be rendered.” Show both backflow layout checks and prevent the two disallowed layouts.
- 2026-11-17, the owner said, “very well said. yes partial should be the way.” Label known shared-trunk values as partial and withhold certified pressure and normalized bars until both paths are complete.
- 2026-11-19, the owner approved the recommendation with “i take your rec on everything else”. Offer a cap only when Revit reports zero airflow at the open end and the rest of the system is well connected. Tell the engineer to check the flow in Revit when it is unknown.
- 2026-11-19, the owner confirmed that the 2.6-inch gap at MUAS-1 is intended because the intake comes out of the Greenheck plenum.
- 2026-11-19, the owner approved “i take your rec on everything else” for the pricing contract. A pricing read reports the parameter names it actually used under `effective`. `cb1f9a16`.

- 2026-11-19, the owner said, “id rather get this fixed now tho, code is the spec, and i dont wanna make that defect look like a product decision”. Write to Revit on /duct-systems saves staged rule tables and ignore verdicts across all systems in the model. The save leaves fittings untouched. `facd0d5f` and `cb9e1599`.
- 2026-11-19, a Fans plan that would write a fitting coefficient from an unsaved table refuses before writing. It names the rule and tells the person to save it on /duct-systems. A Fans write leaves the model's duct rules and verdicts unchanged. `facd0d5f` and `cb9e1599`.
- 2026-11-19, saving duct rulings preserves a deliberately blank required-pressure setting and records only parameter names the person chose. `02ff7bbe`.
- 2026-11-19, only the /duct-systems save creates a stored duct rule. A fitting write changes the fitting's coefficient without creating the rule. `56154bc3`.

## Tried & rejected

- 2026-11-16, MAP D2, kaitpw: "yes d2, delete". Do not restore the circuits chain or its five Pea projections as a second system-pricing authority.
- 2026-11-16, MAP separate-producer boundary: meetup design checks C1, C2 and C3 are separate from structural backflow C4; the fan calc cutover does not certify them.

## Owed

- MAP D4: review the retained repair modules fan-assignment, unit-roles, topology, issues, bins, readiness, system-scope, system-search and assessment. The old drop list was not a dead-code census; retain real repair consumers, and verify offeredFan and fansOwedBase are absent.
- MAP D8: decide how document-wide panes behave when acquisitions are per system. Moving the page does not settle that scope decision.
- MAP decision log, CONVERGENCE M13: implement separate checks C1 (ERV fresh air off MUAS discharge), C2 (ERV supply downstream of AHU) and C3 (exhaust before fresh air on a return trunk).
- Witness partial shared-trunk values on a real model with Fans, then check the completed result on both routes. Chadds duct 6532079 did not occur on both computed paths in the earlier drive. [FANS-DRIVER-CHADDS-SHARED, owner-queue item 9]
- MAP L2-4 and deletion criteria: finish the real Chadds tree/bar/encoding and no-fan drives before calling the cutover accepted.
- P4-fix-seams, implementor instruction 2026-11-17: product-specific preflight and write selection remain in generic admission.ts and slots/sheet.ts. Their removal must shrink the name baseline under [shared-base name cleanup](../ducts/LEDGER.md#owed); see the [shared-base ruling](../ducts/LEDGER.md).

- Decide where a person accepts the inferred MUAS-1 join on Chadds and give that person a way to complete it. On 2026-11-16 the owner said, “ideally on fans, but if this if its convoluted then it can b an occam cut and a is ok”. The [Fans link](../../../ts/products/fans/web/src/calc/closer.ts) goes to the [duct-system inbox](../../../ts/products/duct-systems/domain/src/inbox-rows.ts), where the inferred join currently has no acceptance action. [W-duct-systems-07-005, W-fans-02-062, W-fans-04-080]

- Use the same resolved design friction and source in Settings, the network picture, and the equivalent-length readout. Recheck the sizing wheel and worksheet against the same duct and flow. [W-duct-systems-06-164, W-duct-systems-07-015, W-fans-01-126]
- Decide whether system status and loss bar popovers should open on hover, then give the two controls one readable interaction. [W-duct-systems-01-047]
- Check the worksharing borrow footprint before offering Apply for Heal or Assign Fan. [W-duct-systems-05-139]
- Validate the rectangular straight-collar and round converging junction rules against applicable tables. Keep a fitting outside the table's range visibly unpriced until an applicable rule or verified drop is available. [W-duct-systems-03-050, W-duct-systems-03-055, W-duct-systems-06-116, W-duct-systems-06-162, W-fans-01-003]
- Check the stock damper placeholder even when the scoped read contains only one damper in its family. [W-duct-systems-06-161]
- Make a fallback terminal drop of zero show its evidence and require confirmation when the model and catalog provide no drop. [W-duct-systems-03-028]
- Require a named writable terminal drop parameter in the native write path when the next calculation reads only a named slot. [W-duct-systems-07-066]
- Trace candidates at equipment connections through the planner and native Heal. Give the engineer the same answer about whether a join can be repaired at both steps. [W-duct-systems-02-050, W-duct-systems-05-030]
- Make a side tap that the pressure walk can use appear in Heal when the same repair is feasible. [W-duct-systems-03-107]
- 2026-11-19, once the page can withdraw a stored fitting rule, verify its removal on the next model read and check separately what happens to coefficients already written to fittings. [W-duct-systems-06-108, W-duct-systems-07-011]
- Preserve drawing assignments and links through a harmless network group change or system rename. Use a stable system identity in place of its display name where the route binds it. [W-duct-systems-04-027, W-duct-systems-05-022]
- Count shared network coverage once in a document-wide read. [W-duct-systems-03-043]
- Keep the active system consistent between the host reading and the picture when several systems are open. Define what happens to the active system on selecting All. [W-duct-systems-02-149, W-fans-01-036]
- Reject parameter names that become empty after trimming on both duct calculation routes. [W-duct-systems-07-069, W-fans-05-084]
- Preserve Revit's full element identity across the JavaScript wire for IDs beyond its safe integer range. [W-duct-systems-07-016]
- Require explicit slot provenance in pricing reads, and show the actual source of a default in the repair review. [W-duct-systems-06-011, W-duct-systems-07-010]
- Check the drawing order of selected ducts against translucent context and equipment boxes. [W-duct-systems-02-032, W-duct-systems-02-061]
- Use the same airflow formatting in the field and picture, with enough precision to explain the calculated path value. [W-duct-systems-04-136]
- Make the pressure proof's stated airflow match the exact parameter write it exercises. [W-duct-systems-06-088]

### Carried from the 2026-11-19 census

- Replace non-null assertions with checked presence or types that establish the invariant, and lower the per-file nonNull allowance as each caller changes. The [guard baseline](../../../ts/tests/repo-guards/src/health.baseline.json) records the file allowances. [owed-20261119 duct-systems-non-null, 13 items]
- Prove the shared airflow and pressure calculation through complete and partial states on a genuinely connected pair. Match the picture, tree, source, requested flow and per-piece loss evidence, including an unfinished path and a saved write. [owed-20261119 duct-systems-shared-airflow, 10 items]
- Drive Pea picture selection in a browser bound to a real Revit document. [owed-20261119 duct-systems-1-010, 1 item]
- Make model binding and network reads preserve the intended duct system, geometry and provenance. Measure acquisition and retained snapshot cost on the stated Chadds scopes and test reconnects, cache freshness and transitions between open systems. [owed-20261119 duct-systems-network-topology-and-reads, 29 items]
- Resolve the diagnostics behind 1 guarded check suppression in ts/products/duct-systems/web/src/screen/rulings.tsx and ratchet the allowance down. [owed-20261119 tooling-3-080, 1 item]
- Explain what happens to saved calculation Work when the engineer discards the Revit document's changes. Offer priced open-end repair proposals and gate actual geometry changes on a reviewed plan. Support named equipment-to-equipment route queries across disconnected islands with explicit gaps. Witness Assign Fan undo, redo, save and reopen on a copy independently of the Heal proof. Report all qualifying inline parts in duct order or explicitly report ambiguity when a single run hosts several. Measure cap setback across real cap families before using one measured setback as a general tolerance. Measure repeated native reads in bridged-join acquisition and batch frontier seeds if the bounded rounds are slow. Carry existing native network health findings through Heal and compare the delivered findings against current native reads. [owed-20261119 duct-systems-network-repair-1, 8 items]
- Make the duct system picture and controls explain which legs, repairs and systems are active. Verify the view keeps its intended scope, displays partial or refused states honestly and allows the modeller to find the correct row or geometry. [owed-20261119 duct-systems-network-picture-and-controls, 19 items]
- Keep fitting and criterion choices aligned between calculation, review, saved project and firm settings, and Revit readback. Show the selected source and which changes are only staged, and verify affected shared trunks, fit rules and partial values after reload. [owed-20261119 duct-systems-network-pricing-and-persistence, 17 items]
- Make the external-fixture skip visible and decide whether this gate requires a retained fixture. Give Fans and Duct Systems plans independent custody while still invalidating either plan when a shared dependency changes. Reconcile the overlapping contract edits when the save branch is integrated with the Fans changes. [owed-20261119 duct-systems-duct-system-behavior-1, 3 items]
- Give the criterion test an independent price expectation instead of echoing its supplied payload. Provide a working route fixture for the old document-gated Ducts demo and redrive the affected journeys after the fixture repair. [owed-20261119 duct-systems-duct-test-fixtures-1, 3 items]
- Build and drive a current illustrated Duct Systems tutorial from the bound model, retaining useful legacy topology coverage, shareable focused cases and explanations of the single fan-pricing path. Bring the parked named scene lenses and Fans setting to the owner for their own reviews. [owed-20261119 duct-systems-1-088, 7 items]
- Verify a named writable terminal-drop slot and document binding and readback on the Chadds louver and grille family. [owed-20261119 duct-systems-1-093, 2 items]
- Redrive the named filter chassis and fan-coil proximity issue on the original ports. Verify with a real positive-pressure tie-in that the picture shows the structural backflow finding even while the worksheet explains the separate H5 pressure consequence. [owed-20261119 duct-systems-fan-sheet-1, 2 items]
- Seal the same bound document and resolved input basis across acquisition, worksheet, preview and apply. [owed-20261119 duct-systems-1-120, 1 item]
- 2026-11-19, drive the /duct-systems save and the Fans refusal on a real model copy. Check the save across systems, then stage and discard another table and verify the stored rule, fitting coefficients and receipt by independent readback. [owed-20261119 fans-1-077, 1 item]
- Give inferred taps and split segments stable identities across refresh, pricing and write review. Witness the compact repair row's model name and one-click preview on Chadds. Prove in Revit that the native Heal preview refuses a cap on EX 1's only flowing discharge. Prove the native Heal post-check rejects added harm on an already poorly connected RA 37 network. Census facing gaps on Chadds before extending auto-join or cap-tap acceptance beyond the measured case. Apply the owner's niche-case rule after the census. Check the owner-approved cap eligibility rule on the two RA 37 stubs, whose side taps must retain a path. Drive the sealed Heal review on a disposable Chadds copy without a local plan. Confirm it shows the actual plan, the visible join action and both requested ends without the earlier `flatMap` failure. [owed-20261119 duct-systems-network-repair-2, 11 items]
- 2026-11-19, drive the intended Greenheck plenum join on a disposable Chadds copy. An earlier Heal plan offered a cap for connector `14122436:1`. Check what Heal offers under the new cap rule and confirm that the repair restores the fan's path and changes only the intended geometry. [owed-20261119 fans-1-103, 1 item]
- Decide whether duct-end intent needs an interoperable Revit parameter, and choose its author and write behavior if it does. [owed-20261119 duct-systems-1-195, 1 item]
- Resume the owner's paused verification using the named duct scenarios with evidence ready for their judgment. [owed-20261119 duct-systems-1-228, 1 item]
- Drive real duct membership and stale or unacknowledged recovery in the browser. Drive conversation switching and Write arming through the route disruption journey. [owed-20261119 duct-systems-route-disruption-1, 2 items]
- Give the tests typed fixtures or checked constructors where they now assert a type, and lower each file's test-cast allowance once the test expresses the same witness. The [guard baseline](../../../ts/tests/repo-guards/src/test-casts.baseline.json) records the file allowances. [owed-20261119 duct-systems-test-casts, 8 items]

- 2026-11-19, decide whether Fans may write required pressure calculated with an unsaved rule. A hand-driven Fans write selects no fitting rule for its write scope. Pea can name a rule and request a coefficient write.
- 2026-11-19, give the person a way to withdraw a stored rule from the page. Today the person can save a replacement table. A fitting keeps its old coefficient until a Fans write names that rule again.
- 2026-11-19, decide how to handle catalogue links and rule assignments in the pending count. They can keep the count above zero after a save because the save leaves them staged.
