namespace Pe.Shared.StorageRuntime.Capabilities;

public enum SettingsRuntimeMode {
    HostOnly = 0,
    LiveDocument = 1
}

public static class SettingsRuntimeModeExtensions {
    public static bool Supports(this SettingsRuntimeMode currentMode, SettingsRuntimeMode requiredMode) =>
        currentMode >= requiredMode;
}
