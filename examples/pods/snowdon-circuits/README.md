# Snowdon Circuits

Read electrical circuits in your own licensed Revit Snowdon Towers electrical sample. This Pod ships authored sources only. It includes no model, saved circuit readings, binding or user state.

1. Open the electrical sample from your licensed Revit installation. Save a disposable copy whose title contains `copy` or `sandbox`.
2. Import this Pod and open `page:@snowdon-circuits/pages/tour`. Bind it to that document with the chip.
3. Press **Read circuits**. Filter by panel, circuit, load or element id. Select a row to fill the calculator and highlight its connected loads and wires. **Inspect selected circuit** reads the native circuit facts again.
4. Missing material, length or conductor size requires an explicit calculation override. Overrides change the worksheet only. The calculation uses copper K = 12.9 at 75 C, one-way feet and apparent amperes. It assumes unity power factor, negligible reactance and balanced three-phase loads. Poles 1 and 2 use the single-phase two-wire calculation.
5. **Prepare proposal** reads exact native wire parameter evidence. A writable string parameter can be changed only by **Approve and apply wire change**, on a disposable copy, through `revit.apply.parameter-values` with expected evidence. Revit normally calculates Wire Size and exposes it read-only. That refusal is shown; the Page never substitutes a Comments write or claims it resized conductors.
6. **Export snapshot** downloads one HTML file with the document and export time, the circuit reading, calculator inputs and source. Tables and calculations still work offline. Revit doors and approval actions are absent in the snapshot.

The typed `revit.catalog.electrical-circuits` operation owns discovery and circuit/member identities. `src/Census.cs` supplies explicit-unit voltage, apparent current and one-way path length because the typed catalog has formatted voltage/current and omits length and material. `src/InspectRun.cs` reads circuits containing Revit's current selection. Values Revit cannot compute remain null.

The Pod also declares **Voltage Drop** in the Home tool directory and global palette. Open it, review the source, and trust its exact SHA-256 as a human administrator. Route code runs with the shell's browser authority; this is trusted extension code, not a sandbox. Importing a Pod does not approve its routes. An edited route requires renewed trust. Disable the Pod to remove its routes. Trust stays on this machine and is never exported.

The verified route bundle becomes one kernel RouteGraph. Its saved Work holds calculator inputs independently of the document chosen for operations; selecting a different document preserves those inputs. The kernel owns the target picker, action review, history and undo. Revit reads and proposals use the exact selected target. Open the route with `?fixture=calculator` to use in-memory Work without host access. The Page keeps its own chip binding and portable snapshot form.

The house instruments come from the shell's React and `@pe/kit`, or from `pe.kit` through `/pages/pe.js`. Edit `pages/tour/instruments.mjs`, `circuits.mjs`, `calc.mjs` and `styles.mjs` once for both forms. `page.js` adapts the Page kernel; `routes/voltage-drop/index.source.mjs` explicitly promotes the instruments to the route contract. From `ts`, run `pnpm --filter @pe/kit build` to regenerate both entry files, then run kit tests. The source tab retains the authored code.

Use the `circuit-drop` skill to derive a Pod with a new manifest id. Keep readings separate from shipped sources. Check ampacity, derating, reactance, load balance and the full circuit design independently; this worksheet is a design comparison.
