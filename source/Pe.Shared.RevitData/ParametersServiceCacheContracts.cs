using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[ExportTsSchema]
public sealed record ParametersServiceCacheData(
    int ParameterCount,
    string JsonPath,
    IReadOnlyList<string> AdditionalFormatPaths
);
