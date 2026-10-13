# Snowdon Ducts

A Pod for investigating duct systems and fitting pressure loss in Revit's **Snowdon Towers** mechanical sample. It ships authored sources only: no model, no recorded results, no state.

## Get the sample

Open the sample from your own licensed Revit installation (Revit's "Snowdon Towers Sample" mechanical project; the file name and folder vary by Revit year). Work on a **copy**: the experiment changes the model. Note the file name, Revit year and the file's SHA-256 beside any result you keep; this Pod claims nothing about a model you have not measured.

## Use

1. Import this Pod (it arrives with the product), then open the Page `page:@snowdon-ducts/pages/tour`.
2. Bind the Page to the copy with the chip in the corner.
3. Press **Census**, choose a system, then **Inspect**. **Show in Revit** frames the elements in a 3D view; **Capture** keeps the picture.
4. The experiment is guarded: it runs only on a document whose title contains `copy` or `sandbox` and prints before/after readings from an independent second read. If the model has no eligible fitting the Page says so; it never invents one.

Everything the Page shows comes from a reading made this session. Teaching figures are labeled as illustrations.

## Make it yours

Ask Pea: "Use the Snowdon ducts example to make a page listing this sample's duct systems, add refresh and show-in-Revit, then export the adapted Pod." The `duct-loss` skill teaches the steps. Give your derivative a new Pod id.
