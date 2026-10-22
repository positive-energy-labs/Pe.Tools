namespace Pe.Revit.Scripting.Context;

public static class ReadableParameterExtensions {
    /// <summary>
    ///     The element's parameters minus built-ins the public API does not name. Reading <c>StorageType</c> of such a
    ///     parameter kills Revit natively (AccessViolation in <c>ParamDef.getStorageType</c>), past any catch or rollback:
    ///     on Project A, the Copy/Monitor settings element carries hidden ids -1016012..-1016014 whose definition is nameless
    ///     and not an <c>InternalDefinition</c>, so the name test is what drops them. A whole-model sweep through this
    ///     read 316,005 elements without a crash (2026-10-19). Sweep with this instead of <c>element.Parameters</c>.
    /// </summary>
    public static IEnumerable<Parameter> ReadableParameters(this Element element) =>
        element.Parameters.Cast<Parameter>()
            .Where(p => p.Definition is { Name.Length: > 0 } def
                        && (def is not InternalDefinition d || Enum.IsDefined(typeof(BuiltInParameter), d.BuiltInParameter)));
}
