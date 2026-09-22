using Newtonsoft.Json;

namespace Pe.Shared.RevitData;

/// <summary>
///     Mutation evidence for one native parameter: what a reviewer saw, and what a writer compares against a fresh
///     read before writing. Schedule cells carry one per target; parameter edits carry one as Expected.
/// </summary>
/// <remarks>Reviewed evidence is required on the wire: a capture that lacks a field refuses, never defaults to 0/false/absent.</remarks>
public sealed record ParameterTarget(
    [property: JsonProperty(Required = Required.Always)] long ElementId,
    [property: JsonProperty(Required = Required.Always)] long ParameterId,
    string? ParameterName,
    [property: JsonProperty(Required = Required.Always)] RequestedParameterStorageType StorageType,
    [property: JsonProperty(Required = Required.Always)] bool IsReadOnly,
    [property: JsonProperty(Required = Required.Always)] bool HasValue,
    [property: JsonProperty(Required = Required.AllowNull, NullValueHandling = NullValueHandling.Include)] string? RawValue
);
