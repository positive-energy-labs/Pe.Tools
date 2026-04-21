using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record ParameterCollectionRequest(
    LoadedFamiliesFilter? Filter = null
);

[ExportTsInterface]
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
