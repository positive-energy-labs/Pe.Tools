# Snowdon Circuits

Read electrical circuits in your own licensed Revit Snowdon Towers electrical sample. This Pod ships authored sources only. It includes no model, saved circuit readings, binding or user state.

1. Open the electrical sample from your licensed Revit installation. Save a disposable copy whose title contains `copy` or `sandbox`.
2. Import this Pod and open `page:@snowdon-circuits/pages/tour`. Bind it to that document with the chip.
3. Press **Read circuits**. Filter by panel, circuit, load or element id. Select a row to fill the calculator and highlight its connected loads and wires. **Inspect selected circuit** reads the native circuit facts again.
4. Missing material, length or conductor size requires an explicit calculation override. Overrides change the worksheet only. The calculation uses copper K = 12.9 at 75 C, one-way feet and apparent amperes. It assumes unity power factor, negligible reactance and balanced three-phase loads. Poles 1 and 2 use the single-phase two-wire calculation.
5. **Prepare proposal** reads exact native wire parameter evidence. A writable string parameter can be changed only by **Approve and apply wire change**, on a disposable copy, through `revit.apply.parameter-values` with expected evidence. Revit normally calculates Wire Size and exposes it read-only. That refusal is shown; the Page never substitutes a Comments write or claims it resized conductors.
6. **Export snapshot** downloads one HTML file with the document and export time, the circuit reading, calculator inputs and source. Tables and calculations still work offline. Revit doors and approval actions are absent in the snapshot.

The typed `revit.catalog.electrical-circuits` operation owns discovery and circuit/member identities. `src/Census.cs` supplies explicit-unit voltage, apparent current and one-way path length because the typed catalog has formatted voltage/current and omits length and material. `src/InspectRun.cs` reads circuits containing Revit's current selection. Values Revit cannot compute remain null.

The Pod also declares **Voltage Drop** as an admitted route. Its subject is an authored copper voltage-drop worksheet. Its Work holds explicit calculation inputs; no circuit facts are inferred. Open it, review the source and trust its `pod-bytes:` fingerprint as a human administrator. Route code is trusted extension code, not a sandbox. An edited artifact requires renewed trust. Disable the Pod to remove its routes. Trust stays on this machine and is never exported.

The route exports one typed `PodRouteAuthoring` declaration from `routes/voltage-drop/module.ts`. It includes subject display, the calculation, an input edit verb and a v1-to-v2 Work migration. The host owns saved Work and migration. The Page tour retains its separate binding and portable snapshot form.

Publish from `ts/apps/web` with `node scripts/publish-pod-route.ts <absolute-pod-directory> voltage-drop`. This calls the generic `buildRouteArtifact` producer, writes `routes/voltage-drop/route.artifact`, and records its path and source-tagged fingerprint in `pod.json`. The artifact is the JSON `RouteArtifactBytes` envelope with integer-octet arrays for byte fields. Its executable closure includes schemas, codecs, bodies and migration. Never hash function strings or add another route bundler. `PodRouteAuthoring` is exported by `@pe/agent-contracts`; this repository example imports its source directly. To regenerate only the portable Page, run `pnpm --filter @pe/kit codegen:pages` from `ts`.

Under ruling `0944c85d`, the route drops the demo wire-intent editor, stage/apply write verbs, native circuit picker and `manual` subject sentinel, nested legacy registration graph, manual seed and custom renderers. The worksheet retains the copper calculation and Work editing. The portable Page tour is separate; its existing Revit inspection and proposal behavior is unchanged.

Use the `circuit-drop` skill to derive a Pod with a new manifest id. Keep readings separate from shipped sources. Check ampacity, derating, reactance, load balance and the full circuit design independently; this worksheet is a design comparison.
