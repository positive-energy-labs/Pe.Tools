using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData.Schedules;

[ExportTsInterface]
public record ScheduleCollectionRequest(
    ScheduleCatalogRequest? PrimaryCatalogRequest = null,
    ScheduleCatalogRequest? FallbackCatalogRequest = null
);

[ExportTsInterface]
public record ScheduleCollectionArtifact(
    string RunId,
    string Engine,
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? DocumentTitle,
    string? DocumentPath,
    string? CloudModelUrn,
    string CollectedAtUtc,
    bool ResolvedViaFallback,
    ScheduleCatalogData Catalog,
    ScheduleQueryData Query
);
