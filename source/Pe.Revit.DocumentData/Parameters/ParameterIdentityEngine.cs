using Pe.Shared.RevitData;
namespace Pe.Revit.DocumentData.Parameters;

public static class ParameterIdentityEngine {
    public static string GetParameterKey(
        Document doc,
        ElementId? parameterId,
        string fallbackName
    ) => ParameterIdentityFactory.FromParameterId(doc, parameterId, fallbackName).Key;

    public static ParameterIdentity FromCanonical(ParameterIdentity parameter) =>
        new(
            parameter.Key,
            parameter.Kind switch {
                ParameterIdentityKind.SharedGuid => ParameterIdentityKind.SharedGuid,
                ParameterIdentityKind.BuiltInParameter => ParameterIdentityKind.BuiltInParameter,
                ParameterIdentityKind.ParameterElement => ParameterIdentityKind.ParameterElement,
                _ => ParameterIdentityKind.NameFallback
            },
            parameter.Name,
            parameter.BuiltInParameterId,
            parameter.SharedGuid,
            parameter.ParameterElementId
        );

    public static ParameterIdentity FromRaw(
        string name,
        int? builtInParameterId,
        string? sharedGuid,
        long? parameterElementId
    ) => FromCanonical(ParameterIdentityFactory.FromRaw(
        name,
        builtInParameterId,
        Guid.TryParse(sharedGuid, out var parsedGuid) ? parsedGuid : null,
        parameterElementId
    ));

    public static ParameterIdentity FromParameterId(
        Document doc,
        ElementId? parameterId,
        string fallbackName
    ) => FromCanonical(ParameterIdentityFactory.FromParameterId(doc, parameterId, fallbackName));
}
