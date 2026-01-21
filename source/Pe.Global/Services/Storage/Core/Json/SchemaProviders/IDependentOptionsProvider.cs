using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Options provider that can filter results based on sibling property values.
///     Extend this interface when a dropdown's options depend on another field's value
///     (e.g., TagTypeName depends on TagFamilyName).
/// </summary>
public interface IDependentOptionsProvider : IOptionsProvider {
    /// <summary>
    ///     Property names that this provider depends on (relative to the parent object).
    ///     The frontend will pass the current values of these properties when requesting filtered options.
    /// </summary>
    IReadOnlyList<string> DependsOn { get; }

    /// <summary>
    ///     Get filtered examples based on sibling property values.
    /// </summary>
    /// <param name="siblingValues">Map of property name to current value</param>
    /// <returns>Filtered list of valid options</returns>
    IEnumerable<string> GetExamples(IReadOnlyDictionary<string, string> siblingValues);
}
