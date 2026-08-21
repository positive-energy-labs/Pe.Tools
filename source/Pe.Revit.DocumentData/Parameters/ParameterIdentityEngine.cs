using Pe.Shared.RevitData;
namespace Pe.Revit.DocumentData.Parameters;

// FOOTGUN: Literal PE_* names are project/fixture data only; runtime logic must not treat the
// prefix as a parameter-authority signal. (2026-08-17, folded from
// source/Pe.Revit.FamilyFoundry/_README.md, deleted — git history.)
// Shared-vs-local classification resolves ONLY through this engine's ParameterIdentity, captured
// shared GUIDs, injected parameter-service evidence, or resolved shared definitions. A name that
// starts with PE_ proves nothing about who owns the parameter — real projects carry PE_-prefixed
// local parameters, and real PE shared parameters carry names that do not. Defaults, projection,
// and host examples are covered by the same rule; a name-prefix shortcut here reads as correct on
// the fixtures and is wrong in the field.
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
