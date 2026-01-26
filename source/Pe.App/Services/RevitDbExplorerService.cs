using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Serilog;
using RevitDBExplorer;
using RevitDBExplorer.Domain.Selectors;
using System.Diagnostics;

namespace Pe.App.Services;

/// <summary>
///     Centralized wrapper for RevitDBExplorer integration.
///     Uses the forked RDBE package with embedded support via EmbeddedCommand.
/// </summary>
public static class RevitDbExplorerService {
    /// <summary>
    ///     Opens RevitDBExplorer UI to snoop elements.
    /// </summary>
    /// <param name="uiApp">The UIApplication instance</param>
    /// <param name="doc">The document containing the elements</param>
    /// <param name="elements">The elements to snoop</param>
    public static Result<bool> TrySnoopElements(UIApplication uiApp, Document doc, IEnumerable<Element> elements) {
        try {
            // Log input parameters
            var elementsList = elements.ToList();
            Log.Debug("TrySnoopElements called with {ElementCount} elements", elementsList.Count);
            Log.Debug("Document: Title={Title}, IsValidObject={IsValid}",
                doc?.Title ?? "NULL",
                doc?.IsValidObject ?? false);

            // Verify inputs
            if (uiApp == null) {
                Log.Error("UIApplication is null");
                return new ArgumentNullException(nameof(uiApp));
            }

            if (doc == null) {
                Log.Error("Document is null");
                _ = TaskDialog.Show("Snoop Failed", "Document is null");
                return new ArgumentNullException(nameof(doc));
            }

            if (!elementsList.Any()) {
                Log.Warning("No elements to snoop");
                _ = TaskDialog.Show("Snoop", "No elements provided to snoop.");
                return false;
            }

            // Log sample of elements
            foreach (var elem in elementsList.Take(3)) {
                Log.Debug("  Element: Id={Id}, Category={Category}, Type={Type}",
                    elem?.Id?.Value ?? -1,
                    elem?.Category?.Name ?? "NULL",
                    elem?.GetType()?.Name ?? "NULL");
            }
            if (elementsList.Count > 3) {
                Log.Debug("  ... and {MoreCount} more", elementsList.Count - 3);
            }

            // Set Revit selection to the elements we want to snoop
            // EmbeddedCommand with Selector.CurrentSelection will read from this
            Log.Debug("Setting Revit selection...");
            var uidoc = new UIDocument(doc);
            var elementIds = elementsList.Select(e => e.Id).ToList();
            uidoc.Selection.SetElementIds(elementIds);

            // Execute RDBE using EmbeddedCommand
            Log.Debug("Executing RDBE EmbeddedCommand...");
            _ = new EmbeddedCommand().Execute(uiApp, Selector.CurrentSelection);

            Log.Information("RevitDBExplorer opened successfully");
            return true;

        } catch (Exception ex) {
            Log.Error(ex, "RevitDBExplorer snoop failed: {Exception}", ex.ToStringDemystified());
            _ = TaskDialog.Show("Snoop Failed", $"Error: {ex.Message}\n\nCheck logs for details.");
            return ex;
        }
    }
}
