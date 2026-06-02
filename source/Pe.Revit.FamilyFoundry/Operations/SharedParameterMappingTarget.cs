using Pe.Revit.Global;
using Pe.Shared.RevitData;

namespace Pe.Revit.FamilyFoundry.Operations;

public sealed record SharedParameterMappingTarget(
    ParameterDefinitionDescriptor Definition,
    SharedParameterDefinition SharedParameter
) {
    public string Name => this.Definition.Identity.Name;

    public ExternalDefinition ExternalDefinition => this.SharedParameter.ExternalDefinition;

    public ForgeTypeId GroupTypeId => this.SharedParameter.GroupTypeId;

    public bool IsInstance => this.SharedParameter.IsInstance;

    public bool HasSameDataType(ForgeTypeId dataType) =>
        string.Equals(this.Definition.DataTypeId, dataType.TypeId, StringComparison.Ordinal);
}

public static class SharedParameterMappingTargets {
    public static IReadOnlyDictionary<string, SharedParameterMappingTarget> ByName(
        IEnumerable<SharedParameterDefinition> sharedParameters
    ) => sharedParameters
        .Select(FromSharedParameter)
        .GroupBy(target => target.Name, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

    public static SharedParameterMappingTarget FromSharedParameter(SharedParameterDefinition sharedParameter) =>
        new(
            new ParameterDefinitionDescriptor(
                new ParameterIdentity(
                    $"shared:{sharedParameter.ExternalDefinition.GUID:D}",
                    ParameterIdentityKind.SharedGuid,
                    sharedParameter.ExternalDefinition.Name,
                    null,
                    sharedParameter.ExternalDefinition.GUID.ToString("D"),
                    null),
                sharedParameter.IsInstance,
                NormalizeForgeTypeId(sharedParameter.ExternalDefinition.GetDataType()),
                null,
                NormalizeForgeTypeId(sharedParameter.GroupTypeId),
                null),
            sharedParameter);

    private static string? NormalizeForgeTypeId(ForgeTypeId? forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;
}
