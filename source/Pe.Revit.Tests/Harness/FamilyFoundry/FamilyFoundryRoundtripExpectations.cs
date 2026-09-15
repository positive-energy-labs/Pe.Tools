using Pe.Revit.FamilyFoundry;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

internal sealed record FamilyModelRoundtripArtifact(
    FamilyModel Authored,
    FamilyModel CapturedFromA,
    string SavedAPath,
    string SavedBPath,
    Document ReopenedA,
    Document ReopenedB
) {
    public void CloseDocuments() {
        RevitFamilyFixtureHarness.CloseDocument(this.ReopenedA);
        RevitFamilyFixtureHarness.CloseDocument(this.ReopenedB);
    }
}

internal sealed record RuntimePlaneProbe(
    string Name,
    XYZ Normal,
    XYZ Midpoint
);

internal sealed record RuntimeDimensionProbe(
    IReadOnlyList<string> PlaneNames,
    string? LabelParameterName,
    double MeasuredDistance,
    bool AreSegmentsEqual
);

/// <summary>
///     One rectangular extrusion as Revit reports it. `IsSolid` is read from the extrusion itself: a
///     bounding box cannot tell a solid from a void, and the intent oracle must never match a predicted
///     void against a solid.
/// </summary>
internal sealed record RuntimePrismProbe(
    ElementId ElementId,
    string? SketchPlaneName,
    XYZ Min,
    XYZ Max,
    double StartOffset,
    double EndOffset,
    bool IsSolid
);

internal sealed record RuntimeCylinderProbe(
    ElementId ElementId,
    string? SketchPlaneName,
    XYZ Min,
    XYZ Max,
    double StartOffset,
    double EndOffset,
    double Diameter,
    bool IsSolid
);

internal sealed record RuntimeConnectorProbe(
    ElementId ElementId,
    Domain Domain,
    ConnectorProfileType Profile,
    MEPSystemClassification? SystemClassification,
    FlowDirectionType? FlowDirection,
    XYZ Origin,
    XYZ WidthAxis,
    XYZ LengthAxis,
    XYZ FaceNormal,
    double? Diameter,
    double? Width,
    double? Length
);

internal sealed record RuntimeStateProbe(
    string TypeName,
    IReadOnlyDictionary<string, double> ParameterValues,
    IReadOnlyDictionary<string, RuntimePlaneProbe> Planes,
    IReadOnlyList<RuntimeDimensionProbe> Dimensions,
    IReadOnlyList<RuntimePrismProbe> Prisms,
    IReadOnlyList<RuntimeCylinderProbe> Cylinders,
    IReadOnlyList<RuntimeConnectorProbe> Connectors,
    RuntimeFamilySettingsProbe Settings,
    int ReferencePlaneCount,
    int DimensionCount,
    int ExtrusionCount,
    int ConnectorCount
);

/// <summary>
///     The family-global switches as REVIT reports them, read straight off the family element and the size
///     table manager. Capture reads the same places, so this is the independent second reading that proves a
///     setting survived build → capture → rebuild rather than merely surviving inside the portable document.
/// </summary>
internal sealed record RuntimeFamilySettingsProbe(
    bool? AlwaysVertical,
    bool? Shared,
    bool? CutWithVoidsWhenLoaded,
    int? PartType,
    string? OmniClass,
    bool RoomCalculationPointEnabled,
    double? RoomCalculationPointOffsetFeet,
    IReadOnlyList<string> LookupTableNames
);
