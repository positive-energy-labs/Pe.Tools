using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.StorageRuntime.Capabilities;

[ExportTsEnum]
public enum SettingsRuntimeMode {
    HostOnly = 0,
    LiveDocument = 1
}

public static class SettingsRuntimeModeExtensions {
    public static bool Supports(this SettingsRuntimeMode currentMode, SettingsRuntimeMode requiredMode) =>
        currentMode >= requiredMode;

    public static IReadOnlyDictionary<string, bool> ToMetadata(this SettingsRuntimeMode runtimeMode) =>
        runtimeMode switch {
            SettingsRuntimeMode.LiveDocument => new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase) {
                ["hasRevitApiContext"] = true, ["hasActiveDocument"] = true
            },
            _ => new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase) {
                ["hasRevitApiContext"] = false, ["hasActiveDocument"] = false
            }
        };
}