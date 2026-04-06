namespace Pe.Shared.StorageRuntime.Revit.AutoTag;

/// <summary>
///     Maps element categories to their corresponding tag categories.
/// </summary>
public static class CategoryTagMapping {
    private static readonly Dictionary<BuiltInCategory, BuiltInCategory> CategoryToTagMap = new() {
        { BuiltInCategory.OST_MechanicalEquipment, BuiltInCategory.OST_MechanicalEquipmentTags },
        { BuiltInCategory.OST_PlumbingFixtures, BuiltInCategory.OST_PlumbingFixtureTags },
        { BuiltInCategory.OST_PlumbingEquipment, BuiltInCategory.OST_MechanicalEquipmentTags },
        { BuiltInCategory.OST_LightingFixtures, BuiltInCategory.OST_LightingFixtureTags },
        { BuiltInCategory.OST_ElectricalFixtures, BuiltInCategory.OST_ElectricalFixtureTags },
        { BuiltInCategory.OST_ElectricalEquipment, BuiltInCategory.OST_ElectricalEquipmentTags },
        { BuiltInCategory.OST_Sprinklers, BuiltInCategory.OST_SprinklerTags },
        { BuiltInCategory.OST_DuctTerminal, BuiltInCategory.OST_DuctTerminalTags },
        { BuiltInCategory.OST_DuctFitting, BuiltInCategory.OST_DuctFittingTags },
        { BuiltInCategory.OST_FlexDuctCurves, BuiltInCategory.OST_FlexDuctTags },
        { BuiltInCategory.OST_DuctCurves, BuiltInCategory.OST_DuctTags },
        { BuiltInCategory.OST_DuctAccessory, BuiltInCategory.OST_DuctAccessoryTags },
        { BuiltInCategory.OST_PipeFitting, BuiltInCategory.OST_PipeFittingTags },
        { BuiltInCategory.OST_FlexPipeCurves, BuiltInCategory.OST_FlexPipeTags },
        { BuiltInCategory.OST_PipeCurves, BuiltInCategory.OST_PipeTags },
        { BuiltInCategory.OST_PipeAccessory, BuiltInCategory.OST_PipeAccessoryTags },
        { BuiltInCategory.OST_LightingDevices, BuiltInCategory.OST_LightingDeviceTags },
        { BuiltInCategory.OST_DataDevices, BuiltInCategory.OST_DataDeviceTags },
        { BuiltInCategory.OST_CommunicationDevices, BuiltInCategory.OST_CommunicationDeviceTags },
        { BuiltInCategory.OST_FireAlarmDevices, BuiltInCategory.OST_FireAlarmDeviceTags },
        { BuiltInCategory.OST_SecurityDevices, BuiltInCategory.OST_SecurityDeviceTags },
        { BuiltInCategory.OST_CableTray, BuiltInCategory.OST_CableTrayTags },
        { BuiltInCategory.OST_CableTrayFitting, BuiltInCategory.OST_CableTrayFittingTags },
        { BuiltInCategory.OST_Conduit, BuiltInCategory.OST_ConduitTags },
        { BuiltInCategory.OST_ConduitFitting, BuiltInCategory.OST_ConduitFittingTags },
        { BuiltInCategory.OST_Doors, BuiltInCategory.OST_DoorTags },
        { BuiltInCategory.OST_Windows, BuiltInCategory.OST_WindowTags },
        { BuiltInCategory.OST_Walls, BuiltInCategory.OST_WallTags },
        { BuiltInCategory.OST_Rooms, BuiltInCategory.OST_RoomTags },
        { BuiltInCategory.OST_Furniture, BuiltInCategory.OST_FurnitureTags },
        { BuiltInCategory.OST_GenericModel, BuiltInCategory.OST_GenericModelTags },
        { BuiltInCategory.OST_Parking, BuiltInCategory.OST_ParkingTags },
        { BuiltInCategory.OST_Planting, BuiltInCategory.OST_PlantingTags },
        { BuiltInCategory.OST_SpecialityEquipment, BuiltInCategory.OST_SpecialityEquipmentTags },
        { BuiltInCategory.OST_Casework, BuiltInCategory.OST_CaseworkTags },
        { BuiltInCategory.OST_MEPSpaces, BuiltInCategory.OST_MEPSpaceTags },
        { BuiltInCategory.OST_Areas, BuiltInCategory.OST_AreaTags }
    };

    public static BuiltInCategory GetTagCategory(BuiltInCategory elementCategory) =>
        CategoryToTagMap.TryGetValue(elementCategory, out var tagCategory)
            ? tagCategory
            : BuiltInCategory.OST_MultiCategoryTags;

    public static IEnumerable<BuiltInCategory> GetTaggableCategories() => CategoryToTagMap.Keys;

    public static string? GetCategoryName(Autodesk.Revit.DB.Document doc, BuiltInCategory builtInCategory) {
        if (doc == null)
            return null;

        try {
            return Category.GetCategory(doc, builtInCategory)?.Name;
        } catch {
            return null;
        }
    }

    public static BuiltInCategory GetBuiltInCategoryFromName(
        Autodesk.Revit.DB.Document doc,
        string categoryName
    ) {
        if (doc == null || string.IsNullOrWhiteSpace(categoryName))
            return BuiltInCategory.INVALID;

        foreach (var builtInCategory in GetTaggableCategories()) {
            var existingName = GetCategoryName(doc, builtInCategory);
            if (existingName != null &&
                existingName.Equals(categoryName, StringComparison.OrdinalIgnoreCase)) {
                return builtInCategory;
            }
        }

        return BuiltInCategory.INVALID;
    }
}
