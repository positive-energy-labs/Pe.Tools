using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using Pe.Global.PolyFill;
using Pe.Global.Revit.Lib;
using Pe.Global.Revit.Mep.Mechanical;
using Pe.Global.Revit.Ui;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.Tools.Commands;

[Transaction(TransactionMode.Manual)]
public class CmdTapMaker : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        try {
            var uiapp = commandData.Application;
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc?.Document;

            if (doc == null) {
                message = "No active document found";
                return Result.Failed;
            }

            while (true) {
                var (selection, selectionError) = Pickers.FacePosition(
                    uiapp,
                    new DuctFaceSelectionFilter(),
                    "where you want to place the tap"
                );

                if (selectionError is not null)
                    break;

                if (selection.element is not null
                    && selection.elementFace is not null
                    && selection.clickPosition is not null) {
                    _ = CreateTapOnFace(
                        uiapp,
                        selection.element,
                        selection.elementFace,
                        selection.clickPosition
                    );
                }
            }

            return Result.Succeeded;
        } catch (Exception ex) {
            message = $"Error placing tap: {ex.Message}";
            return Result.Failed;
        }
    }


    private static bool CreateTapOnFace(
        UIApplication uiApplication,
        Element trunkDuct,
        Face face,
        UV clickPosition,
        double tapSizeInches = 6.0
    ) {
        var balloon = new Ballogger();

        try {
            var uidoc = uiApplication.ActiveUIDocument;
            var doc = uidoc.Document;

            tapSizeInches = TapSizer(face, tapSizeInches);
            var tapSizeFeet = tapSizeInches / 12.0;
            var tapRadiusFeet = tapSizeInches / 2 / 12.0; // Convert to feet for Revit internal units

            var locationAdjusted = !Faces.IsPointInside(face, clickPosition, tapRadiusFeet)
                ? Faces.ConstrainUVPointWithMargin(face, clickPosition, tapRadiusFeet)
                : clickPosition;
            var normal = face.ComputeNormal(locationAdjusted);

            var tapDuctType =
                new[] { ConnectorProfileType.Round, ConnectorProfileType.Rectangular, ConnectorProfileType.Oval }
                    .Select(shape => Filters.DuctType(doc, shape, JunctionType.Tap))
                    .FirstOrDefault(result => result is not null)
                ?? throw new InvalidOperationException("DuctType is null, nothing was found");
            using var trans = new Transaction(doc, "Make Tap On Face");
            _ = trans.Start();

            var (tap, tapError) = TapPlacer(
                doc,
                face,
                trunkDuct,
                locationAdjusted,
                tapSizeFeet,
                tapDuctType,
                balloon
            );

            if (tapError is not null) {
                _ = trans.RollBack();
                _ = balloon.Add(LogEventLevel.Error, new StackFrame(), tapError);
                balloon.Show();
                return false;
            }

            _ = trans.Commit();
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Created a {tapSizeInches}\" tap successfully (tap ID: {tap.Id}).");
            balloon?.Show();
            return true;
        } catch (Exception ex) {
            _ = balloon.Add(LogEventLevel.Error, new StackFrame(), ex);
            balloon.Show();
            return false; // Don't throw, just return false so user can see debug info
        }
    }

    private static Result<FamilyInstance> TapPlacer(
        Document doc,
        Face face,
        Element trunkDuct,
        UV locationAdjusted,
        double tapSizeFeet,
        DuctType ductType,
        Ballogger balloon = null
    ) {
        // Get all radial points at 45 degree increments in order of center-proximity
        var positions = Enumerable.Range(1, 9)
            .Select(i =>
                Faces.GetPointAtAngle(locationAdjusted, tapSizeFeet / 2, i * 45.0))
            .OrderBy(p => (p - Faces.GetCenter(face)).GetLength()) // Order by distance from center
            .Prepend(locationAdjusted)
            .ToList();

        try {
            foreach (var pos in positions) {
                if (!Faces.IsPointInside(face, pos, tapSizeFeet / 2)) continue;
                var altPoint = face.Evaluate(pos);
                var altNormal = face.ComputeNormal(pos);
                var (tap, tapError) = Ducts.MakeTakeoffWithBranch(
                    doc,
                    trunkDuct as MEPCurve,
                    altPoint,
                    altNormal,
                    tapSizeFeet,
                    ductType,
                    balloon);
                if (tap is null || tapError is not null) continue;
                return tap;
            }

            return new InvalidOperationException("No easy tap placement was found");
        } catch (Exception ex) {
            return ex;
        }
    }

    private static double TapSizer(Face face, double defaultTapSizeInches) {
        var sizesInches = face switch {
            PlanarFace => new[] { 16.0, 14.0, 12.0, 10.0, 8.0, 6.0, 5.0, 4.0, 3.0 },
            CylindricalFace => new[] { 16.0, 14.0, 12.0, 10.0, 8.0, 6.0, 5.0, 4.0 },
            _ => Array.Empty<double>()
        };
        var faceMinSizeInches = face switch {
            PlanarFace pf => Faces.GetMinSizePlanar(pf),
            CylindricalFace cf => Faces.GetMinSizeCylindrical(cf),
            _ => 0.0
        };

        // Return default tap size if it fits on face. Happy path
        if (defaultTapSizeInches <= faceMinSizeInches
            && sizesInches.Contains(defaultTapSizeInches))
            return defaultTapSizeInches;

        // Otherwise, get size that fits. Implicitly, default is 0.0 (bc double's def is 0.0)
        return sizesInches.FirstOrDefault(size => size <= faceMinSizeInches);
    }
}

public class DuctFaceSelectionFilter : ISelectionFilter {
    public bool AllowElement(Element elem) {
        // Only allow ducts
#if REVIT2023
        return elem.Category?.Id.IntegerValue == (int)BuiltInCategory.OST_DuctCurves;
#else
#pragma warning disable IDE0022 // Use expression body for method
        return elem.Category?.Id.Value() == (int)BuiltInCategory.OST_DuctCurves;
#pragma warning restore IDE0022 // Use expression body for method
#endif
    }

    public bool AllowReference(Reference reference, XYZ position) =>
        // Allow face selection on ducts
        true;
}