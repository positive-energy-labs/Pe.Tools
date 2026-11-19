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
- 2026-11-19, the owner approved “i take your rec on everything else” for naming the parameter names actually used in a calculation `effective` in the pricing contract.

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
- Prove that withdrawing an older fitting rule removes its saved effect on the next model read. [W-duct-systems-06-108, W-duct-systems-07-011]
- Preserve drawing assignments and links through a harmless network group change or system rename. Use a stable system identity in place of its display name where the route binds it. [W-duct-systems-04-027, W-duct-systems-05-022]
- Count shared network coverage once in a document-wide read. [W-duct-systems-03-043]
- Keep the active system consistent between the host reading and the picture when several systems are open. Define what happens to the active system on selecting All. [W-duct-systems-02-149, W-fans-01-036]
- Reject parameter names that become empty after trimming on both duct calculation routes. [W-duct-systems-07-069, W-fans-05-084]
- Preserve Revit's full element identity across the JavaScript wire for IDs beyond its safe integer range. [W-duct-systems-07-016]
- Require explicit slot provenance in pricing reads, and show the actual source of a default in the repair review. [W-duct-systems-06-011, W-duct-systems-07-010]
- Check the drawing order of selected ducts against translucent context and equipment boxes. [W-duct-systems-02-032, W-duct-systems-02-061]
- Use the same airflow formatting in the field and picture, with enough precision to explain the calculated path value. [W-duct-systems-04-136]
- Make the pressure proof's stated airflow match the exact parameter write it exercises. [W-duct-systems-06-088]
