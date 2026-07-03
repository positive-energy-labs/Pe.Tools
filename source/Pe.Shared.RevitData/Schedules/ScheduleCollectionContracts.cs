using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData.Schedules;

[ExportTsSchema]
public record ScheduleCollectionRequest(
    ScheduleCatalogRequest? PrimaryCatalogRequest = null,
    ScheduleCatalogRequest? FallbackCatalogRequest = null
);

[ExportTsSchema]
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
