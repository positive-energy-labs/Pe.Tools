using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;

namespace Pe.Global.Services.AutoTag.Core;

/// <summary>
///     Dynamic Model Updater that automatically tags elements when they are placed in the model.
///     Settings are provided by AutoTagService - this updater has no storage dependencies.
/// </summary>
public class AutoTagUpdater : IUpdater {
    private readonly AddInId _addInId;
    private readonly UpdaterId _updaterId;
    private readonly Dictionary<string, FamilySymbol> _tagTypeCache = new();
    private AutoTagSettings? _settings;

    public AutoTagUpdater(AddInId addInId) {
        this._addInId = addInId;
        this._updaterId = new UpdaterId(addInId, new Guid("A3F8B7C2-4D5E-4A9B-8C3D-1E2F3A4B5C6D"));
    }

    public UpdaterId GetUpdaterId() => this._updaterId;

    public string GetUpdaterName() => "Pe.Tools AutoTag Updater";

    public string GetAdditionalInformation() =>
        "Automatically tags elements after placement based on configured settings.";

    public ChangePriority GetChangePriority() => ChangePriority.Annotations;

    /// <summary>
    ///     Updates the settings used by this updater. Called by AutoTagService.
    /// </summary>
    public void SetSettings(AutoTagSettings? settings) {
        this._settings = settings;
    }

    /// <summary>
    ///     Main updater execution - called when tracked elements are added.
    /// </summary>
    public void Execute(UpdaterData data) {
        try {
            // Check if globally enabled
            if (this._settings?.Enabled != true || this._settings.Configurations.Count == 0) return;

            var doc = data.GetDocument();
            var view = doc.ActiveView;

            // Don't tag in invalid view contexts
            if (view == null || !this.IsTaggableView(view)) return;

            foreach (var addedId in data.GetAddedElementIds()) {
                try {
                    var element = doc.GetElement(addedId);
                    if (element == null) continue;

                    this.ProcessElement(doc, element, view);
                } catch (Exception ex) {
                    // Log but don't fail entire batch
                    System.Diagnostics.Debug.WriteLine($"AutoTag: Failed to tag element {addedId}: {ex.Message}");
                }
            }
        } catch (Exception ex) {
            // Critical error - don't crash Revit
            System.Diagnostics.Debug.WriteLine($"AutoTag: Execute failed: {ex.Message}");
        }
    }

    /// <summary>
    ///     Process a single element for auto-tagging.
    /// </summary>
    private void ProcessElement(Autodesk.Revit.DB.Document doc, Element element, View view) {
        var category = element.Category;
        if (category == null) return;

        // Find matching configuration
        var config = this._settings?.Configurations
            .FirstOrDefault(c => c.Enabled && c.CategoryName.Equals(category.Name, StringComparison.OrdinalIgnoreCase));

        if (config == null) return;

        // Check view type filter
        if (!this.IsViewTypeAllowed(view, config)) return;

        // Skip if already tagged (if configured)
        if (config.SkipIfAlreadyTagged && this.IsElementTagged(doc, element, view)) return;

        // Get tag type
        var tagType = this.GetOrCacheTagType(doc, category.BuiltInCategory, config);
        if (tagType == null) return;

        // Create tag
        this.CreateTag(doc, element, tagType, config, view);
    }

    /// <summary>
    ///     Gets or caches a tag type for performance.
    /// </summary>
    private FamilySymbol? GetOrCacheTagType(Autodesk.Revit.DB.Document doc, BuiltInCategory elementCategory,
        AutoTagConfiguration config) {
        var cacheKey = $"{config.TagFamilyName}::{config.TagTypeName}";

        if (this._tagTypeCache.TryGetValue(cacheKey, out var cachedType)) {
            // Verify it's still valid
            if (cachedType.IsValidObject && doc.GetElement(cachedType.Id) != null) return cachedType;

            // Invalid, remove from cache
            _ = this._tagTypeCache.Remove(cacheKey);
        }

        // Find the tag type
        var tagCategory = CategoryTagMapping.GetTagCategory(elementCategory);
        if (tagCategory == BuiltInCategory.INVALID) return null;

        var tagType = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(tagCategory)
            .Cast<FamilySymbol>()
            .FirstOrDefault(fs =>
                fs.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase) &&
                fs.Name.Equals(config.TagTypeName, StringComparison.OrdinalIgnoreCase));

        if (tagType != null) {
            // Ensure symbol is activated
            if (!tagType.IsActive) {
                tagType.Activate();
            }

            this._tagTypeCache[cacheKey] = tagType;
        }

        return tagType;
    }

    /// <summary>
    ///     Creates a tag for the element.
    /// </summary>
    private void CreateTag(Autodesk.Revit.DB.Document doc, Element element, FamilySymbol tagType,
        AutoTagConfiguration config, View view) {
        try {
            var location = this.GetTagLocation(element, config);
            if (location == null) return;

            var reference = new Reference(element);
            var orientation = config.TagOrientation == TagOrientationMode.Horizontal
                ? TagOrientation.Horizontal
                : TagOrientation.Vertical;

            _ = IndependentTag.Create(
                doc,
                tagType.Id,
                view.Id,
                reference,
                config.AddLeader,
                orientation,
                location
            );
        } catch (Exception ex) {
            System.Diagnostics.Debug.WriteLine($"AutoTag: Failed to create tag: {ex.Message}");
        }
    }

    /// <summary>
    ///     Gets the tag location based on element location and offset configuration.
    /// </summary>
    private XYZ? GetTagLocation(Element element, AutoTagConfiguration config) {
        XYZ? baseLocation = null;

        // Try different location methods
        if (element.Location is LocationPoint locationPoint) {
            baseLocation = locationPoint.Point;
        } else if (element.Location is LocationCurve locationCurve) {
            // Use midpoint of curve
            var curve = locationCurve.Curve;
            baseLocation = curve.Evaluate(0.5, true);
        } else if (element is FamilyInstance fi) {
            // Get origin from family instance
            var transform = fi.GetTransform();
            baseLocation = transform.Origin;
        } else {
            // Last resort - use bounding box center
            var bbox = element.get_BoundingBox(null);
            if (bbox != null) {
                baseLocation = (bbox.Min + bbox.Max) / 2.0;
            }
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

    /// <summary>
    ///     Checks if the element already has a tag in the current view.
    /// </summary>
    private bool IsElementTagged(Autodesk.Revit.DB.Document doc, Element element, View view) {
        try {
            // Find all tags in the view that reference this element
            var tags = new FilteredElementCollector(doc, view.Id)
                .OfClass(typeof(IndependentTag))
                .Cast<IndependentTag>()
                .Where(tag => {
                    try {
                        var taggedId = tag.GetTaggedLocalElementIds();
                        return taggedId.Contains(element.Id);
                    } catch {
                        return false;
                    }
                });

            return tags.Any();
        } catch {
            return false;
        }
    }

    /// <summary>
    ///     Checks if the view is a valid context for tagging.
    /// </summary>
    private bool IsTaggableView(View view) {
        // Don't tag in schedules, legends, or templates
        if (view.IsTemplate) return false;

        return view.ViewType switch {
            ViewType.FloorPlan => true,
            ViewType.CeilingPlan => true,
            ViewType.Elevation => true,
            ViewType.Section => true,
            ViewType.DraftingView => true,
            ViewType.EngineeringPlan => true,
            ViewType.AreaPlan => true,
            _ => false
        };
    }

    /// <summary>
    ///     Checks if the view type matches the configuration filter.
    /// </summary>
    private bool IsViewTypeAllowed(View view, AutoTagConfiguration config) {
        // If no filter specified, allow all
        if (config.ViewTypeFilter == null || config.ViewTypeFilter.Count == 0) return true;

        var viewTypeFilter = view.ViewType switch {
            ViewType.FloorPlan => ViewTypeFilter.FloorPlan,
            ViewType.CeilingPlan => ViewTypeFilter.CeilingPlan,
            ViewType.Elevation => ViewTypeFilter.Elevation,
            ViewType.Section => ViewTypeFilter.Section,
            ViewType.DraftingView => ViewTypeFilter.DraftingView,
            ViewType.EngineeringPlan => ViewTypeFilter.EngineeringPlan,
            _ => (ViewTypeFilter?)null
        };

        return viewTypeFilter.HasValue && config.ViewTypeFilter.Contains(viewTypeFilter.Value);
    }

    /// <summary>
    ///     Clears the tag type cache.
    /// </summary>
    public void ClearCache() => this._tagTypeCache.Clear();
}
