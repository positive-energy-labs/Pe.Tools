using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     The exact bytes one composition consumed, captured at its one read: the root (a saved member or a supplied
///     draft, always under its actual pod id) and its ordered dependencies. A run stores these bytes; it never rereads them.
/// </summary>
public sealed record PodComposedSource(PodCapturedSourceData Root, List<PodConsumedSourceData> Dependencies);
