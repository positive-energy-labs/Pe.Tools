using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using System.Runtime.CompilerServices;

namespace Pe.Shared.StorageRuntime.AutoTag;

internal sealed class AutoTagConfigurationSchemaDefinition : SettingsSchemaDefinition<AutoTagConfiguration> {
    public override void Configure(ISettingsSchemaBuilder<AutoTagConfiguration> builder) {
        builder.Property(config => config.TagFamilyName,
            property => property.UseFieldOptions<AnnotationTagFamilyNamesProvider>());
        builder.Property(config => config.TagTypeName,
            property => property.UseFieldOptions<AnnotationTagTypeNamesProvider>());
    }
}

public static class AutoTagSchemaDefinitionBootstrapper {
    private static readonly object SyncRoot = new();
    private static bool _registered;

    [ModuleInitializer]
    internal static void RegisterOnModuleLoad() => TryRegister();

    public static void EnsureRegistered() {
        if (_registered)
            return;

        lock (SyncRoot) {
            if (_registered)
                return;

            SettingsSchemaDefinitionRegistry.Shared.Register(new AutoTagConfigurationSchemaDefinition());
            _registered = true;
        }
    }

    private static void TryRegister() {
        try {
            EnsureRegistered();
        } catch (Exception ex) when (IsMissingRevitAssembly(ex)) {
        }
    }

    private static bool IsMissingRevitAssembly(Exception ex) =>
        (ex is FileNotFoundException fileNotFoundException &&
         string.Equals(fileNotFoundException.FileName?.Split(',')[0], "RevitAPI",
             StringComparison.OrdinalIgnoreCase)) ||
        (ex.InnerException is not null && IsMissingRevitAssembly(ex.InnerException));
}