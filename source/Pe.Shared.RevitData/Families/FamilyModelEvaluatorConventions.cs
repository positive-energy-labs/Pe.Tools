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

/// <summary>The axis-aligned bounds of one extruded solid, in its own frame's coordinates.</summary>
public readonly record struct FamilyModelExtrusionBounds(
    FamilyModelBounds X,
    FamilyModelBounds Y,
    FamilyModelBounds Z);

/// <summary>A point or a direction in family coordinates. Feet or unitless; the caller owns the unit.</summary>
public readonly record struct FamilyModelVector(double X, double Y, double Z) {
    public static FamilyModelVector Zero => new(0, 0, 0);

    public double Component(FamilyModelCoordinateAxis axis) => axis switch {
        FamilyModelCoordinateAxis.X => this.X,
        FamilyModelCoordinateAxis.Y => this.Y,
        _ => this.Z
    };

    public static FamilyModelVector operator +(FamilyModelVector a, FamilyModelVector b) =>
        new(a.X + b.X, a.Y + b.Y, a.Z + b.Z);

    public static FamilyModelVector operator -(FamilyModelVector a, FamilyModelVector b) =>
        new(a.X - b.X, a.Y - b.Y, a.Z - b.Z);

    public static FamilyModelVector operator *(FamilyModelVector vector, double scale) =>
        new(vector.X * scale, vector.Y * scale, vector.Z * scale);

    public double Dot(FamilyModelVector other) => (this.X * other.X) + (this.Y * other.Y) + (this.Z * other.Z);

    public FamilyModelVector Cross(FamilyModelVector other) => new(
        (this.Y * other.Z) - (this.Z * other.Y),
        (this.Z * other.X) - (this.X * other.Z),
        (this.X * other.Y) - (this.Y * other.X));
}

/// <summary>
///     The world placement of one frame: where its origin sits and which way its three local axes point.
///     Local X is left/right, local Y is back/front, local Z is the extrusion direction.
/// </summary>
public readonly record struct FamilyModelTransform(
    FamilyModelVector Origin,
    FamilyModelVector BasisX,
    FamilyModelVector BasisY,
    FamilyModelVector BasisZ
) {
    public static FamilyModelTransform Identity => new(
        FamilyModelVector.Zero,
        new FamilyModelVector(1, 0, 0),
        new FamilyModelVector(0, 1, 0),
        new FamilyModelVector(0, 0, 1));

    /// <summary>Maps a point given in this frame's local coordinates to family (world) coordinates.</summary>
    public FamilyModelVector Apply(FamilyModelVector local) =>
        this.Origin + (this.BasisX * local.X) + (this.BasisY * local.Y) + (this.BasisZ * local.Z);

    public FamilyModelVector Basis(FamilyModelCoordinateAxis axis) => axis switch {
        FamilyModelCoordinateAxis.X => this.BasisX,
        FamilyModelCoordinateAxis.Y => this.BasisY,
        _ => this.BasisZ
    };

    /// <summary>
    ///     True when every local axis is parallel to a family axis. Axis-aligned frames keep the
    ///     axis-plus-coordinate claims of the v1 vocabulary exact; oblique frames do not.
    /// </summary>
    public bool IsAxisAligned =>
        IsAxisParallel(this.BasisX) && IsAxisParallel(this.BasisY) && IsAxisParallel(this.BasisZ);

    private static bool IsAxisParallel(FamilyModelVector vector) =>
        (Math.Abs(Math.Abs(vector.X) - 1) < 1e-9 && Math.Abs(vector.Y) < 1e-9 && Math.Abs(vector.Z) < 1e-9) ||
        (Math.Abs(Math.Abs(vector.Y) - 1) < 1e-9 && Math.Abs(vector.X) < 1e-9 && Math.Abs(vector.Z) < 1e-9) ||
        (Math.Abs(Math.Abs(vector.Z) - 1) < 1e-9 && Math.Abs(vector.X) < 1e-9 && Math.Abs(vector.Y) < 1e-9);
}

/// <summary>One infinite plane as a point on it plus its normal. The normal points away from the body it bounds.</summary>
public readonly record struct FamilyModelPlaneGeometry(
    FamilyModelVector Point,
    FamilyModelVector Normal
);

/// <summary>One resolved profile vertex, in the frame's XY plane, in feet.</summary>
public readonly record struct FamilyModelProfilePointValue(double X, double Y);

/// <summary>
///     One of the three stock family reference planes, and the direction an `Out` offset travels from it.
/// </summary>
public readonly record struct FamilyModelFamilyPlane(
    FamilyModelCoordinateAxis Axis,
    FamilyModelVector Outward
);

public static class FamilyModelEvaluatorConventions {
    public static double Offset(double distance, FamilyModelOffsetDirection direction) =>
        direction == FamilyModelOffsetDirection.In ? -distance : distance;

    /// <summary>
    ///     Resolves one stock family reference plane (`plane:family.<paramref name="member" />`) to its axis
    ///     and to the direction `Out` travels from it.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         All three planes pass through the family origin, so only the outward direction is a decision.
    ///         `Out` travels toward the RIGHT (+X), toward the FRONT (−Y), and UP (+Z). The Y sign is the
    ///         Revit convention, not a typo: the front elevation of a family looks from −Y toward +Y, so the
    ///         front side of `Center (Front/Back)` is the −Y side, and the stock template plane normal points
    ///         there. Live proof: `PE GRD Supply / Fifteen Vanes` puts `opening.Front`
    ///         (`from plane:family.CenterFB, Out by 15in`) at Y = −1.25 ft.
    ///     </para>
    ///     <para>
    ///         This differs from <see cref="ResolvePrismFace" />, where the FRONT face of a solid is +Y. The
    ///         two live at different altitudes — a solid face is named in the portable axis language, a family
    ///         plane inherits the template — and the disagreement is recorded for review, not hidden.
    ///     </para>
    /// </remarks>
    public static FamilyModelFamilyPlane ResolveFamilyPlane(string member) =>
        member switch {
            "CenterLR" => new(FamilyModelCoordinateAxis.X, new FamilyModelVector(1, 0, 0)),
            "CenterFB" => new(FamilyModelCoordinateAxis.Y, new FamilyModelVector(0, -1, 0)),
            "Bottom" => new(FamilyModelCoordinateAxis.Z, new FamilyModelVector(0, 0, 1)),
            _ => throw new ArgumentOutOfRangeException(nameof(member), member,
                "Family plane has no coordinate in the v1 vocabulary.")
        };

    /// <summary>
    ///     What `frame:family` means in each placement, which is the same three axes every time: local X runs
    ///     left/right, local Y front/back, local Z up from the family's bottom plane. The templates differ in
    ///     what those axes are ATTACHED to, and that is the whole difference.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         `Unhosted`: the origin is the model origin, Z rises from `Ref. Level`.
    ///     </para>
    ///     <para>
    ///         `FaceHosted`: the origin sits on the host face, Z leaves that face. The template also carries a
    ///         placeholder extrusion which capture recognizes and ignores.
    ///     </para>
    ///     <para>
    ///         `WallHosted` is the one that differs, and the difference is measured, not assumed. A stock
    ///         `Plumbing Fixture wall based` template exposes exactly three named reference planes —
    ///         `Center (Left/Right)`, `Back`, and `Reference Plane` — so X is centred on the wall's
    ///         centreline and Z rises from the level plane as everywhere else, but there is NO front/back
    ///         centre plane: a wall-hosted family is not centred in the wall's thickness, it hangs off the
    ///         wall FACE, which is what `Back` names. Depth is therefore anchored at that face and runs OUT
    ///         of the wall, −Y, the same direction the room calculation point travels (`AddRoomDingler`) and
    ///         the same direction <see cref="ResolveFamilyPlane" /> gives for `Out` from `CenterFB`.
    ///     </para>
    ///     <para>
    ///         That is why wall-hosted SOLIDS are refused at lowering today: the legacy plan centres depth on
    ///         `Center (Front/Back)`, a plane the wall template does not have. Until the plan can anchor a
    ///         one-sided depth span on the wall face, a wall-hosted document may carry the placement, the
    ///         template and its parameters, but not geometry.
    ///     </para>
    /// </remarks>
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

    public static FamilyModelExtrusionBounds ResolveCylinderBounds(double diameter, double height) {
        var radius = diameter / 2;
        return new(
            new FamilyModelBounds(-radius, radius),
            new FamilyModelBounds(-radius, radius),
            new FamilyModelBounds(0, height));
    }

    /// <summary>
    ///     The bounds of an extruded polygon in its own frame: the extremes of the resolved profile points,
    ///     and the bottom plane up to the height. The ring's shape between its points is Revit's business;
    ///     the bounds only need its corners.
    /// </summary>
    public static FamilyModelExtrusionBounds ResolvePolygonBounds(
        IReadOnlyList<FamilyModelProfilePointValue> profile,
        double height
    ) {
        if (profile.Count < 3)
            throw new ArgumentException("An extruded polygon needs at least three profile points.", nameof(profile));

        return new(
            new FamilyModelBounds(profile.Min(point => point.X), profile.Max(point => point.X)),
            new FamilyModelBounds(profile.Min(point => point.Y), profile.Max(point => point.Y)),
            new FamilyModelBounds(0, height));
    }

    /// <summary>
    ///     Resolves one authored length driver to FEET, which is the unit Revit reports and therefore the
    ///     one both sides of a prediction share. A `param:` reference reads the resolved parameter table,
    ///     which already carries feet; a literal carries its own unit and is converted here.
    /// </summary>
    /// <remarks>
    ///     This is the one length law. The lowerer normalizes to inches for the legacy authored profile,
    ///     which is a different seam with a different unit — it is not a second opinion about what `1/2ft`
    ///     means.
    /// </remarks>
    public static double ResolveLengthFeet(
        string? driver,
        IReadOnlyDictionary<string, double> parameterValuesInFeet
    ) {
        if (string.IsNullOrWhiteSpace(driver))
            throw new InvalidOperationException("The length driver is missing.");

        if (PortableFamilyReference.TryParse(driver, out var reference)) {
            if (reference.Kind != PortableFamilyReferenceKind.Parameter)
                throw new InvalidOperationException($"Length driver '{driver}' is not a param: reference.");

            if (parameterValuesInFeet.TryGetValue(reference.Target, out var value))
                return value;

            throw new InvalidOperationException($"Length driver '{driver}' has no resolved parameter value.");
        }

        if (!PortableScalar.TryParse(driver, out var scalar) || scalar.Kind != PortableScalarKind.Length)
            throw new InvalidOperationException($"Length driver '{driver}' is not a portable length literal.");

        return scalar.Unit switch {
            "ft" => scalar.Value,
            "in" => scalar.Value / 12.0,
            "mm" => scalar.Value / 304.8,
            "cm" => scalar.Value / 30.48,
            "m" => scalar.Value / 0.3048,
            var unit => throw new InvalidOperationException($"Unsupported portable length unit '{unit}'.")
        };
    }

    public static int CenteredLinearTotal(int halfCount) => (2 * halfCount) - 1;

    /// <summary>Resolves an authored axis token (`+X` … `−Z`) to a unit direction.</summary>
    public static FamilyModelVector ResolveAxis(string axis) => axis switch {
        "+X" => new FamilyModelVector(1, 0, 0),
        "-X" => new FamilyModelVector(-1, 0, 0),
        "+Y" => new FamilyModelVector(0, 1, 0),
        "-Y" => new FamilyModelVector(0, -1, 0),
        "+Z" => new FamilyModelVector(0, 0, 1),
        "-Z" => new FamilyModelVector(0, 0, -1),
        _ => throw new ArgumentOutOfRangeException(nameof(axis), axis, "Unknown axis token.")
    };

    /// <summary>
    ///     Builds the unrotated basis of a frame from its authored `normal` and `up` axis tokens. Local Z is
    ///     the normal, local Y is up, and local X completes a right-handed set (X = Y × Z).
    /// </summary>
    /// <remarks>
    ///     A frame takes POSITION from the planes and faces it references, never orientation: `normal` and
    ///     `up` are family axis tokens, and a frame that references a rotated frame does not inherit its
    ///     rotation. The one orientation delta is the `rotation` clause.
    /// </remarks>
    public static FamilyModelTransform ResolveFrameBasis(
        FamilyModelVector origin,
        string normal,
        string up
    ) {
        var basisZ = ResolveAxis(normal);
        var basisY = ResolveAxis(up);
        return new FamilyModelTransform(origin, basisY.Cross(basisZ), basisY, basisZ);
    }

    /// <summary>
    ///     Resolves the axis a `rotation.about` token names. `normal` and `up` are the frame's own local axes;
    ///     an axis token is a family axis. The origin never moves — a rotation turns the basis in place.
    /// </summary>
    public static FamilyModelVector ResolveRotationAxis(string about, FamilyModelTransform frame) => about switch {
        "normal" => frame.BasisZ,
        "up" => frame.BasisY,
        _ => ResolveAxis(about)
    };

    /// <summary>Turns a frame about one axis through its own origin (Rodrigues, right-hand rule).</summary>
    public static FamilyModelTransform Rotate(
        FamilyModelTransform frame,
        FamilyModelVector axis,
        double degrees
    ) {
        var radians = degrees * Math.PI / 180.0;
        return new FamilyModelTransform(
            frame.Origin,
            RotateVector(frame.BasisX, axis, radians),
            RotateVector(frame.BasisY, axis, radians),
            RotateVector(frame.BasisZ, axis, radians));
    }

    /// <summary>
    ///     Resolves a `rotation.by` driver to degrees. A `param:` reference reads the resolved parameter
    ///     table, which carries Revit internal units — angles are RADIANS there, degrees in the document.
    /// </summary>
    public static double ResolveAngleDegrees(
        string by,
        IReadOnlyDictionary<string, double> parameterValuesInRadians
    ) {
        if (PortableFamilyReference.TryParse(by, out var reference)) {
            if (reference.Kind != PortableFamilyReferenceKind.Parameter)
                throw new InvalidOperationException($"Rotation driver '{by}' is not a param: reference.");

            if (!parameterValuesInRadians.TryGetValue(reference.Target, out var radians))
                throw new InvalidOperationException($"Rotation driver '{by}' has no resolved parameter value.");

            return radians * 180.0 / Math.PI;
        }

        if (PortableScalar.TryParse(by, out var scalar) && scalar.Kind == PortableScalarKind.Angle)
            return scalar.Value;

        throw new InvalidOperationException($"Rotation driver '{by}' is not a param: reference or an angle literal.");
    }

    /// <summary>
    ///     Intersects the three planes a frame origin names. Three planes meet in one point unless two of
    ///     them are parallel, which is an authoring error rather than a geometry to guess at.
    /// </summary>
    public static FamilyModelVector IntersectPlanes(
        FamilyModelPlaneGeometry first,
        FamilyModelPlaneGeometry second,
        FamilyModelPlaneGeometry third
    ) {
        var (a, b, c) = (first.Normal, second.Normal, third.Normal);
        var determinant = a.Dot(b.Cross(c));
        if (Math.Abs(determinant) < 1e-9) {
            throw new InvalidOperationException(
                "Frame origin planes do not meet in one point; at least two of them are parallel.");
        }

        var (da, db, dc) = (a.Dot(first.Point), b.Dot(second.Point), c.Dot(third.Point));
        return ((b.Cross(c) * da) + (c.Cross(a) * db) + (a.Cross(b) * dc)) * (1.0 / determinant);
    }

    private static FamilyModelVector RotateVector(
        FamilyModelVector vector,
        FamilyModelVector axis,
        double radians
    ) {
        var cos = Math.Cos(radians);
        var sin = Math.Sin(radians);
        return (vector * cos) +
               (axis.Cross(vector) * sin) +
               (axis * (axis.Dot(vector) * (1 - cos)));
    }
}
