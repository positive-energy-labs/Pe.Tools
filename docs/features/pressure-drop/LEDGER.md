# pressure-drop ledger

The surface that makes a firm model compute duct and pipe pressure drop: a grille-first table where fitting losses are set by type, Pe computes the critical path and fan static pressure, and values are written into Revit so they travel with the model. Campaign evidence (a real client model, NDA) stays gitignored in `.artifacts/pdrop/RECORD.md`; prototypes in `.artifacts/pdrop/protoui/`.

## Decided
- 2026-10-04, Revit's arithmetic is right and its automatic fitting route is dead. PROVEN[session, controlled `walkthru`, R2025 detached copy]: straight duct matches a hand calc within 0.1%; "Coefficient from ASHRAE Table" computes 0 on every duct fitting in R2025 and R2026, still after Autodesk's ASHRAE registry cleanup; "Specific Coefficient" is exact. One small supply system hand-set end to end: Revit critical path 0.1105 in wg against 0.1107 by hand.
- 2026-10-04, root cause of "nobody fixes it", first principles: the number has no reader (fan static pressure comes from a rule of thumb, never from the model); the state is invisible (a duct-fitting schedule can show no loss method, coefficient, drop or flow); it is per-instance with no type default, so every drafter edit resets it; the default reads zero with no error; and the largest term is the grille's catalog drop, not any fitting. The product creates the reader and makes the state visible; the coefficient setter alone speeds up the fast part.
- 2026-10-04, kaitpw: the grille (air terminal) is the unit a person thinks in. Audit and edit both start from the grille, never from a duct element.
- 2026-10-04, kaitpw: the thing a person edits on a fitting is the fitting type's table, never a raw coefficient. The rule is family:type plus a geometry condition (a die-stamped elbow table stops at 10 in; the same transition family is a contraction at the unit and an expansion at the grille), and Pe re-looks-up every instance's coefficient from Revit's shipped ASHRAE grids. Instances appear only on request.
- 2026-10-04, kaitpw: Revit's own number sits beside Pe's. Pe computes the critical path itself (it does not need a placed air mover, a whole system, or a family that accepts a drop), and Revit's number is the check that the model has become whole.
- 2026-10-04, kaitpw: Revit-first for what travels (coefficients and drops written into Revit where the family accepts them), Pe in control. Extensible storage is banned (firm history); provenance follows the param-tables precedent, one versioned JSON blob in a hidden Project Information text parameter.
- 2026-10-04, kaitpw: terminal and unit drops are typed per project for now; carrying them on the family library is a larger `/families` and doc-lab story. Health recomputes on open or a long trigger, never continuously.
- 2026-10-04, kaitpw (protoui round 2): **F, grille drawer**, is the shape: the grilles only, each a bar segmented by what eats the pressure; open one and the rules on its path appear under it with their table picker. PROVEN[deterministic, kit check, `.artifacts/pdrop/protoui/index2.html`]: switching the taps' table re-looks-up 4 instances and moves the fan number.

## Tried & rejected
- 2026-10-04, round 1 (A ledger of every element, B route tree, C grille bars with per-element edit, D proposal queue): C won both audit and edit, but editing per element was the wrong grain; A and B show the route a person does not think in; D needs a rule engine first (kept as a later layer).
- 2026-10-04, round 2 (E rules table above grilles, G rule × grille matrix): E makes the rule-to-grille relation a hover; G is dense and cannot hold 67 systems. Both lose to F.
- 2026-10-04, an "as found" before-snapshot toggle: kaitpw, not necessary.
- 2026-10-04, a shadow store where Pe never writes to Revit: nothing travels with the model and native sizing stays dead.

## Owed
- Port `/ducts` to `manifest.url` (`view`, `group`, `level`, `layers`, `selected`) when the branch merges: main's `route/url.ts` (2026-10-04) replaces the hand-written search mirror in `routes/ducts.tsx` and `ducts/route.tsx`; drop the `text()` numeric shim and the `replace: true` effect.
- F's own con: a table changed under one grille silently moves every other grille that shares the rule. Round 3 must show the fan-out before the change lands (cite the design-system fan-out primitive gap).
- Rulings still open from round 2: rule grain (type, type plus condition, part type); instances hidden, count-expands, or exceptions only; the grille as a rule row or its own table; what Pe writes for a tap, which Revit holds one coefficient for.
- Where fan static pressure lands. Counsel: on the unit in Revit so it travels, and as a typed column on the Units card wall until the workbook can read it from Revit. kaitpw has not ruled.
- Promote the table reader and type rules (`.artifacts/pdrop/sa26/ctable.py`) into a package; it is the rule engine the product needs.
- The automatic ASHRAE route: an Autodesk case if it ever matters; the Specific Coefficient route does not depend on it.
- The firm-wide cited catalog store is owed in `docs/features/design-system/LEDGER.md` (IMPORTANT, deferred); grille drops are its first consumer.
