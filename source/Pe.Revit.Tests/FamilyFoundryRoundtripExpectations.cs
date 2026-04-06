using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

namespace Pe.Tools.RevitTest.Tests;

internal sealed record RoundtripArtifact(
    ProfileFamilyManager Profile,
    AuthoredParamDrivenSolidsSettings Authored,
    ParamDrivenSolidsCompileResult Compiled,
    FamilyProcessingContext Context,
    string SavedFamilyPath,
    Document? SourceDocument,
    Document SavedDocument
) {
    public void CloseDocuments() {
        RevitFamilyFixtureHarness.CloseDocument(this.SavedDocument);
        RevitFamilyFixtureHarness.CloseDocument(this.SourceDocument);
    }
}

internal sealed record AuthoredGraphExpectation(
    int PlaneCount,
    int SpanCount,
    int PrismCount,
    int CylinderCount,
    int ConnectorCount,
    IReadOnlyList<string> PlaneNames,
    IReadOnlyList<string> PrismNames,
    IReadOnlyList<string> CylinderNames,
    IReadOnlyList<string> ConnectorNames
) {
    public static AuthoredGraphExpectation From(AuthoredParamDrivenSolidsSettings authored) =>
        new(
            authored.Planes.Count,
            authored.Spans.Count,
            authored.Prisms.Count,
            authored.Cylinders.Count,
            authored.Connectors.Count,
            authored.Planes.Keys.OrderBy(name => name, StringComparer.Ordinal).ToList(),
            authored.Prisms.Select(spec => spec.Name).OrderBy(name => name, StringComparer.Ordinal).ToList(),
            authored.Cylinders.Select(spec => spec.Name).OrderBy(name => name, StringComparer.Ordinal).ToList(),
            authored.Connectors.Select(spec => spec.Name).OrderBy(name => name, StringComparer.Ordinal).ToList());
}

internal sealed record CompiledPlanExpectation(
    int SymmetricPairCount,
    int OffsetCount,
    int RectangleExtrusionCount,
    int CircleExtrusionCount,
    int ConnectorCount,
    IReadOnlyList<string> ExpectedPlaneNames,
    IReadOnlyList<string> ExpectedDimensionDrivers,
    IReadOnlyList<string> ExpectedConnectorNames
) {
    public static CompiledPlanExpectation From(ParamDrivenSolidsCompileResult compiled) =>
        new(
            compiled.RefPlanesAndDims.SymmetricPairs.Count,
            compiled.RefPlanesAndDims.Offsets.Count,
            compiled.InternalExtrusions.Rectangles.Count,
            compiled.InternalExtrusions.Circles.Count,
            compiled.Connectors.Connectors.Count,
            compiled.RefPlanesAndDims.SymmetricPairs
                .SelectMany(spec => new[] {
                    spec.CenterPlaneName,
                    spec.NegativePlaneName,
                    spec.PositivePlaneName
                })
                .Concat(compiled.RefPlanesAndDims.Offsets.Select(spec => spec.PlaneName))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList(),
            compiled.RefPlanesAndDims.SymmetricPairs
                .Select(spec => spec.Parameter)
                .Concat(compiled.RefPlanesAndDims.Offsets.Select(spec => spec.Parameter))
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name!.Trim())
                .Distinct(StringComparer.Ordinal)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList(),
            compiled.Connectors.Connectors
                .Select(spec => spec.Name)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList());
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

internal sealed record RuntimePrismProbe(
    ElementId ElementId,
    string? SketchPlaneName,
    XYZ Min,
    XYZ Max,
    double StartOffset,
    double EndOffset
);

internal sealed record RuntimeCylinderProbe(
    ElementId ElementId,
    string? SketchPlaneName,
    XYZ Min,
    XYZ Max,
    double StartOffset,
    double EndOffset,
    double Diameter
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
    int ReferencePlaneCount,
    int DimensionCount,
    int ExtrusionCount,
    int ConnectorCount
);

internal sealed record ExtrusionVerticalSpan(
    bool IsSolid,
    double MinZ,
    double MaxZ,
    double Volume
);

internal sealed record RectangularConnectorOrientationMeasurement(
    XYZ WidthAxis,
    XYZ LengthAxis,
    XYZ FaceNormal
);

internal sealed record ConnectorExpectation(
    string Name,
    string FacePlaneName,
    ParamDrivenConnectorDomain Domain,
    ParamDrivenConnectorProfile Profile,
    string? CenterPlane1,
    string? CenterPlane2,
    string? WidthAxisPlaneName,
    string? LengthAxisPlaneName,
    string? SizeParameter1,
    string? SizeParameter2,
    string? DepthParameter,
    FlowDirectionType? FlowDirection,
    MEPSystemClassification? SystemClassification
);
