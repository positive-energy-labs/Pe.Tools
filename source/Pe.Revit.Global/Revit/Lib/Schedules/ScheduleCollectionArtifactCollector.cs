using Pe.Revit.Global.Revit.Documents;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

public static class ScheduleCollectionArtifactCollector {
    public static ScheduleCollectionArtifact Collect(
        Document doc,
        string runId,
        string engine,
        string region,
        string projectGuid,
        string modelGuid,
        ScheduleCollectionRequest? request = null,
        Action<string>? onProgress = null
    ) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        var effectiveRequest = request ?? new ScheduleCollectionRequest();

        onProgress?.Invoke("Schedule collection resolving primary schedule catalog.");
        var primaryCatalog = ScheduleCatalogCollector.Collect(doc, effectiveRequest.PrimaryCatalogRequest);
        var resolvedCatalog = primaryCatalog;
        var resolvedViaFallback = false;

        if (primaryCatalog.Entries.Count == 0 && effectiveRequest.FallbackCatalogRequest != null) {
            onProgress?.Invoke("Schedule collection primary catalog returned no schedules. Resolving fallback schedule catalog.");
            resolvedCatalog = ScheduleCatalogCollector.Collect(doc, effectiveRequest.FallbackCatalogRequest);
            resolvedViaFallback = true;
        }

        onProgress?.Invoke($"Schedule collection projecting {resolvedCatalog.Entries.Count} schedule(s).");
        var query = ScheduleQueryCollector.Collect(
            doc,
            new ScheduleQuery {
                Kind = ScheduleQueryKind.ScheduleReferences,
                ScheduleIds = resolvedCatalog.Entries.Select(entry => entry.ScheduleId).ToList()
            }
        );

        return new ScheduleCollectionArtifact(
            runId,
            engine,
            region,
            projectGuid,
            modelGuid,
            doc.Title,
            doc.GetDocumentPath(),
            doc.GetCloudModelUrn(),
            DateTimeOffset.UtcNow.ToString("O"),
            resolvedViaFallback,
            resolvedCatalog,
            query
        );
    }
}
