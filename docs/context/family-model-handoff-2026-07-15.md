# Family Model handoff — 2026-07-15

## Resume here

- Worktree: `C:\Users\kaitp\source\repos\Pe.Tools-family-model`
- Branch: `codex/family-model`
- Durable spec: `docs/design/family-model-spec.md`
- User-owned Revit: PID `55548`, `puck.rfa`; do not stop it.

## State

Committed through `085bf5b`:

- Portable, metadata-free family model contract and roundtrip.
- Room calculation point convention.
- Educational parametric-solid showcase.
- GRD dependency plus centered, parameter-associated vane array.
- Exact native `puck.rfa` resource and documented public-API boundary.

The puck spike is closed: Revit's public API cannot recreate the picked reference-line endpoint work-plane relationship. The native puck resource is intentional, not a temporary workaround.

Uncommitted:

- `RoomDinglerTests.Generated_grd_opens_into_the_room_and_exports_visual_proof` builds the checked-in GRD, places it on a room wall, and proves its calculation point is inside the opening-side room while the mirrored back-side point is outside.
- `RevitViewImageExporter` temporarily unlocks template-controlled crop parameters, clears/restores scope and uncropped state, and tightens/restores annotation crop.
- `RevitDataRequestService.ResolveFocusBox` explicitly creates world-coordinate union boxes with `Transform.Identity`.

## Image-capture conclusion

The GRD behavioral proof passed before the final image experiment. Focused `FitToPage` exports remain poorly framed because stock-template elevation/section annotations dominate Revit's export extents.

Do not resume the `UIView.ZoomAndCenterRectangle` + `ImageExportOptions.Zoom` experiment: it completed but emitted a mostly black PNG. That path was reverted. The post-revert build/test was interrupted and must be rerun.

Latest artifacts:

- `.artifacts/build/Pe.Revit.Tests/Debug.R25.Tests/visual-proof/grd-room-whole.png`
- `.artifacts/build/Pe.Revit.Tests/Debug.R25.Tests/visual-proof/grd-room-proof.png` (the 21:50 file is the rejected black-image experiment)

## Exact next step

1. Review the three-file diff. Prefer deleting exporter complexity unless it independently improves a real `capture_view` case; do not add more speculative capture features.
2. Run:

   ```powershell
   dotnet build source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests --no-restore
   pe-revit test fresh --project source\Pe.Revit.Tests\Pe.Revit.Tests.csproj --year 2025 --filter "FullyQualifiedName~Generated_grd_opens_into_the_room_and_exports_visual_proof|FullyQualifiedName~Grd_and_vane_dependency_roundtrip_without_recovery_metadata" --timeout-seconds 240
   ```

3. Commit the GRD room-facing proof once green.
4. Resume the spec phases: supported-year proof, then Manager/Pea/host/web wiring. Revisit plumbing fixtures only with a concrete native-puck hosting recipe.

## Constraints

- Roundtrip is the north star; never pass it with Extensible Storage, hidden parameters, or other recovery metadata.
- Do not migrate old OneDrive family profiles or change `FamilyProcessor` internals.
- Use SDK-owned FreshRevitProcess/AttachedRrd lanes; preserve user Revit state.
- Keep the API small, Revit/engineer-oriented, and predictable.

## Completion — 2026-07-15

This handoff was completed on `codex/family-model`:

- Deleted the speculative view-export crop manipulation. Kept the shared world-coordinate focus-box fix and the single
  whole-view GRD proof.
- FreshRevitProcess 2025 proves the GRD opens into the room and the GRD/vane dependency roundtrips without recovery
  metadata. The accepted image is `.artifacts/build/Pe.Revit.Tests/Debug.R25.Tests/visual-proof/grd-room-proof.png`.
- Installed-year proof covers 2023–2026. Revit 2023/2024 pass default-state portable roundtrips but natively reject a
  centered-array half-count of zero; this is recorded as a precise compatibility limitation, not a model workaround.
- Added typed `family.model.capture` and `family.model.build` host operations, generated TypeScript contracts, and a
  dumb `/family-model` Manager page with JSON editing, type preview, named constituents, capture, and explicit-path build.
  Pea receives both operations through its existing generic public-operation surface.
- The durable spec now closes Phases 4, 6, and 7 and treats the Phase 5 puck result as the supported public-API boundary.

Machine-local note: the stale Revit 2023 manifest that pointed to a missing loader was renamed to
`%APPDATA%\Autodesk\Revit\Addins\2023\00-Pe.App.addin.disabled` so FreshRevitProcess could start without its modal error.
