# Product declaration map

This index records the landing at `90dbe51e`. The [routes ledger](LEDGER.md) holds the rulings and remaining work. The launch map is in Git at `90dbe51e:docs/features/routes/MAP.md`, including the original ruling 1 and slice numbering.

## Nouns and invariants

One product contract supplies the host, web and Pea projections. Commands declare where Work cells land. The kernel owns target admission and retained capture storage. [ADR 0059](../../adr/0059-product-declaration-owns-the-contract.md) records the boundary.

## Ordered deletable slices

| Slice | Final state | Evidence and owner |
| --- | --- | --- |
| D0 | Landed. Rulings and the home ladder are tracked. | [Homes](../homes/LEDGER.md), [ADR 0058](../../adr/0058-the-home-ladder.md) |
| W0 | Source gate and Knip passed. Aggregate verify remained red in Host, Web and browser. | `verify-90dbe51e.log`, [Host](../host/LEDGER.md), [Agent](../agent/LEDGER.md) |
| S0 | The Schedules, Family and Captures screens were archived. | [Routes](LEDGER.md), `s0-catalog.log` |
| S1, S2a, S2b | The contract package owns the route helpers and declaration grammar. Generated registration binds host and web. | [ADR 0059](../../adr/0059-product-declaration-owns-the-contract.md), `s2b-product.log` |
| S3, S4a, S4b | Fans, the shared Ducts base and Duct Systems use the declaration. The generator has one registration path. | [Fans](../fans/LEDGER.md), [Duct Systems](../duct-systems/LEDGER.md), `s4a-main-closure.log` |
| S5 | The Tutorial derives homes and writes. Shared Ducts labels in Fans are Owed. | [Fans](../fans/LEDGER.md), `drive-5f77d0ae/fans-tutorial-homes.txt` |
| S6, S7 | Declared loading and the plan picture landed. The picture pane has focused tests. | `s6-load-guards.log`, `s7-picture.log` |
| S8a, S8b | Rooms use the region record. DuctLossStore uses UniqueId. Fresh OwnerBlob tests passed. | [Rooms](../rooms/LEDGER.md), [Ducts](../ducts/LEDGER.md), [ADR 0057](../../adr/0057-an-unreadable-model-record-may-be-overwritten.md), `candidate-90dbe51e.md` |
| S9, S10 | Rooms and Takeoffs share a product. Exact-plan addressing, Rooms writes and Takeoffs Adopt were driven on private model copies. | [Rooms](../rooms/LEDGER.md), [Takeoffs](../takeoffs/LEDGER.md), `drive-90dbe51e/REPORT.md` |
| S11 | Fresh integrated proof of unnamed-home refusal is Owed. | [Homes](../homes/LEDGER.md), `ROWS.md` |
| S12 and wave G | The final drive lifted the Rooms integrity hold and exercised capture refresh overlap. The gateway is gone. Stop after native dispatch is Owed. | [ADR 0059](../../adr/0059-product-declaration-owns-the-contract.md), [Ops](../ops/LEDGER.md), `MAIN-MOVES.md`, `drive-90dbe51e/REPORT.md` |

Evidence filenames resolve under `.artifacts/runs/product-decl-20261120/`. Keep the run receipts while an Owed line or a decision relies on them for replay.

## Deletion criteria

The old product registration pointers, archived route implementations, old Rooms web tree and eleven Detail Item carriers were removed. The baselined tests and Family placement exception remain tracked by their owners. [Routes](LEDGER.md), [Family](../family/LEDGER.md)

## Risk tier per surface

- Integrity. Owner-record replacement, target-scoped Work, and mutation readback. [Homes](../homes/LEDGER.md), [Rooms](../rooms/LEDGER.md)
- Contract. Product composition, capture freshness and removal of archived commands. [ADR 0059](../../adr/0059-product-declaration-owns-the-contract.md)
- Presentation. The Tutorial home labels and plan picture. [Fans](../fans/LEDGER.md), [Rooms](../rooms/LEDGER.md)

## Decision log

- 2026-11-19, kaitpw, rulings 1 and 2: "i hate C, json isnt strong enough. d i doint like bc it brings backend stuff into web code, bleh. A + B seems the way to go".
- 2026-11-19, kaitpw, rulings 3 to 13: "agreed on all. family is mostly stable but i haent driven it substantially in a long time so its not worth the time. the last i remember we had lots of freshness/reactivity bugs".
- 2026-11-20, kaitpw, ruling 14: "100% yes to turning the carriers into doc record."
- 2026-11-20, kaitpw, ruling 15: "yes to placement. prove is kinda weird but not sure where would be better".

- 2026-11-20, kaitpw, on command-owned placement, "great, i like ur rec on lands. continue without me". Evidence in `RULES.md`.
- 2026-11-20, kaitpw, on dissolving the gateway with declared captures, "option 1". Evidence in `RULES.md` and `muse-sm30/reading.md`.
- 2026-11-20, kaitpw, on the placement wall, "Invert, move tests". Evidence in `RULES.md` and `wave/smell4.md`.
- 2026-11-21, the root lifted the Rooms integrity hold at `90dbe51e`. Evidence in `MAIN-MOVES.md` and `drive-90dbe51e/REPORT.md`.
