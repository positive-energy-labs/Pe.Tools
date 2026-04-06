namespace Pe.Revit.Global;

public record SharedParameterDefinition(
    ExternalDefinition ExternalDefinition,
    ForgeTypeId GroupTypeId,
    bool IsInstance
);