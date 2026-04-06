
namespace Pe.Revit.Extensions.ProjectDocument;

public static class ProjectDocumentDefinitions {
    /// <summary>
    /// Tries to resolve shared GUID from either:
    /// - ExternalDefinition.GUID
    /// - InternalDefinition.Id -> SharedParameterElement.GuidValue
    /// </summary>
    /// <returns>The shared GUID or null if not found</returns>
    /// // TODO: go back to my llm parameter guide and get a better method for this
    private static Guid? TryGetSharedGuid(this Autodesk.Revit.DB.Document doc, Definition def) {
        return (def) switch {
            ExternalDefinition ext => ext.GUID,
            InternalDefinition internalDef => (doc.GetElement(internalDef.Id) as SharedParameterElement)?.GuidValue,
            _ => null
        };
    }
}

