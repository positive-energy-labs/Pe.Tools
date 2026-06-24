using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;

namespace Pe.Revit.FamilyFoundry.DesiredState;

public sealed class CompiledFamilyFoundryOperationProfile {
    public ExecutionOptions ExecutionOptions { get; init; } = new();
    public CleanFamilyDocumentSettings CleanFamilyDocument { get; init; } = new() { Enabled = false };
    public DeleteParamsSettings DeleteParams { get; init; } = new() { Enabled = false };
    public MapParamsSettings AddAndMapSharedParams { get; init; } = new() { Enabled = false };
    public AddFamilyParamsSettings AddFamilyParams { get; init; } = new() { Enabled = false };
    public SetKnownParamsSettings SetKnownParams { get; init; } = new() { Enabled = false };
    public MakeElecConnectorSettings MakeElectricalConnector { get; init; } = new() { Enabled = false };
    public AddRoomDinglerSettings AddRoomDingler { get; init; } = new() { Enabled = false };
    public SortParamsSettings SortParams { get; init; } = new() { Enabled = false };
    public SetLookupTablesSettings SetLookupTables { get; init; } = new() { Enabled = false };
}
