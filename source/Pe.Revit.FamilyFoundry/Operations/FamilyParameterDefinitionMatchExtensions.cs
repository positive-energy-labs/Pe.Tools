using Pe.Shared.RevitData;

namespace Pe.Revit.FamilyFoundry.Operations;

internal static class FamilyParameterDefinitionMatchExtensions {
    public static bool Matches(
        this RevitParameterDefinition parameter,
        FamilyParameter liveParameter
    ) => parameter.Definition.Matches(liveParameter);

    public static bool Matches(
        this ParameterDefinitionDescriptor definition,
        FamilyParameter liveParameter
    ) => string.Equals(definition.Identity.Name, liveParameter.Definition.Name, StringComparison.Ordinal)
         && (!definition.IsInstance.HasValue || definition.IsInstance == liveParameter.IsInstance)
         && MatchesForgeTypeId(definition.DataTypeId, liveParameter.Definition.GetDataType())
         && MatchesForgeTypeId(definition.GroupTypeId, liveParameter.Definition.GetGroupTypeId());

    private static bool MatchesForgeTypeId(string? expectedTypeId, ForgeTypeId actual) =>
        string.IsNullOrWhiteSpace(expectedTypeId) || string.Equals(expectedTypeId, actual.TypeId, StringComparison.Ordinal);
}
