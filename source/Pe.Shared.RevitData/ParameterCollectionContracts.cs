
namespace Pe.Shared.RevitData;

public record ParameterCollectionRequest(
    LoadedFamiliesFilter? Filter = null
);

public record ParameterCollectionArtifact(
    string RunId,
    string Engine,
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? DocumentTitle,
    string? DocumentPath,
    string? CloudModelUrn,
    string CollectedAtUtc,
    ProjectParameterBindingsData ProjectParameterBindings,
    LoadedFamiliesMatrixData LoadedFamiliesMatrix
);