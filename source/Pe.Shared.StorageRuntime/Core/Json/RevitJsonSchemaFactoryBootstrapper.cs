namespace Pe.Shared.StorageRuntime.Core.Json;

internal static class RevitJsonSchemaModuleInitializer {
    public static void EnsureRegistered() => RevitTypeRegistry.Initialize();
}
