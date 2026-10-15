namespace Build.Options;

/// <summary>
///     Build configuration options.
/// </summary>
[Serializable]
public sealed record BuildOptions {
    /// <summary>
    ///     Application version.
    /// </summary>
    /// <remarks>
    ///     Optional assertion of product.payloads.json's version; a different value is refused.
    /// </remarks>
    /// <example>
    ///     1.0.0-alpha.1.250101 <br />
    ///     1.0.0-beta.2.250101 <br />
    ///     1.0.0
    /// </example>
    public string? Version { get; init; }

    /// <summary>
    ///     Optional explicit solution configuration to compile instead of the default Release.R* set.
    /// </summary>
    public string? Configuration { get; set; }
}
