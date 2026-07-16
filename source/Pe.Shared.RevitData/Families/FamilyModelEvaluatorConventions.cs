namespace Pe.Shared.RevitData.Families;

public enum FamilyModelCoordinateAxis {
    X,
    Y,
    Z
}

public readonly record struct FamilyModelFaceCoordinate(
    FamilyModelCoordinateAxis Axis,
    double Coordinate);

public readonly record struct FamilyModelBounds(
    double Minimum,
    double Maximum);

public readonly record struct FamilyModelCylinderBounds(
    FamilyModelBounds X,
    FamilyModelBounds Y,
    FamilyModelBounds Z);

public static class FamilyModelEvaluatorConventions {
    public static double Offset(double distance, FamilyModelOffsetDirection direction) =>
        direction == FamilyModelOffsetDirection.In ? -distance : distance;

    public static FamilyModelFaceCoordinate ResolvePrismFace(
        string face,
        double width,
        double depth,
        double height) =>
        face switch {
            "Left" => new(FamilyModelCoordinateAxis.X, -width / 2),
            "Right" => new(FamilyModelCoordinateAxis.X, width / 2),
            "Back" => new(FamilyModelCoordinateAxis.Y, -depth / 2),
            "Front" => new(FamilyModelCoordinateAxis.Y, depth / 2),
            "Bottom" => new(FamilyModelCoordinateAxis.Z, 0),
            "Top" => new(FamilyModelCoordinateAxis.Z, height),
            _ => throw new ArgumentOutOfRangeException(nameof(face), face, "Unknown prism face.")
        };

    public static FamilyModelCylinderBounds ResolveCylinderBounds(double diameter, double height) {
        var radius = diameter / 2;
        return new(
            new FamilyModelBounds(-radius, radius),
            new FamilyModelBounds(-radius, radius),
            new FamilyModelBounds(0, height));
    }

    public static int CenteredLinearTotal(int halfCount) => (2 * halfCount) - 1;
}
