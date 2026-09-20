namespace Pe.Shared.RevitData;

/// <summary>
///     The native write cap per call: parameter edits, and reviewed schedule cells and their coalesced writes.
///     The generated contract carries it as `parameterValueApplyBounds` so the host reads the same number.
/// </summary>
public static class ParameterValueApplyBounds {
    public const int MaxEditsPerCall = 500;
}
