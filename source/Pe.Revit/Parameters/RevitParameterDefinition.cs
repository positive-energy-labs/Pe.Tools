using Pe.Shared.RevitData;

namespace Pe.Revit.Parameters;

public record RevitParameterDefinition {
    private ParameterDefinitionDescriptor _definition = NameFallbackDescriptor(string.Empty);

    public ParameterDefinitionDescriptor Definition {
        get => this._definition;
        init => this._definition = value;
    }

    public string? Tooltip { get; init; }

    public ParameterIdentity Identity => this.Definition.Identity;

    public bool IsShared => !string.IsNullOrWhiteSpace(this.Identity.SharedGuid);

    public bool IsBuiltIn => this.Identity.BuiltInParameterId.HasValue;

    public string? SharedGuid => this.Identity.SharedGuid;

    public string? DataTypeId => this.Definition.DataTypeId;

    public string? DataTypeLabel => this.Definition.DataTypeLabel;

    public string? GroupTypeId => this.Definition.GroupTypeId;

    public string? GroupTypeLabel => this.Definition.GroupTypeLabel;

    public string Name {
        get => this.Identity.Name;
        init => this._definition = this.Definition with { Identity = NameFallbackIdentity(value) };
    }

    public bool? IsInstance {
        get => this.Definition.IsInstance;
        init => this._definition = this.Definition with { IsInstance = value };
    }

    public ForgeTypeId DataType {
        get => this.OptionalDataType ?? SpecTypeId.String.Text;
        init => this._definition = this.Definition with { DataTypeId = ToTypeId(value) };
    }

    public ForgeTypeId PropertiesGroup {
        get => this.OptionalPropertiesGroup ?? new ForgeTypeId(string.Empty);
        init => this._definition = this.Definition with { GroupTypeId = ToTypeId(value) };
    }

    private ForgeTypeId? OptionalDataType => ToForgeTypeId(this.Definition.DataTypeId);

    private ForgeTypeId? OptionalPropertiesGroup => ToForgeTypeId(this.Definition.GroupTypeId);

    public static RevitParameterDefinition FromDescriptor(
        ParameterDefinitionDescriptor definition,
        string? tooltip = null
    ) => new() {
        Definition = definition,
        Tooltip = tooltip
    };

    public static RevitParameterDefinition DesiredFamilyParameter(
        string name,
        ForgeTypeId? dataType = null,
        ForgeTypeId? propertiesGroup = null,
        bool? isInstance = null,
        string? tooltip = null
    ) => new() {
        Definition = NameFallbackDescriptor(name, dataType, propertiesGroup, isInstance),
        Tooltip = tooltip
    };

    public static RevitParameterDefinition DesiredSharedParameter(
        ExternalDefinition definition,
        ForgeTypeId propertiesGroup,
        bool isInstance
    ) {
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));

        return new RevitParameterDefinition {
            Definition = Descriptor(
                SharedIdentity(definition.Name, definition.GUID),
                definition.GetDataType(),
                propertiesGroup,
                isInstance),
            Tooltip = string.IsNullOrWhiteSpace(definition.Description) ? null : definition.Description
        };
    }

    public static RevitParameterDefinition DesiredSharedParameter(SharedParameterDefinition definition) {
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));

        return DesiredSharedParameter(
            definition.ExternalDefinition,
            definition.GroupTypeId,
            definition.IsInstance);
    }

    public static RevitParameterDefinition ObservedFamilyParameter(FamilyParameter parameter) {
        if (parameter == null)
            throw new ArgumentNullException(nameof(parameter));

        return new RevitParameterDefinition {
            Definition = Descriptor(
                IdentityFromFamilyParameter(parameter),
                parameter.Definition.GetDataType(),
                parameter.Definition.GetGroupTypeId(),
                parameter.IsInstance)
        };
    }

    public static RevitParameterDefinition ObservedParameter(
        Parameter parameter,
        bool? isInstance = null
    ) {
        if (parameter == null)
            throw new ArgumentNullException(nameof(parameter));

        return new RevitParameterDefinition {
            Definition = Descriptor(
                IdentityFromParameter(parameter),
                parameter.Definition.GetDataType(),
                parameter.Definition.GetGroupTypeId(),
                isInstance)
        };
    }

    public static ParameterDefinitionDescriptor NameFallbackDescriptor(
        string name,
        ForgeTypeId? dataType = null,
        ForgeTypeId? propertiesGroup = null,
        bool? isInstance = null
    ) => Descriptor(NameFallbackIdentity(name), dataType, propertiesGroup, isInstance);

    public static ParameterDefinitionDescriptor Descriptor(
        ParameterIdentity identity,
        ForgeTypeId? dataType,
        ForgeTypeId? propertiesGroup,
        bool? isInstance
    ) => new(
        identity,
        isInstance,
        ToTypeId(dataType),
        null,
        ToTypeId(propertiesGroup),
        null
    );

    public static ParameterIdentity NameFallbackIdentity(string? name) {
        var safeName = name ?? string.Empty;
        return new ParameterIdentity(
            $"name:{NormalizeName(safeName)}",
            ParameterIdentityKind.NameFallback,
            safeName,
            null,
            null,
            null
        );
    }

    public static ParameterIdentity SharedIdentity(string name, Guid sharedGuid) => new(
        $"shared:{sharedGuid:D}",
        ParameterIdentityKind.SharedGuid,
        name,
        null,
        sharedGuid.ToString("D"),
        null
    );

    public static ForgeTypeId? ToForgeTypeId(string? typeId) =>
        string.IsNullOrWhiteSpace(typeId) ? null : new ForgeTypeId(typeId);

    public static string? ToTypeId(ForgeTypeId? forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

    private static ParameterIdentity IdentityFromParameter(Parameter parameter) => CreateIdentity(
        parameter.Definition?.Name ?? string.Empty,
        GetBuiltInParameterId(parameter.Id),
        TryGetSharedGuid(parameter),
        GetParameterElementId(parameter.Id)
    );

    private static ParameterIdentity IdentityFromFamilyParameter(FamilyParameter parameter) => CreateIdentity(
        parameter.Definition?.Name ?? string.Empty,
        GetBuiltInParameterId(parameter.Id),
        TryGetSharedGuid(parameter),
        GetParameterElementId(parameter.Id)
    );

    private static ParameterIdentity CreateIdentity(
        string name,
        int? builtInParameterId,
        Guid? sharedGuid,
        long? parameterElementId
    ) {
        if (sharedGuid.HasValue && sharedGuid.Value != Guid.Empty)
            return SharedIdentity(name, sharedGuid.Value) with { BuiltInParameterId = builtInParameterId, ParameterElementId = parameterElementId };

        if (builtInParameterId.HasValue) {
            return new ParameterIdentity(
                $"builtin:{builtInParameterId.Value}",
                ParameterIdentityKind.BuiltInParameter,
                name,
                builtInParameterId,
                null,
                null
            );
        }

        if (parameterElementId.HasValue) {
            return new ParameterIdentity(
                $"parameter-element:{parameterElementId.Value}",
                ParameterIdentityKind.ParameterElement,
                name,
                null,
                null,
                parameterElementId
            );
        }

        return NameFallbackIdentity(name);
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
            return parameter.GUID == Guid.Empty ? null : parameter.GUID;
        } catch {
            return null;
        }
    }

    private static Guid? TryGetSharedGuid(FamilyParameter parameter) {
        if (!parameter.IsShared)
            return null;

        try {
            return parameter.GUID == Guid.Empty ? null : parameter.GUID;
        } catch {
            return null;
        }
    }

    private static string NormalizeName(string name) => name.Trim().ToLowerInvariant();
}
