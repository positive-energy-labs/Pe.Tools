using Pe.StorageRuntime.Context;

namespace Pe.StorageRuntime.Revit.Context;

public static class SettingsDocumentContextAccessorRegistry {
    public static ISettingsDocumentContextAccessor? Current { get; set; }
}
