namespace Pe.Revit.Tests;

internal static class FamilyFoundryRuntimeProbe {
    public static RuntimeStateProbe Collect(Document familyDocument) {
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        // Reopened RFAs are already regenerated and are intentionally inspected read-only. Revit forbids an
        // explicit Regenerate outside a transaction, while apply-time callers may already own one.
        if (familyDocument.IsModifiable)
            familyDocument.Regenerate();

        var currentType = familyDocument.FamilyManager.CurrentType
                          ?? throw new InvalidOperationException("The family document had no current type.");
        var planes = CollectPlanes(familyDocument);
        var dimensions = CollectDimensions(familyDocument, planes);
        var prisms = CollectPrisms(familyDocument);
        var cylinders = CollectCylinders(familyDocument);
        var connectors = CollectConnectors(familyDocument);

        return new RuntimeStateProbe(
            currentType.Name,
            CollectParameterValues(familyDocument, currentType),
            planes,
            dimensions,
            prisms,
            cylinders,
            connectors,
            CollectSettings(familyDocument),
            planes.Count,
            dimensions.Count,
            prisms.Count + cylinders.Count,
            connectors.Count);
    }

    /// <summary>
    ///     Reads the family-global settings the portable `settings` section names, plus the room calculation
    ///     point and the embedded size-table names. `FamilySizeTableManager` is the only door to table data,
    ///     so asking it for the names is the one independent check available without exporting every table.
    /// </summary>
    private static RuntimeFamilySettingsProbe CollectSettings(Document familyDocument) {
        var family = familyDocument.OwnerFamily;
        var points = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(SpatialElementCalculationPoint))
            .Cast<SpatialElementCalculationPoint>()
            .Select(point => point.Position.GetLength())
            .ToList();
        var ownerFamilyId = family?.Id;
        var tableNames = new List<string>();
        if (ownerFamilyId != null) {
            using var manager = FamilySizeTableManager.GetFamilySizeTableManager(familyDocument, ownerFamilyId);
            if (manager != null && manager.IsValidObject)
                tableNames = manager.GetAllSizeTableNames().OrderBy(name => name, StringComparer.Ordinal).ToList();
        }

        return new RuntimeFamilySettingsProbe(
            ReadBoolean(family, BuiltInParameter.FAMILY_ALWAYS_VERTICAL),
            ReadBoolean(family, BuiltInParameter.FAMILY_SHARED),
            ReadBoolean(family, BuiltInParameter.FAMILY_ALLOW_CUT_WITH_VOIDS),
            ReadInteger(family, BuiltInParameter.FAMILY_CONTENT_PART_TYPE),
#if REVIT2026_OR_GREATER
            // Revit 2026 removed the OmniClass parameter; see FamilyModelSettings.OmniClass.
            null,
#else
            family?.get_Parameter(BuiltInParameter.OMNICLASS_CODE)?.AsString(),
#endif
            family?.ShowSpatialElementCalculationPoint == true,
            points.Count == 0 ? null : points[0],
            tableNames);
    }

    private static bool? ReadBoolean(Family? family, BuiltInParameter builtInParameter) =>
        ReadInteger(family, builtInParameter) is { } value ? value != 0 : null;

    private static int? ReadInteger(Family? family, BuiltInParameter builtInParameter) {
        var parameter = family?.get_Parameter(builtInParameter);
        return parameter == null || parameter.StorageType != StorageType.Integer ? null : parameter.AsInteger();
    }

    private static IReadOnlyDictionary<string, double> CollectParameterValues(Document familyDocument,
        FamilyType currentType) =>
        familyDocument.FamilyManager.Parameters
            .Cast<FamilyParameter>()
            .Where(parameter => currentType.HasValue(parameter))
            .Select(parameter => new {
                parameter.Definition.Name, Value = TryGetLengthLikeValue(currentType, parameter)
            })
            .Where(entry => entry.Value != null)
            .ToDictionary(entry => entry.Name, entry => entry.Value!.Value, StringComparer.Ordinal);

    private static double? TryGetLengthLikeValue(FamilyType currentType, FamilyParameter parameter) {
        try {
            return currentType.AsDouble(parameter);
        } catch {
            return null;
        }
    }

    private static IReadOnlyDictionary<string, RuntimePlaneProbe> CollectPlanes(Document familyDocument) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .Where(plane => !string.IsNullOrWhiteSpace(plane.Name))
            .ToDictionary(
                plane => plane.Name.Trim(),
                plane => new RuntimePlaneProbe(
                    plane.Name.Trim(),
                    NormalizeOrThrow(plane.Normal, $"reference plane '{plane.Name}' normal"),
                    plane.GetPlane().Origin),
                StringComparer.Ordinal);

    private static IReadOnlyList<RuntimeDimensionProbe> CollectDimensions(
        Document familyDocument,
        IReadOnlyDictionary<string, RuntimePlaneProbe> planes
    ) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Dimension))
            .Cast<Dimension>()
            .Where(dimension => dimension is not SpotDimension)
            .Select(dimension => CreateDimensionProbe(familyDocument, dimension, planes))
            .Where(probe => probe != null)
            .Cast<RuntimeDimensionProbe>()
            .ToList();

    private static RuntimeDimensionProbe? CreateDimensionProbe(
        Document familyDocument,
        Dimension dimension,
        IReadOnlyDictionary<string, RuntimePlaneProbe> planes
    ) {
        var planeNames = new List<string>();

        for (var index = 0; index < dimension.References.Size; index++) {
            if (familyDocument.GetElement(dimension.References.get_Item(index)) is not ReferencePlane plane ||
                string.IsNullOrWhiteSpace(plane.Name))
                continue;

            planeNames.Add(plane.Name.Trim());
        }

        if (planeNames.Count < 2)
            return null;

        var measuredDistance = TryMeasureDimensionDistance(planeNames, planes);
        return new RuntimeDimensionProbe(
            planeNames,
            dimension.FamilyLabel?.Definition?.Name,
            measuredDistance,
            dimension.AreSegmentsEqual);
    }

    private static double TryMeasureDimensionDistance(
        IReadOnlyList<string> planeNames,
        IReadOnlyDictionary<string, RuntimePlaneProbe> planes
    ) {
        if (!planes.TryGetValue(planeNames[0], out var first) ||
            !planes.TryGetValue(planeNames[planeNames.Count - 1], out var last))
            return 0.0;

        return Math.Abs((last.Midpoint - first.Midpoint).DotProduct(first.Normal));
    }

    private static IReadOnlyList<RuntimePrismProbe> CollectPrisms(Document familyDocument) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(IsRectangularExtrusion)
            .Select(extrusion => {
                var box = GetBoundingBox(extrusion);
                return new RuntimePrismProbe(
                    extrusion.Id,
                    extrusion.Sketch?.SketchPlane?.Name,
                    box.Min,
                    box.Max,
                    extrusion.StartOffset,
                    extrusion.EndOffset,
                    extrusion.IsSolid);
            })
            .ToList();

    private static IReadOnlyList<RuntimeCylinderProbe> CollectCylinders(Document familyDocument) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(IsRoundExtrusion)
            .Select(extrusion => {
                var box = GetBoundingBox(extrusion);
                return new RuntimeCylinderProbe(
                    extrusion.Id,
                    extrusion.Sketch?.SketchPlane?.Name,
                    box.Min,
                    box.Max,
                    extrusion.StartOffset,
                    extrusion.EndOffset,
                    MeasureRoundExtrusionDiameter(extrusion),
                    extrusion.IsSolid);
            })
            .ToList();

    private static IReadOnlyList<RuntimeConnectorProbe> CollectConnectors(Document familyDocument) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .Select(connector => {
                var coordinateSystem = connector.CoordinateSystem;
                var widthAxis = coordinateSystem == null
                    ? XYZ.Zero
                    : NormalizeOrThrow(coordinateSystem.BasisX, $"connector '{connector.Id.Value()}' width axis");
                var lengthAxis = coordinateSystem == null
                    ? XYZ.Zero
                    : NormalizeOrThrow(coordinateSystem.BasisY, $"connector '{connector.Id.Value()}' length axis");
                var faceNormal = coordinateSystem == null
                    ? XYZ.Zero
                    : NormalizeOrThrow(coordinateSystem.BasisZ, $"connector '{connector.Id.Value()}' face normal");

                return new RuntimeConnectorProbe(
                    connector.Id,
                    connector.Domain,
                    connector.Shape,
                    TryGetSystemClassification(connector),
                    TryGetFlowDirection(connector),
                    connector.Origin,
                    widthAxis,
                    lengthAxis,
                    faceNormal,
                    connector.Shape == ConnectorProfileType.Round ? GetRoundConnectorDiameter(connector) : null,
                    connector.Shape == ConnectorProfileType.Rectangular ? connector.Width : null,
                    connector.Shape == ConnectorProfileType.Rectangular ? connector.Height : null);
            })
            .ToList();

    private static MEPSystemClassification? TryGetSystemClassification(ConnectorElement connector) {
        try {
            return connector.SystemClassification;
        } catch {
            return null;
        }
    }

    private static FlowDirectionType? TryGetFlowDirection(ConnectorElement connector) {
        try {
            return connector.Domain switch {
                Domain.DomainHvac => (FlowDirectionType)(connector.get_Parameter(BuiltInParameter
                                                             .RBS_DUCT_FLOW_DIRECTION_PARAM)?.AsInteger()
                                                         ?? (int)FlowDirectionType.Bidirectional),
                Domain.DomainPiping => (FlowDirectionType)(connector.get_Parameter(BuiltInParameter
                                                               .RBS_PIPE_FLOW_DIRECTION_PARAM)?.AsInteger()
                                                           ?? (int)FlowDirectionType.Bidirectional),
                _ => null
            };
        } catch {
            return null;
        }
    }

    private static double? GetRoundConnectorDiameter(ConnectorElement connector) {
        if (connector.Shape != ConnectorProfileType.Round)
            return null;

        if (connector.Radius > 1e-9)
            return connector.Radius * 2.0;

        var diameter = connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER)?.AsDouble();
        if (diameter is > 1e-9)
            return diameter;

        var radius = connector.get_Parameter(BuiltInParameter.CONNECTOR_RADIUS)?.AsDouble();
        return radius is > 1e-9 ? radius * 2.0 : null;
    }

    private static double MeasureRoundExtrusionDiameter(Extrusion extrusion) {
        var arc = extrusion.Sketch?.Profile
            ?.Cast<CurveArray>()
            .SelectMany(loop => loop.Cast<Curve>())
            .OfType<Arc>()
            .FirstOrDefault();
        if (arc != null)
            return arc.Radius * 2.0;

        var box = GetBoundingBox(extrusion);
        var x = box.Max.X - box.Min.X;
        var y = box.Max.Y - box.Min.Y;
        return Math.Min(x, y);
    }

    private static BoundingBoxXYZ GetBoundingBox(Extrusion extrusion) =>
        extrusion.get_BoundingBox(null)
        ?? throw new InvalidOperationException($"Extrusion '{extrusion.Id.Value()}' had no bounding box.");

    private static bool IsRectangularExtrusion(Extrusion extrusion) {
        var profile = extrusion.Sketch?.Profile;
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        return loop != null && loop.Size == 4 && loop.Cast<Curve>().All(curve => curve is Line);
    }

    private static bool IsRoundExtrusion(Extrusion extrusion) {
        var profile = extrusion.Sketch?.Profile;
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        return loop != null && loop.Size > 0 && loop.Cast<Curve>().All(curve => curve is Arc);
    }

    internal static XYZ NormalizeOrThrow(XYZ vector, string label) {
        if (vector.GetLength() <= 1e-9)
            throw new InvalidOperationException($"The {label} had zero length.");

        return vector.Normalize();
    }
}
