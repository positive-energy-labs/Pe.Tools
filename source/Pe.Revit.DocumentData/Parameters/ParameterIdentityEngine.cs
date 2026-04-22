using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Parameters;

namespace Pe.Revit.DocumentData.Parameters;

public static class ParameterIdentityEngine {
    public static string GetParameterKey(
        Document doc,
        ElementId? parameterId,
        string fallbackName
    ) => RevitParameterIdentityFactory.FromParameterId(doc, parameterId, fallbackName).Key;

    public static ParameterIdentity FromCanonical(RevitParameterIdentity parameter) =>
        new(
            parameter.Key,
            parameter.Kind switch {
                RevitParameterIdentityKind.SharedGuid => ParameterIdentityKind.SharedGuid,
                RevitParameterIdentityKind.BuiltInParameter => ParameterIdentityKind.BuiltInParameter,
                RevitParameterIdentityKind.ParameterElement => ParameterIdentityKind.ParameterElement,
                _ => ParameterIdentityKind.NameFallback
            },
            parameter.Name,
            parameter.BuiltInParameterId,
            parameter.SharedGuid?.ToString("D"),
            parameter.ParameterElementId
        );

    public static ParameterIdentity FromRaw(
        string name,
        int? builtInParameterId,
        string? sharedGuid,
        long? parameterElementId
    ) => FromCanonical(RevitParameterIdentityFactory.FromRaw(
        name,
        builtInParameterId,
        Guid.TryParse(sharedGuid, out var parsedGuid) ? parsedGuid : null,
        parameterElementId
    ));

    public static ParameterIdentity FromParameterId(
        Document doc,
        ElementId? parameterId,
        string fallbackName
    ) => FromCanonical(RevitParameterIdentityFactory.FromParameterId(doc, parameterId, fallbackName));
}
