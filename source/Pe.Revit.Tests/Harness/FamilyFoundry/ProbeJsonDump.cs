using Newtonsoft.Json;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     Writes one runtime probe as JSON beside its <see cref="ProbeSvgGallery" /> SVG, so the ACTUAL side of
///     the family review board can be drawn in the web from Revit-side readings instead of a picture.
/// </summary>
/// <remarks>
///     The SVG is for a human; this is for a renderer. Same probe, same run directory, same file stem.
///     Revit types do not serialize, so every <c>XYZ</c> becomes <c>[x, y, z]</c> in feet and every
///     <c>ElementId</c> is dropped — an element id is machine identity from one document, meaningless to a
///     reader of a checked-in fixture.
/// </remarks>
internal static class ProbeJsonDump {
    /// <summary>
    ///     Writes `&lt;familyName&gt;/&lt;typeName&gt;.probe.json` under <paramref name="directory" /> and
    ///     returns the full path. The caller owns the run directory, including its date.
    /// </summary>
    public static string Write(
        string directory,
        string familyName,
        RuntimeStateProbe probe,
        FamilyModel model
    ) {
        var familyDirectory = Path.Combine(directory, SanitizeName(familyName));
        _ = Directory.CreateDirectory(familyDirectory);
        var path = Path.Combine(familyDirectory, $"{SanitizeName(probe.TypeName)}.probe.json");
        File.WriteAllText(path,
            JsonConvert.SerializeObject(Project(familyName, probe, model), Formatting.Indented));
        return path;
    }

    private static object Project(string familyName, RuntimeStateProbe probe, FamilyModel model) => new {
        familyName,
        typeName = probe.TypeName,
        predicted = Predict(probe, model),
        parameterValues = probe.ParameterValues,
        planes = probe.Planes.ToDictionary(
            entry => entry.Key,
            entry => (object)new { normal = Xyz(entry.Value.Normal), midpoint = Xyz(entry.Value.Midpoint) }),
        dimensions = probe.Dimensions.Select(dimension => new {
            planeNames = dimension.PlaneNames,
            labelParameterName = dimension.LabelParameterName,
            measuredDistance = dimension.MeasuredDistance,
            areSegmentsEqual = dimension.AreSegmentsEqual
        }),
        prisms = probe.Prisms.Select(prism => new {
            sketchPlaneName = prism.SketchPlaneName,
            min = Xyz(prism.Min),
            max = Xyz(prism.Max),
            startOffset = prism.StartOffset,
            endOffset = prism.EndOffset,
            isSolid = prism.IsSolid
        }),
        cylinders = probe.Cylinders.Select(cylinder => new {
            sketchPlaneName = cylinder.SketchPlaneName,
            min = Xyz(cylinder.Min),
            max = Xyz(cylinder.Max),
            startOffset = cylinder.StartOffset,
            endOffset = cylinder.EndOffset,
            diameter = cylinder.Diameter,
            isSolid = cylinder.IsSolid
        }),
        connectors = probe.Connectors.Select(connector => new {
            domain = connector.Domain.ToString(),
            profile = connector.Profile.ToString(),
            systemClassification = connector.SystemClassification?.ToString(),
            flowDirection = connector.FlowDirection?.ToString(),
            origin = Xyz(connector.Origin),
            widthAxis = Xyz(connector.WidthAxis),
            lengthAxis = Xyz(connector.LengthAxis),
            faceNormal = Xyz(connector.FaceNormal),
            diameter = connector.Diameter,
            width = connector.Width,
            length = connector.Length
        }),
        settings = new {
            alwaysVertical = probe.Settings.AlwaysVertical,
            shared = probe.Settings.Shared,
            cutWithVoidsWhenLoaded = probe.Settings.CutWithVoidsWhenLoaded,
            partType = probe.Settings.PartType,
            omniClass = probe.Settings.OmniClass,
            roomCalculationPointEnabled = probe.Settings.RoomCalculationPointEnabled,
            roomCalculationPointOffsetFeet = probe.Settings.RoomCalculationPointOffsetFeet,
            lookupTableNames = probe.Settings.LookupTableNames
        },
        counts = new {
            referencePlanes = probe.ReferencePlaneCount,
            dimensions = probe.DimensionCount,
            extrusions = probe.ExtrusionCount,
            connectors = probe.ConnectorCount
        }
    };
}
