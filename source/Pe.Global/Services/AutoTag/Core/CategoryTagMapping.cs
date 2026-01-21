namespace Pe.Global.Services.AutoTag.Core;

/// <summary>
///     Helper class that maps element categories to their corresponding tag categories.
///     Single source of truth - all mappings defined once in the CategoryToTagMap dictionary.
/// </summary>
public static class CategoryTagMapping {
    /// <summary>
    ///     Master mapping of element categories to their corresponding tag categories.
    ///     Add new mappings here - all other methods derive from this single source of truth.
    /// </summary>
    private static readonly Dictionary<BuiltInCategory, BuiltInCategory> CategoryToTagMap = new() {
        // MEP Equipment
        { BuiltInCategory.OST_MechanicalEquipment, BuiltInCategory.OST_MechanicalEquipmentTags },
        { BuiltInCategory.OST_PlumbingFixtures, BuiltInCategory.OST_PlumbingFixtureTags },
        { BuiltInCategory.OST_PlumbingEquipment, BuiltInCategory.OST_MechanicalEquipmentTags },
        { BuiltInCategory.OST_LightingFixtures, BuiltInCategory.OST_LightingFixtureTags },
        { BuiltInCategory.OST_ElectricalFixtures, BuiltInCategory.OST_ElectricalFixtureTags },
        { BuiltInCategory.OST_ElectricalEquipment, BuiltInCategory.OST_ElectricalEquipmentTags },
        { BuiltInCategory.OST_Sprinklers, BuiltInCategory.OST_SprinklerTags },

        // MEP Ducts
        { BuiltInCategory.OST_DuctTerminal, BuiltInCategory.OST_DuctTerminalTags },
        { BuiltInCategory.OST_DuctFitting, BuiltInCategory.OST_DuctFittingTags },
        { BuiltInCategory.OST_FlexDuctCurves, BuiltInCategory.OST_FlexDuctTags },
        { BuiltInCategory.OST_DuctCurves, BuiltInCategory.OST_DuctTags },
        { BuiltInCategory.OST_DuctAccessory, BuiltInCategory.OST_DuctAccessoryTags },

        // MEP Pipes
        { BuiltInCategory.OST_PipeFitting, BuiltInCategory.OST_PipeFittingTags },
        { BuiltInCategory.OST_FlexPipeCurves, BuiltInCategory.OST_FlexPipeTags },
        { BuiltInCategory.OST_PipeCurves, BuiltInCategory.OST_PipeTags },
        { BuiltInCategory.OST_PipeAccessory, BuiltInCategory.OST_PipeAccessoryTags },

        // MEP Electrical Devices
        { BuiltInCategory.OST_LightingDevices, BuiltInCategory.OST_LightingDeviceTags },
        { BuiltInCategory.OST_DataDevices, BuiltInCategory.OST_DataDeviceTags },
        { BuiltInCategory.OST_CommunicationDevices, BuiltInCategory.OST_CommunicationDeviceTags },
        { BuiltInCategory.OST_FireAlarmDevices, BuiltInCategory.OST_FireAlarmDeviceTags },
        { BuiltInCategory.OST_SecurityDevices, BuiltInCategory.OST_SecurityDeviceTags },

        // MEP Cable Trays & Conduits
        { BuiltInCategory.OST_CableTray, BuiltInCategory.OST_CableTrayTags },
        { BuiltInCategory.OST_CableTrayFitting, BuiltInCategory.OST_CableTrayFittingTags },
        { BuiltInCategory.OST_Conduit, BuiltInCategory.OST_ConduitTags },
        { BuiltInCategory.OST_ConduitFitting, BuiltInCategory.OST_ConduitFittingTags },

        // Architectural
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

        // Areas/Spaces
        { BuiltInCategory.OST_MEPSpaces, BuiltInCategory.OST_MEPSpaceTags },
        { BuiltInCategory.OST_Areas, BuiltInCategory.OST_AreaTags }
    };

    /// <summary>
    ///     Gets the tag category for a given element category.
    ///     Returns OST_MultiCategoryTags if no specific mapping exists.
    /// </summary>
    public static BuiltInCategory GetTagCategory(BuiltInCategory elementCategory) =>
        CategoryToTagMap.TryGetValue(elementCategory, out var tagCategory)
            ? tagCategory
            : BuiltInCategory.OST_MultiCategoryTags;

    /// <summary>
    ///     Returns all element categories that can be tagged (derived from the master map).
    /// </summary>
    public static IEnumerable<BuiltInCategory> GetTaggableCategories() => CategoryToTagMap.Keys;

    /// <summary>
    ///     Gets the localized category name from a BuiltInCategory.
    /// </summary>
    public static string? GetCategoryName(Autodesk.Revit.DB.Document doc, BuiltInCategory builtInCategory) {
        if (doc == null) return null;

        try {
            var category = Category.GetCategory(doc, builtInCategory);
            return category?.Name;
        } catch {
            return null;
        }
    }

    /// <summary>
    ///     Gets the BuiltInCategory from a category name (case-insensitive).
    /// </summary>
    public static BuiltInCategory GetBuiltInCategoryFromName(Autodesk.Revit.DB.Document doc, string categoryName) {
        if (doc == null || string.IsNullOrWhiteSpace(categoryName))
            return BuiltInCategory.INVALID;

        // Try to find a matching category by comparing names
        foreach (var builtInCat in GetTaggableCategories()) {
            var catName = GetCategoryName(doc, builtInCat);
            if (catName != null && catName.Equals(categoryName, StringComparison.OrdinalIgnoreCase))
                return builtInCat;
        }

        return BuiltInCategory.INVALID;
    }
}