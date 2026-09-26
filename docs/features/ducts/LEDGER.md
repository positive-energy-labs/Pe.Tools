# ducts ledger

The `/ducts` route shows a Revit duct network and its metadata on a real project. It is read-only. It teaches the physics and prepares a pressure-loss judgment.

## Decided
- 2026-09-26, user supersedes the zero-clash acceptance gate: a connected, correctly sized run within its cap counts when Pea clearly reports remaining clashes for engineer review. Aim to avoid clashes and record severity separately; do not label unknown coverage clear. Designer CFM, no unintended changes, independent read-back and no human geometric rescue remain hard requirements.
- 2026-09-26, user clarification for duct-modeling experiments: check hard clashes against loaded architectural IFC and host geometry; do not invent a minimum clearance. Tight fits are expected. Unloaded links, service access and unspecified insulation allowances remain unverified; the local snapshot does not certify the evolving ACC coordination model.
- 2026-09-26, the unit of truth is the connector graph, not `MEPSystem`. On Chadds, 45 connected groups carry more than one system name and 31 mix supply, return and exhaust (census H).
- 2026-09-26, residential correctness has no single unit: room loads (Manual J), equipment capacity (Manual S), the critical path against available static pressure (Manual D), and the outlet (Manual T). Every check is a sum of demand from the terminals to the root, then a sum of loss from the root to the terminals.
- 2026-09-26, kaitpw: build `/ducts` as two work streams with two variants each, all on one shared backend. The verbs stay minimal: one op `ducts.snapshot` and one fetch verb `refresh`. Targeting a document or a group revalidates it with no press.
- 2026-09-26, the route uses the shared situation head and is a chat plugin, so counsel and Pea can drive it. The stability bar is `/rooms` and `/schedules`.
- 2026-09-26, the state model has one Reading `ducts` (the document index or one group) and one Work segment `assumptions`: user answers per issue and per-type overrides, with no Revit writes. The readiness of a group (walkable, then budgetable) is derived in TS and never stored.
- 2026-09-26, kaitpw: at least one variant draws the network as SVG so health is visible on the geometry. Each segment is one path styled by one encoding function, so the same drawing later shows flow, velocity and pressure drop.
- 2026-09-26, kaitpw: views draw the selected group, and the rest of the document is faint context.
- 2026-09-26, kaitpw: one `ISSUE_KINDS` module owns every issue kind's label, one-sentence meaning, the readiness level it blocks (walkable, budgetable or none) and its color token. Every view, table and Chat use it, and one hue family maps to each blocked level.
- 2026-09-26, each layer names the one Revit query that produced it and shows its coverage and provenance (geometry, Revit-reported, designer-stated, derived, `revit-default`).
- 2026-09-26, kaitpw: a chat-plugin claim counts only when it is proven on the real `/chat` route in a browser, driven by the T3 preview tools or the `chrome-agent` PowerShell tool.
- 2026-09-26, counsel ruling, re-openable: `ducts.snapshot` takes one request record `{ group?, assumptions?, context? }`. Without a group it returns the document index (groups, counts, layers). With a group it returns that group's elements, issues and pressure. `context` adds faint polylines for views. Why: Pea's first read of the 7.7 MB whole-document snapshot overflowed its context window on the real `/chat` route, and the solver pushed the estimate to 11.7 MB.
- 2026-09-26, the segments and issues tables list the selected group only. Unscoped, about 6,500 rows froze `master-table`.
- 2026-09-26, counsel ruling, re-openable: `ignore` resolves an open end and the advisory kinds only. A loop, no-root or multi-root issue needs a structural answer and always blocks.
- 2026-09-26, the pass-2 solver is pure C# (`ducts-solver` ec782eb6, `Pe.Shared.RevitData/Ducts`): it uses Colebrook friction, the hydraulic diameter `Dh = 4A/P`, and ASHRAE fitting rows with a citation each. An unmatched fitting gets the named default `assumed-one-velocity-head` (C = 1) and an issue, never 0.
- 2026-09-26, counsel ruling, re-openable: the route consumes the solver through `ducts.snapshot({ group, assumptions })`. Porting the solver to TS would duplicate tap splitting, coefficient choice and budgeting.
- 2026-09-26, the reader validates staged assumptions and solves the full capture before returning the selected group's pressure. Fan budgets need sibling supply/return evidence; slicing first fabricated missing connectors and changed circuit issues. Retained connectors name existing excluded peers with `outsideGroup`. Index reads still omit pressure and elements.
- 2026-09-26, the views draw the solver's critical path and color segments by cumulative loss from the root. Every pressure number discloses the assumptions it used. The ledger prints the Manual D equations and names each unknown term instead of inventing it (`ducts-pressure-ui` 10906797).
- 2026-09-26, pressure diagnostics collapse by kind with a count and one-sentence meaning; expansion exposes the exact elements and receipt reasons. `outsideGroup` and `outside-group` are neutral scope boundaries.

## Tried & rejected
- 2026-09-26, staging fan static alone did not complete the saved g8079765 or g8761260 Manual D budget. The old bounded solve lacked return evidence, and component drops remained unknown. The reader now solves the full capture; the pressure UI still preserves unresolved circuit terms.
- 2026-09-26, live `ducts.snapshot` on Chadds takes about 7 s per read against a 5 s target. The collector traverses the whole document on every call, and the bounded reading bounds only the payload.
- 2026-09-26, Colebrook parity with Revit's saved section losses: 45 of 50 match, and 5 do not. All 50 match Altshul-Tsal, so Chadds's duct settings most likely select Altshul-Tsal. Production stays on Colebrook, and Altshul-Tsal lives in a diagnostic test only.
- 2026-09-26, trusting Revit's calculated duct values: 0 of 4571 fittings on Chadds have a pressure drop, because the loss method is "ASHRAE Table" with no table chosen. Revit gives a critical path on 9 of 335 systems, with friction only. Use it as a test oracle, not as a result.
- 2026-09-26, feeding the whole Chadds `ducts.snapshot` to Pea in real `/chat`: the 7,736,648-byte `pe_read` result exceeded `openai/gpt-5.6-terra`'s context window before any answer or proposal. Thread `90c33808-d3d3-4043-bc17-a1d8806eeddf`; human staging and unstaging worked in the same Chat pane.

## Owed
- Promote the cited research (`.artifacts/research/mep-networks/A-D`, `H`) into `docs/features/ducts/RESEARCH.md` before the artifacts are swept.
- Establish smooth-round fitting construction from reliable metadata. Native r/D capture is repaired, but no Chadds fitting has both known construction and r/D, so no sourced fitting row matches.
- Cache the captured duct graph per document change mark, so group reads stop re-collecting the whole document.
- The Altshul-Tsal inference stays open: Revit names its server only as "Duct Pressure Drop … Darcy method".
- A root assumption (equipment pass-through, or naming the root port) for the 73 multi-root groups. The `assumptions` Work schema has no key for it yet.
- kaitpw rulings on the model muse (`.artifacts/handoffs/2026-09-26-ducts-model-muse.md`, section 6):
  1. Adopt shape C, a Revit-free graph of parts and ports with explicit internal air paths, where Revit bindings are optional?
  2. Keep room CFM designer-assigned, with loads as evidence and Pea proposing terminal allocation?
  3. Accept the first bar: one fan circuit, complete terminal service, reviewed loss inputs, post-write readback?
- kaitpw verdict: which of the four variants (S1 plan, S2 isometric, T1 schematic tree, T2 table ledger) survive as views.
- Finish the `r24` Pe.App net48 compile: integration reaches the unchanged `Pe.Revit.Takeoff/Kernel.cs:69` use of `SkipLast`, which net48 does not provide. Route rendering and cross-view selection now have deterministic checks.
- Remove the residual `C:/Users/kaitp/source/repos/Pe.Tools-ducts-baseline-int` directory: `git worktree remove` unregistered it but could not empty it; automatic approval review blocked the follow-up recursive deletion.
- Remove the residual `C:/Users/kaitp/source/repos/Pe.Tools-ducts-bounded-baseline` dependency directory: the untouched `a8941ba9` checkout reproduced the 75-second chat lifecycle timeout, then `git worktree remove` unregistered it but left `ts/`; automatic approval review blocked the follow-up recursive deletion.
