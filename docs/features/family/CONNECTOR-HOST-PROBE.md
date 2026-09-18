# Connector host identity probe

## Finding

The b-grd omission is not evidence that its duct connector is hosted on the nested vane. `MakeConnectors` creates the connector from the authored `flange.top` reference, while capture's `NestedFaceUnder` classifies any parallel nested planar face intersecting the connector origin as `ConnectorOnNestedFace`. That test establishes geometric overlap, not host identity.

The Revit 2025 public API exposes `ConnectorElement.ChangeHostReference(Reference)` and its edge overload, but no inverse host-reference property. `ConnectorElement` exposes direction, classification, shape, dimensions, origin, and coordinate system. The remaining public evidence surfaces are inherited element parameters and `Element.GetDependentElements`. Candidate built-in parameters such as `HOST_ID_PARAM`, `SKETCH_PLANE_PARAM`, and `INSTANCE_FREE_HOST_PARAM` exist, but the API documentation does not say that connector elements populate them.

## Native control probe

`FamilyModelCaptureTests.Native_connector_host_probe_compares_plane_with_coincident_nested_face` creates a fresh family from the b-grd header, builds and loads only the real `vane.json` family model dependency (`Fixtures/FamilyModel/vane.json`), places one vane on `Ref. Level`, and creates a reference plane directly on one referenced vane face. Full b-grd forms, arrays, dimensions, values, and reconciliation are absent from the precondition. It then creates two rectangular duct connectors at the same point:

1. Exhaust-air connector created from the coincident control reference-plane reference.
2. Supply-air connector created from a referenced planar face of the real nested `vane` instance.

The distinct systems label the controls without adding metadata. After regeneration the test verifies coincident origins and writes `connector-host-identity.json` containing every public connector parameter, any parameter `ElementId`, built-in parameter name, connector dependents, host dependents, and the supplied reference element IDs. The transaction is rolled back and the document is closed in `finally`.

P should run only this test in a fresh owned Revit test rung and return that JSON. Evaluate discriminators in this order:

1. A connector `ElementId` parameter that equals the supplied plane or nested-instance reference ID in the matching control and differs in the other.
2. Host `GetDependentElements` containing only its actual connector.
3. Connector `GetDependentElements` identifying its host.

Only a signal that distinguishes both coincident controls can replace `NestedFaceUnder`. If all three are identical or empty, Revit's public API does not expose sound host identity for capture through these surfaces; geometry overlap must not be promoted into host identity. The creation references are control truth available during apply, but they are unavailable when capturing an arbitrary existing family.

## Validation

- Compile: `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --no-restore`
- Result: exit 0, 0 errors, 22 warnings.
- Runtime: intentionally pending the proof owner; no Revit lifecycle or capture behavior changed in this slice.
