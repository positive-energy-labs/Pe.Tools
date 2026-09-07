# GRD value-flow investigation

Base: `dd67073542b864401dd2a394d06e7f79c5236b21`. Evidence: wave 19 `Authored_family_survives_capture_rebuild_and_reopen("b-grd")` and `Grd_arrays_own_independent_nested_seeds_under_count_and_spacing_perturbation`.

## Source causal trace

The authored model gives `_vane spacing` a uniform `2in` value and overrides only `Slot` with `0in`. `FamilyReconciler.Canonical` first records explicit type cells, then uses `TryAdd` to expand each parameter-level value across the remaining types. The desired cells are therefore `24x12 = 2in` and `Slot = 0in`. `Diff` emits typed `types.cell` updates, and `Lower` runs `CreateFamilyTypes`, `AddParams`, then `SetKnownParams` at step 8. `SetParamValuesPerType` visits every native type, looks up the value by the current type name, and writes with `OverrideExistingValues = true`. No earlier source path aliases or drops the two cells.

After that write, `MakeArrays` is the only traced operation that mutates family type values. It does not address `_vane spacing` directly: it temporarily clears `_calc vane half count`'s formula, ensures that array-label parameter is at least 2 in every type, creates and labels each array, then restores the formula. Because the formula depends on `_vane spacing`, the wave 19 `24x12 = 0ft` observation could be either a native constraint side effect during array labeling or an incorrect captured cell. Source alone does not distinguish those outcomes, so changing production code now would be speculative.

The opening planes have a separate, fully explained flow. `MakeRefPlanes` seeds them at -12in and +12in. `MakeDims` then creates an equality constraint through the center and labels the full front-to-back dimension with `PE_M_Grd_OpenLength = 12in`; Revit consequently drives the final planes to -6in and +6in. The reconciler already removes `at` from comparison for every plane participating in a labeled, locked, or equality dimension. Wave 19's printed coordinates are therefore expected native results, not the reason for recreation. The remaining plane mismatch is desired `isReference: NotAReference` versus an omitted captured field, owned by the capture lane.

## Discriminating native probe

`Grd_values_and_driven_opening_planes_are_correct_before_arrays` builds a disposable copy of the real GRD model with forms, nested content, arrays, and connectors removed. It reads native `FamilyType.AsDouble` values directly and requires `24x12 = 2in`, `Slot = 0`, and the dimension-driven planes at +/-6in. A pass proves type creation/value assignment and the plane solver before arrays; the existing full GRD failure then isolates the spacing change to the later array path or its capture. A failure proves the defect precedes arrays. The probe does not weaken residue checks or edit the fixture.

Compile lane: `dotnet build source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests -nologo` exited 0 with 26 warnings and 0 errors. No Revit lifecycle or native test ran. No capture or metadata source changed.
