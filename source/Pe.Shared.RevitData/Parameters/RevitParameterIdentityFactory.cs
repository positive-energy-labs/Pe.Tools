using Pe.RevitData.PolyFill;

namespace Pe.RevitData.Parameters;

public static class RevitParameterIdentityFactory {
    public static RevitParameterIdentity FromParameter(Parameter parameter) {
        if (parameter == null)
            throw new ArgumentNullException(nameof(parameter));

        return Create(
            parameter.Definition?.Name ?? string.Empty,
            GetBuiltInParameterId(parameter.Id),
            TryGetSharedGuid(parameter),
            GetParameterElementId(parameter.Id)
        );
    }

    public static RevitParameterIdentity FromFamilyParameter(FamilyParameter parameter) {
        if (parameter == null)
            throw new ArgumentNullException(nameof(parameter));

        return Create(
            parameter.Definition?.Name ?? string.Empty,
            GetBuiltInParameterId(parameter.Id),
            TryGetSharedGuid(parameter),
            GetParameterElementId(parameter.Id)
        );
    }

    public static RevitParameterIdentity FromDefinition(
        Document doc,
        Definition definition
    ) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));

        if (definition is ExternalDefinition externalDefinition) {
            var sharedGuid = externalDefinition.GUID;
            return Create(
                definition.Name,
                null,
                sharedGuid == Guid.Empty ? null : sharedGuid,
                null
            );
        }

        if (definition is InternalDefinition internalDefinition) {
            var parameterId = internalDefinition.Id;
            if (parameterId == null || parameterId == ElementId.InvalidElementId)
                return Create(definition.Name, null, null, null);

            var builtInParameterId = GetBuiltInParameterId(parameterId);
            var parameterElementId = GetParameterElementId(parameterId);
            var parameterElement = doc.GetElement(parameterId);
            var sharedGuid = (parameterElement as SharedParameterElement)?.GuidValue;

            return Create(
                parameterElement?.Name ?? definition.Name,
                builtInParameterId,
                sharedGuid == Guid.Empty ? null : sharedGuid,
                parameterElementId
            );
        }

        return Create(definition.Name, null, null, null);
    }

    public static RevitParameterIdentity FromParameterId(
        Document doc,
        ElementId? parameterId,
        string fallbackName
    ) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        if (parameterId == null || parameterId == ElementId.InvalidElementId)
            return Create(fallbackName, null, null, null);

        var builtInParameterId = GetBuiltInParameterId(parameterId);
        if (builtInParameterId.HasValue) {
            return Create(
                TryGetBuiltInParameterLabel(builtInParameterId.Value, fallbackName),
                builtInParameterId,
                null,
                null
            );
        }

        var parameterElement = doc.GetElement(parameterId);
        var sharedGuid = (parameterElement as SharedParameterElement)?.GuidValue;
        return Create(
            parameterElement?.Name ?? fallbackName,
            null,
            sharedGuid == Guid.Empty ? null : sharedGuid,
            GetParameterElementId(parameterId)
        );
    }

    public static RevitParameterIdentity FromRaw(
        string name,
        int? builtInParameterId,
        Guid? sharedGuid,
        long? parameterElementId
    ) => Create(name, builtInParameterId, sharedGuid, parameterElementId);

    private static RevitParameterIdentity Create(
        string name,
        int? builtInParameterId,
        Guid? sharedGuid,
        long? parameterElementId
    ) {
        // Identity strength order:
        // SharedGuid > BuiltInParameter > ParameterElement > NameFallback.
        // This is an observation/join identity only. Do not assume every
        // identity kind is safe for cross-document authority resolution.
        if (sharedGuid.HasValue && sharedGuid.Value != Guid.Empty) {
            return new RevitParameterIdentity(
                $"shared:{sharedGuid.Value:D}",
                RevitParameterIdentityKind.SharedGuid,
                name,
                builtInParameterId,
                sharedGuid,
                parameterElementId
            );
        }

        if (builtInParameterId.HasValue) {
            return new RevitParameterIdentity(
                $"builtin:{builtInParameterId.Value}",
                RevitParameterIdentityKind.BuiltInParameter,
                name,
                builtInParameterId,
                null,
                null
            );
        }

        if (parameterElementId.HasValue) {
            return new RevitParameterIdentity(
                $"parameter-element:{parameterElementId.Value}",
                RevitParameterIdentityKind.ParameterElement,
                name,
                null,
                null,
                parameterElementId
            );
        }

        return new RevitParameterIdentity(
            $"name:{NormalizeName(name)}",
            RevitParameterIdentityKind.NameFallback,
            name,
            null,
            null,
            null
        );
    }

    private static int? GetBuiltInParameterId(ElementId? parameterId) {
        if (parameterId == null || parameterId == ElementId.InvalidElementId)
            return null;

        var rawValue = parameterId.Value();
        return rawValue < 0 ? (int)rawValue : null;
    }

    private static long? GetParameterElementId(ElementId? parameterId) {
        if (parameterId == null || parameterId == ElementId.InvalidElementId)
            return null;

        var rawValue = parameterId.Value();
        return rawValue > 0 ? rawValue : null;
    }

    private static Guid? TryGetSharedGuid(Parameter parameter) {
        if (!parameter.IsShared)
            return null;

        try {
            var sharedGuid = parameter.GUID;
            return sharedGuid == Guid.Empty ? null : sharedGuid;
        } catch {
            return null;
        }
    }

    private static Guid? TryGetSharedGuid(FamilyParameter parameter) {
        if (!parameter.IsShared)
            return null;

        try {
            var sharedGuid = parameter.GUID;
            return sharedGuid == Guid.Empty ? null : sharedGuid;
        } catch {
            return null;
        }
    }

    private static string TryGetBuiltInParameterLabel(
        int builtInParameterId,
        string fallbackName
    ) {
        try {
            return LabelUtils.GetLabelFor((BuiltInParameter)builtInParameterId);
        } catch {
            return fallbackName;
        }
    }

    private static string NormalizeName(string name) =>
        string.IsNullOrWhiteSpace(name)
            ? string.Empty
            : name.Trim().ToLowerInvariant();
}
