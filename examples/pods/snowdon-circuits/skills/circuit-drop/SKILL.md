---
name: circuit-drop
description: Read electrical circuits from the bound licensed sample, compare copper voltage drop, review wire proposals on a disposable copy, and export a portable worksheet.
---
# Circuit voltage drop

Use this Pod to teach or adapt a circuit worksheet. Open the person's own licensed electrical sample and save a disposable copy first. Never ship the model or pre-recorded results.

1. Open `page:@snowdon-circuits/pages/tour` and bind it with the chip. Read the current target with `pe.target()`; never choose a document in Page code.
2. Read `revit.catalog.electrical-circuits` for identities and connected load/wire ids. Run `script:@snowdon-circuits/src/Census.cs` with `ReadOnly` for numeric volts, apparent amperes, path feet and material. Join by circuit id; do not parse localized display strings as measurements.
3. Select a circuit. `revit.context.show-elements` highlights its members. Run `script:@snowdon-circuits/src/InspectRun.cs` with `ReadOnly` to inspect the current Revit selection.
4. Show the reading's document and time beside the table. Null is unavailable. Unsupported conductor sizes, parallel runs and missing material need explicit overrides before calculation. Explain that the copper K method excludes reactance, ampacity and derating.
5. A conductor override changes the worksheet only. For a native wire proposal, revalidate the bound exact document and its copy-only title, read the native parameter through a dry run, and show the edit. Only an explicit human approval can issue the wet `revit.apply.parameter-values` call with expected evidence. Refuse read-only native Wire Size; never fake a wire change with Comments.
6. Read back after a successful native change. Export the Page snapshot to keep document/time, data, calculator state and offline calculation. Export no binding or live doors.

To adapt the example, copy the Pod under a new manifest id and change its authored sources. Retain versioned reducer events and deterministic package/export gates. Prove a new reading against the actual document; the shipped example records no findings about any sample.
