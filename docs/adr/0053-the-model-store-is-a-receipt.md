# 0053: The model store is a receipt, never a value layer

Date: 2026-11-18. Status: built in TypeScript (run `field-20261118`, slices V1 and V5); the Revit journey J-V1 is owed. Source: kaitpw's rulings D1, D2, D3 and D8 in `docs/features/ducts/LEDGER.md` (Decided, 2026-11-18). Supersedes [ADR 0030](0030-pea-first-goal-core-plan-statecell.md) rule 9's sentence on retired cells, as far as it covers design values, and the layer order in [ADR 0026](0026-one-route-shell.md). The rest of both stands.

## Context

ADR 0030 rule 9 said a cell retired into the model store (`_PE_DuctLosses`) "resolves through the model-store layer at equal precedence", and ADR 0026 put the model store above the model in the layer order. So a terminal flow, a terminal drop or a unit flow that Pe once wrote kept pricing from the stored copy after a person changed the parameter in Revit. The calc then minted a required ESP from a number the model no longer held and wrote it. The sheet could not show the difference, because it compared the store with itself.

The stored number is our own metadata. Revit's parameter is what schedules, Revit's own calculations and other engineers see. kaitpw, D1: "100% yes, this is why we started unwinding local storage and browser in mem".

## Decision

1. **Live Revit wins.** A design value (terminal cfm, terminal drop, unit cfm) resolves from the parameter it is written to, read live. The model store supplies no design value, and no criterion: the layers for a value are run → Work → the live parameter (`model`) → the homes → default.
2. **The store keeps a receipt.** What Pe last wrote to a parameter stays in the store as evidence. It is compared with the live read in one place (`receiptDrift` in the ducts domain) and a disagreement is shown as drift on the cell: the binding's model layer carries `drift` beside its note, and the sheet kernel ORs it into the cell's one `drift`, the same signal a Work edit raises. The comparison allows for the reader's rounding (4 places on a slot parameter). Drift never blocks, and no write re-asserts a receipt.
3. **A written parameter outranks the catalog lookup** (D2), whether or not its receipt still agrees. The lookup is not run for a written terminal. Without a receipt the catalog keeps its place above the parameter.
4. **A receipt whose parameter no longer reads makes the value missing** (D3), never the stored number and never the firm fallback beneath it. The drift note names the parameter. The reader tells absence from a reading: an absent or empty parameter is null, and one that reads 0 is 0, so a written zero stays a value. A unit flow that resolves 0 from `model` is therefore a 0 Pe wrote, and the fans calc keeps it as the unit's flow and its share, as it did while typed.
5. **A terminal drop is read from its TerminalDrop slot parameter only.** Resolved slots always name one, and with a slot named the applier refuses a terminal that lacks the parameter; it never falls back to the connector's AssignedPressureDrop. So no receipt points at the connector, and the connector's drop is not a rung.
6. **Rulings stay store-homed.** A role, a verdict and a rule table have no Revit parameter, so they still retire from Work into the store and resolve from it at the `model-store` rung.
7. **A catalog lookup is labelled by its home's tier** (D8): `user`, `project` or `firm`, the words `homesStatus` uses. The catalog reader takes the tiered home list as given and stamps each table with the tier and its file; it never assigns a tier itself. The served table shape requires its home, so a table recorded before the stamp is refused at replay; the recording does not say which home it came from, so none is stamped.

## Consequences

- A hand edit in Revit reprices on the next read. A side-stream unit flow that Pe wrote is, once retired, the unit's design parameter and no longer a typed assertion.
- A model whose store holds a value that was never in a parameter loses that value. `Compose` records a receipt only for a write that landed, so no such value should exist.
- `user` joins the shared value sources, between `model` and `project`.
- The dead store fields `criteria` and `kinds`, which nothing wrote, are gone from the resolver.
