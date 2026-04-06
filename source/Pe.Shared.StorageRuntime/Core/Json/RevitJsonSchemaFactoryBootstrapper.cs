namespace Pe.Shared.StorageRuntime.Revit.Core.Json;

internal static class RevitJsonSchemaModuleInitializer {
    public static void EnsureRegistered() => RevitTypeRegistry.Initialize();
}
