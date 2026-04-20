using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using System.Runtime.CompilerServices;

namespace Pe.Revit.FamilyFoundry.SchemaDefinitions;

internal sealed class ProfileFamilyManagerSchemaDefinition : SettingsSchemaDefinition<FFManagerProfile> {
    public override void Configure(ISettingsSchemaBuilder<FFManagerProfile> builder) =>
        builder.Data(SchemaDatasetIds.ParameterCatalog, data => {
            data.Provider(SchemaDatasetIds.ParameterCatalog);
            data.Load(SettingsSchemaDatasetLoadMode.Eager);
            data.StaleOn(SchemaInvalidationKeys.DocumentChanged);
            data.SupportsProjection(SchemaProjectionKeys.FamilyParameterNames);
        });
}

internal sealed class ProfileRemapSchemaDefinition : SettingsSchemaDefinition<FFMigratorProfile> {
    public override void Configure(ISettingsSchemaBuilder<FFMigratorProfile> builder) =>
        builder.Data(SchemaDatasetIds.ParameterCatalog, data => {
            data.Provider(SchemaDatasetIds.ParameterCatalog);
            data.Load(SettingsSchemaDatasetLoadMode.Eager);
            data.StaleOn(SchemaInvalidationKeys.DocumentChanged);
            data.SupportsProjection(SchemaProjectionKeys.FamilyParameterNames);
        });
}

public static class FamilyFoundryRootSchemaDefinitionBootstrapper {
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

            SettingsSchemaDefinitionRegistry.Shared.Register(new ProfileFamilyManagerSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ProfileRemapSchemaDefinition());
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