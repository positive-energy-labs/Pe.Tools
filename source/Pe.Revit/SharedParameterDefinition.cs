namespace Pe.Revit;

public record SharedParameterDefinition(
    ExternalDefinition ExternalDefinition,
    ForgeTypeId GroupTypeId,
    bool IsInstance
);
