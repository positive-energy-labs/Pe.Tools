using Newtonsoft.Json;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     The exact bytes one composition consumed, captured at its one read: the root (a saved member or a supplied
///     draft, always under its actual pod id) and its ordered dependencies. A run stores these bytes; it never rereads them.
/// </summary>
/// <remarks>Every member is required on the wire: a source without its bytes is refused at binding, never bound to nulls.</remarks>
public sealed record PodComposedSource(
    [property: JsonProperty(Required = Required.Always)] PodCapturedSourceData Root,
    [property: JsonProperty(Required = Required.Always)] List<PodConsumedSourceData> Dependencies);
