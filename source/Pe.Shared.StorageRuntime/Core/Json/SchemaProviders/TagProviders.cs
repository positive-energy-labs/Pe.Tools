using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Json.SchemaProviders;
using Pe.Shared.StorageRuntime.Revit.AutoTag;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides category names that can be auto-tagged.
/// </summary>
public class TaggableCategoryNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(TaggableCategoryNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeMode.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null)
                return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

            var items = CategoryTagMapping.GetTaggableCategories()
                .Select(category => CategoryTagMapping.GetCategoryName(doc, category))
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Cast<string>()
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .Select(value => new FieldOptionItem(value, value, null))
                .ToList();
            return new ValueTask<IReadOnlyList<FieldOptionItem>>(items);
        } catch {
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);
        }
    }
}

/// <summary>
///     Provides multi-category tag family names available in the current document.
/// </summary>
public class MultiCategoryTagProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(MultiCategoryTagProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeMode.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null)
                return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

            var items = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .OfCategory(BuiltInCategory.OST_MultiCategoryTags)
                .Cast<FamilySymbol>()
                .Select(symbol => symbol.FamilyName)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .Select(value => new FieldOptionItem(value, value, null))
                .ToList();
            return new ValueTask<IReadOnlyList<FieldOptionItem>>(items);
        } catch {
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);
        }
    }
}

/// <summary>
///     Provides annotation tag family names available in the current document.
/// </summary>
public class AnnotationTagFamilyNamesProvider : IFieldOptionsSource {
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

    public FieldOptionsDescriptor Describe() => new(
        nameof(AnnotationTagFamilyNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [new FieldOptionsDependency(OptionContextKeys.CategoryName, SettingsOptionsDependencyScope.Sibling)],
        SettingsRuntimeMode.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

        var categoryName = context.TryGetContextValue(OptionContextKeys.CategoryName, out var selectedCategoryName)
            ? selectedCategoryName
            : null;
        if (string.IsNullOrWhiteSpace(categoryName))
            return ToItems(GetAllTagFamilyNames(doc));

        var elementCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, categoryName);
        if (elementCategory == BuiltInCategory.INVALID)
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

        var tagCategory = CategoryTagMapping.GetTagCategory(elementCategory);
        var items = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(tagCategory)
            .Cast<FamilySymbol>()
            .Select(symbol => symbol.FamilyName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        return ToItems(items);
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

    private static ValueTask<IReadOnlyList<FieldOptionItem>> ToItems(IEnumerable<string> values) =>
        new(
            values.Select(value => new FieldOptionItem(value, value, null)).ToList()
        );
}

/// <summary>
///     Provides tag type names for annotation tags in the current document.
/// </summary>
public class AnnotationTagTypeNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(AnnotationTagTypeNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [new FieldOptionsDependency(OptionContextKeys.TagFamilyName, SettingsOptionsDependencyScope.Sibling)],
        SettingsRuntimeMode.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var doc = context.GetActiveDocument();
        if (doc == null)
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

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

        return ToItems(typeNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase));
    }

    private static ValueTask<IReadOnlyList<FieldOptionItem>> ToItems(IEnumerable<string> values) =>
        new(
            values.Select(value => new FieldOptionItem(value, value, null)).ToList()
        );
}
