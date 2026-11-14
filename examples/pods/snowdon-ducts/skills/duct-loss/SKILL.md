---
name: duct-loss
description: Investigate duct systems and fitting pressure loss in Revit's Snowdon Towers mechanical sample with the snowdon-ducts Pod, then adapt its Page and export your own Pod. Use when asked about the Snowdon ducts example, duct loss, or making a duct Page.
---

# Duct loss on the Snowdon sample

You work with the Pod `snowdon-ducts`. Find its keys with `pe_find`:

- `script:@snowdon-ducts/src/Census.cs` and `script:@snowdon-ducts/src/InspectRun.cs` are declared `ReadOnly`, so you run them with `pe_read`. Neither takes input. Each answers the same value the Page's button gets.
- `script:@snowdon-ducts/src/CoefficientExperiment.cs` is declared `NoTransaction` and changes the model. Run it with `pe_do`.
- `page:@snowdon-ducts/pages/tour` is the Page. `pe_read` answers what it says now (`text`, as of `textSeq`), the events it accepts from you (`agent`) and the tail of its log (`events`). The `census`, `run` and `experiment` events hold each reading as `{ source, at, rows }`, where `rows` is the script's answer unchanged.
- `member:@snowdon-ducts/settings/checks.json` is data.

## Ground rules

- Claim only what you read this session. The Pod ships no results; every number must come from a reading in the bound document, with the document title and time.
- Element ids are valid for one open lifetime. Discover, then revalidate before you act.
- The experiment changes the model. Run it only on a disposable copy whose title says `copy`, and only after the person approves.
- `member:` keys are for reading and mentioning. They never execute.

## Procedure

1. **Bind.** Confirm the thread (or the Page) names one document. If it does not, say so and stop; do not pick one.
2. **Census.** Read `Census`. Report the systems, their element and fitting counts, and any duct warnings. If there are no duct systems, say the model does not suit this investigation.
3. **Pick a run.** Select an element of one system (or let `InspectRun` take the largest) and read `InspectRun`. Report fittings with a loss parameter and fittings without. If none carry one, say that plainly: the sample may not store loss on its fittings.
4. **Show.** Use `revit.context.lens` then `revit.context.show-elements` on the fitting ids so the person sees them. Capture the view when asked.
5. **Experiment (optional).** Read `settings/checks.json` for the markers. Run `CoefficientExperiment` on the copy; it writes each duct's velocity and size into Comments. Report `changed`, `alreadyCurrent`, `applied` and the `sample` readbacks. If it says `refused` or `unavailable`, relay that; never fabricate a fixture and call it a sample defect.
6. **Leave a note.** `pe_do page:@snowdon-ducts/pages/tour { event: { type: "note", text } }` puts a remark on the open Page, marked as yours. It is the only event the Page accepts from an agent; any other type is refused with that list.

## Adapting the Page

Copy the Pod under a new manifest id first; never edit `snowdon-ducts` in place. The Page is the file `pages/tour/index.html` in the Pod folder, plain HTML using `/pages/pe.js`; edit it with file tools. It runs the Pod's entrypoints by path with `pe.script`, and keeps everything it shows in one `pe.state` event log. Change one thing at a time (a refresh button, a show-in-Revit button), reload, then `pe_read` the Page's key and check that `text` says what the Page shows. The build-pod skill is the full account of a Pod's scripts and Pages.

## Export

Export the derivative through the public Pod export operation. Export needs no Revit. Bindings and run output do not travel; observations you recorded in the Page may.
