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
    ///     This will override the version determined by GitVersion.Tool. <br />
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

// PE_HOT_RELOAD_NUDGE
