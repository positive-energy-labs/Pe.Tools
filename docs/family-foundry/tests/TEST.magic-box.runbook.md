# Magic Box POC Runbook

This POC verifies a constrained "meat and bones" box:

- width driven by `PE_G_Dim_Width1`
- length driven by `PE_G_Dim_Length1`
- height driven by `PE_G_Dim_Height1`
- extrusion constrained to reference planes so moving planes resizes geometry

## 1) Prepare profile

1. Copy `docs/family-foundry/tests/TEST.magic-box.profile.json`
2. Place it in your FF Manager profiles folder as `TEST.magic-box.json`
3. Select this profile in `CmdFFManager`

If your template uses a different level plane name, update:

- `MakeRefPlaneAndDims.OffsetSpecs[0].AnchorName`
- `MakeConstrainedExtrusions.Rectangles[0].SketchPlaneName`
- `MakeConstrainedExtrusions.Rectangles[0].HeightPlaneBottom`

## 2) Run command

1. Open a family doc.
2. Run `CmdFFManager`.
3. Apply profile `TEST.magic-box`.

Expected created constraints:

- mirror width planes + dim label: `PE_G_Dim_Width1`
- mirror length planes + dim label: `PE_G_Dim_Length1`
- top offset plane from `Ref. Level` + dim label: `PE_G_Dim_Height1`
- rectangle extrusion aligned to width/length planes and cap-aligned to
  bottom/top height planes

## 3) Manual verification (your core test)

1. Edit dimensions:
   - set width, length, height to obvious values
2. Move constrained reference planes directly
3. Confirm extrusion updates in all three axes
4. Re-run profile and confirm idempotent behavior (no broken constraints)

## 4) Expected logs/files

In output:

- `snapshot-refplanesanddims-pre/post.json`
- `snapshot-extrusions-pre/post.json`
- `logs-detailed.json`

Look for:

- success entries from `MakeRefPlanesAndDims`
- success entry from `MakeConstrainedExtrusions`
- no fatal commit-time errors

## 5) Known v1 boundaries

- Rectangle constrained recreation: implemented
- Circle constrained recreation: captured in settings but creation currently
  skipped by design
