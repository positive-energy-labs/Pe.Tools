# Pea duct identification and repair tests, 2026-10-26

Pea can recover useful duct diagnoses from vague system names and apply caps. It does not repair the equipment connection that prevents the makeup-air path reaching FC-23. The shipped instructions explicitly reserve that geometry repair, fan assignment, and airflow-slot staging for the engineer. This run exposed that product boundary, not an inability to write a repair script. No product code was changed.

## Method and boundary

The prompts used the normal `pea --prompt` product door with its default Claude provider. The returned model was `opus`; the event stream identifies `claude-opus-5-5`. No internal diagnosis or element ids were supplied to Pea. Follow-ups stayed in the same Pea conversation. The driver used this checkout's source CLI because the global `pea` shim resolved to a checkout with missing dependencies.

The initial session was the existing controlled dev session `pe.app-25`, PID `27012`, payload stamp `965bd2ed5832`. Initial prompts allowed reads only. Repair follow-ups explicitly requested previews and allowed tool permissions. The actual-write case used a separate controlled dev snapshot `acc-pea-ducts-copy-20261026`, PID `6964`, with a detached copy of a saved Project A model and an isolated product home and host. It never authorized saving or syncing.

These are headless operator tests, not successful selected-picture tests. A browser opened on `/ducts` reported `no document bound` and no reading in 30 seconds, including after an explicit session target. It was closed. Pea also reported no mounted view for its conversation. Shared visual attention remains UNPROVEN. Pea received the product world and discovered its tools, but did not receive a working selected browser picture.

The checkout was `0b40c293dea1c9ef83f09ff3f44c5980b0beac08` with pre-existing edits, including Ducts and context files. The existing session retained its own loaded stamp. The snapshot built a separate payload. These are observations of those running bytes, not certification of a clean commit or installed release.

## Completed prompts

| Case | Input | Observed result |
|---|---|---|
| SA 29, first attempt | `look at SA 29, something is weird where all those systems meet. can you figure out what is going on? just look for now` | Timed out at 240 seconds. Pea downloaded a 61,901,787-byte analysis artifact and used shell/Python to inspect it. No final diagnosis or repair. |
| SA 29, continuation | `any luck? what is actually wrong with it` | Found FC-5's disconnected return inlet, the shared riser `6530455`, the two-outlet FA 42 takeoff `9896162`, and detached grille `6508741`. Distinguished repair facts from decisions about the intended ERV layout, although its short-circuit explanation remains an engineering hypothesis. |
| SA 29, repair | `ok fix what you can and show me whats still wrong. preview it first, dont write to revit yet` | Executed rolled-back native heal and fan-assignment previews. Reported 17 caps and FC-5 assignment. Left the equipment/filter size mismatch and grille/drop size mismatch to the user in Revit. Did not propose the airflow-source change. No solved ESP. |
| SA 19 and MUAS / FC-23 | `how bad is sa 19 and the one with the muas one and i think its fc-23. just look for now` | Distinguished SA 19 from FC-23's SA 20, found MUAS-1 on FA 12 and the shared return-side network, and identified missing flow coverage under the configured slot. Explained that zero ESP represented an incomplete calculation. |
| SA 19 and MUAS / FC-23, repair | `ok fix what you can then show me whats still wrong. preview only for now` | Executed a rolled-back preview of 9 caps. Revit still reported SA 19 and SA 20 not well connected, without critical paths. Pea asked for approval to apply caps. It did not repair the equipment return or complete the calculation. |

The two preview requests overlapped on the original host. The MUAS preview received busy refusals twice and then completed. This contention was introduced by the test driver. It demonstrates recovery under contention, not a clean standalone latency result. Actual mutation testing was isolated and sequential.

## Actual repair on a copy

Pea conversation `87bb8a77-53ae-42a9-811d-4d297a39b16f` received: `in ProjectA-test_detached, what is the deal with the makeup air for muas one and fc-23? fix what you can and show me whats still wrong. this is a disposable test copy so you can make the changes, dont save or sync it`.

Pea traced the intake plenum, MUAS-1, DS-1, SH-2, FA 12 takeoff, RA 37 trunk and FR-1, then found the open FC-23 return. Its first rolled-back write was refused because the document was not in the conversation's scope. The driver attached only the exact disposable open document through the public scope door, preserving Guarded access, and replied: `its attached now. go ahead and fix what you can, dont save or sync the copy. show me what actually changed and whats still broken`.

Pea previewed and applied four SA 20 caps. Independent native reads confirmed new caps `13006820`–`13006823`, each connected to its intended duct `8733833`, `8733980`, `8734004`, or `8734043`. None of the original snapshot's duct-network elements was missing afterward. This establishes real model mutation. It does not establish that capping those branches was the engineer's intended design. The three checked systems still had no base equipment and were not well connected. Pea repaired its own failed verification script, but did not refresh the complete Ducts analysis.

The driver then asked: `but what about the actual gap at the filter? can you fix that too? try it on this copy, just dont save or sync it`. Pea called the healer, received `6514877 is equipment; a join there splits or merges systems and is a person's`, and stopped. It explicitly said a C# script would bypass the rule. It did not test whether the proposed equipment move and connection worked. The final native observation still showed the equipment gap open.

The reason is explicit in [the guide's Pea-never rules](../../../ts/packages/agent-contracts/src/ducts-guide.ts:89): it forbids staging airflow slots, applying fan assignments, and editing geometry by script, including transitions and joins between systems. The generated `calc-duct-pressure-drop` skill carries the same text. A test of autonomous equipment repair under these instructions is a test of policy compliance, not a test of scripting capability. Changing that boundary requires a product decision; no instruction was changed to improve this run's score.

Actual-write evidence: `copy-muas-repair.json`, `attach-copy-result.json`, `copy-muas-repair-attached.json`, `copy-gap-repair.json`, `copy-final-native.json`, and `final-independent-diff.json` in the run directory. The native result proves the four caps and their connections. Complete calculation and repair remain FALSIFIED[session dev controlled, FR-1/FC-23 connection remained open after the explicit repair request].

The test snapshot was stopped with its unsaved changes discarded, and its isolated host shut down. Final SDK census shows only the original session, PID `27012`; both created process ids are gone. The original document's post-preview native witness reported `modified: false`. The first aborted setup created no session or host. Automatic approval review rejected recursive removal of its scratch copy as `blocked by policy`, so `.artifacts/accept/pea-ducts-20261026/` remains as disposable run residue.

## Independent checks

Fresh raw snapshot evidence and a separate read-only native script agree that FC-5 connector 3 is open and grille `6508741` is disconnected. The snapshot also shows both FA 42 takeoff connectors directed `out`. The native witness, after previews, reported the original document unmodified. The readback script executed actual Revit API reads rather than trusting Pea's final text.

Two ordinary host snapshot reads returned the same `readAt`, so their equality alone is not independent proof of rollback. The native witness is the relevant second observation. Its first version exceeded the script result size limit because it enumerated all 308,981 model elements; the corrected witness returns bounded connector and cap data. This was verifier friction, not a Pea failure.

History does not establish today's topology. In the current original model, SA 29 has groups `g6494977` and `g6508741`, with FC-5 as the sole root of the first. The older DH-31 connection is absent. In the saved repair copy, native reads show FC-23 `8732550` is New Construction and `13760867` is absent. An initial suspicion based on the historical phase mapping was falsified and was not scored against Pea.

## Feedback

1. **Analysis delivery delays a simple question.** The first SA 29 attempt spent its entire four-minute budget extracting a document-wide artifact. Useful system diagnosis required another operator turn. Keep an exact system and its coupled equipment progressively inspectable without making Pea unpack the whole model.
2. **The shipped policy prohibits repair of the blocking connection.** Pea exercised the bounded healer, then obeyed the guide's ban on scripted geometry edits. Decide whether an approved, previewed script on a scoped document may repair an equipment join before grading that capability again. The current tool refusal does not prove Revit cannot make the connection.
3. **A successful heal preview does not mean the system is fixed.** Both previews left the original calculation blockers standing. Applying caps should not be the success criterion. The criterion is the intended connection, preserved system meaning, and a fresh path/calculation after repair.
4. **Pea did not progress the airflow-source choice into a proposal.** It found the better-covered parameter and then told the user to change settings. The next useful behavior is a reviewable proposal with its coverage and effect, while retaining the engineer's authority over design inputs.
5. **Pea's narration needs receipt checks.** Its SA 29 response says 17 caps but allocates them as 16 + 1 + 1. The retained native receipt actually lists 15 RA 26, one RA 1, and one FA 24. It also mixes topology facts with a possible ERV short circuit. Use exact native receipts for the repair list, and retain uncertainty on air-distribution intent.

## Evidence

[History and prior cases](black-box-history-2026-10-26.md). The raw evidence is NDA material and remains gitignored in `.artifacts/runs/session-20261026-pea-ducts/`. Key files are `sa29-identify.json`, `sa29-followup.json`, `sa29-repair-preview.json`, `muas-identify.json`, `muas-repair-preview.json`, the saved thread event logs, `independent-witness.json`, and `main-native-witness.json`. Native setup, SDK envelopes, copy hashes and teardown live under `.artifacts/accept/pea-ducts-copy-20261026/`.

PROVEN[session dev controlled, pe.app-25 and acc-pea-ducts-copy-20261026 plus native witnesses and prompt receipts, checkout 0b40c293 with pre-existing edits and original loaded stamp 965bd2ed5832 / snapshot stamp 2a032a9a6347, 2026-10-26]. This proves the exercised identification, previews, and four connected caps. UNPROVEN[design approval of the caps, a solved ESP, and selected-picture context].
