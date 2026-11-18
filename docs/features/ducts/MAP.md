# Field values map

Run `field-20261118`. One coupled change: where a duct or fan value comes from, and that every surface shows the value the calculation used. Source: kaitpw's rulings of 2026-11-18 on the fans handoff (`.artifacts/handoffs/fans-homes-primitives.md` in the root checkout, findings 1, 3, 4, 8, 9, 11 and field item 2). The handoff holds the evidence, the witnesses and the line references; its line numbers are from `72cba949`, so find each place by name.

This map is a spec. It says what must be true and what proves it. The implementor phases the work and writes the `Wave:` and `Estimate:` lines (kaitpw, 2026-11-18: "I find its usually better when the implementor phases its won work").

## Nouns and invariants

- **Design value**: terminal cfm, terminal drop, unit cfm, ESP, component drop. It lives in a Revit parameter, reached through a slot.
- **Slot**: the name of the Revit parameter a design value is read from and written to. Firm configuration.
- **Receipt**: what Pe last wrote to a parameter, kept in the model store `_PE_DuctLosses`. A record, never a value.
- **Drift**: a live parameter that disagrees with its receipt. Shown, never blocking.
- **Criterion**: a number that decides a computed result and is not a Revit parameter (the auto-join gap, a velocity limit).
- **Resolution**: the host's answer for one value: the value, its source word and its tier.

Invariants, each from a ruling:

1. Live Revit wins. A design value resolves from its parameter, read live. The model store never supplies a value, and no write re-asserts a receipt (D1: "100% yes, this is why we started unwinding local storage and browser in mem").
2. A parameter Pe has ever written outranks the catalog lookup, whether or not its receipt still agrees (D2, reworded).
3. A receipt whose parameter no longer reads makes the value missing, never the stored number (D3).
4. Slot names live only in settings, over the C# default. The model carries none that feed resolution (D4).
5. One resolution, drawn everywhere. The sheet draws the host's resolution and computes no ladder of its own, so a label and the priced value cannot differ (seam S).
6. Every shown value carries a source word. The roster ESP word is "computed", or "partial" when incomplete (D6).
7. Catalog tiers are `user | project | firm`, the words `homesStatus` uses. The catalog reader consumes the home list and never assigns a tier (D8).
8. A /fans apply never persists or retires duct-systems rulings (D9).
9. A view request for a subject that does not resolve is refused by name, never answered "rendered" (field item 2).

## Ordered deletable slices

The order is a suggestion; the implementor may change it and says why in its wave report. Each slice lands alone and leaves less code than it found unless its line says otherwise.

| Slice | What must be true after it | Falsifier, red at the base | Paths the falsifier observes |
|---|---|---|---|
| V1 live value (finding 4; invariants 1, 2, 3) | The value rung fed by `_PE_DuctLosses` is gone from every ladder. A hand edit in Revit reprices on the next read, and the receipt shows as drift. | The handoff's witness `w4` prints the Revit value with a Revit source (today: "terminal cfm (Revit 200) → 150 model-store"). A second case: a receipt with an unreadable parameter resolves missing. | `ts/products/ducts/domain/src/calc/`, `ts/products/ducts/host/src/` |
| V2 slots (finding 3; invariant 4) | No slot name is read from the model for resolution. With no tier naming a slot, the C# default serves, with source word `default`. | The third line of witness `w1` no longer reads `model`. A model that stores a slot name resolves the same as one that stores none. | `ts/products/ducts/domain/src/calc/`, `ts/products/ducts/host/src/`, `dotnet/` duct snapshot slot code |
| V3 one resolution (finding 1; invariant 5) | The sheet row draws the host's resolution. /duct-systems draws each criterion once. | Witness `w1` prints the same value and source on `PRICED` and `LABEL` (today 9 Work against 5 firm). | `ts/apps/web/src/route/slots/sheet/`, `ts/products/duct-systems/web/src/`, `ts/products/ducts/host/src/` |
| V4 source words (finding 9; invariant 6) | No value on /fans or /duct-systems is drawn without a source word. | A test that walks the roster and the sheet cells and fails on an empty source. | `ts/products/fans/`, `ts/products/duct-systems/web/src/` |
| V5 catalog tiers (finding 8; invariant 7) | The catalog reader takes the tiered home list as given, and the drop ladder has a tier rung for the catalog, apart from the parameter's rung. | A catalog served from the project home reports `project`, and one from the firm home reports `firm`. | `ts/products/ducts/host/src/` catalog reader, `ts/products/ducts/domain/src/calc/` |
| V6 apply stays in its route (finding 11; invariant 8) | A fans apply stores its own roles only. `retireWork` takes its route from the executing route. | A staged /duct-systems verdict is still staged, and not in the store, after a /fans apply. | `ts/products/fans/host/src/`, `ts/products/ducts/host/src/`, `ts/products/ducts/domain/src/staged.ts` |
| V7 honest view ack (field item 2; invariant 9) | The route resolves its subject against the live read before it acks. | `set-view` with a made-up fan id is refused and names the id (the field case: `UniqueId:f2f7a0d6-placeholder` answered `rendered`). | `ts/apps/web/src/route/view-bridge.ts`, `ts/packages/agent-contracts/src/route-kernel-codecs.ts` |

Journey rows, driven on a real Revit session on a copy of the Chadds clone, in the tail:

| Row | Journey | Own route folders |
|---|---|---|
| J-V1 | Edit one terminal's flow by hand in Revit. /fans reprices from the new flow, shows drift on that terminal, and an apply writes an ESP computed from the new flow. | `ts/products/fans/web/`, `ts/products/fans/host/` |
| J-V3 | With a firm criterion and a different staged one, the /duct-systems row shows the value and source that pricing used. | `ts/products/duct-systems/web/`, `ts/products/duct-systems/host/` |
| J-V7 | Pea asks /fans to show a fan that does not exist and is told so by name. | `ts/apps/web/src/route/` |

Not in this run:

- Deleting the per-model Work home of a criterion (D5). kaitpw, 2026-11-18: yes, but only after a person can make a project home from the product. V3 fixes the wrong label now and leaves the Work rung.
- Anything in the Converge run's files: `ts/apps/host/src/action-journal.ts`, `command-*.ts`, `native-receipts.ts`, `receipt-services.ts`, `call-route.ts`, `ts/apps/web/src/ops/route.ts`, the four `recoverAction` call sites in `ts/packages/mcps/`, and the SDK's `OpAttempt`. A slice that needs one stops and writes an owner-queue item.
- The homes resolver: `product-paths.ts`, `content-roots.ts`, `homes-config.ts` and the C# `ProductPathing`. This run consumes them.
- The Revit loss server's `PeDuctLossResults`, which is live and stays.

## Deletion criteria

- The model-store value rung, and every reader of a stored value or a stored slot name for resolution, has no importer left.
- The sheet's own ladder over project and firm is deleted, with the false claim beside it in `ts/packages/agent-contracts/src/tiered-setting.ts`.
- The duplicate criterion rows in /duct-systems are one row.
- The run's net production lines are negative. A slice at twice its line estimate, or growing against its sign, stops and is planned again.

## Risk tier per surface

| Surface | Tier | Why |
|---|---|---|
| Value resolution in the ducts domain and host (V1, V2, V5) | high | It decides numbers written into a project model. Non-author review, and a mutant run on the ladder. |
| Fans apply (V6) | high | A write path across two routes. Non-author review. |
| Sheet and roster drawing (V3, V4) | medium | Wrong label, right number. |
| View ack (V7) | medium | A route-kernel seam every route shares. |

Amendments owed with the build, written by the implementor as a new ADR that supersedes: ADR 0030 rule 9, and the layer order in ADR 0026 (the model store leaves the value layers).

## Decision log

- 2026-11-18, kaitpw: D1 to D9 as recorded in `docs/features/ducts/LEDGER.md` (Decided, 2026-11-18). D5's deletion waits on project-home creation ("2 yes").
- 2026-11-18, kaitpw: the map is a spec and the implementor phases its own work. This differs from the root charter, which has the root group the waves and run a plan check with readers before writers launch.
- 2026-11-18, kaitpw, on scope: "i never meant for it to become a kernel crusade". No kernel file is in this run.
