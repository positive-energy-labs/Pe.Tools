---
name: duct-loss
description: Investigate duct systems and fitting pressure loss in Revit's Snowdon Towers mechanical sample with the snowdon-ducts Pod, then adapt its Page and export your own Pod. Use when asked about the Snowdon ducts example, duct loss, or making a duct Page.
---

# Duct loss on the Snowdon sample

You work with the Pod `snowdon-ducts`. Its keys: `script:@snowdon-ducts/src/Census.cs`, `script:@snowdon-ducts/src/InspectRun.cs`, `script:@snowdon-ducts/src/CoefficientExperiment.cs`, `page:@snowdon-ducts/pages/tour`, `member:@snowdon-ducts/settings/checks.json`. Find them with `pe_find`; read with `pe_read`; run with `pe_do`.

## Ground rules

- Claim only what you read this session. The Pod ships no results; every number must come from a reading in the bound document, with the document title and time.
- Element ids are valid for one open lifetime. Discover, then revalidate before you act.
- The experiment changes the model. Run it only on a disposable copy whose title says `copy`, and only after the person approves.
- `member:` keys are for reading and mentioning. They never execute.

## Procedure

1. **Bind.** Confirm the thread (or the Page) names one document. If it does not, say so and stop; do not pick one.
2. **Census.** Run `Census`. Report the systems, their element and fitting counts, and any duct warnings. If there are no duct systems, say the model does not suit this investigation.
3. **Pick a run.** Select an element of one system (or let `InspectRun` take the largest) and run `InspectRun`. Report fittings with a loss parameter and fittings without. If none carry one, say that plainly: the sample may not store loss on its fittings.
4. **Show.** Use `revit.context.lens` then `revit.context.show-elements` on the fitting ids so the person sees them. Capture the view when asked.
5. **Experiment (optional).** Read `settings/checks.json` for the delta and markers. Run `CoefficientExperiment` on the copy. Report `before`, `readback`, and `applied`. If it says `refused` or `unavailable`, relay that; never fabricate a fixture and call it a sample defect.

## Adapting the Page

Copy the Pod under a new manifest id first; never edit `snowdon-ducts` in place. The Page `pages/tour/index.html` is plain HTML using `/pages/pe.js`: `pe.read`, `pe.do`, `pe.script`, `pe.state`, `pe.describe`. Change one thing at a time (a refresh button, a show-in-Revit button), reload, and read `GET /pages/<slug>/state` to check what the Page says.

## Export

Export the derivative through the public Pod export operation. Export needs no Revit. Bindings and run output do not travel; observations you recorded in the Page may.
