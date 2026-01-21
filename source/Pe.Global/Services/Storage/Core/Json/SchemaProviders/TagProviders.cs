using Pe.Global.Services.AutoTag.Core;
using Pe.Global.Services.Document;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Provides category names that can be auto-tagged (have corresponding tag categories).
/// </summary>
public class TaggableCategoryNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            var taggableCategories = CategoryTagMapping.GetTaggableCategories();
            var categoryNames = taggableCategories
                .Select(cat => CategoryTagMapping.GetCategoryName(doc, cat))
                .Where(name => name != null)
                .Cast<string>()
                .OrderBy(name => name);

            return categoryNames;
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides multi-category tag family names available in the current document.
/// </summary>
public class MultiCategoryTagProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            // Get all multi-category tag families
            var tagFamilies = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .OfCategory(BuiltInCategory.OST_MultiCategoryTags)
                .Cast<FamilySymbol>()
                .Select(fs => fs.FamilyName)
                .Distinct()
                .OrderBy(name => name);

            return tagFamilies;
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides all annotation symbol tag family names available in the current document.
///     Includes all tag categories (Door Tags, Window Tags, Equipment Tags, etc.) and
///     Multi-Category Tags.
/// </summary>
public class AnnotationTagFamilyNamesProvider : IOptionsProvider {
    /// <summary>
    ///     All BuiltInCategories that represent annotation tags.
    /// </summary>
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

    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            var tagFamilyNames = new HashSet<string>();

            foreach (var category in TagCategories) {
                try {
                    var families = new FilteredElementCollector(doc)
                        .OfClass(typeof(FamilySymbol))
                        .OfCategory(category)
                        .Cast<FamilySymbol>()
                        .Select(fs => fs.FamilyName);

                    foreach (var name in families) _ = tagFamilyNames.Add(name);
                } catch {
                    // Skip categories that don't exist or cause errors
                }
            }

            return tagFamilyNames.OrderBy(name => name);
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides tag type names (FamilySymbol names) for all annotation tags in the document.
/// </summary>
public class AnnotationTagTypeNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            var tagTypeNames = new HashSet<string>();

            foreach (var category in AnnotationTagFamilyNamesProvider.TagCategories) {
                try {
                    var types = new FilteredElementCollector(doc)
                        .OfClass(typeof(FamilySymbol))
                        .OfCategory(category)
                        .Cast<FamilySymbol>()
                        .Select(fs => fs.Name);

                    foreach (var name in types) _ = tagTypeNames.Add(name);
                } catch {
                    // Skip categories that don't exist or cause errors
                }
            }

            return tagTypeNames.OrderBy(name => name);
        } catch {
            return [];
        }
    }
}