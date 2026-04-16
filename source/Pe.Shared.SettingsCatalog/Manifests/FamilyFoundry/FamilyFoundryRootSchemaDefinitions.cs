using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using System.Runtime.CompilerServices;

namespace Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

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

internal static class FamilyFoundryRootSchemaDefinitionBootstrapper {
    [ModuleInitializer]
    internal static void Register() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new ProfileFamilyManagerSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ProfileRemapSchemaDefinition());
    }
}
