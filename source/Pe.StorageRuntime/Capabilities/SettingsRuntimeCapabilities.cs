namespace Pe.StorageRuntime.Capabilities;

public sealed record SettingsRuntimeCapabilities(
    bool HasRevitAssembly,
    bool HasRevitApiContext,
    bool HasActiveDocument
) {
    public bool Supports(SettingsRuntimeCapabilities requiredCapabilities) {
        if (requiredCapabilities == null)
            throw new ArgumentNullException(nameof(requiredCapabilities));

        return (!requiredCapabilities.HasRevitAssembly || this.HasRevitAssembly) &&
               (!requiredCapabilities.HasRevitApiContext || this.HasRevitApiContext) &&
               (!requiredCapabilities.HasActiveDocument || this.HasActiveDocument);
    }

    public IReadOnlyDictionary<string, bool> ToMetadata() =>
        new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase) {
            ["hasRevitAssembly"] = this.HasRevitAssembly,
            ["hasRevitApiContext"] = this.HasRevitApiContext,
            ["hasActiveDocument"] = this.HasActiveDocument
        };
}

public static class SettingsRuntimeCapabilityProfiles {
    public static SettingsRuntimeCapabilities HostOnly { get; } = new(false, false, false);
    public static SettingsRuntimeCapabilities RevitAssemblyOnly { get; } = new(true, false, false);
    public static SettingsRuntimeCapabilities LiveDocument { get; } = new(true, true, true);
}
