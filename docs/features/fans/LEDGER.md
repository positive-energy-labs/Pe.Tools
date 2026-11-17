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

## Tried & rejected

- 2026-11-16, MAP D2 and RULES.md 20:25: the whole-network circuits solver and ducts.analysis projections are retired. Fan calc is the single pricing path.
- 2026-11-17, RULES.md H5 amendment: adding host loss before N counted pressure already spent. The remaining-pressure rule above supersedes the 2026-11-16 H5 reading.

## Owed
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
