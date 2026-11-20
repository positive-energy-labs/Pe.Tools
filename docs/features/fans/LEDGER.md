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

- 2026-11-19, the driver reported PROVEN for the Chadds F1 journey at `f1b2ac94` on Revit 2025 ran 11 steps with seed `20261119`. Staging CD3-21 raised B160E75RS port 7 from 0.1285 to 0.1420 in-wg. Pea named `elbow-1d-le10` and asked for a /duct-systems save before a fitting write. Airflow receipts named `revit:Flow` and `PE_M_Fan_AirFlowBoost`; written zero showed 0 cfm and unreceipted zero a dash. Evidence: `products-drive/` in the tie-up run.
- 2026-11-19, Fans reads worksheets that price proposed extensions and acquires picture geometry in batches of 4,096 IDs. See [Ducts](../ducts/LEDGER.md) for FC-4 and the `hydraulicDiameterFt` fault. `3dc31db5`, merged in `701320c1`.
- 2026-11-19, PROVEN[browser and session, 5734987f, 2026-11-19]: the 14 fan ports that failed fans.calc each render a ledger; a write says "Applying…" and never "Apply is held". The driver's controlled Revit 2025 session was `acc-tieup-products-5734987f` (pid 13420) on a disposable Chadds copy, add-ins off.
- 2026-11-19, preview and apply share the unchanged-content comparison in `DuctApplier.cs:118`. An unchanged required-ESP re-plan offers no write, keeps the loss-record revision and keeps rated ESP's Work source. The same comparison covers a duct-ruling save. `5ec6e8f3`, merged in `6961250f`. PROVEN[attached rung, acc-tieup-products-fixes-2, Revit 2025 fixture documents, 2 passed].
- 2026-11-19, PROVEN[browser and session acc-tieup-fan-replan-38dac482-drive pid 1008, Chadds copy, 38dac482, 2026-11-19]: an unchanged re-plan on B160E75RS 8775469 port 7 says "Nothing to write: all native targets are unchanged.", the loss record stays revision 1 byte for byte, and a real edit (terminal 9020215 flow 75 to 80 cfm) still offers a write.
- 2026-11-19, Fans offers All up to eight ports. The old full-worksheet read took 268–270 s in 75 native walks before its 512-recipe refusal. Each port added six port-specific recipes, so 112 ports required 672 before shared work. The eight-port limit was the writer's conservative choice. `6797476c`, merged in `7c21e6cf`.
- 2026-11-20, PROVEN[browser and session, 7c21e6cf, 2026-11-20]: with 112 ports All is dimmed and says "Open up to 8 fan ports at a time from the roster." (roster ready 45.7 s after opening the route); eight ports read in 72.9 s from the first click, 13.2 s from the eighth; no 512-recipe refusal. An unchanged re-plan's toolbar says "Write to Revit · nothing to write"; a plan of two planned and two unchanged says "planned 2". Custody: the driver's controlled Revit 2025 session `acc-tieup-products-7c21e6cf` (pid 48116), add-ins off, on a disposable Chadds copy.
- 2026-11-20, the ninth roster row explains the limit and leaves the eight ports open. An oversized address or Pea navigation keeps the first eight IDs in request order, or roster order for All, and rewrites the address to match. All works when the roster fits. `605364aa`, merged in `252d3ccf`..

- 2026-11-20, PROVEN[browser and session, 09943e6c, 2026-11-20]: the ninth port was disabled with the limit’s wording, the eight-port batch stayed visible and no read was sent. Pasting nine IDs opened the first eight and dropped the ninth from the address. The fourth drive used controlled Revit 2025 session `acc-tieup-rooms-09943e6c` (pid 29324), add-ins off, on a fresh Chadds copy. Evidence: `rooms-drive/tieup-rooms-09943e6c/REPORT.md`, row 5. UNPROVEN[Pea navigation with oversized scope and All on a roster that fits in Revit].
- 2026-11-20, when one port is open and Write scope is empty, browser Plan stages that port and plans on the accepted Work revision. When a choice is needed, it says “Choose a fan port in Write scope in Inputs, then plan again.” Pea’s refusal says to read `fans.roster`, stage `unitId` and `portIndex` in Fans Work, and retry `sheet.plan`. It says nothing was submitted. `8d2a6057` and `d5dc8183`, merged in `7d1e67e8`. UNPROVEN[the first fan plan on Revit after the fix].

## Tried & rejected

- 2026-11-16, MAP D2 and RULES.md 20:25: the whole-network circuits solver and ducts.analysis projections are retired. Fan calc is the single pricing path.
- 2026-11-17, RULES.md H5 amendment: adding host loss before N counted pressure already spent. The remaining-pressure rule above supersedes the 2026-11-16 H5 reading.

## Owed

- 2026-11-18, the J-V1 journey script (`ts/products/fans/web/journeys/jv1-live-flow.ts`) has never passed on a real session as written, so the live-flow journey is proven only by hand (field-20261118, `45c670d4`). Three faults of the tooling, none of the product: the drift note was looked for as inline text (repaired at `3c667277`); the write-scope helper missed an option that was on screen, not reproduced; and `revit.url` in `ts/tests/e2e/cdp.ts` puts the internal target kind `document` into the page's public target query, which the page rightly refuses as invalid, so the script cannot bind (`jv1-live-flow.ts:45`). The same projection fault was worked around by hand in J-V7's first real pass.

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

- Decide which geometry repairs and assignment controls belong on the Fans ledger or header and which should open a working control in Duct Systems. [W-fans-01-018, W-fans-01-019]
- Handle a unit with one duct connector in the pressure walk and explain why an ambiguous unit with several outlets is missing from the roster. [W-fans-01-051, W-fans-01-132, W-fans-02-110]
- Keep sample views editable on the first history entry and add a complete fan whose priced bars can be seen. [W-fans-04-007, W-fans-04-068]
- Include the bound model in a copied link and use a public document target in the live-flow journey. [W-fans-04-121, W-fans-05-023]
- Keep the button that takes Pea's value clear of the cell's focus target at narrow widths. [W-fans-04-075]
- Name the affected peers in the shared ESP type refusal when their resolved names are available. [W-fans-02-038]
- Break up the Fans route declaration along existing ownership boundaries when the next route change needs that space. [W-fans-04-084]

### Tie-up, 2026-11-19 to 2026-11-20

- 2026-11-20, decide how Pea should handle a single open fan port. The browser can use the Page’s selection, while Pea’s preflight sees only Work handles.
- 2026-11-20, investigate two failures the `tieup/products-fixes-5` writer also reported on main: a missing ghost volume and an unavailable `ink-mute` token in test setup.

- 2026-11-19, witness manufacturer catalogue drops on a real worksheet. The Chadds copy in the F1 drive had no catalogue witness.
- 2026-11-20, provide a whole-model fan pressure sheet. Acquire shared data in bounded batches and publish pressure and blocker rows with progress. Read the full worksheet when a port opens.
- 2026-11-20, decide whether limiting All to eight fan ports and sixteen duct systems is acceptable until the whole-model sheets exist. See the [Duct Systems drive](../duct-systems/LEDGER.md).

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
- 2026-11-19, repair the J6 scope-picker step on fresh Work, where `f1b2ac94` stopped before writing. Then run J6 with a shared fan type and real controls, another Pea turn while mounted and a leave-and-return. Read pressure back after one Apply and check native refusal, History and Undo. The `38dac482` drive witnessed the unchanged re-plan separately. [owed-20261119 fans-1-073, 7 items]
- Remove the deferred focus-capture lifecycle and fixture transport console logs once the replacement evidence is in place. Regenerate the native operation catalog on the final Fans candidate and retain its commit-pinned receipt. Find or produce the final wave-five Fans and duct-systems guard and build receipt on the tip that contains the duct-heal review fix. Recover the pre-cleanup build or original route-closure bytes and compare the moved closure before claiming parity. [owed-20261119 fans-fans-candidate-proof-1, 6 items]
- Change an automatically matched fitting table through the browser and read back the resulting calculation. [owed-20261119 duct-systems-1-130, 1 item]
- Complete Outstanding A17 on a real model through the remaining write, native readback and Pea turns, retaining MUAS-1 and FC-23 as distinct witnesses. [owed-20261119 routes-kernel-1-092, 1 item]
- Recover the Manual D rulings made after run 276 before revisiting the equivalent-length option. Use run 277 to locate the transition into the kernel architecture discussion. [owed-20261119 fans-1-101, 2 items]
- 2026-11-19, compare the zero-airflow receipt cases across Fans and Duct Systems and directly read back a terminal-flow write to built-in Flow. The F1 drive witnessed parameter names and the written-zero distinction. Check old or mismatched receipts separately. [owed-20261119 fans-1-102, 4 items]
- Replace non-null assertions with checked presence or types that establish the invariant, and lower the per-file nonNull allowance as each caller changes. The [guard baseline](../../../ts/tests/repo-guards/src/health.baseline.json) records the file allowances. [owed-20261119 fans-non-null, 16 items]
- Resolve the two outstanding Fans seams with the owner before promoting the field defaults. [owed-20261119 host-journal-1-262, 1 item]
- Audit the remaining set-aside helpers and fan input row exports after the contract cutover and remove only the exports without live callers. [owed-20261119 fans-1-116, 1 item]
- Capture output from the intermittent Codex harness thread test failure and diagnose the failing step. The earlier attempt failed once in four runs without a retained failure log. [owed-20261119 fans-1-123, 1 item]
- Drive proposed repairs and fitting coefficients in the running route and retain a complete fan pressure result with its evidence. [owed-20261119 duct-systems-1-248, 1 item]
- Resolve Fans walk writes at the host from a typed port SubjectRef. [owed-20261119 routes-kernel-1-426, 1 item]
- Give the tests typed fixtures or checked constructors where they now assert a type, and lower each file's test-cast allowance once the test expresses the same witness. The [guard baseline](../../../ts/tests/repo-guards/src/test-casts.baseline.json) records the file allowances. [owed-20261119 fans-test-casts, 24 items]
- Resolve the unfinished Fans calculation read contract work recorded by the health guard and lower its marker allowance after checking the owning contract. [owed-20261119 tooling-2-414, 1 item]
