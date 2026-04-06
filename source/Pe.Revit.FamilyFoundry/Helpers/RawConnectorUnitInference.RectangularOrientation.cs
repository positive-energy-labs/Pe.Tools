using Autodesk.Revit.DB;
using System.Diagnostics.CodeAnalysis;

namespace Pe.FamilyFoundry.Helpers;

internal static partial class RawConnectorUnitInference {
    private const double DirectionEqualityTolerance = 0.999;
    private const double VectorMagnitudeTolerance = 1e-6;

    public static bool TryGetRectangularConnectorAxes(
        ConnectorElement connector,
        out XYZ widthAxis,
        out XYZ lengthAxis,
        out XYZ faceNormal
    ) {
        widthAxis = XYZ.Zero;
        lengthAxis = XYZ.Zero;
        faceNormal = XYZ.Zero;
        if (connector.Shape != ConnectorProfileType.Rectangular || connector.CoordinateSystem == null)
            return false;

        // Empirically, rectangular connector width follows BasisX and length/height follows BasisY.
        widthAxis = NormalizeOrZero(connector.CoordinateSystem.BasisX);
        lengthAxis = NormalizeOrZero(connector.CoordinateSystem.BasisY);
        faceNormal = NormalizeOrZero(connector.CoordinateSystem.BasisZ);
        return widthAxis.GetLength() > VectorMagnitudeTolerance &&
               lengthAxis.GetLength() > VectorMagnitudeTolerance &&
               faceNormal.GetLength() > VectorMagnitudeTolerance;
    }

    public static bool TryResolveRectangularConnectorAxes(
        Document doc,
        string widthPlaneName1,
        string widthPlaneName2,
        string lengthPlaneName1,
        string lengthPlaneName2,
        out XYZ widthAxis,
        out XYZ lengthAxis
    ) {
        widthAxis = XYZ.Zero;
        lengthAxis = XYZ.Zero;
        return TryResolvePlaneNormal(doc, widthPlaneName1, widthPlaneName2, out widthAxis) &&
               TryResolvePlaneNormal(doc, lengthPlaneName1, lengthPlaneName2, out lengthAxis);
    }

    public static bool TryResolveRectangularConnectorFrame(
        Document doc,
        string widthPlaneName1,
        string widthPlaneName2,
        string lengthPlaneName1,
        string lengthPlaneName2,
        XYZ faceNormal,
        out XYZ widthAxis,
        out XYZ lengthAxis
    ) {
        widthAxis = XYZ.Zero;
        lengthAxis = XYZ.Zero;

        if (!TryResolveRectangularConnectorAxes(
                doc,
                widthPlaneName1,
                widthPlaneName2,
                lengthPlaneName1,
                lengthPlaneName2,
                out var rawWidthAxis,
                out var rawLengthAxis)) {
            return false;
        }

        var normalizedFace = NormalizeOrZero(faceNormal);
        var normalizedWidth = NormalizeOrZero(rawWidthAxis);
        var normalizedLength = NormalizeOrZero(rawLengthAxis);
        if (normalizedFace.GetLength() <= VectorMagnitudeTolerance ||
            normalizedWidth.GetLength() <= VectorMagnitudeTolerance ||
            normalizedLength.GetLength() <= VectorMagnitudeTolerance) {
            return false;
        }

        var candidateWidth = normalizedWidth;
        var candidateLength = NormalizeOrZero(normalizedFace.CrossProduct(candidateWidth));
        if (candidateLength.GetLength() <= VectorMagnitudeTolerance)
            return false;

        var flippedWidth = candidateWidth.Negate();
        var flippedLength = NormalizeOrZero(normalizedFace.CrossProduct(flippedWidth));
        if (flippedLength.GetLength() <= VectorMagnitudeTolerance)
            return false;

        var directScore = candidateLength.DotProduct(normalizedLength);
        var flippedScore = flippedLength.DotProduct(normalizedLength);
        if (flippedScore > directScore) {
            candidateWidth = flippedWidth;
            candidateLength = flippedLength;
        }

        widthAxis = candidateWidth;
        lengthAxis = candidateLength;
        return true;
    }

    public static bool TryConnectorWidthUsesPrimaryDirection(
        ConnectorElement connector,
        RawConnectorStubMatch stubMatch,
        out bool widthUsesPrimaryDirection
    ) {
        widthUsesPrimaryDirection = false;
        if (TryGetRectangularConnectorAxes(connector, out var widthAxis, out _, out _)) {
            var primaryScore = ComputeUnsignedVectorMisalignment(widthAxis, stubMatch.PrimaryDirection);
            var secondaryScore = ComputeUnsignedVectorMisalignment(widthAxis, stubMatch.SecondaryDirection);
            widthUsesPrimaryDirection = primaryScore <= secondaryScore;
            return true;
        }

        var connectorWidth = connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)?.AsDouble() ?? 0.0;
        var connectorHeight = connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)?.AsDouble() ?? 0.0;
        widthUsesPrimaryDirection = WidthUsesPrimaryAxis(
            connectorWidth,
            connectorHeight,
            stubMatch.PrimaryExtent,
            stubMatch.SecondaryExtent);
        return connectorWidth > 1e-6 && connectorHeight > 1e-6;
    }

    public static bool TryConnectorWidthUsesFirstAxis(
        ConnectorElement connector,
        DominantAxis firstAxis,
        DominantAxis secondAxis,
        out bool widthUsesFirstAxis
    ) {
        widthUsesFirstAxis = false;
        if (!TryGetRectangularConnectorAxes(connector, out var widthAxis, out _, out _))
            return false;

        var firstScore = ComputeUnsignedVectorMisalignment(widthAxis, ToBasisVector(firstAxis));
        var secondScore = ComputeUnsignedVectorMisalignment(widthAxis, ToBasisVector(secondAxis));
        widthUsesFirstAxis = firstScore <= secondScore;
        return true;
    }

    public static double ComputeUnsignedVectorMisalignment(XYZ actual, XYZ expected) {
        var normalizedActual = NormalizeOrZero(actual);
        var normalizedExpected = NormalizeOrZero(expected);
        if (normalizedActual.GetLength() <= VectorMagnitudeTolerance ||
            normalizedExpected.GetLength() <= VectorMagnitudeTolerance) {
            return 1.0;
        }

        return 1.0 - Math.Abs(normalizedActual.DotProduct(normalizedExpected));
    }

    public static double ComputeSignedVectorMisalignment(XYZ actual, XYZ expected) {
        var normalizedActual = NormalizeOrZero(actual);
        var normalizedExpected = NormalizeOrZero(expected);
        if (normalizedActual.GetLength() <= VectorMagnitudeTolerance ||
            normalizedExpected.GetLength() <= VectorMagnitudeTolerance) {
            return 2.0;
        }

        return 1.0 - normalizedActual.DotProduct(normalizedExpected);
    }

    public static bool TryGetRectangularProfileFrame(Extrusion extrusion, out RectangularProfileFrame frame) {
        frame = default!;
        var lines = extrusion.Sketch?.Profile?
            .Cast<CurveArray>()
            .SelectMany(array => array.Cast<Curve>())
            .OfType<Line>()
            .ToList();
        if (lines == null || lines.Count < 2)
            return false;

        var groups = new List<DirectionalLineGroup>();
        foreach (var line in lines) {
            var direction = CanonicalizeDirection(line.Direction);
            if (direction.GetLength() <= VectorMagnitudeTolerance)
                continue;

            var groupIndex = groups.FindIndex(group => AreParallel(group.Direction, direction));
            if (groupIndex >= 0) {
                groups[groupIndex] = groups[groupIndex] with {
                    Extent = Math.Max(groups[groupIndex].Extent, line.Length)
                };
                continue;
            }

            groups.Add(new DirectionalLineGroup(direction, line.Length));
        }

        if (groups.Count != 2)
            return false;

        frame = new RectangularProfileFrame(
            groups[0].Direction,
            groups[1].Direction,
            groups[0].Extent,
            groups[1].Extent);
        return true;
    }

    public static bool TryResolveReferencePlane(
        Document doc,
        string requestedName,
        [NotNullWhen(true)] out ReferencePlane? plane
    ) {
        plane = null;
        if (string.IsNullOrWhiteSpace(requestedName))
            return false;

        var referencePlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .ToList();
        plane = referencePlanes.FirstOrDefault(candidate => candidate.Name == requestedName);
        if (plane != null)
            return true;

        if (!requestedName.Equals("Ref. Level", StringComparison.OrdinalIgnoreCase))
            return false;

        plane = referencePlanes.FirstOrDefault(candidate =>
            !string.IsNullOrWhiteSpace(candidate.Name) &&
            candidate.Name.IndexOf("level", StringComparison.OrdinalIgnoreCase) >= 0 &&
            Math.Abs(candidate.Normal.Normalize().Z) > 0.95);
        return plane != null;
    }

    private static bool TryResolvePlaneNormal(
        Document doc,
        string primaryPlaneName,
        string secondaryPlaneName,
        out XYZ normal
    ) {
        normal = XYZ.Zero;
        if (!TryResolveReferencePlane(doc, primaryPlaneName, out var plane) &&
            !TryResolveReferencePlane(doc, secondaryPlaneName, out plane)) {
            return false;
        }

        normal = NormalizeOrZero(plane.Normal);
        return normal.GetLength() > VectorMagnitudeTolerance;
    }

    private static XYZ NormalizeOrZero(XYZ vector) =>
        vector.GetLength() <= VectorMagnitudeTolerance ? XYZ.Zero : vector.Normalize();

    private static XYZ CanonicalizeDirection(XYZ direction) {
        var normalized = NormalizeOrZero(direction);
        if (normalized.GetLength() <= VectorMagnitudeTolerance)
            return XYZ.Zero;

        if (Math.Abs(normalized.X) > VectorMagnitudeTolerance)
            return normalized.X < 0.0 ? normalized.Negate() : normalized;

        if (Math.Abs(normalized.Y) > VectorMagnitudeTolerance)
            return normalized.Y < 0.0 ? normalized.Negate() : normalized;

        return normalized.Z < 0.0 ? normalized.Negate() : normalized;
    }

    private static bool AreParallel(XYZ left, XYZ right) =>
        Math.Abs(NormalizeOrZero(left).DotProduct(NormalizeOrZero(right))) >= DirectionEqualityTolerance;

    private sealed record DirectionalLineGroup(XYZ Direction, double Extent);
}

internal sealed record RectangularProfileFrame(
    XYZ PrimaryDirection,
    XYZ SecondaryDirection,
    double PrimaryExtent,
    double SecondaryExtent
);
