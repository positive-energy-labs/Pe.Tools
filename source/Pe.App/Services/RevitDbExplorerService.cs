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
    ///     Opens RevitDBExplorer UI to snoop any objects.
    ///     Works for FamilyParameter, Family, FamilySymbol, Category, or any other Revit API object.
    /// </summary>
    /// <param name="uiApp">The UIApplication instance</param>
    /// <param name="doc">The document context (can be null for non-document objects)</param>
    /// <param name="objects">The objects to snoop</param>
    /// <param name="title">Optional title for the RDBE window</param>
    public static Result<bool> TrySnoopObjects(
        UIApplication uiApp,
        Document? doc,
        IEnumerable<object> objects,
        string? title = null
    ) {
        try {
            var objectsList = objects?.ToList() ?? [];
            Log.Debug("TrySnoopObjects called with {ObjectCount} objects", objectsList.Count);

            if (uiApp == null) {
                Log.Error("UIApplication is null");
                return new ArgumentNullException(nameof(uiApp));
            }

            if (objectsList.Count == 0) {
                Log.Warning("No objects to snoop");
                _ = TaskDialog.Show("Snoop", "No objects provided to snoop.");
                return false;
            }

            // Log sample of objects
            foreach (var obj in objectsList.Take(3))
                Log.Debug("  Object: Type={Type}", obj?.GetType()?.Name ?? "NULL");

            if (objectsList.Count > 3)
                Log.Debug("  ... and {MoreCount} more", objectsList.Count - 3);

            // Use the new direct object Execute overload
            Log.Debug("Executing RDBE EmbeddedCommand with direct objects...");
            _ = new EmbeddedCommand().Execute(uiApp, doc, objectsList, title);

            Log.Information("RevitDBExplorer opened successfully");
            return true;
        } catch (Exception ex) {
            Log.Error(ex, "RevitDBExplorer snoop failed: {Exception}", ex.ToStringDemystified());
            _ = TaskDialog.Show("Snoop Failed", $"Error: {ex.Message}\n\nCheck logs for details.");
            return ex;
        }
    }

    /// <summary>
    ///     Opens RevitDBExplorer UI to snoop a single object.
    ///     Works for FamilyParameter, Family, FamilySymbol, Category, or any other Revit API object.
    /// </summary>
    /// <param name="uiApp">The UIApplication instance</param>
    /// <param name="obj">The object to snoop</param>
    /// <param name="title">Optional title for the RDBE window</param>
    public static Result<bool> TrySnoopObject(UIApplication uiApp, object obj, string? title = null) {
        if (obj == null) {
            Log.Warning("Object to snoop is null");
            return false;
        }

        var doc = uiApp?.ActiveUIDocument?.Document;
        return TrySnoopObjects(uiApp!, doc, [obj], title);
    }

    /// <summary>
    ///     Opens RevitDBExplorer UI to snoop a single object with explicit document context.
    /// </summary>
    public static Result<bool> TrySnoopObject(
        UIApplication uiApp,
        Document doc,
        object obj,
        string? title = null
    ) {
        if (obj == null) {
            Log.Warning("Object to snoop is null");
            return false;
        }

        return TrySnoopObjects(uiApp, doc, [obj], title);
    }

    /// <summary>
    ///     Opens RevitDBExplorer UI to snoop elements (convenience wrapper).
    /// </summary>
    /// <param name="uiApp">The UIApplication instance</param>
    /// <param name="doc">The document containing the elements</param>
    /// <param name="elements">The elements to snoop</param>
    public static Result<bool> TrySnoopElements(
        UIApplication uiApp,
        Document doc,
        IEnumerable<Element> elements
    ) {
        var elementsList = elements?.ToList() ?? [];
        if (elementsList.Count == 0) {
            Log.Warning("No elements to snoop");
            _ = TaskDialog.Show("Snoop", "No elements provided to snoop.");
            return false;
        }

        var title = elementsList.Count == 1
            ? $"{elementsList[0].GetType().Name}: {elementsList[0].Name}"
            : $"{elementsList.Count} elements";

        return TrySnoopObjects(uiApp, doc, elementsList.Cast<object>(), title);
    }
}
