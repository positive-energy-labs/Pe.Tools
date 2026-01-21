using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Global.Services.AutoTag;
using Pe.Global.Services.AutoTag.Core;
using System.Diagnostics;
using Document = Autodesk.Revit.DB.Document;

namespace Pe.Tools.Commands.AutoTag;

/// <summary>
///     Command to tag all existing untagged elements that match AutoTag configurations.
///     This is a "catch-up" command for when AutoTag is enabled mid-project or after elements were placed.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdAutoTagCatchUp : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;
        var activeView = doc.ActiveView;

        try {
            // Check if AutoTag is configured for this document
            var settings = AutoTagService.Instance.GetSettingsForDocument(doc);
            if (settings == null) {
                _ = TaskDialog.Show("AutoTag Catch-Up",
                    "AutoTag is not configured for this document.\n\n" +
                    "Please use the 'AutoTag Init' command first to set up AutoTag.");
                return Result.Cancelled;
            }

            if (!settings.Enabled || settings.Configurations.Count == 0) {
                _ = TaskDialog.Show("AutoTag Catch-Up",
                    "AutoTag is disabled or has no configurations.\n\n" +
                    "Please enable AutoTag and configure categories first.");
                return Result.Cancelled;
            }

            // Confirm with user
            var enabledConfigs = settings.Configurations.Where(c => c.Enabled).ToList();
            var categoriesList = string.Join("\n  • ", enabledConfigs.Select(c => c.CategoryName));

            var confirmDialog = new TaskDialog("AutoTag Catch-Up") {
                MainInstruction = "Tag all untagged elements in the active view?",
                MainContent = $"This will tag all untagged elements in '{activeView.Name}' for these categories:\n\n" +
                             $"  • {categoriesList}\n\n" +
                             "This operation cannot be undone as a group (use Ctrl+Z after to undo).",
                CommonButtons = TaskDialogCommonButtons.Ok | TaskDialogCommonButtons.Cancel
            };

            if (confirmDialog.Show() != TaskDialogResult.Ok)
                return Result.Cancelled;

            // Execute tagging
            var stopwatch = Stopwatch.StartNew();
            var results = this.TagAllUntagged(doc, activeView, settings);
            stopwatch.Stop();

            // Show results
            var resultMsg = $"Catch-up complete in {stopwatch.ElapsedMilliseconds}ms:\n\n";
            var totalTagged = 0;

            foreach (var (categoryName, count) in results) {
                if (count > 0) {
                    resultMsg += $"  • {categoryName}: {count} tagged\n";
                    totalTagged += count;
                }
            }

            if (totalTagged == 0)
                resultMsg += "No untagged elements found.";
            else
                resultMsg += $"\nTotal: {totalTagged} elements tagged";

            _ = TaskDialog.Show("AutoTag Catch-Up Complete", resultMsg);

            return Result.Succeeded;
        } catch (Exception ex) {
            message = ex.Message;
            _ = TaskDialog.Show("AutoTag Error", $"Catch-up failed:\n{ex.Message}");
            return Result.Failed;
        }
    }

    /// <summary>
    ///     Tags all untagged elements in the view based on configurations.
    /// </summary>
    private Dictionary<string, int> TagAllUntagged(Document doc, View view, AutoTagSettings settings) {
        var results = new Dictionary<string, int>();

        using var transaction = new Transaction(doc, "AutoTag Catch-Up");
        transaction.Start();

        try {
            foreach (var config in settings.Configurations.Where(c => c.Enabled)) {
                var count = this.TagCategoryElements(doc, view, config);
                results[config.CategoryName] = count;
            }

            transaction.Commit();
        } catch {
            transaction.RollBack();
            throw;
        }

        return results;
    }

    /// <summary>
    ///     Tags all untagged elements for a specific category configuration.
    /// </summary>
    private int TagCategoryElements(Document doc, View view, AutoTagConfiguration config) {
        try {
            // Get the built-in category
            var builtInCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, config.CategoryName);
            if (builtInCategory == BuiltInCategory.INVALID) {
                Debug.WriteLine($"AutoTag Catch-Up: Invalid category '{config.CategoryName}'");
                return 0;
            }

            // Get the tag category
            var tagCategory = CategoryTagMapping.GetTagCategory(builtInCategory);
            if (tagCategory == BuiltInCategory.INVALID) {
                Debug.WriteLine($"AutoTag Catch-Up: No tag category for '{config.CategoryName}'");
                return 0;
            }

            // Find the tag type
            var tagType = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .OfCategory(tagCategory)
                .Cast<FamilySymbol>()
                .FirstOrDefault(fs =>
                    fs.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase) &&
                    fs.Name.Equals(config.TagTypeName, StringComparison.OrdinalIgnoreCase));

            if (tagType == null) {
                Debug.WriteLine($"AutoTag Catch-Up: Tag type not found: {config.TagFamilyName} - {config.TagTypeName}");
                return 0;
            }

            // Ensure tag type is activated
            if (!tagType.IsActive)
                tagType.Activate();

            // Find all elements of this category in the view
            var elements = new FilteredElementCollector(doc, view.Id)
                .OfCategory(builtInCategory)
                .WhereElementIsNotElementType()
                .ToList();

            // Filter to untagged elements if configured
            if (config.SkipIfAlreadyTagged) {
                var existingTags = new FilteredElementCollector(doc, view.Id)
                    .OfClass(typeof(IndependentTag))
                    .Cast<IndependentTag>()
                    .SelectMany(tag => tag.GetTaggedLocalElementIds())
                    .ToHashSet();

                elements = elements.Where(e => !existingTags.Contains(e.Id)).ToList();
            }

            // Tag each element
            var taggedCount = 0;
            var orientation = config.TagOrientation == TagOrientationMode.Horizontal
                ? TagOrientation.Horizontal
                : TagOrientation.Vertical;

            foreach (var element in elements) {
                try {
                    var location = this.GetTagLocation(element, config);
                    if (location == null) continue;

                    var reference = new Reference(element);
                    _ = IndependentTag.Create(
                        doc,
                        tagType.Id,
                        view.Id,
                        reference,
                        config.AddLeader,
                        orientation,
                        location
                    );

                    taggedCount++;
                } catch (Exception ex) {
                    Debug.WriteLine($"AutoTag Catch-Up: Failed to tag element {element.Id}: {ex.Message}");
                }
            }

            return taggedCount;
        } catch (Exception ex) {
            Debug.WriteLine($"AutoTag Catch-Up: Failed to process category '{config.CategoryName}': {ex.Message}");
            return 0;
        }
    }

    /// <summary>
    ///     Gets the tag location for an element based on configuration.
    /// </summary>
    private XYZ? GetTagLocation(Element element, AutoTagConfiguration config) {
        XYZ? baseLocation = null;

        // Try different location methods
        if (element.Location is LocationPoint locationPoint) {
            baseLocation = locationPoint.Point;
        } else if (element.Location is LocationCurve locationCurve) {
            var curve = locationCurve.Curve;
            baseLocation = curve.Evaluate(0.5, true);
        } else if (element is FamilyInstance fi) {
            var transform = fi.GetTransform();
            baseLocation = transform.Origin;
        } else {
            // Last resort - use bounding box center
            var bbox = element.get_BoundingBox(null);
            if (bbox != null)
                baseLocation = (bbox.Min + bbox.Max) / 2.0;
        }

        if (baseLocation == null) return null;

        // Apply offset
        if (config.OffsetDistance > 0) {
            var angleRad = config.OffsetAngle * Math.PI / 180.0;
            var offsetX = config.OffsetDistance * Math.Cos(angleRad);
            var offsetY = config.OffsetDistance * Math.Sin(angleRad);
            baseLocation = new XYZ(
                baseLocation.X + offsetX,
                baseLocation.Y + offsetY,
                baseLocation.Z
            );
        }

        return baseLocation;
    }
}
