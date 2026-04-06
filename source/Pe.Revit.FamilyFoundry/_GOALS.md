# Pe.Revit.FamilyFoundry

## North Star

Make authored family-processing workflows predictable, debuggable, and reusable across authoring, snapshotting, replay, and targeted automation.

## User Goals

- Author profiles in a compact, semantic shape instead of low-level Revit mutation detail.
- Preview likely failures before expensive document mutation starts.
- Reuse snapshots and serialized output as practical authoring seeds.
- Keep parameter, connector, and geometry behavior understandable across family types and states.

## Developer Goals

- Keep authored contracts, compile steps, runtime operations, and diagnostics clearly separated.
- Make operation flows easy to test with focused Revit-backed harnesses.
- Preserve strong logging, snapshots, and proof artifacts so regressions are auditable.
- Prefer one canonical authored shape for a workflow instead of parallel overlapping models.

## Integration Goals

- Expose settings shapes cleanly to the shared schema/runtime pipeline.
- Support host/editor authoring without moving live Revit semantics out of the Revit lane.
- Let tests prove behavior across replay, migration, and parameter-resolution scenarios with reusable harnesses.

## Non-Goals

- Do not optimize for disconnected smart validation that requires the active Revit document.
- Do not preserve older authoring models as permanent peers once a better canonical shape exists.
- Do not hide ambiguous reverse-inference or runtime behavior behind silent heuristics.
