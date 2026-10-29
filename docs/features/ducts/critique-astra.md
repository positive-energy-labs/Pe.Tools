# Critique of the ducts product map

Reviewed the uncommitted [MAP.md](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md) against checkout **cac7f9699dff0349de10bc37566aab43fd7bd455**, on **2026-10-27 America/Chicago**. Map SHA-256: **c3a384de493fd43c11abb38fa3898530bea6470bafb5c8c3e7eafaf0443571e9**.

The ask is automatic critical-path discovery with minimal engineering entry. The terrain supports that objective, but the map currently conflates finding connected elements, establishing a valid airflow path, and certifying a fan pressure requirement. Those are separate obligations even when one engine and one sheet own them.

Existing route code is cited only for reusable mechanisms, physical calculations, and migration dependencies. Its inbox, groups, tutorial, and fan-election workflow are not treated as requirements. No repository source was edited. This report is the sole intentional file output.

## A. Architecture and data model

1. **Blocking — The scoped collector cannot discover the inferred continuation it promises.**

   **Claim:** A native walk that stops at an open connector cannot supply a downstream disconnected component to inference that examines only that walk's returned elements.

   **Evidence:** [MAP:109](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:109) stops the native walk at open ends; [MAP:115](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:115) computes inferred joins on walked elements. The actual inference starts from the supplied nodes and segments at [proximity.ts:520](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/ducts-domain/src/proximity.ts:520). If A ends beside disconnected B, B is absent; no algorithm over A alone can discover B's connectors or downstream terminals. The named acceptance case already contains an equipment gap: [black-box-tests:37](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/black-box-tests-2026-10-26.md:37) describes the FR-1/FC-23 failure.

   **Map correction:** Define bounded spatial candidate acquisition and continuation across proposed joins, including a completion/truncation witness; do not claim complete reachability from a connector-only walk.

2. **Blocking — The data model cannot identify the path through a multiport unit, and removing loop issues does not remove loops.**

   **Claim:** An element ID plus one isFan flag does not identify a fan/airstream, an internal equipment passage, or the traversed leg of a fitting.

   **Evidence:** The path is connector-ordered at [MAP:24](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:24), but Fan and Leg retain only unit/element IDs at [MAP:76](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:76). Four ERV ports admit six unordered port pairs; two isolated air passages cannot be recovered from “this element passes flow.” A side-stream reconnecting downstream produces two routes to the same endpoint. A global visited set arbitrarily drops one; a path-local visited set can enumerate many simple paths. With k successive split/rejoin choices there can be 2^k paths. Naming a starting fan does not resolve any of these facts. This is a representational objection, independent of which fan-stop policy the engineering critic selects.

   **Map correction:** Identify fan/airstream and ingress/egress ports, specify allowed equipment passages, and define bounded alternative-path/cycle handling with an explicit unresolved result.

3. **Blocking — Fan design CFM does not determine the flow needed to price each leg.**

   **Claim:** The map replaces fan-flow summation but never states the replacement rule for shared trunks, branches, missing terminal flows, or recirculating side streams.

   **Evidence:** [MAP:51](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:51) makes fan CFM authoritative and grille sum a check; [MAP:82](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:82) nevertheless requires flow on every leg. The retained fitting rules require branch, upstream-main and downstream-main flows separately at [loss-rules.ts:46](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/ducts-domain/src/loss-rules.ts:46). A 100 CFM fan feeding two branches permits 50/50, 20/80, and many other allocations. With fixed area and coefficient, 80 versus 50 CFM changes fitting loss by **2.56×**, from the velocity-pressure square in [loss-physics.ts:41](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/ducts-domain/src/loss-physics.ts:41). Stopping at another fan does not supply the missing branch allocation.

   **Map correction:** Specify segment and junction flow derivation, mismatch handling and explicit flow assumptions; do not substitute the fan's CFM for every leg or silently rescale terminals.

4. **Blocking — “A number always exists” cannot also mean “the worst path is known.”**

   **Claim:** A priced subtotal with a blocker is useful, but ranking partial sums as required ESP can select the wrong critical path.

   **Evidence:** [MAP:31](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:31) promises a number despite missing flow/drop; [MAP:81](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:81) promotes the largest total to fan required ESP. Counterexample: path A is complete at 0.20 in-wg; path B has 0.10 known plus an unknown filter drop. If that drop is 0.15, B is critical at 0.25. Neither a blocker count nor a generic cushion establishes an upper bound. Missing flow is worse: it changes multiple upstream losses, not merely one additive term. [ADR 0020](C:/Users/kaitp/source/repos/Pe.Tools/docs/adr/0020-sparse-named-ashrae-coordinates.md:13) also expressly preserves unknown table queries instead of clamping/extrapolating.

   **Map correction:** Always return a sheet, but distinguish known subtotal, assumed estimate and complete requirement; expose unresolved critical-path ranking and prevent an incomplete subtotal from being written as certified required ESP.

5. **Important — Parameter-backed roster persistence needs a binding and ownership contract.**

   **Claim:** “Stored on the unit” is a sound direction, but it does not specify what confirmation does when the slot is missing, type-bound, read-only, or in a linked document.

   **Evidence:** [MAP:110](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:110) says confirmation is written once. Existing fan writes fall back from instance to type, refuse absent/read-only slots, and explicitly guard conflicting values shared by one type at [DuctApplier.cs:386](C:/Users/kaitp/source/repos/Pe.Tools/dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs:386). A type-level confirmation changes all same-type instances. A host-document element ID alone cannot distinguish a linked instance from a local unit, and a linked source is not writable through the host's ordinary element write. The map does not establish linked-model support; it should not imply it.

   **Map correction:** Require instance-scoped confirmed identity, define missing-slot setup and failed-write state, and explicitly scope v1 to writable owning documents or provide document/link-qualified identities.

6. **Important — Defaults are not inherently a shadow store, but this model can recreate the rejected failure.**

   **Claim:** A firm configuration file is reasonable. Recomputing from whichever version is installed, while persisting only selected outputs, makes the same delivered model produce different results for different engineers.

   **Evidence:** [MAP:79](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:79) never persists sheets; [MAP:89](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:89) resolves firm defaults plus local Work. Its sink list names unit values and fitting coefficients, not the effective defaults, project rulings, equipment drops or their versions. [LEDGER:131](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/LEDGER.md:131) rejected the shadow-store outcome because nothing traveled with the model; [DuctApply.cs:93](C:/Users/kaitp/source/repos/Pe.Tools/dotnet/Pe.Shared.RevitData/Ducts/DuctApply.cs:93) shows the existing model-carried provenance mechanism. Two default filter drops, 0.10 and 0.20, change the result without a model change.

   **Map correction:** State which effective inputs and provenance travel with the model, pin defaults by version/hash, and define one precedence order and an explicit refresh of firm defaults.

7. **Important — The Work keep/delete list removes the ability to reject an inferred join.**

   **Claim:** Keeping only open-end verdicts cannot preserve a ruling that two nearby pieces must remain separate.

   **Evidence:** [MAP:99](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:99) limits assumptions to flex roughness, component drop and open-end verdicts; its new path override merely asserts an end. Inference currently accepts topology verdicts at [proximity.ts:485](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/ducts-domain/src/proximity.ts:485), and persisted ignore rulings are reapplied by [rulings.ts:33](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/ducts-domain/src/rulings.ts:33). With two nearby candidate continuations, asserting the same final endpoint does not say which join is forbidden. Re-reading would reintroduce the rejected edge.

   **Map correction:** Keep connector-pair accept/reject rulings with stable identity and geometry freshness; distinguish them from an intended endpoint.

## B. The Manual D method

8. **Blocking — The proposed total is a path-loss result, not yet a Manual D friction-rate worksheet.**

   **Claim:** A maximum fan-to-terminal loss does not by itself represent both sides of the fan, available static, or the pressure planes of its rated ESP.

   **Evidence:** [MAP:27](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:27) calls the outward-terminal maximum the generated worksheet, but its schema has no supply/return pairing, component-loss budget, ASP or calculated design FR. The current [MUAS PDF](<G:/Shared drives/PE Team Folder/Yoram Lepair Architects/Chadds Ford Residence/07_Internal Review/2026.10.19 Muas-01 pressure drop calculation/muas-01 pressure drop calculation.pdf>), physical page 4 / printed page 8, explicitly adds **0.022 in-wg return loss** and reports **1373.5 ft supply + 148.6 ft return ≈ 1522.2 ft overall**. [ACCA's explanation](https://hvac-blog.acca.org/calculating-friction-rate-not-constant/) distinguishes the external pressure budget, device deductions, TEL and resulting FR. A required-loss calculation is legitimate, but it is not evidence that the fan can deliver that pressure. Internal cabinet components already included in a rating also cannot be deducted again.

   **Map correction:** Separate required external loss from rated ESP/available duct pressure, declare inlet/outlet pressure boundaries and applicable sides, and either implement the worksheet quantities or name this a path-loss calculator with a worksheet projection still owed.

9. **Blocking — Reading rated ESP and writing required ESP through the same slot destroys the comparison input.**

   **Claim:** The map can overwrite the manufacturer's available-pressure datum with its own result, then read that result back as the rating.

   **Evidence:** [MAP:77](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:77) calls the Fan value rated ESP; [MAP:111](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:111) sources it from today's FanStatic slot; [MAP:121](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:121) writes required ESP to the unit without naming a separate destination. Today's write uses that same FanStatic slot at [DuctApplier.cs:403](C:/Users/kaitp/source/repos/Pe.Tools/dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs:403). Example: rated 0.50, required 0.70; after Write, a reread sees “rated 0.70” and the shortfall disappears.

   **Map correction:** Give rated/available ESP and calculated required ESP distinct contracts and destinations, or explicitly declare FanStatic a design requirement and source the rating elsewhere.

10. **Important — “Keep equivalent-length.ts unchanged” contradicts the chosen conversion and RHVAC comparability.**

   **Claim:** The map's single-rate display conversion is permissible, but cannot be described as the same TEL RHVAC currently prints.

   **Evidence:** [MAP:59](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:59) keeps the file unchanged; [MAP:66](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:66) chooses the design rate. [equivalent-length.ts:19](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/ducts-domain/src/equivalent-length.ts:19) instead leaves straight ducts at physical length and converts other losses using a nearby duct's actual rate. [Elite's equation](https://www.elitesoftapps.com/ro/help/equivalent_length_of_fitting.htm) uses current-duct friction in the denominator. A fresh read-only Jet query of [muas-01.r10](C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/close-ducts-v1/r10/muas-01.r10), section ST-140, returned loss **0.162553325**, actual rate **0.0145185124**, design input **0.08**: the same loss converts to **1119.628 ft** at the actual rate and **203.192 ft** at the design rate. The PDF prints 1119.6. A direct read-only execution of withEquivalentLength also returned [100, 100] ft for a 100-ft duct losing 0.02 in-wg and a fitting losing 0.02 at design rate 0.08; the proposed uniform conversion would return [25, 25] ft.

   **Map correction:** Remove “unchanged”; label the chosen quantity “equivalent feet at X in-wg/100 ft,” and document its deliberate difference from RHVAC TEL rather than silently comparing the two.

## C. Pea and the route contract

11. **Important — The full sheet has no demonstrated route to a 10 KB response.**

   **Claim:** Ten terminals and roughly 150 leg occurrences already exceed the proposed budget with straightforward compact JSON.

   **Evidence:** [MAP:79](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:79) includes full legs and provenance; [MAP:124](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:124) promises the sheet under 10 KB. My independent serialization probe measured **26,933 UTF-8 bytes** for ten paths of fifteen legs, including empty inputs/blockers and no geometry or duplicated common trunks. Each leg occupied 173 bytes with these fields: elementId, kind, flowCfm, flowSource, velocityFpm, lossInWg, rule, lossSource, equivalentFt. This is a counterexample to the ordinary object encoding, not proof that a compressed representation is impossible.

   **Map correction:** Promise a bounded overview with ranked paths and blocker summaries, plus complete path/leg/provenance detail handles tied to the same calculation basis.

12. **Blocking — A recomputed sheet has no identity for freshness, review, or Write.**

   **Claim:** Recompute-on-read does not prove that Pea, the page, a preview, and an approved write refer to the same model and inputs.

   **Evidence:** [MAP:79](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:79) omits document lifetime, native observation, Work revision, defaults version and engine/rule version. Yet [MAP:121](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:121) retains review/consent and the next rows promise freshness. Existing acquisition separately checks exact document lifetime at [ducts-analysis.ts:309](C:/Users/kaitp/source/repos/Pe.Tools/ts/apps/host/src/ducts-analysis.ts:309) and changes during acquisition at line 369; line 390 explicitly says sequential reads are not atomic. If a default changes between review and Write, an identical fan ID is insufficient evidence that the approved number remains the candidate.

   **Map correction:** Add a basis token covering exact document/lifetime, native observation, Work/defaults versions and engine inputs; bind details, geometry, previews and writes to it and invalidate changed candidates.

13. **Important — Blocker element IDs cannot drive the promised heal verbs.**

   **Claim:** An actionable blocker needs a precise affected connector or prepared repair candidate, not merely an element list.

   **Evidence:** [MAP:85](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:85) gives kind, element IDs, effect and closer. The existing heal contract requires exact elementId:connectorIndex ends at [ducts.ts:641](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/agent-contracts/src/ducts.ts:641); its omitted-items fallback plans by group at [ducts-actions.ts:30](C:/Users/kaitp/source/repos/Pe.Tools/ts/apps/host/src/ducts-actions.ts:30). Groups are being deleted. A fitting with two open ends demonstrates the ambiguity without invoking the old workflow. Pea would have to guess or reconstruct topology, contrary to the proposed instructions.

   **Map correction:** Return basis-bound repair candidates with exact ports and preview handles, and explicitly replace the group-based heal planner.

14. **Important — “Fan or start+end” requires two result meanings.**

   **Claim:** A selected subpath loss cannot safely use a type whose headline means a fan's complete required ESP.

   **Evidence:** [MAP:124](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:124) permits fan or start+end, while [MAP:79](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:79) requires a Fan and all reachable-terminal paths. A connector-to-connector query may have no fan at either endpoint; MUAS-to-FC-23 can end at another unit rather than a terminal. No field records whether the caller requested one chain, all terminals, or the whole fan boundary. Multiple paths between the same endpoints remain ambiguous.

   **Map correction:** Define discriminated fan-sheet and path request/result modes with explicit ports, asserted direction, coverage and quantity meaning, sharing one pricing engine.

## D. Order of work and proof

15. **Blocking — Step 2 deletes the old collector's analysis before proving the new capture boundary.**

   **Claim:** This is the highest-risk step: it combines a major architectural commitment with an unproven inferred-connectivity and roster contract.

   **Evidence:** [MAP:132](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:132) deletes Analyze/groups/roots/issues while demanding the louver-to-FC-23 chain under one second. Inference/engine work follows in step 3 and roster work in step 4, although step 2 already depends on both concepts. The open equipment gap in [black-box-tests:37](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/black-box-tests-2026-10-26.md:37) makes this an actual acceptance dependency, not a hypothetical edge case.

   **Map correction:** Put a read-only capture-and-price spike before deletion; retire the old shells only after its exact path-membership and scoped-loss checks pass.

   **Cheapest falsifying spike:** First use a retained raw snapshot to compare a connector-only fan walk with the same walk expanded through bounded spatial candidates. Pin the expected MUAS/FC-23 connector chain against the supplied red-route image and exact IDs; record missing continuations, cross-airstream candidates, repeated ports and truncation. Then price the chosen chain with explicit flows/drops and check an independent section sum. Finally, one fresh controlled copy tests only native candidate acquisition and latency. Failure to recover the disconnected continuation cheaply falsifies the “one raw from read” premise before any deletion. This review did not run that native spike.

16. **Important — The shelf supplies a reconstructable RHVAC calculation, not a ready independent hand-calc oracle.**

   **Claim:** The acceptance number exists, but cannot establish correctness of the proposed automatic path without mapping and resolving its dominant allowance.

   **Evidence:** [MAP:135](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:135) names a hand-priced MUAS chain. I queried the actual retained Jet database read-only: TabularManualDDuctsize contains **eight sections**; ST-140 has **0.150000006 in-wg AdditionalStaticPressureLoss**; SR-150 cumulative loss is **0.193379149**. The allowance is **77.5678%** of the total. The current PDF contains section flows, lengths and fitting codes, so it is more than a lone total. But neither those sections nor their Manual D fitting counts supply a Revit element/port mapping, and the allowance is not explained. [LEDGER:166](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/LEDGER.md:166) already asks the authors what it means. ASHRAE and Manual D fitting methods also need an explicit comparison basis.

   **Map correction:** Make acceptance a mapped section-by-section reconciliation with separate duct/fitting, return and typed-allowance subtotals; use 0.193379 only as the RHVAC reconstruction check.

17. **Important — One fast walk does not prove the 360-system experience.**

   **Claim:** The plan has no proof for roster-wide recomputation, overlapping walks or consistency during a batch.

   **Evidence:** [MAP:29](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:29) promises one-click recompute-all, and line 79 recomputes on every read. The sole latency criterion is one chain under one second at line 134. Even 0.9 seconds per independent native read would make 360 sequential reads **324 seconds**, before rendering or repeated shared-network work; this is an illustrative bound, not a measured runtime. One reading per fan can also straddle model or defaults changes. “360-plus systems” at line 11 is not itself a census of 360 independently writable fan records.

   **Map correction:** Add a roster census and batch budget covering native-read count, shared acquisition, time/memory and coherent basis; prove cold batch plus one changed-fan refresh rather than extrapolating one walk.

## E. Other contradictions

18. **Important — “One TypeScript engine” and “Pe_C via PeLossServer per leg” describe incompatible native write mechanisms.**

   **Claim:** The map retains a second calculation implementation while describing it as a writer of the TypeScript result.

   **Evidence:** [MAP:40](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:40) reserves pricing to TypeScript; [MAP:60](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:60) keeps DuctFittingPricing unchanged; [MAP:122](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:122) promises per-leg coefficients through Pe_C/PeLossServer so the native report agrees. In reality, [PeLossServer.cs:102](C:/Users/kaitp/source/repos/Pe.Tools/dotnet/Pe.Revit.Global/Lib/Mep/PeLossServer.cs:102) applies one positive family coefficient to every leg; otherwise line 112 invokes C# DuctFittingPricing using Revit's current connector flows. That is a second computation with potentially different flow inputs, not transport of a TypeScript per-leg result. [WHY-NOT-REVIT:313](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/WHY-NOT-REVIT.md:313) also rejects unconditional equality as the acceptance rule; later server work must be distinguished from the older single-coefficient limitation.

   **Map correction:** Name the native loss-server exception explicitly, choose transported per-leg results versus independent native recomputation, and specify parity tolerances, flow basis and stale-input behavior.

## Fix these three first

1. **Criticism 1 — Complete capture across disconnected continuations.** Automatic discovery is the product's advantage; a scope that excludes the critical continuation defeats it before pricing starts.
2. **Criticism 3 — Leg and junction flow assignment.** Every retained loss formula depends on it, and a fan design-flow parameter alone cannot supply it.
3. **Criticism 4 — Partial totals and critical-path certainty.** This prevents a helpful provisional number from becoming a false critical-path declaration or fan write.

These are prerequisites for judging the new engine. They do not require restoring groups, election, the inbox, or the abandoned hydraulic product.

## What the map gets right, verified

- **The engineering reference is path/section oriented.** The supplied RHVAC images and current PDF expose an ordered supply/return tree, section lengths/flows, fitting quantities and additional drops. Automated extraction addresses genuine manual entry.
- **Scoped agent reads address a documented failure.** The [black-box test](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/black-box-tests-2026-10-26.md:21) records a four-minute timeout while handling a 61,901,787-byte artifact. A compact result with inspectable detail is warranted.
- **A browser-independent route command fits the existing transport.** [capability-tools.ts:813](C:/Users/kaitp/source/repos/Pe.Tools/ts/packages/mcps/src/pea/capability-tools.ts:813) already dispatches a Ducts query directly to the host; the replacement need not inherit the current page's workflow.
- **The physics kernels are separable assets.** The inspected friction and rule functions consume sizes, flows and table inputs; their arithmetic does not require preserving a group-oriented UX.
- **The roster text does reserve confirmation to the engineer.** [MAP:76](C:/Users/kaitp/source/repos/Pe.Tools/docs/features/ducts/MAP.md:76), line 101 and line 110 distinguish suggestions from confirmation. There is no evidence that this map authorizes Pea to elect fans.
- **Element IDs are already present.** The Sheet does not omit them altogether; the missing pieces are document, connector, path and calculation-basis identity.

Grounding: read the map in full; inspected the shelf, relevant source and retained user turns; viewed all three RHVAC screenshots and the red-route image; extracted all five pages of the current MUAS PDF and visually inspected its calculation/summary pages; independently queried the retained .r10 through 32-bit Jet ODBC with ReadOnly=1. Native file SHA-256: **93ad94deb7133f7c8532aa828a27cfb08a8387875a48d413920dbbb5185a3b40**. The SQL selected Description, Length, CalculatedFlow, DesignLoss, AdditionalStaticPressureLoss, CalculatedSPLoss, CalculatedSPLossCumulative and CalculatedSPLossPer100Feet from TabularManualDDuctsize. Arithmetic, byte-count and direct equivalent-length-function probes ran without file outputs. One route-contract reader returned; its decisive claims were independently checked. No Revit session, browser, server or worktree was created.

**PROVEN[deterministic, read-only MUAS Jet query and compact-JSON/arithmetic probes recorded in this critique, cac7f9699dff0349de10bc37566aab43fd7bd455 with uncommitted MAP hash above, 2026-10-27 America/Chicago]. FALSIFIED[deterministic, retaining equivalent-length.ts unchanged cannot implement the map's all-losses-at-design-rate conversion]. UNPROVEN[native from-selector correctness and latency, roster binding/link behavior, final fan pressure requirements and proposed route runtime; no fresh Revit proof was performed].**

