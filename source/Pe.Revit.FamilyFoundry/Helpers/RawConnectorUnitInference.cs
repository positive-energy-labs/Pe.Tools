using Autodesk.Revit.DB;
namespace Pe.FamilyFoundry.Helpers;

internal static partial class RawConnectorUnitInference {
    private const double AxisAlignmentTolerance = 0.95;
    private const double PlaneDistanceTolerance = 1e-3;

    public static IReadOnlyDictionary<ElementId, RawConnectorStubMatch> MatchOwnedStubs(Document doc) {
        var extrusions = new FilteredElementCollector(doc)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(extrusion => extrusion.Sketch != null)
            .ToList();
        var matches = new Dictionary<ElementId, RawConnectorStubMatch>();

        foreach (var connector in new FilteredElementCollector(doc)
                     .OfClass(typeof(ConnectorElement))
                     .Cast<ConnectorElement>()) {
            var match = TryMatchOwnedStub(connector, extrusions);
            if (match != null)
                matches[connector.Id] = match;
        }

        return matches;
    }

    public static RawConnectorStubMatch? TryMatchOwnedStub(
        ConnectorElement connector,
        IReadOnlyList<Extrusion> extrusions
    ) {
        var coordinateSystem = connector.CoordinateSystem;
        if (coordinateSystem == null || !TryGetAxis(coordinateSystem.BasisZ, out var faceAxis))
            return null;

        var connectorSize = GetConnectorSize(connector);
        var best = extrusions
            .Select(extrusion => TryScoreExtrusion(connector, extrusion, faceAxis, connectorSize))
            .Where(candidate => candidate != null)
            .OrderBy(candidate => candidate!.Score)
            .FirstOrDefault();

        return best?.Match;
    }

    public static double ScoreOrderedRectangularConnectorCandidate(
        double actualWidth,
        double actualHeight,
        double expectedWidth,
        double expectedHeight
    ) => Math.Abs(actualWidth - expectedWidth) + Math.Abs(actualHeight - expectedHeight);

    public static double ScoreRectangularConnectorCandidate(
        double actualWidth,
        double actualHeight,
        double expectedWidth,
        double expectedHeight
    ) {
        var direct = Math.Abs(actualWidth - expectedWidth) + Math.Abs(actualHeight - expectedHeight);
        var swapped = Math.Abs(actualWidth - expectedHeight) + Math.Abs(actualHeight - expectedWidth);
        return Math.Min(direct, swapped);
    }

    public static bool WidthUsesPrimaryAxis(
        double connectorWidth,
        double connectorHeight,
        double primaryExtent,
        double secondaryExtent
    ) {
        var direct = Math.Abs(connectorWidth - primaryExtent) + Math.Abs(connectorHeight - secondaryExtent);
        var swapped = Math.Abs(connectorWidth - secondaryExtent) + Math.Abs(connectorHeight - primaryExtent);
        return direct <= swapped;
    }

    public static DominantAxis[] GetPerpendicularAxes(DominantAxis axis) =>
        axis switch {
            DominantAxis.X => [DominantAxis.Y, DominantAxis.Z],
            DominantAxis.Y => [DominantAxis.X, DominantAxis.Z],
            DominantAxis.Z => [DominantAxis.X, DominantAxis.Y],
            _ => []
        };

    public static bool TryGetAxis(XYZ vector, out DominantAxis axis) {
        var normalized = vector.Normalize();
        var x = Math.Abs(normalized.X);
        var y = Math.Abs(normalized.Y);
        var z = Math.Abs(normalized.Z);
        var max = Math.Max(x, Math.Max(y, z));
        if (max < AxisAlignmentTolerance) {
            axis = default;
            return false;
        }

        axis = max == x
            ? DominantAxis.X
            : max == y
                ? DominantAxis.Y
                : DominantAxis.Z;
        return true;
    }

    public static double GetAxisExtent(BoundingBoxXYZ boundingBox, DominantAxis axis) =>
        axis switch {
            DominantAxis.X => boundingBox.Max.X - boundingBox.Min.X,
            DominantAxis.Y => boundingBox.Max.Y - boundingBox.Min.Y,
            DominantAxis.Z => boundingBox.Max.Z - boundingBox.Min.Z,
            _ => 0.0
        };

    private static ScoredStubMatch? TryScoreExtrusion(
        ConnectorElement connector,
        Extrusion extrusion,
        DominantAxis faceAxis,
        ConnectorSize connectorSize
    ) {
        if (!IsShapeCompatible(connector.Shape, extrusion))
            return null;

        var boundingBox = extrusion.get_BoundingBox(null);
        if (boundingBox == null)
            return null;

        var connectorOrigin = connector.Origin;
        var planeDistance = GetHostPlaneDistance(connectorOrigin, faceAxis, boundingBox);
        if (planeDistance > PlaneDistanceTolerance)
            return null;

        var perpendicularAxes = GetPerpendicularAxes(faceAxis);
        if (perpendicularAxes.Length != 2)
            return null;

        var primaryAxis = perpendicularAxes[0];
        var secondaryAxis = perpendicularAxes[1];
        var primaryDirection = ToBasisVector(primaryAxis);
        var secondaryDirection = ToBasisVector(secondaryAxis);
        var primaryExtent = GetAxisExtent(boundingBox, primaryAxis);
        var secondaryExtent = GetAxisExtent(boundingBox, secondaryAxis);
        if (connector.Shape == ConnectorProfileType.Rectangular &&
            TryGetRectangularProfileFrame(extrusion, out var frame)) {
            primaryDirection = frame.PrimaryDirection;
            secondaryDirection = frame.SecondaryDirection;
            primaryExtent = frame.PrimaryExtent;
            secondaryExtent = frame.SecondaryExtent;
            if (TryGetAxis(primaryDirection, out var resolvedPrimaryAxis))
                primaryAxis = resolvedPrimaryAxis;
            if (TryGetAxis(secondaryDirection, out var resolvedSecondaryAxis))
                secondaryAxis = resolvedSecondaryAxis;
        }

        var inPlaneDistance = GetInPlaneCenterDistance(connectorOrigin, faceAxis, boundingBox);
        var sizeScore = connectorSize.Profile switch {
            ConnectorProfileType.Round => ScoreRound(connectorSize.Primary, primaryExtent, secondaryExtent),
            ConnectorProfileType.Rectangular => ScoreRectangularConnectorCandidate(
                connectorSize.Primary,
                connectorSize.Secondary,
                primaryExtent,
                secondaryExtent),
            _ => double.MaxValue
        };

        var score = planeDistance * 1000.0 + sizeScore + inPlaneDistance;
        return new ScoredStubMatch(
            score,
            new RawConnectorStubMatch(
                extrusion,
                faceAxis,
                primaryAxis,
                secondaryAxis,
                primaryDirection,
                secondaryDirection,
                primaryExtent,
                secondaryExtent));
    }

    private static bool IsShapeCompatible(ConnectorProfileType profileType, Extrusion extrusion) =>
        profileType switch {
            ConnectorProfileType.Round => IsRoundExtrusion(extrusion),
            ConnectorProfileType.Rectangular => IsRectangularExtrusion(extrusion),
            _ => false
        };

    private static ConnectorSize GetConnectorSize(ConnectorElement connector) {
        if (connector.Shape == ConnectorProfileType.Round) {
            var diameter = connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER)?.AsDouble() ?? 0.0;
            if (diameter <= 1e-6)
                diameter = (connector.get_Parameter(BuiltInParameter.CONNECTOR_RADIUS)?.AsDouble() ?? 0.0) * 2.0;

            return new ConnectorSize(ConnectorProfileType.Round, diameter, diameter);
        }

        return new ConnectorSize(
            ConnectorProfileType.Rectangular,
            connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)?.AsDouble() ?? 0.0,
            connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)?.AsDouble() ?? 0.0);
    }

    private static double ScoreRound(double connectorDiameter, double primaryExtent, double secondaryExtent) {
        var direct = (primaryExtent + secondaryExtent) / 2.0;
        return Math.Abs(connectorDiameter - direct);
    }

    private static double GetHostPlaneDistance(XYZ origin, DominantAxis axis, BoundingBoxXYZ boundingBox) {
        var min = GetCoordinate(boundingBox.Min, axis);
        var max = GetCoordinate(boundingBox.Max, axis);
        var coordinate = GetCoordinate(origin, axis);
        return Math.Min(Math.Abs(coordinate - min), Math.Abs(coordinate - max));
    }

    private static double GetInPlaneCenterDistance(XYZ origin, DominantAxis faceAxis, BoundingBoxXYZ boundingBox) {
        var center = (boundingBox.Min + boundingBox.Max) * 0.5;
        return GetPerpendicularAxes(faceAxis)
            .Select(axis => {
                var delta = GetCoordinate(origin, axis) - GetCoordinate(center, axis);
                return delta * delta;
            })
            .Sum();
    }

    private static double GetCoordinate(XYZ point, DominantAxis axis) =>
        axis switch {
            DominantAxis.X => point.X,
            DominantAxis.Y => point.Y,
            DominantAxis.Z => point.Z,
            _ => 0.0
        };

    private static XYZ ToBasisVector(DominantAxis axis) =>
        axis switch {
            DominantAxis.X => XYZ.BasisX,
            DominantAxis.Y => XYZ.BasisY,
            DominantAxis.Z => XYZ.BasisZ,
            _ => XYZ.Zero
        };

    private static bool IsRoundExtrusion(Extrusion extrusion) {
        var profile = extrusion.Sketch?.Profile;
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        return loop != null && loop.Size > 0 && loop.Cast<Curve>().All(curve => curve is Arc);
    }

    private static bool IsRectangularExtrusion(Extrusion extrusion) {
        var profile = extrusion.Sketch?.Profile;
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        return loop != null && loop.Size == 4 && loop.Cast<Curve>().All(curve => curve is Line);
    }

    private sealed record ConnectorSize(ConnectorProfileType Profile, double Primary, double Secondary);

    private sealed record ScoredStubMatch(double Score, RawConnectorStubMatch Match);
}

internal sealed record RawConnectorStubMatch(
    Extrusion Extrusion,
    DominantAxis FaceAxis,
    DominantAxis PrimaryAxis,
    DominantAxis SecondaryAxis,
    XYZ PrimaryDirection,
    XYZ SecondaryDirection,
    double PrimaryExtent,
    double SecondaryExtent
);

internal enum DominantAxis {
    X,
    Y,
    Z
}
