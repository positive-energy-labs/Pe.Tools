using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Artifacts;

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
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        // The artifact feeds FamilyFoundry migration planning: binding categories are load-bearing,
        // and the bindings collector strips them below Rows/Full projection.
        var bindings = ProjectParameterBindingsCollector.Collect(
            doc,
            filter,
            projection: new RevitDataProjectionRequest { View = RevitDataResultView.Full });
        var matrix = LoadedFamiliesMatrixCollector.Collect(doc, filter, onProgress);

        return new ParameterCollectionArtifact(
            runId,
            engine,
            region,
            projectGuid,
            modelGuid,
            doc.Title,
            doc.GetDocumentPath(),
            doc.TryGetCloudModelUrn(),
            DateTimeOffset.UtcNow.ToString("O"),
            bindings,
            matrix
        );
    }
}
