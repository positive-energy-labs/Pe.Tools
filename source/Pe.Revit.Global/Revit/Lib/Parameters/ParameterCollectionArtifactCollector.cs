using Pe.Revit.Global.Revit.Documents;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Parameters;

public static class ParameterCollectionArtifactCollector {
    public static ParameterCollectionArtifact Collect(
        Document doc,
        string runId,
        string engine,
        string region,
        string projectGuid,
        string modelGuid,
        LoadedFamiliesFilter? filter = null,
        Action<string>? onProgress = null
    ) {
        ArgumentNullException.ThrowIfNull(doc);

        var bindings = ProjectParameterBindingsCollector.Collect(doc, filter);
        var matrix = LoadedFamiliesMatrixCollector.Collect(doc, filter, onProgress);

        return new ParameterCollectionArtifact(
            runId,
            engine,
            region,
            projectGuid,
            modelGuid,
            doc.Title,
            doc.GetDocumentPath(),
            doc.GetCloudModelUrn(),
            DateTimeOffset.UtcNow.ToString("O"),
            bindings,
            matrix
        );
    }
}
