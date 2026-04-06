namespace Pe.Global;

public record SharedParameterDefinition(
    ExternalDefinition ExternalDefinition,
    ForgeTypeId GroupTypeId,
    bool IsInstance
);