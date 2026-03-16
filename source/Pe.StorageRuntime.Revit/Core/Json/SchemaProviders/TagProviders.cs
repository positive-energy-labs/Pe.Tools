using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Revit.AutoTag;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides category names that can be auto-tagged.
/// </summary>
[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class TaggableCategoryNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null)
                return [];

            return CategoryTagMapping.GetTaggableCategories()
                .Select(category => CategoryTagMapping.GetCategoryName(doc, category))
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Cast<string>()
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides multi-category tag family names available in the current document.
/// </summary>
[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class MultiCategoryTagProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null)
                return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .OfCategory(BuiltInCategory.OST_MultiCategoryTags)
                .Cast<FamilySymbol>()
                .Select(symbol => symbol.FamilyName)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides annotation tag family names available in the current document.
/// </summary>
[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class AnnotationTagFamilyNamesProvider : IDependentOptionsProvider {
    public static readonly BuiltInCategory[] TagCategories = [
        BuiltInCategory.OST_CaseworkTags,
        BuiltInCategory.OST_CeilingTags,
        BuiltInCategory.OST_CommunicationDeviceTags,
        BuiltInCategory.OST_CurtainWallPanelTags,
        BuiltInCategory.OST_DataDeviceTags,
        BuiltInCategory.OST_DetailComponentTags,
        BuiltInCategory.OST_DoorTags,
        BuiltInCategory.OST_DuctAccessoryTags,
        BuiltInCategory.OST_DuctFittingTags,
        BuiltInCategory.OST_DuctInsulationsTags,
        BuiltInCategory.OST_DuctLiningsTags,
        BuiltInCategory.OST_DuctTags,
        BuiltInCategory.OST_DuctTerminalTags,
        BuiltInCategory.OST_ElectricalCircuitTags,
        BuiltInCategory.OST_ElectricalEquipmentTags,
        BuiltInCategory.OST_ElectricalFixtureTags,
        BuiltInCategory.OST_FabricationContainmentTags,
        BuiltInCategory.OST_FabricationDuctworkTags,
        BuiltInCategory.OST_FabricationHangerTags,
        BuiltInCategory.OST_FabricationPipeworkTags,
        BuiltInCategory.OST_FireAlarmDeviceTags,
        BuiltInCategory.OST_FlexDuctTags,
        BuiltInCategory.OST_FlexPipeTags,
        BuiltInCategory.OST_FloorTags,
        BuiltInCategory.OST_FurnitureTags,
        BuiltInCategory.OST_FurnitureSystemTags,
        BuiltInCategory.OST_GenericModelTags,
        BuiltInCategory.OST_KeynoteTags,
        BuiltInCategory.OST_LightingDeviceTags,
        BuiltInCategory.OST_LightingFixtureTags,
        BuiltInCategory.OST_MassAreaFaceTags,
        BuiltInCategory.OST_MassTags,
        BuiltInCategory.OST_MaterialTags,
        BuiltInCategory.OST_MechanicalEquipmentTags,
        BuiltInCategory.OST_MEPSpaceTags,
        BuiltInCategory.OST_MultiCategoryTags,
        BuiltInCategory.OST_NurseCallDeviceTags,
        BuiltInCategory.OST_ParkingTags,
        BuiltInCategory.OST_PartTags,
        BuiltInCategory.OST_PipeAccessoryTags,
        BuiltInCategory.OST_PipeFittingTags,
        BuiltInCategory.OST_PipeInsulationsTags,
        BuiltInCategory.OST_PipeTags,
        BuiltInCategory.OST_PlantingTags,
        BuiltInCategory.OST_PlumbingFixtureTags,
        BuiltInCategory.OST_RailingSystemTags,
        BuiltInCategory.OST_RevisionCloudTags,
        BuiltInCategory.OST_RoofTags,
        BuiltInCategory.OST_RoomTags,
        BuiltInCategory.OST_SecurityDeviceTags,
        BuiltInCategory.OST_SiteTags,
        BuiltInCategory.OST_SpecialityEquipmentTags,
        BuiltInCategory.OST_SprinklerTags,
        BuiltInCategory.OST_StairsLandingTags,
        BuiltInCategory.OST_StairsRunTags,
        BuiltInCategory.OST_StairsSupportTags,
        BuiltInCategory.OST_StairsTags,
        BuiltInCategory.OST_StructConnectionTags,
        BuiltInCategory.OST_StructuralColumnTags,
        BuiltInCategory.OST_StructuralFoundationTags,
        BuiltInCategory.OST_StructuralFramingTags,
        BuiltInCategory.OST_TelephoneDeviceTags,
        BuiltInCategory.OST_WallTags,
        BuiltInCategory.OST_WindowTags,
        BuiltInCategory.OST_WireTags
    ];

    public IReadOnlyList<string> DependsOn => [OptionContextKeys.CategoryName];

    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return [];

        var categoryName = context.TryGetContextValue(OptionContextKeys.CategoryName, out var selectedCategoryName)
            ? selectedCategoryName
            : null;
        if (string.IsNullOrWhiteSpace(categoryName))
            return GetAllTagFamilyNames(doc);

        var elementCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, categoryName);
        if (elementCategory == BuiltInCategory.INVALID)
            return [];

        var tagCategory = CategoryTagMapping.GetTagCategory(elementCategory);
        return new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(tagCategory)
            .Cast<FamilySymbol>()
            .Select(symbol => symbol.FamilyName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> GetAllTagFamilyNames(Autodesk.Revit.DB.Document doc) {
        var familyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var category in TagCategories) {
            try {
                var names = new FilteredElementCollector(doc)
                    .OfClass(typeof(FamilySymbol))
                    .OfCategory(category)
                    .Cast<FamilySymbol>()
                    .Select(symbol => symbol.FamilyName);
                foreach (var name in names)
                    _ = familyNames.Add(name);
            } catch {
            }
        }

        return familyNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
    }
}

/// <summary>
///     Provides tag type names for annotation tags in the current document.
/// </summary>
[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class AnnotationTagTypeNamesProvider : IDependentOptionsProvider {
    public IReadOnlyList<string> DependsOn => [OptionContextKeys.TagFamilyName];

    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return [];

        var familyName = context.TryGetContextValue(OptionContextKeys.TagFamilyName, out var selectedFamilyName)
            ? selectedFamilyName
            : null;
        var typeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var category in AnnotationTagFamilyNamesProvider.TagCategories) {
            try {
                var symbols = new FilteredElementCollector(doc)
                    .OfClass(typeof(FamilySymbol))
                    .OfCategory(category)
                    .Cast<FamilySymbol>();
                if (!string.IsNullOrWhiteSpace(familyName)) {
                    symbols = symbols.Where(symbol =>
                        string.Equals(symbol.FamilyName, familyName, StringComparison.OrdinalIgnoreCase));
                }

                foreach (var name in symbols.Select(symbol => symbol.Name))
                    _ = typeNames.Add(name);
            } catch {
            }
        }

        return typeNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
    }
}
