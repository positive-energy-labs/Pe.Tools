namespace Pe.Shared.RevitData;

// Home: this package, not Pe.Shared.HostContracts. The op runner (HostContracts/Operations/Op.cs) references
// RevitData directly and Pe.Revit.Space reaches it through Pe.Revit; Space does not reference HostContracts
// and must not gain the bridge protocol to state what it observed. No Revit reference here.

/// <summary>
///     The least every evidence record states. A null <c>Revision</c> is no source-revision proof: the observed
///     basis is unavailable. It is never written as 0 or "current".
/// </summary>
public interface IObserved {
    string DocumentKey { get; }
    long? Revision { get; }
}

/// <summary>
///     A response that carries evidence says so in its type. <c>TEvidence</c> is the domain's own record
///     (Space's <c>SpatialEvidence</c>). A response type without this interface sends no evidence.
/// </summary>
public interface IEvidenced<out TEvidence> where TEvidence : class, IObserved {
    TEvidence Evidence { get; }
}
