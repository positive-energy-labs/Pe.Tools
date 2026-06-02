using Pe.Revit.FamilyFoundry.Operations;

namespace Pe.Revit.FamilyFoundry.OperationGroups;

public sealed class AddAndMapFamilyParams(
    AddFamilyParamsSettings addSettings,
    MapParamsSettings mapSettings)
    : OperationGroup<AddFamilyParamsSettings>(
        "Add desired local family parameters and map legacy source values",
        InitializeOperations(addSettings, mapSettings),
        mapSettings.MappingData.Select(mapping => mapping.NewName)) {
    private static List<IOperation> InitializeOperations(
        AddFamilyParamsSettings addSettings,
        MapParamsSettings mapSettings
    ) => [
        new AddFamilyParams(addSettings),
        new MapFamilyParams(mapSettings)
    ];
}
