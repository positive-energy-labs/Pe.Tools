# Family Model handoff — 2026-07-15

## Final state

- Worktree: `C:\Users\kaitp\source\repos\Pe.Tools-family-model`
- Branch: `codex/family-model`
- Durable spec: `docs/design/family-model-spec.md`
- Completed through `da1afcf` plus the final review closure recorded below.
- Worktree is clean, the exact `ff-family-model-r25` sandbox is stopped, and no user-owned Revit process is part of
  the completion state.

The puck spike is closed: Revit's public API cannot recreate the picked reference-line endpoint work-plane
relationship. The native puck resource is intentional, not a temporary workaround.

## Final artifacts

- `.artifacts/build/Pe.Revit.Tests/Debug.R25.Tests/visual-proof/grd-room-proof.png` is the accepted room-facing proof.
- `.artifacts/family-model-walkthrough/walkthrough-report.json` is the final Phase 8 entrypoint; the sibling RFAs and
  PNGs are disposable walkthrough evidence.

## Historical capture conclusion

The speculative crop manipulation and black-image experiment were reverted. Stock-template annotations still make
some whole-view exports visually loose, but the accepted GRD image and structural assertions are green. Do not resume
that capture experiment unless a separate `capture_view` requirement justifies it.

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
- Added typed `revit.detail.family-model` and `revit.apply.family-model` host operations, generated TypeScript contracts, and a
  dumb `/family-model` Manager page with JSON editing, type preview, named constituents, capture, and explicit-path build.
  Pea receives both operations through its existing generic public-operation surface.
- The final review moved operation DTOs to `Pe.Shared.HostContracts`, uses structured bridge errors and the shared Revit
  scheduler, adds the dependency-directory input needed by GRD, and removes guessed Connector/spatial geometry.
- Review closure maps missing/invalid paths and family-document preconditions to structured host errors, moves the
  build/save/close choreography behind `FamilyModelBuilder.BuildAndSave`, and renders authored facts for every v1
  constituent instead of name-only chips. The Manager validates through `revit.detail.family-model.validation` and
  preserves formulas/references/units verbatim rather than implementing a second semantic evaluator in TypeScript.
- The final FreshRevitProcess 2025 `FamilyModelRoundtripTests` run passes 4/4.
- The durable spec now closes Phases 4, 6, and 7 and treats the Phase 5 puck result as the supported public-API boundary.
- Phase 8 ran in the exact `ff-family-model-r25` source sandbox (final generation `20260716052344454`, PID `41160`,
  build stamp `6580a841097a`). Public host operations validated, built, and opened the minimal box, showcase, and GRD/vane RFAs
  sequentially; type flex applied 1/3/3 edits with zero failures. Final RFAs and PNGs are under
  `.artifacts/family-model-walkthrough/`; `walkthrough-report.json` persists every operation result plus the complete
  before/after family snapshots. The SDK armed no-save and stopped the exact sandbox gracefully.

Machine-local note: the stale Revit 2023 manifest that pointed to a missing loader was renamed to
`%APPDATA%\Autodesk\Revit\Addins\2023\00-Pe.App.addin.disabled` so FreshRevitProcess could start without its modal error.
