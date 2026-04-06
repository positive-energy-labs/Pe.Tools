using Autodesk.Revit.DB.Mechanical;
using Pe.Global.Revit.Ui;
using Serilog.Events;

namespace Pe.Global.Revit.Mep.Mechanical;

public class Ducts {
    /// <summary>
    ///     Create a proper takeoff fitting using Document.NewTakeoffFitting
    ///     This ensures the tap is connected to the duct system
    /// </summary>
    public static Result<FamilyInstance> MakeTakeoffWithBranch(
        Document doc,
        MEPCurve trunkDuct,
        XYZ location,
        XYZ direction,
        double tapSizeFeet,
        DuctType ductType,
        Ballogger? balloon = null
    ) {
        try {
            var (level, _) = MepCurve.GetReferenceLevel(trunkDuct);
            if (level is null) return new InvalidOperationException("ReferenceLevel is null, nothing was found");

            var (systemType, _) = MepCurve.GetSystemType(trunkDuct);
            if (systemType is null) return new InvalidOperationException("SystemType is null, nothing was found");

            // Check for existing elements at the tap location first
            var boundingBox = new BoundingBoxXYZ();
            boundingBox.Min = location - new XYZ(tapSizeFeet / 2, tapSizeFeet / 2, tapSizeFeet / 2);
            boundingBox.Max = location + new XYZ(tapSizeFeet / 2, tapSizeFeet / 2, tapSizeFeet / 2);

            var outline = new Outline(boundingBox.Min, boundingBox.Max);
            var bbIntersectsFilter = new BoundingBoxIntersectsFilter(outline);

            var existingElements = new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_DuctFitting)
                .WhereElementIsNotElementType()
                .WherePasses(bbIntersectsFilter)
                .ToElements()
                .Where(e => e.Id != trunkDuct.Id)
                .ToList();

            if (existingElements.Any()) {
                var existingIds = existingElements.Select(e => e.Id).ToArray();
                return new ElementIntersectException(null, existingIds);
            }

            // If no intersections, proceed with creating the tap
            var branchStart = location;
            var branchEnd = location + (direction.Normalize() * 0.5); // 6 inch stub
            var branchDuct = Duct.Create(
                doc,
                systemType.Id,
                ductType.Id,
                level.Id,
                branchStart,
                branchEnd
            );
            if (branchDuct is null) return new InvalidOperationException("Branch duct is null, creation was faulty");
            _ = balloon?.AddDebug(LogEventLevel.Information, new StackFrame(),
                $"Created branch duct on {level.Name} with DuctType: {ductType.Name}, SystemType: {systemType.Name}");

            // Set the duct diameter to the correct tap size
            var diamParam = branchDuct.FindParameter(BuiltInParameter.RBS_CURVE_DIAMETER_PARAM);
            if (diamParam == null)
                return new InvalidOperationException("Branch duct diameter parameter not found");

            var setDiamSuccess = diamParam.Set(tapSizeFeet);
            if (!setDiamSuccess)
                _ = balloon?.Add(LogEventLevel.Warning, new StackFrame(), "Branch duct's diameter could not be set");

            // Get the connector from the branch duct closest to the main duct
            var (branchConns, _) = Connectors.GetClosestToPoint(branchDuct, location);
            if (branchConns is null)
                return new InvalidOperationException("Branch connectors are null, nothing was found");
            var branchConn = branchConns[0];

            var fitting = doc.Create.NewTakeoffFitting(branchConn, trunkDuct);
            if (fitting is null) return new InvalidOperationException("Failed to create takeoff fitting");

            return !branchConn.IsConnected
                ? new InvalidOperationException("Tap not properly connected to branch duct.")
                : fitting;
        } catch (Exception ex) {
            return ex;
        }
    }
}