using Pe.Revit.SettingsRuntime.Modules.AutoTag;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public sealed class AnnotationTagFamilyNamesValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.AnnotationTagFamilyNames,
        SettingsRuntimeMode.LiveDocument,
        [new SettingsOptionsDependency(ValueDomainContextKeys.CategoryName, SettingsOptionsDependencyScope.Sibling)]
    ) {
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

    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return ToItems([]);

        var categoryName = context.TryGetContextValue(ValueDomainContextKeys.CategoryName, out var selectedCategoryName)
            ? selectedCategoryName
            : null;
        if (string.IsNullOrWhiteSpace(categoryName))
            return ToItems(GetAllTagFamilyNames(doc));

        var elementCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, categoryName);
        if (elementCategory == BuiltInCategory.INVALID)
            return ToItems([]);

        var tagCategory = CategoryTagMapping.GetTagCategory(elementCategory);
        return ToItems(new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(tagCategory)
            .Cast<FamilySymbol>()
            .Select(symbol => symbol.FamilyName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase));
    }

    private static IEnumerable<string> GetAllTagFamilyNames(Document doc) {
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

public sealed class AnnotationTagTypeNamesValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.AnnotationTagTypeNames,
        SettingsRuntimeMode.LiveDocument,
        [new SettingsOptionsDependency(ValueDomainContextKeys.TagFamilyName, SettingsOptionsDependencyScope.Sibling)]
    ) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return ToItems([]);

        var familyName = context.TryGetContextValue(ValueDomainContextKeys.TagFamilyName, out var selectedFamilyName)
            ? selectedFamilyName
            : null;
        var typeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var category in AnnotationTagFamilyNamesValueDomain.TagCategories) {
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

        return ToItems(typeNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase));
    }
}
