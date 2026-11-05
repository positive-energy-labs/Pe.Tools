# 0030: Pea first; the route core is a Goal, a write is a plan, every Pea-touchable value is a StateCell

Date: 2026-11-04. Status: accepted. Source: kaitpw's rulings in the kernel room (`C:\Users\kaitp\muse-rooms\kernel-20261104\SPEC-ADDENDUM-PEA.md`, every ruling section), after kernel muse rounds 9 to 11 (four clean-room designers, two codebase reps; evidence `.artifacts/runs/kernel-muse-20261104/evidence-r9-rep-*.md`) and the hub argument with the four implementing threads (`.artifacts/runs/spook-20261104/ROUND2.md`, `ROUND3.md`, `reply3-*.md`). Amends [ADR 0028](0028-seven-nouns-two-clients-one-catalog.md) items 3, 4 and 6 and its write-boundary seal; amends [ADR 0027](0027-one-route-one-subject-one-consent.md) rule 10; amends [ADR 0026](0026-one-route-shell.md) on the Timeline and on how Pea reaches a Page. Counsel's three choices are marked OPINION and stay re-openable. Frontier: [routes MAP](../features/routes/MAP.md).

## Context

kaitpw stated the goal after round 8: "every route logic core should double as the pea interface, and ui fetches." Restated: one host function is the route's core. Pea calls it, and the UI fetches the same output. The output tells Pea what is still unresolved. kaitpw also named the ladder: "1. make C# modules to solve a revit problem ... 2. ... wrap that C# surface into public ops accessible via mcp and publish a skill, 3. if theres clear potential/upside for making a human-pea collaborative surface ... then we build a product on top." Restated: rung 1 is a plug-in module, rung 2 is a public op plus a skill, rung 3 is a product route. A lower rung never depends on a higher one.

The terrain at bb447ddf (source reads, no runtime claim): Pea already has three generic tools over the generated catalog (`ts/packages/mcps/src/pea/index.ts:74-85`), and the catalog hides `Internal` leaves (`ts/packages/mcps/src/pea/capabilities.ts:47-58`). Pea's Work tools drop every admitted route (`ts/packages/mcps/src/pea/routes.ts:24-30`, `ts/apps/host/src/app.ts:263`), so Pea has no Work door on /ducts or /fans. The fan sheet already returns typed blockers with closer kinds, assumed blockers, `next`, inputs with source and status, and a roster row with a `complete` flag (`ts/packages/agent-contracts/src/ducts-sheet.ts:301-325,427-443,537-541`); it lacks only who resolves each item. `ducts.apply.preview` is declared `TransactRead, RollsBack = true` and opens no transaction (`dotnet/Pe.Revit.Global/Services/Host/RevitDataRequestService.cs:117-121`). The gate forced that declaration: `OpCallGate` refuses a TransactRead without rollback (`dotnet/Pe.Shared.HostContracts/Operations/Op.cs:514`), and the linker requires every ModelWrite command to bind a TransactRead preview (`ts/packages/agent-contracts/src/catalog.ts:71,84-89`). The kit has one state-cell component (`ts/packages/kit/src/components/lang/cell.tsx`, `cell-state.ts`) and one plan-then-apply button that only the design-system specimen uses (`preview-action.tsx`). Work binds four ways (`ts/packages/agent-contracts/src/route-state.ts:42-64`), and three routes key Work by subject on purpose. Attention is a read projection, not a lease (`docs/features/agent/LEDGER.md:138`), and four routes publish none on purpose (`docs/features/routes/LEDGER.md:53`). Pea answered 8 of 8 from an element fact sheet and 0 of 4 from the picture of the same view: the picture is for the person, the fact sheet is for Pea. Pea failed at modeling through scripts.

## Decision

**Discovery**

1. **Catalog first.** Pea's doors are three generic tools, find, read and do, over the generated catalog plus the live availability overlay (ADR 0028). There is no tool per op. Typed write leaves stay `Internal`, and the bridge refuses them. No projection filters routes out of Pea's doors: a route's Work doors project from the catalog like every other entry. The admitted-key filter is the defect V3 in the routes MAP.
2. **A route-free write.** A typed ModelWrite reaches Pea with no route when its author declares a Work schema with stable-keyed cells. Pea stages cells in that Work, then plan, the Reject? window, then apply. kaitpw: "yes, whatever the simplest and most principled home for this is is fine for now." Restated: the staged cells live in ordinary Work, and the author chooses nothing else. OPINION (counsel, adopted): that Work is owned by the write's stable owner key, and a later Page attaches to the same owner with no ownership transfer. A later route reuses the identity, the journal and the staged history.

**The goal core**

3. **A route's core is one host Read that returns a Goal**: `unresolved` closers, each with a `resolver` (person, pea or op), `assumed` closers, `next`, `inputs` as StateCells, and a result that is `complete` or an `estimate` with its sources. Pea reads the same Goal the UI fetches. kaitpw: "What is left comes first." Restated: the route leads with the unresolved list, and the answer stays greyed until that list is empty. kaitpw: "An incomplete answer is shown as a greyed estimate with its sources." No author certifies an incomplete answer.

**Writes**

4. **Plan, optional rehearse, apply.** A plan is a Read with an empty footprint. It derives the request from Work and returns the seal: request hash, consumed Work handles and revisions, document mark, dependency hash. A rehearse is declared per op and is optional. It is a TransactRead that rolls back, and it alone earns the mark "checked in Revit". kaitpw: "I only ever wanted preview for revit rehearsed stuff. What even would be the point of rehearsing for say the file system." Restated: preview means a rollback rehearsal inside Revit, nothing else. A plan that opens no transaction is a Read. There is no fidelity enum. Apply takes the seal, rechecks it, and refuses "plan first" or "plan changed" without dropping input. The seal binds to the plan, never to a rehearsal. The linker rule "a ModelWrite binds a TransactRead preview" becomes "a ModelWrite binds a plan whose effect is Read or TransactRead". This retires V1.
5. **A rehearsal never borrows.** A rehearsal that would take ownership of elements in a workshared model is refused before any transaction opens, and the refusal names the elements. The plan still runs. kaitpw: "yea a for now i guess. again whatevers simpler here." Restated: refuse and explain. Nothing rehearses and then relinquishes.
6. **One write button.** Idle, then plan or rehearse, then apply. It shows before and after as StateCells with their authors inside the Reject? window. It drops back to idle when any consumed input changes. It is one shared kit component.
7. **A script receipt claims only what it proves**: input, exact source bytes and hash, process incarnation, document census and footprint, outcome. No before-values. kaitpw: "revit is extremely fragile, finicky, and unpredictable. dealing with this explodes complexity."

**StateCell**

8. **Every value Pea can touch is a StateCell**: current value, model value (struck), pending author (person or Pea), drift, freshness, source. kaitpw: "in general everything pea can touch should be a statecell i think. like honestly most inputs across our uis." Pea stages; there is no suggestion lane. kaitpw: "accepting a suggestion is kinda just ceremony." One field per cell: last writer wins, the cell shows the author, undo restores the earlier value, and Pea may overwrite a person's staged value (kaitpw: "I think fine"). Nothing reaches Revit before the pending write shows before and after with authors inside the Reject? window. Batch review near the conversation and in-place review in the route body are two views of the same staged cells.

**Work**

9. **One identity and one journal per stored Work**, however its key is spelled (document, subject, workspace, host). Every read of Work returns its handle. A Work has one owner. A cell another route owns is edited on the route you are using, carries a "from /owner" label, and the edit lands in the owner's journal through the owner's handle. kaitpw names /ducts' route settings behind the settings icon as the pattern /fans follows. A cell retired into the model store (`_PE_DuctLosses` for ducts) leaves Work on a receipt and resolves through the model-store layer at equal precedence. A document Work may fork to a standalone scenario; a standalone is never promoted into a document. OPINION (counsel): Subject stays a route field, not a noun. OPINION (counsel): a portable file (a Pod member, the firm file) is a home of Work, not a noun named Artifact.

**Page**

10. **Nine roles with a total policy** each: URL presence, share, agent default and decode. Pea's decoder is a page-input path, so the policy covers decode. Pea moves the view only when the person asks, and the move pushes history so Back undoes it. kaitpw: "yes, perfect." Pea highlights without changing the selection: Pointers is a shell list per thread, "Pea is pointing at", kept until dismissed. There is no annotation role. Attention is an opt-in read projection published by routes with an agent block; it is not a lease invariant, and four routes publish none on purpose.

**Timeline**

11. **The Timeline is a projection** over receipts, invocation starts (a press shows before its receipt), open consent windows and the Work journal. Labels derive; they are never stored, so a label can never contradict a receipt (Manual D defect J). ActionJournal stays the execution owner. History and the undo barrier derive from the Timeline.

**Pod**

12. **The Pod floor is a folder with `index.html` plus scripts** on the find, read and do doors. A Pod appears in find. Promotion to a route is trusted JavaScript by hash and adds attention, selection, owned Work and History. A Pod adds no native op. Deactivation keeps data.

**The ladder**

| Rung | The author writes | The author gets |
|---|---|---|
| 1 plug-in | one C# op: input, output, effect, subject, touches, cost, example, `rehearsable` where Revit can rehearse | schema, catalog row, link check, journal execution, receipts, consent by footprint |
| 2 public op | a read: audience and a skill paragraph. A write: one Work schema. A Pod: `index.html`, a script, a manifest | the three doors, Pea staging into StateCells, plan then apply with the Reject? window, the borrow refusal, History |
| 3 route | one core returning a Goal, one declaration, pane bodies; or a Pod page promoted | deep links, roles, attention, selection, Pointers, the unresolved list first, "from /route" edits, the History rail, the fixture lane |

## Consequences

- ADR 0028 item 3 (Page) is replaced by rule 10; item 4 (Work) keeps the resolver and gains rule 9; item 6 (Timeline) keeps ActionJournal as owner and becomes rule 11; "only ModelWrite is sealed at preview" becomes "sealed at the plan" (rule 4). ADR 0028's "Pea uses the lease" becomes attention and Pointers. ADR 0027 rule 10 "shows a preview of exactly what it sends" becomes "shows its plan"; rule 12's undo now covers Pea's staged cells. ADR 0026's Timeline paragraph becomes rule 11.
- ADR 0029: a plan runs on the request fiber as a Read; apply runs under journal ownership (rule 10 there); the borrow refusal and "plan changed" are typed failures (rule 5 there).
- Owed enforcement, frontier in the routes MAP: the linker and `OpCallGate` change; `ducts.apply.plan` as a Read; the V3 filters deleted; the V2 preflight rewritten; StateCell as the one drawing in production; Pointers; the one write button adopted by /ducts and /fans; a census of the write ops with stable-keyed inputs as the first route-free set.
- Rejected: a Pea tool per op; a suggestion lane; an annotation Page role; attention as a lease invariant; stock pane templates as the Pod floor; a generated Work per ModelWrite (10 of 21 write inputs take element ids); a Fidelity enum; rehearse then relinquish; Subject and Artifact as nouns; Route renamed Product.
- Every stake is a source read at bb447ddf. The borrow refusal on cloud worksharing is UNPROVEN: the file-central experiment did not reproduce a borrow (`dotnet/Pe.Revit.Tests/Proofs/DuctHealWorksharingProofTests.cs:47-50`), and the cloud incident is unexplained (`docs/features/ducts/LEDGER.md:223`).
