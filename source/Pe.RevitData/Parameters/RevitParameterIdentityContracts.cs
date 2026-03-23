namespace Pe.RevitData.Parameters;

public enum RevitParameterIdentityKind {
    SharedGuid,
    BuiltInParameter,
    ParameterElement,
    NameFallback
}

public sealed record RevitParameterIdentity(
    string Key,
    RevitParameterIdentityKind Kind,
    string Name,
    int? BuiltInParameterId,
    Guid? SharedGuid,
    long? ParameterElementId
);
