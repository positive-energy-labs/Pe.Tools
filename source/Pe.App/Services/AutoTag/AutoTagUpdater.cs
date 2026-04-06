using Pe.Revit.Global.Revit.Ui;
using Pe.Shared.SettingsCatalog.Manifests.AutoTag;
using Pe.Shared.StorageRuntime.AutoTag;
using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using Serilog;
using Serilog.Events;

namespace Pe.App.Services.AutoTag;

/// <summary>
///     Dynamic Model Updater that automatically tags elements when they are placed in the model.
/// </summary>
public class AutoTagUpdater : IUpdater {
    private readonly AddInId _addInId;
    private readonly HashSet<string> _notifiedMissingTags = new();
    private readonly Dictionary<string, FamilySymbol> _tagTypeCache = new();
    private readonly UpdaterId _updaterId;
    private AutoTagSettings? _settings;

    public AutoTagUpdater(AddInId addInId) {
        this._addInId = addInId;
        this._updaterId = new UpdaterId(addInId, new Guid("A3F8B7C2-4D5E-4A9B-8C3D-1E2F3A4B5C6D"));
    }

    public UpdaterId GetUpdaterId() => this._updaterId;
    public string GetUpdaterName() => "Pe.Tools AutoTag Updater";
    public string GetAdditionalInformation() => "Automatically tags elements after placement based on configured settings.";
    public ChangePriority GetChangePriority() => ChangePriority.Annotations;

    public void Execute(UpdaterData data) {
        try {
            var addedIds = data.GetAddedElementIds();
            Log.Debug("AutoTag DMU: Execute called with {Count} added elements", addedIds.Count);

            if (this._settings == null) {
                Log.Warning("AutoTag DMU: _settings is NULL - updater not configured");
                return;
            }

            if (!this._settings.Enabled || this._settings.Configurations.Count == 0)
                return;

            var doc = data.GetDocument();
            var view = doc.ActiveView;
            if (view == null || !this.IsTaggableView(view))
                return;

            foreach (var addedId in addedIds) {
                try {
                    var element = doc.GetElement(addedId);
                    if (element != null)
                        this.ProcessElement(doc, element, view);
                } catch (Exception ex) {
                    Log.Error(ex, "AutoTag DMU: Failed to tag element {ElementId}", addedId);
                }
            }
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag DMU: Execute failed");
        }
    }

    public void SetSettings(AutoTagSettings? settings) {
        this._settings = settings;
        this._notifiedMissingTags.Clear();
        this._tagTypeCache.Clear();
    }

    private void ProcessElement(Autodesk.Revit.DB.Document doc, Element element, View view) {
        var category = element.Category;
        if (category == null)
            return;

        var config = this._settings?.Configurations
            .FirstOrDefault(c => c.Enabled && c.BuiltInCategory == category.BuiltInCategory);
        if (config == null)
            return;

        if (!this.IsViewTypeAllowed(view, config))
            return;

        if (config.SkipIfAlreadyTagged && this.IsElementTagged(doc, element, view))
            return;

        var tagType = this.GetOrCacheTagType(doc, category.BuiltInCategory, config);
        if (tagType == null)
            return;

        this.CreateTag(doc, element, tagType, config, view);
    }

    private FamilySymbol? GetOrCacheTagType(
        Autodesk.Revit.DB.Document doc,
        BuiltInCategory elementCategory,
        AutoTagConfiguration config
    ) {
        var cacheKey = $"{config.TagFamilyName}::{config.TagTypeName}";
        if (this._tagTypeCache.TryGetValue(cacheKey, out var cachedType) &&
            cachedType.IsValidObject &&
            doc.GetElement(cachedType.Id) != null) {
            return cachedType;
        }

        _ = this._tagTypeCache.Remove(cacheKey);

        var tagCategory = CategoryTagMapping.GetTagCategory(elementCategory);
        if (tagCategory == BuiltInCategory.INVALID)
            return null;

        var allTagsInCategory = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(tagCategory)
            .Cast<FamilySymbol>()
            .ToList();

        var tagType = allTagsInCategory.FirstOrDefault(fs =>
            fs.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase) &&
            fs.Name.Equals(config.TagTypeName, StringComparison.OrdinalIgnoreCase));

        if (tagType == null) {
            var fallbackType = allTagsInCategory.FirstOrDefault(fs =>
                fs.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase));

            if (fallbackType != null) {
                tagType = fallbackType;
                this.NotifyTypeFallback(config, fallbackType, allTagsInCategory);
            } else {
                this.NotifyAndDisableConfig(config, allTagsInCategory);
            }
        }

        if (tagType != null) {
            if (!tagType.IsActive)
                tagType.Activate();

            this._tagTypeCache[cacheKey] = tagType;
        }

        return tagType;
    }

    private void NotifyTypeFallback(
        AutoTagConfiguration config,
        FamilySymbol fallbackType,
        List<FamilySymbol> availableTags
    ) {
        var notificationKey = $"fallback::{config.BuiltInCategory}::{config.TagFamilyName}::{config.TagTypeName}";
        if (!this._notifiedMissingTags.Add(notificationKey))
            return;

        var availableTypes = availableTags
            .Where(tag => tag.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase))
            .Select(tag => tag.Name)
            .ToList();
        var categoryLabel = GetCategoryLabel(config.BuiltInCategory);

        var message = $"Tag type '{config.TagTypeName}' not found in family '{config.TagFamilyName}'.";
        message += $"\n\nUsing fallback: '{fallbackType.Name}'";
        message += $"\nCategory: '{categoryLabel}'";
        message += $"\n\nAvailable types:\n  - {string.Join("\n  - ", availableTypes)}";
        message += "\n\nUpdate your AutoTag settings to use a valid type.";

        new Ballogger()
            .Add(LogEventLevel.Warning, null, message)
            .Show("AutoTag: Using Fallback Tag Type");
    }

    private void NotifyAndDisableConfig(AutoTagConfiguration config, List<FamilySymbol> availableTags) {
        var notificationKey = $"{config.BuiltInCategory}::{config.TagFamilyName}::{config.TagTypeName}";
        if (!this._notifiedMissingTags.Add(notificationKey))
            return;

        config.Enabled = false;

        var availableTypes = availableTags
            .Where(tag => tag.FamilyName.Equals(config.TagFamilyName, StringComparison.OrdinalIgnoreCase))
            .Select(tag => tag.Name)
            .ToList();
        var categoryLabel = GetCategoryLabel(config.BuiltInCategory);

        var message =
            $"Tag type '{config.TagFamilyName}:{config.TagTypeName}' not found for category '{categoryLabel}'.";

        if (availableTypes.Count > 0) {
            message += $"\n\nAvailable types for this family:\n  - {string.Join("\n  - ", availableTypes)}";
        } else {
            var availableFamilies = availableTags
                .Select(tag => tag.FamilyName)
                .Distinct()
                .ToList();
            if (availableFamilies.Count > 0)
                message += $"\n\nAvailable tag families:\n  - {string.Join("\n  - ", availableFamilies)}";
        }

        message += "\n\nThis configuration has been disabled. Update your AutoTag settings to fix.";

        new Ballogger()
            .Add(LogEventLevel.Warning, null, message)
            .Show("AutoTag Configuration Error");
    }

    private static string GetCategoryLabel(BuiltInCategory category) =>
        CategoryNamesProvider.GetLabelForBuiltInCategory(category);

    private void CreateTag(
        Autodesk.Revit.DB.Document doc,
        Element element,
        FamilySymbol tagType,
        AutoTagConfiguration config,
        View view
    ) {
        try {
            var location = this.GetTagLocation(element, config);
            if (location == null)
                return;

            var orientation = config.TagOrientation == TagOrientationMode.Horizontal
                ? TagOrientation.Horizontal
                : TagOrientation.Vertical;

            _ = IndependentTag.Create(
                doc,
                tagType.Id,
                view.Id,
                new Reference(element),
                config.AddLeader,
                orientation,
                location
            );
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to create tag");
        }
    }

    private XYZ? GetTagLocation(Element element, AutoTagConfiguration config) {
        XYZ? baseLocation = null;
        if (element.Location is LocationPoint locationPoint)
            baseLocation = locationPoint.Point;
        else if (element.Location is LocationCurve locationCurve)
            baseLocation = locationCurve.Curve.Evaluate(0.5, true);
        else if (element is FamilyInstance familyInstance)
            baseLocation = familyInstance.GetTransform().Origin;
        else {
            var bbox = element.get_BoundingBox(null);
            if (bbox != null)
                baseLocation = (bbox.Min + bbox.Max) / 2.0;
        }

        if (baseLocation == null)
            return null;

        if (config.OffsetDistance <= 0)
            return baseLocation;

        var angleRad = config.OffsetAngle * Math.PI / 180.0;
        return new XYZ(
            baseLocation.X + config.OffsetDistance * Math.Cos(angleRad),
            baseLocation.Y + config.OffsetDistance * Math.Sin(angleRad),
            baseLocation.Z
        );
    }

    private bool IsElementTagged(Autodesk.Revit.DB.Document doc, Element element, View view) {
        try {
            return new FilteredElementCollector(doc, view.Id)
                .OfClass(typeof(IndependentTag))
                .Cast<IndependentTag>()
                .Any(tag => {
                    try {
                        return tag.GetTaggedLocalElementIds().Contains(element.Id);
                    } catch {
                        return false;
                    }
                });
        } catch {
            return false;
        }
    }

    private bool IsTaggableView(View view) {
        if (view.IsTemplate)
            return false;

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

    private bool IsViewTypeAllowed(View view, AutoTagConfiguration config) {
        if (config.ViewTypeFilter == null || config.ViewTypeFilter.Count == 0)
            return true;

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

    public void ClearCache() => this._tagTypeCache.Clear();
}
