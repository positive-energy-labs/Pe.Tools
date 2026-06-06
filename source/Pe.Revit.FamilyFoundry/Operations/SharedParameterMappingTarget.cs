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
            RevitParameterDefinition.DesiredSharedParameter(sharedParameter).Definition,
            sharedParameter);
}
