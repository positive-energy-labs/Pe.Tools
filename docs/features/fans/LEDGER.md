# Fans ledger

## Decided

- 2026-11-16, MAP Q1, kaitpw: "B". Stated airflow is an input; otherwise the terminal sum is a result and is never written.
- 2026-11-16, MAP Q2, kaitpw: "on the logic side i feel like itd b a major issue if these werent separated". Rated ESP and required ESP are separate values with separate sources.
- 2026-11-16, MAP Q3, kaitpw: "im pretty sure this is backflow which we need to handle and show errors for". Encounters carry a verdict and static contribution; an unruled encounter cannot certify a complete claim.
- 2026-11-16, MAP Q4, kaitpw: "the family, but this mismatch should be shown as an error/warning, probably onn the picture". Family connector direction wins over network direction.
- 2026-11-16, MAP Q5, kaitpw: "ideally on fans, but if this if its convoluted then it can b an occam cut and a is ok". Prefer accepting a join in Fans; a linked duct-systems repair is an allowed cut.
- 2026-11-16, MAP D1, kaitpw: "calc is fine". A priced fan result is a calc. Old wire names and retained data are set aside with one notice, never migrated.
- 2026-11-16, MAP invariants 1 to 6: only a complete claim mints the write request; it writes no derived flow. One contract table owns inputs, and staged values retain author and evidence through resolution and write review.
- 2026-11-16, RULES.md ESP ruling, kaitpw: "we actually dont have a standard" and "we need to make our products flexible to accomodate changes to company standartds as well as different topologies of standards at other companies." Parameter names and instance/type homes are firm configuration, not company standards inferred from Chadds.
- 2026-11-16, RULES.md RequiredEsp/RatedEsp default, re-openable: RequiredEsp is the write target, with the current default name; RatedEsp is read-only with no default. The same parameter cannot serve both. Resolution is instance first, then type.
- 2026-11-16, RULES.md 20:25 default, re-openable: required ESP comes from the complete claim, never a staged ESP cell. The applying caller authors the write and the claim basis is its ref. "Writes nowhere" is one three-state field: absent/default, a name, or explicit none.
- 2026-11-16, RULES.md P-060 default, re-openable: a type-bound ESP write requires complete claims for every cohort member and equal required ESP at written precision. Otherwise refuse and name each peer and value. Never invent a maximum; the native shared-type guard remains a second check.
- 2026-11-16, RULES.md 18:00 coverage ruling: one required coverage value accounts for every source as read or lost. An unaccounted source is lost, and no lost entry can mint a complete claim.
- 2026-11-17, RULES.md owner-queue item 4, kaitpw: "change it". H5 uses host rated ESP minus loss before tie-in N; if rated is unknown, use required ESP minus that loss and warn "assumes the host is balanced". Add only when the path stops at N; R-SHARE paths already priced past N and return tie-ins add zero. Rated below required is a backflow/deadhead error.
- 2026-11-17, RULES.md owner-queue item 5: the owner accepted the default. Mutually accepted fans form an unresolved loop and never become complete.
- 2026-11-17, RULES.md owner-queue item 6: the owner accepted the default. Direction mismatch is an error, never complete, and cannot write.
- 2026-11-17, RULES.md handoff ruling, kaitpw: "The link names the fan, not every system id." Handoffs must retain fan identity without an unbounded system list.

- 2026-10-28, the owner said, “A utopia solution would just one-click calcs, once the absolute bare minimum configuration and inputs have been done.” They added, “we should attempt to infer/heal/fix anything that we possible can, the purpose being a one click calc.” Reduce the work an engineer has to supply before pressing Calculate.

- 2026-11-19, the owner said, “yes fix”. Terminal and unit airflow receipts name the parameter Pe wrote. A receipt can make a zero count as real only when it names the parameter in use. Older receipts carry no parameter and cannot establish a zero. A terminal reading zero remains missing until a write creates a receipt for that parameter. `ba3a654e`.
- 2026-11-19, a drop from a manufacturer catalogue loses the “default” label. The airflow cell keeps the “chosen by coverage” explanation when it has a receipt. The Changed in Revit check allows for Revit Flow at three decimal places. `ba3a654e`.
- 2026-11-19, the calculation rounds Revit Flow to three decimal places before pricing the terminal. It shows a rounded zero as 0 cfm when a matching receipt exists and shows missing airflow when the receipt is absent. `50b8e216`.

## Tried & rejected

- 2026-11-16, MAP D2 and RULES.md 20:25: the whole-network circuits solver and ducts.analysis projections are retired. Fan calc is the single pricing path.
- 2026-11-17, RULES.md H5 amendment: adding host loss before N counted pressure already spent. The remaining-pressure rule above supersedes the 2026-11-16 H5 reading.

## Owed
- 2026-11-18, /fans never says "nothing to write" for a complete fan: after an apply with no cell staged, a new plan still lists the ESP, unchanged, and a "Pe record update" to the next store revision, and keeps Write offered. Seen on a real session by the field-20261118 driver (`ev/driver-jv1-hand-final/ev/consumed-replan.txt` in that run's directory). Older than that run: at its base `272c0120` and at its candidate `091a9af1` alike, the scoped request always keeps the equipment row (`ts/products/ducts/domain/src/staged.ts`, `const equipment = request.equipment`) and the native applier always adds a store item with `After = revision N+1` to a preview (`dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs`, about line 123). The applier's own no-op check may leave the store unchanged on apply; whether a second Write bumps the revision was not driven. Not decided: whether a plan that would change nothing should say so.
- 2026-11-18, the J-V1 journey script (`ts/products/fans/web/journeys/jv1-live-flow.ts`) has never passed on a real session as written, so the live-flow journey is proven only by hand (field-20261118, `45c670d4`). Three faults of the tooling, none of the product: the drift note was looked for as inline text (repaired at `3c667277`); the write-scope helper missed an option that was on screen, not reproduced; and `revit.url` in `ts/tests/e2e/cdp.ts` puts the internal target kind `document` into the page's public target query, which the page rightly refuses as invalid, so the script cannot bind (`jv1-live-flow.ts:45`). The same projection fault was worked around by hand in J-V7's first real pass.
- 2026-11-18, a fan whose walk includes a generated heal extension that is not a segment cannot be read on /fans: `fans.calc` answers `refresh-needed`. The producer writes `hydraulicDiameterFt: (section?.dhIn ?? 0) / 12`, which is 0 for such an extension (`ts/products/fans/domain/src/calc/build.ts:958`), and the wire contract requires a positive number (`ts/products/fans/contract/src/fans-inputs.ts:105`). Seen on a copy of the Chadds clone for FC-2 (unit 6047212, port 1) and FC-3 (unit 6047248, port 1) by the field-20261118 driver; both lines are the same at that run's base `272c0120`, so it is older than the run. Not decided: whether the evidence row should omit the diameter or the contract should admit 0.
- 2026-11-18, the 0.03 seed drop still draws as a plain "drop": `lossSourceOf` in `ts/products/fans/domain/src/calc/build.ts` recognises only "firm default" while provenance emits `default:...`. Found by run field-20261118 at 272c0120 and older than it. It is item 4 of the reduced fans wave 5, which is still running on `crusade/fans-w5` (last merge 2026-11-18 02:47) and is not on main.
- Root 2026-11-17, FC-23, owner may upgrade: the [fans fixture provider](../../../ts/products/fans/web/src/calc/value-fixtures.ts#L24-L39) publishes only MUAS-1, so every other offered fan, FC-23 included, is uncovered, with empty `worstLegs` and null `calcBreakdown`; the [duct-systems navigation fixture](../../../ts/products/duct-systems/web/src/value-fixtures.ts#L25-L26) publishes empty calcs and empty `fanRows`. Both must run the production calc path, and one fan must be staged complete with priced bars. Rows J-P2, J-P3 and J-P4 on fans and ducts, and FANS-P3-REVERT-COVERAGE, wait on this. Evidence: `.artifacts/runs/fans-20261116/ev/fc23/`.

- MAP L1-5 and BACKLOG FANS-DRIVER-H5-WITNESS-A418: reconcile REPORT C4 topology with the retained Chadds capture before naming DH-20/13760945 or DH-31/6530455 as positive-pressure witnesses. The recorded replay identifies those trunks as return/static-none; native coverage, complete pricing and the picture warning remain unproven.

- Remove generic product names under the [shared-base Owed item](../ducts/LEDGER.md#owed); a green ratchet does not certify zero debt.

- MAP W0-1, W0-2, W0-3 and W0-6; prior ducts ledger FANS CRUSADE: retain proof of shared Place undo, bounded mark roster lookup, removal of ignored proposal/edits read inputs, and review author from the staged cell. Source history at 6648a9bf preserves the readiness findings; this doc migration does not certify runtime closure.
- MAP L1-2, L1-3, L1-4 and L1-6: retain producer-to-write evidence refs, typed closers without prose parsing, lost-peer claim refusal, generated native vocabulary and row/source set-aside notices. Recheck end-to-end claims against the merged tip, not just schemas.
- MAP L2-1, L2-2, L2-3, L2-5 and R1/R2/R3: finish typed per-leg evidence, legacy engine/read/guide deletion and generic product leak cleanup at the integrated tip. Old write parity was falsified by tap metadata, free-text provenance, port versus group scope and the intended required-ESP change; do not silently restore parity as an acceptance rule.
- RULES.md 2026-11-17 Chadds priority and MAP risk tiers: drive Chadds before fixtures on each new build; the owner's heavy manual use remains final acceptance. Deterministic, compile and browser evidence do not certify a native write.

- MAP D3: kaitpw wants "some version of the tutorial back" and "derived from the targeted doc". Build visual cards and examples from the open document, rather than restoring the old guide.
- MAP D5: decide the parked Manual D equivalent-length option; ASHRAE and Manual D paired-elbow methods differ by about 25%.
- MAP D6: settle the fan calc export format, including the proposed RHVAC tree layout.
- MAP Q2 display: confirm required-above-rated damage on the picture during an owner drive.
- MAP L2-3 and L2-6, RULES.md SDK ruling 2026-11-17: run the native fresh-rung required-ESP/no-flow write and type-cohort refusal proofs. The SDK skew was cleared by main; this ledger does not claim those runs passed.
- MAP W0-4 and W0-5: run native fresh-rung shared-type A=1/B=-1 refusal and failed-peer-read coverage proofs, not only deterministic checks.
- BACKLOG FANS-P3-REVERT-COVERAGE, root ruling 2026-11-16, 23:4x: obtain the missing complete-claim recorded fixture and prove revert-then-stage leaves the reverted cell out of the plan. If Chadds supplies a complete claim, drive it there first. Existing journey fixtures have no complete claim and witness refusal only.
- BACKLOG P-065: peer reads are fresh but sequential; only the fan's own cohort carries a basis check. Prove or close cross-read freshness before claiming atomic peer evidence.
- BACKLOG FANS-BASE-LOAD, root ruling 2026-11-16, 19:35: kernel read and out-of-band Work journeys fail under suite load but pass alone. Measure test contention before changing product behavior; this performance finding holds no product work.
- BACKLOG FANS-BASE-GATE, root ruling 2026-11-16, 19:35: baseline format fails on 1080 files and lint fails. These failures predate this run; bulk formatting remains outside the crusade scope and does not stop its end gate.
- P4-fix-seams, implementor instruction 2026-11-17: generic host slots/sheet.ts LOSSES_ROUTES and MCP shared/admission.ts fan preflight are in flight. Lower their baseline counts under the [shared-base Owed item](../ducts/LEDGER.md#owed) when the seams move.

- Resolve the order of the Fans calculation view. On 2026-11-05 the owner chose the unresolved checklist first with “this”, while the [current view](../../../ts/products/fans/web/src/calc/view.tsx) follows the earlier worksheet-first ruling.
- Show the incomplete pressure estimate in muted ink. On 2026-11-05 the owner said, “greyed estimate is nice”. The [current summary](../../../ts/products/fans/web/src/calc/view.tsx) mutes the note about completeness.
- Review ownership and source labels for the calculation values that remain open. On 2026-11-17 the owner said, “I'm taking the primitive work into a separate muse.” The proposal called seam S would draw the host's resolved value and source in every setting row. Keep that proposal open for design. [ADR 0053](../../adr/0053-the-model-store-is-a-receipt.md) settles the receipt-only rule from seam R. Main now keeps catalog home tiers and shows sources for allowances and rated pressure warnings. Preserve the remaining case evidence in `.artifacts/handoffs/fans-homes-primitives.md` until a design review uses it.

- Show the whole resulting loss record in Write review, including model entries that the write preserves. [W-duct-systems-06-107]
- Show a known pressure subtotal in the roster for an incomplete fan without presenting it as certified pressure. [W-duct-systems-03-032]
- Refuse to plan another pressure write after a completed calculation when the values and saved intent are unchanged. [W-fans-03-084, W-fans-05-021]
- Let the engineer activate any open fan without closing the other fans. [W-fans-01-031]
- Group each unit's ports under that unit in the fan roster. [W-fans-01-029]
- Format the velocity in the picture using the same precision as the worksheet. [W-fans-02-008]
- Compare coefficients against Revit on the same fitting and make any divergence between the worksheet and the model visible. [W-fans-01-127]
- Carry the custom label and selected phase through the pressure walk. [W-fans-01-129]
- Show the borrowing consequence before Apply when the fan write targets a shared model. [W-fans-01-104]
- Keep a fan calculation readable when the snapshot contains a generated heal extension. [W-fans-05-020]
- Decide which geometry repairs and assignment controls belong on the Fans ledger or header and which should open a working control in Duct Systems. [W-fans-01-018, W-fans-01-019]
- Handle a unit with one duct connector in the pressure walk and explain why an ambiguous unit with several outlets is missing from the roster. [W-fans-01-051, W-fans-01-132, W-fans-02-110]
- Keep sample views editable on the first history entry and add a complete fan whose priced bars can be seen. [W-fans-04-007, W-fans-04-068]
- Include the bound model in a copied link and use a public document target in the live-flow journey. [W-fans-04-121, W-fans-05-023]
- Keep the button that takes Pea's value clear of the cell's focus target at narrow widths. [W-fans-04-075]
- Name the affected peers in the shared ESP type refusal when their resolved names are available. [W-fans-02-038]
- Break up the Fans route declaration along existing ownership boundaries when the next route change needs that space. [W-fans-04-084]

### Carried from the 2026-11-19 census

- Preserve Broan's low-setpoint pressure warning when displaying equipment performance against the connected air handler. Carry the cited Broan auto-balance airflow reduction and high-resistance fault thresholds into equipment guidance. [owed-20261119 fans-broan-air-handler-behavior-1, 2 items]
- Reproduce the Chadds selection delay and time each boundary through the first refusal. The earlier calculations took 11 to 46 ms and the saved first refusal took about 10.5 s. The subsequent 60-second protocol was a separate drive. [owed-20261119 fans-1-010, 2 items]
- Finish the Fans fixture and journey coverage for priced bars, a complete worksheet, shared and fanless models, missing fans, fixture history and scope changes. Reuse the checked captures and regenerate the native parameter catalog on the integrated candidate. [owed-20261119 fans-fans-fixtures-and-drives, 34 items]
- Check Fans pressure and airflow against the live model through staged and hand-edited values, slot coverage, incomplete sides and shared paths. Give a rated-flow mismatch a visible explanation and verify the complete calculation against both priced sides and allowances. [owed-20261119 fans-fans-pressure-and-airflow, 11 items]
- Resolve the diagnostics behind 1 guarded check suppression in ts/products/fans/web/src/calc/view.tsx and ratchet the allowance down. [owed-20261119 tooling-3-082, 1 item]
- Name both ports with readable equipment and connector labels in fan connection notes. [owed-20261119 fans-1-015, 2 items]
- Remove the unreachable Fans slot default and the unread input layers field from the active resolver contract. [owed-20261119 duct-systems-1-045, 1 item]
- Drive the Fans browser worksheet with a real document selection and named inputs. Keep the active fan and scope clear, show understandable value sources, and check the final route through selection, edits, refusal and reconnect. [owed-20261119 fans-fans-browser-and-worksheet, 15 items]
- Correct the duplicate FC-23 tags with the modeller, then drive both units on Chadds. Verify each port stays distinct by level or ID when marks collide and opens the intended calculation. [owed-20261119 fans-1-051, 3 items]
- Prove on Chadds SA 11 that Ducts and Fans identify the same fan after walking the system. [owed-20261119 routes-kernel-1-066, 1 item]
- Prove that saved project and firm parameter choices direct pressure and airflow writes to the intended native target. Cover named and explicitly disabled targets, pressure units, the instance or type choice and the readback for every peer in a complete shared-type claim. [owed-20261119 fans-fans-parameter-settings, 11 items]
- Run J6 with a shared fan type using real controls, a later Pea turn while mounted, and a leave-and-return. Read back the intended pressure from Revit after one Apply, verify consumed Work refuses a second plan, and drive native refusal, History and Undo. [owed-20261119 fans-1-073, 7 items]
- Remove the deferred focus-capture lifecycle and fixture transport console logs once the replacement evidence is in place. Regenerate the native operation catalog on the final Fans candidate and retain its commit-pinned receipt. Find or produce the final wave-five Fans and duct-systems guard and build receipt on the tip that contains the duct-heal review fix. Recover the pre-cleanup build or original route-closure bytes and compare the moved closure before claiming parity. [owed-20261119 fans-fans-candidate-proof-1, 6 items]
- Change an automatically matched fitting table through the browser and read back the resulting calculation. [owed-20261119 duct-systems-1-130, 1 item]
- Complete Outstanding A17 on a real model through the remaining write, native readback and Pea turns, retaining MUAS-1 and FC-23 as distinct witnesses. [owed-20261119 routes-kernel-1-092, 1 item]
- Recover the Manual D rulings made after run 276 before revisiting the equivalent-length option. Use run 277 to locate the transition into the kernel architecture discussion. [owed-20261119 fans-1-101, 2 items]
- 2026-11-19, drive a staged terminal-flow write to Revit's built-in Flow. Read the parameter directly, check that the receipt names it, and compare Fans and Duct Systems. Verify that a zero stays missing with an old receipt or a receipt for a different parameter. The earlier refused Chadds drive left Flow at 235 cfm. The custom slot covered 27 of 394 terminals and Revit Flow covered 355 of 394. [owed-20261119 fans-1-102, 4 items]
- Replace non-null assertions with checked presence or types that establish the invariant, and lower the per-file nonNull allowance as each caller changes. The [guard baseline](../../../ts/tests/repo-guards/src/health.baseline.json) records the file allowances. [owed-20261119 fans-non-null, 16 items]
- Resolve the two outstanding Fans seams with the owner before promoting the field defaults. [owed-20261119 host-journal-1-262, 1 item]
- Audit the remaining set-aside helpers and fan input row exports after the contract cutover and remove only the exports without live callers. [owed-20261119 fans-1-116, 1 item]
- Capture output from the intermittent Codex harness thread test failure and diagnose the failing step. The earlier attempt failed once in four runs without a retained failure log. [owed-20261119 fans-1-123, 1 item]
- Drive proposed repairs and fitting coefficients in the running route and retain a complete fan pressure result with its evidence. [owed-20261119 duct-systems-1-248, 1 item]
- Resolve Fans walk writes at the host from a typed port SubjectRef. [owed-20261119 routes-kernel-1-426, 1 item]
- Give the tests typed fixtures or checked constructors where they now assert a type, and lower each file's test-cast allowance once the test expresses the same witness. The [guard baseline](../../../ts/tests/repo-guards/src/test-casts.baseline.json) records the file allowances. [owed-20261119 fans-test-casts, 24 items]
- Resolve the unfinished Fans calculation read contract work recorded by the health guard and lower its marker allowance after checking the owning contract. [owed-20261119 tooling-2-414, 1 item]
