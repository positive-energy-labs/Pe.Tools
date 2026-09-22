
namespace Pe.Shared.RevitData;

public sealed record ParametersServiceCacheData(
    int ParameterCount,
    string JsonPath,
    IReadOnlyList<string> AdditionalFormatPaths
);
