# Snowdon Circuits

Read electrical circuits in your own licensed Revit Snowdon Towers electrical sample. This Pod ships authored sources only. It includes no model, saved circuit readings, binding or user state.

1. Open the electrical sample from your licensed Revit installation. Save a disposable copy whose title contains `copy` or `sandbox`.
2. Import this Pod and open `page:@snowdon-circuits/pages/tour`. Bind it to that document with the chip.
3. Press **Read circuits**. Filter by panel, circuit, load or element id. Select a row to fill the calculator and highlight its connected loads and wires. **Inspect selected circuit** reads the native circuit facts again.
4. Missing material, length or conductor size requires an explicit calculation override. Overrides change the worksheet only. The calculation uses copper K = 12.9 at 75 C, one-way feet and apparent amperes. It assumes unity power factor, negligible reactance and balanced three-phase loads. Poles 1 and 2 use the single-phase two-wire calculation.
5. **Prepare proposal** reads exact native wire parameter evidence. A writable string parameter can be changed only by **Approve and apply wire change**, on a disposable copy, through `revit.apply.parameter-values` with expected evidence. Revit normally calculates Wire Size and exposes it read-only. That refusal is shown; the Page never substitutes a Comments write or claims it resized conductors.
6. **Export snapshot** downloads one HTML file with the document and export time, the circuit reading, calculator inputs and source. Tables and calculations still work offline. Revit doors and approval actions are absent in the snapshot.

The typed `revit.catalog.electrical-circuits` operation owns discovery and circuit/member identities. `src/Census.cs` supplies explicit-unit voltage, apparent current and one-way path length because the typed catalog has formatted voltage/current and omits length and material. `src/InspectRun.cs` reads circuits containing Revit's current selection. Values Revit cannot compute remain null.

The house instruments come from `pe.kit`, loaded by `/pages/pe.js`. Edit `pages/tour/page.js`, `circuits.mjs`, `calc.mjs` and `index.source.html`. From `ts`, run `pnpm --filter @pe/kit build` to regenerate `index.html`, then run kit tests. The source tab retains the authored calculator and page code.

Use the `circuit-drop` skill to derive a Pod with a new manifest id. Keep readings separate from shipped sources. Check ampacity, derating, reactance, load balance and the full circuit design independently; this worksheet is a design comparison.
