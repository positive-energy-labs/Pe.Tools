using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData;

namespace Pe.Revit.FamilyFoundry.Operations;

internal static class FamilyParameterDefinitionCreateExtensions {
    public static FamilyParameter AddFamilyParameter(
        this FamilyDocument document,
        FamilyParamDefinitionModel parameter
    ) => document.AddFamilyParameter(parameter.Definition);

    public static FamilyParameter AddFamilyParameter(
        this FamilyDocument document,
        ParameterDefinitionDescriptor definition
    ) => document.AddFamilyParameter(
        definition.Identity.Name,
        ToForgeTypeId(definition.GroupTypeId),
        ToForgeTypeId(definition.DataTypeId) ?? SpecTypeId.String.Text,
        definition.IsInstance ?? true);

    private static ForgeTypeId? ToForgeTypeId(string? typeId) =>
        string.IsNullOrWhiteSpace(typeId) ? null : new ForgeTypeId(typeId);
}
