using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.Global.PolyFill;
using Serilog;

namespace Pe.App.Tasks;

/// <summary>
///     Flips a selected element upside down (180° around horizontal axis).
///     Rotates around the element's bounding box center.
/// </summary>
public sealed class FlipElement180Task : ITask {
    public string Name => "Flip Element Upside Down";
    public string Description => "Click an element to flip it upside down";
    public string Category => "Edit";

    public async Task ExecuteAsync(UIApplication uiApp) {
        var uidoc = uiApp.ActiveUIDocument;
        var doc = uidoc?.Document;

        if (doc == null) {
            Log.Information("❌ No active document");
            return;
        }

        if (doc.IsReadOnly) {
            Log.Information("❌ Document is read-only");
            return;
        }

        try {
            // Prompt user to select an element
            if (uidoc == null) {
                Log.Information("❌ No active UI document");
                return;
            }

            Log.Information("👆 Click on an element to flip it 180°...");
            var reference = uidoc.Selection.PickObject(
                ObjectType.Element,
                "Select element to flip 180° to your POV");

            var element = doc.GetElement(reference);
            if (element == null) {
                Log.Information("❌ Could not get element");
                return;
            }

            // Get current view to determine rotation axis
            var view = doc.ActiveView;
            if (view == null) {
                Log.Information("❌ No active view");
                return;
            }

            // Get element's bounding box center as rotation point
            var bbox = element.get_BoundingBox(view);
            if (bbox == null) {
                Log.Information("❌ Element has no bounding box in this view");
                return;
            }

            var center = (bbox.Min + bbox.Max) / 2.0;

            // Rotate around horizontal (Y) axis to flip upside down
            var axis = XYZ.BasisY;

            // Create rotation axis line through the center point
            var axisLine = Line.CreateBound(center, center + axis);

            // Rotate 180 degrees (π radians)
            var angle = Math.PI;

            // Perform the rotation in a transaction
            using var trans = new Transaction(doc, "Flip Element Upside Down");
            _ = trans.Start();

            ElementTransformUtils.RotateElement(doc, element.Id, axisLine, angle);

            _ = trans.Commit();

            Log.Information($"✓ Flipped element '{element.Name}' (ID: {element.Id.Value()}) upside down\n");
        } catch (Autodesk.Revit.Exceptions.OperationCanceledException) {
            Log.Information("⚠ Selection cancelled\n");
        } catch (Exception ex) {
            Log.Information($"✗ Failed to flip element: {ex.Message}");
            Log.Information(ex.StackTrace ?? string.Empty);
        }

        await Task.CompletedTask;
    }
}
