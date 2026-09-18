# Captured proof artifacts (r3-capture, 2026-09-06)

`Document.CaptureFamilyModel()` output for the two fixture families in `../../Families/`, run READ-ONLY in the
controlled session `pe.app-25` (Revit 2025, pid 61960, generation `20260906213320390`) through the pea inline
script door with the capture dll loaded in its own `AssemblyLoadContext`
(`.artifacts/handoffs/family-rewrite-20260906/spike/r3-capture/capture.cs`).

| File | Source .rfa | Execution id |
| --- | --- | --- |
| `c-bath-shower.captured.json` | `PE Bath-Shower.rfa` (G: copy 2026-07-02, current type `Double Shower (head only)`) | `a2e0afe971c64af8975c6be2e779aa56` |
| `b-grd.captured.json` | `PE GRD Exhaust.rfa` (G: `final unhosted` copy 2026-03-25) | `a2e0afe971c64af8975c6be2e779aa56` |

Documents were opened from the fixture copies and closed with `Close(false)`. Regenerate by rerunning the
script or `FamilyModelCaptureTests` on the fresh lane once `Pe.Revit.Tests` builds.
