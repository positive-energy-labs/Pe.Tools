using Pe.Global.Revit.Ui;
using Serilog;
using Serilog.Events;

namespace Pe.Global.Services.AutoTag.Core;

/// <summary>
///     Dynamic Model Updater that automatically tags elements when they are placed in the model.
///     Settings are provided by AutoTagService - this updater has no storage dependencies.
/// </summary>
public class AutoTagUpdater : IUpdater {
    private readonly AddInId _addInId;
    private readonly Dictionary<string, FamilySymbol> _tagTypeCache = new();
    private readonly HashSet<string> _notifiedMissingTags = new();
    private readonly UpdaterId _updaterId;
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
    ///     Main updater execution - called when tracked elements are added.
    /// </summary>
    public void Execute(UpdaterData data) {
        try {
            var addedIds = data.GetAddedElementIds();
            Log.Debug("AutoTag DMU: Execute called with {Count} added elements", addedIds.Count);

            // Check if globally enabled
            if (this._settings == null) {
                Log.Warning("AutoTag DMU: _settings is NULL - updater not configured");
                return;
            }

            if (!this._settings.Enabled) {
                Log.Debug("AutoTag DMU: Settings.Enabled is false - skipping");
                return;
            }

            if (this._settings.Configurations.Count == 0) {
                Log.Debug("AutoTag DMU: No configurations defined - skipping");
                return;
            }

            Log.Debug("AutoTag DMU: Settings OK - Enabled={Enabled}, Configurations={Count}",
                this._settings.Enabled, this._settings.Configurations.Count);

            var doc = data.GetDocument();
            var view = doc.ActiveView;

            // Don't tag in invalid view contexts
            if (view == null) {
                Log.Warning("AutoTag DMU: ActiveView is null - skipping");
                return;
            }

            if (!this.IsTaggableView(view)) {
                Log.Debug("AutoTag DMU: View '{ViewName}' (type: {ViewType}) is not taggable - skipping",
                    view.Name, view.ViewType);
                return;
            }

            Log.Debug("AutoTag DMU: Processing in view '{ViewName}'", view.Name);

            foreach (var addedId in addedIds) {
                try {
                    var element = doc.GetElement(addedId);
                    if (element == null) continue;

                    this.ProcessElement(doc, element, view);
                } catch (Exception ex) {
                    Log.Error(ex, "AutoTag DMU: Failed to tag element {ElementId}", addedId);
                }
            }
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag DMU: Execute failed");
        }
    }

    /// <summary>
    ///     Updates the settings used by this updater. Called by AutoTagService.
    /// </summary>
    public void SetSettings(AutoTagSettings? settings) {
        this._settings = settings;

        // Clear notification tracking so user gets fresh notifications if they update settings
        this._notifiedMissingTags.Clear();
        this._tagTypeCache.Clear();

        if (settings != null)
            Log.Information("AutoTag DMU: Settings pushed - Enabled={Enabled}, Configurations={Count}",
                settings.Enabled, settings.Configurations.Count);
        else
            Log.Warning("AutoTag DMU: Settings set to NULL");
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

        Log.Debug("AutoTag: Processing element {ElementId} in category '{Category}'", element.Id, category.Name);
        Log.Debug("AutoTag: Config found - TagFamilyName='{TagFamily}', TagTypeName='{TagType}'",
            config.TagFamilyName, config.TagTypeName);

        // Check view type filter
        if (!this.IsViewTypeAllowed(view, config)) return;

        // Skip if already tagged (if configured)
        if (config.SkipIfAlreadyTagged && this.IsElementTagged(doc, element, view)) return;

        // Get tag type
        var tagType = this.GetOrCacheTagType(doc, category.BuiltInCategory, config);
        if (tagType == null) {
            Log.Warning("AutoTag: No tag type found for '{TagFamily}:{TagType}' - skipping element {ElementId}",
                config.TagFamilyName, config.TagTypeName, element.Id);
            return;
        }

        // Create tag
        this.CreateTag(doc, element, tagType, config, view);
    }

    /// <summary>
    ///     Gets or caches a tag type for performance.
    /// </summary>
    private FamilySymbol? GetOrCacheTagType(Autodesk.Revit.DB.Document doc,
        BuiltInCategory elementCategory,
        AutoTagConfiguration config) {
        var cacheKey = $"{config.TagFamilyName}::{config.TagTypeName}";

        if (this._tagTypeCache.TryGetValue(cacheKey, out var cachedType)) {
            // Verify it's still valid
            if (cachedType.IsValidObject && doc.GetElement(cachedType.Id) != null) {
                Log.Debug("AutoTag: Using cached tag type '{Family}:{Type}'", cachedType.FamilyName, cachedType.Name);
                return cachedType;
            }

            // Invalid, remove from cache
            _ = this._tagTypeCache.Remove(cacheKey);
        }

        // Find the tag type
        var tagCategory = CategoryTagMapping.GetTagCategory(elementCategory);
        if (tagCategory == BuiltInCategory.INVALID) {
            Log.Warning("AutoTag: No tag category mapping for element category {Category}", elementCategory);
            return null;
        }

        Log.Debug("AutoTag: Searching for tag in category {TagCategory}", tagCategory);
        Log.Debug("AutoTag: Looking for FamilyName='{ConfigFamily}', TypeName='{ConfigType}'",
            config.TagFamilyName, config.TagTypeName);

        // Get all available tags for debugging
        var allTagsInCategory = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(tagCategory)
            .Cast<FamilySymbol>()
            .ToList();

        Log.Debug("AutoTag: Found {Count} tag types in category {TagCategory}:", allTagsInCategory.Count, tagCategory);
        foreach (var tag in allTagsInCategory.Take(10)) // Limit to first 10 to avoid log spam
            Log.Debug("AutoTag:   - '{FamilyName}' : '{TypeName}'", tag.FamilyName, tag.Name);

        if (allTagsInCategory.Count > 10)
            Log.Debug("AutoTag:   ... and {More} more", allTagsInCategory.Count - 10);

        // Try exact match first (family + type)
        var tagType = allTagsInCategory
            .FirstOrDefault(fs =>
                fs.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase) &&
                fs.Name.Equals(config.TagTypeName, StringComparison.OrdinalIgnoreCase));

        if (tagType != null) {
            Log.Information("AutoTag: MATCHED tag '{Family}:{Type}' (Id: {Id})",
                tagType.FamilyName, tagType.Name, tagType.Id);
        } else {
            // Type not found - try to find any type from the same family
            var fallbackType = allTagsInCategory
                .FirstOrDefault(fs => fs.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase));

            if (fallbackType != null) {
                Log.Warning("AutoTag: Type '{ConfigType}' not found, using fallback '{Family}:{Type}'",
                    config.TagTypeName, fallbackType.FamilyName, fallbackType.Name);
                tagType = fallbackType;

                // Notify user about the fallback (only once per session)
                this.NotifyTypeFallback(config, fallbackType, allTagsInCategory);
            } else {
                Log.Warning("AutoTag: NO MATCH found for '{ConfigFamily}:{ConfigType}'",
                    config.TagFamilyName, config.TagTypeName);

                // Notify user and disable this configuration (only once per session)
                this.NotifyAndDisableConfig(config, allTagsInCategory);
            }
        }

        if (tagType != null) {
            // Ensure symbol is activated
            if (!tagType.IsActive) tagType.Activate();

            this._tagTypeCache[cacheKey] = tagType;
        }

        return tagType;
    }

    /// <summary>
    ///     Notifies the user that the specified tag type wasn't found but a fallback was used.
    /// </summary>
    private void NotifyTypeFallback(AutoTagConfiguration config, FamilySymbol fallbackType, List<FamilySymbol> availableTags) {
        var notificationKey = $"fallback::{config.CategoryName}::{config.TagFamilyName}::{config.TagTypeName}";

        // Only notify once per session for this specific config
        if (!this._notifiedMissingTags.Add(notificationKey)) return;

        // Build helpful message with available alternatives
        var availableTypes = availableTags
            .Where(t => t.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase))
            .Select(t => t.Name)
            .ToList();

        var message = $"Tag type '{config.TagTypeName}' not found in family '{config.TagFamilyName}'.";
        message += $"\n\nUsing fallback: '{fallbackType.Name}'";
        message += $"\n\nAvailable types:\n  • {string.Join("\n  • ", availableTypes)}";
        message += "\n\nUpdate your AutoTag settings to use a valid type.";

        // Show balloon notification
        new Ballogger()
            .Add(LogEventLevel.Warning, null, message)
            .Show("AutoTag: Using Fallback Tag Type");
    }

    /// <summary>
    ///     Notifies the user that a tag family wasn't found and disables the configuration.
    /// </summary>
    private void NotifyAndDisableConfig(AutoTagConfiguration config, List<FamilySymbol> availableTags) {
        var notificationKey = $"{config.CategoryName}::{config.TagFamilyName}::{config.TagTypeName}";

        // Only notify once per session for this specific config
        if (!this._notifiedMissingTags.Add(notificationKey)) return;

        // Disable this configuration so it doesn't keep trying
        config.Enabled = false;
        Log.Warning("AutoTag: Disabled configuration for '{Category}' - tag type not found", config.CategoryName);

        // Build helpful message with available alternatives
        var availableTypes = availableTags
            .Where(t => t.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase))
            .Select(t => t.Name)
            .ToList();

        var message = $"Tag type '{config.TagFamilyName}:{config.TagTypeName}' not found for category '{config.CategoryName}'.";

        if (availableTypes.Count > 0)
            message += $"\n\nAvailable types for this family:\n  • {string.Join("\n  • ", availableTypes)}";
        else {
            var availableFamilies = availableTags
                .Select(t => t.FamilyName)
                .Distinct()
                .ToList();
            if (availableFamilies.Count > 0)
                message += $"\n\nAvailable tag families:\n  • {string.Join("\n  • ", availableFamilies)}";
        }

        message += "\n\nThis configuration has been disabled. Update your AutoTag settings to fix.";

        // Show balloon notification
        new Ballogger()
            .Add(LogEventLevel.Warning, null, message)
            .Show("AutoTag Configuration Error");
    }

    /// <summary>
    ///     Creates a tag for the element.
    /// </summary>
    private void CreateTag(Autodesk.Revit.DB.Document doc,
        Element element,
        FamilySymbol tagType,
        AutoTagConfiguration config,
        View view) {
        try {
            var location = this.GetTagLocation(element, config);
            if (location == null) return;

            var reference = new Reference(element);
            var orientation = config.TagOrientation == TagOrientationMode.Horizontal
                ? TagOrientation.Horizontal
                : TagOrientation.Vertical;

            Log.Information("AutoTag: Creating tag '{Family}:{Type}' (Id: {TagTypeId}) for element {ElementId}",
                tagType.FamilyName, tagType.Name, tagType.Id, element.Id);

            var tag = IndependentTag.Create(
                doc,
                tagType.Id,
                view.Id,
                reference,
                config.AddLeader,
                orientation,
                location
            );

            // Verify what was actually created
            if (tag != null) {
                var createdTagType = doc.GetElement(tag.GetTypeId()) as FamilySymbol;
                if (createdTagType != null)
                    Log.Information("AutoTag: Tag created successfully - actual type: '{Family}:{Type}' (Id: {Id})",
                        createdTagType.FamilyName, createdTagType.Name, createdTagType.Id);
            }
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to create tag");
        }
    }

    /// <summary>
    ///     Gets the tag location based on element location and offset configuration.
    /// </summary>
    private XYZ? GetTagLocation(Element element, AutoTagConfiguration config) {
        XYZ? baseLocation = null;

        // Try different location methods
        if (element.Location is LocationPoint locationPoint)
            baseLocation = locationPoint.Point;
        else if (element.Location is LocationCurve locationCurve) {
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
            if (bbox != null) baseLocation = (bbox.Min + bbox.Max) / 2.0;
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