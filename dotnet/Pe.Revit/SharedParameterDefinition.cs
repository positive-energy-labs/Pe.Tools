namespace Pe.Revit;

public sealed class SharedParameterDefinition {
    public SharedParameterDefinition(ExternalDefinition externalDefinition, ForgeTypeId groupTypeId, bool isInstance) {
        this.ExternalDefinition = externalDefinition;
        this.GroupTypeId = groupTypeId;
        this.IsInstance = isInstance;
    }

    public ExternalDefinition ExternalDefinition { get; }

    public ForgeTypeId GroupTypeId { get; }

    public bool IsInstance { get; }
}
