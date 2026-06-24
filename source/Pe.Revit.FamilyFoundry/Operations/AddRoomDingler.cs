using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.Extensions.FamDocument;
using System.ComponentModel;

namespace Pe.Revit.FamilyFoundry.Operations;

public sealed class AddRoomDingler(AddRoomDinglerSettings settings) : DocOperation<AddRoomDinglerSettings>(settings) {
    private const double OffsetFeet = 1.0;

    public override string Description =>
        "Enable the family room calculation point and move it to the host-inferred room-facing default.";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();
        var family = doc.OwnerFamily;
        if (family == null)
            return new OperationLog(this.Name, [new LogEntry("Owner family").Error("Family document has no owner family.")]);

        var placement = GetRoomDinglerPlacement(family);
        if (!family.ShowSpatialElementCalculationPoint)
            family.ShowSpatialElementCalculationPoint = true;
        doc.Document.Regenerate();

        var singlePoints = new FilteredElementCollector(doc)
            .OfClass(typeof(SpatialElementCalculationPoint))
            .Cast<SpatialElementCalculationPoint>()
            .ToList();
        var fromToPoints = new FilteredElementCollector(doc)
            .OfClass(typeof(SpatialElementFromToCalculationPoints))
            .Cast<SpatialElementFromToCalculationPoints>()
            .ToList();

        if (singlePoints.Count == 0 && fromToPoints.Count == 0) {
            logs.Add(new LogEntry("Room calculation point").Error(
                $"Family placement '{family.FamilyPlacementType}' did not expose room calculation point elements after enabling ShowSpatialElementCalculationPoint."));
            return new OperationLog(this.Name, logs);
        }

        foreach (var point in singlePoints) {
            var target = placement.Direction.Multiply(OffsetFeet);
            point.Position = target;
            logs.Add(new LogEntry("Room calculation point").Success(
                $"Set {placement.Kind} point to {Format(target)}."));
        }

        foreach (var point in fromToPoints) {
            var from = placement.Direction.Negate().Multiply(OffsetFeet);
            var to = placement.Direction.Multiply(OffsetFeet);
            if (!point.IsAcceptableFromPosition(from) || !point.IsAcceptableToPosition(to)) {
                logs.Add(new LogEntry("From/to room calculation point").Error(
                    $"Family rejected {placement.Kind} from/to points from={Format(from)}, to={Format(to)}."));
                continue;
            }

            point.FromPosition = from;
            point.ToPosition = to;
            logs.Add(new LogEntry("From/to room calculation point").Success(
                $"Set {placement.Kind} from/to points from={Format(from)}, to={Format(to)}."));
        }

        return new OperationLog(this.Name, logs);
    }

    private static RoomDinglerPlacement GetRoomDinglerPlacement(Family family) =>
        family.FamilyPlacementType switch {
            FamilyPlacementType.WorkPlaneBased => new RoomDinglerPlacement(RoomDinglerPlacementKind.FaceHosted, new XYZ(0, -1, 0)),
            FamilyPlacementType.OneLevelBasedHosted => new RoomDinglerPlacement(RoomDinglerPlacementKind.WallHosted, new XYZ(0, -1, 0)),
            _ => new RoomDinglerPlacement(RoomDinglerPlacementKind.Unhosted, XYZ.BasisZ)
        };

    private static string Format(XYZ point) =>
        $"({point.X:0.###}, {point.Y:0.###}, {point.Z:0.###})";

    private sealed record RoomDinglerPlacement(RoomDinglerPlacementKind Kind, XYZ Direction);
}

[JsonConverter(typeof(StringEnumConverter))]
public enum RoomDinglerPlacementKind {
    Unhosted,
    FaceHosted,
    WallHosted
}

public sealed class AddRoomDinglerSettings : IOperationSettings {
    [Description("Whether to add or update the room calculation point using Family Foundry host-inferred defaults.")]
    public bool Enabled { get; init; }
}
