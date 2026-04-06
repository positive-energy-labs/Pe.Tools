using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using System.Runtime.CompilerServices;

namespace Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

internal sealed class ProfileFamilyManagerSchemaDefinition : SettingsSchemaDefinition<ProfileFamilyManager> {
    public override void Configure(ISettingsSchemaBuilder<ProfileFamilyManager> builder) =>
        builder.Data(SchemaDatasetIds.ParameterCatalog, data => {
            data.Provider(SchemaDatasetIds.ParameterCatalog);
            data.Load(SettingsSchemaDatasetLoadMode.Eager);
            data.StaleOn(SchemaInvalidationKeys.DocumentChanged);
            data.SupportsProjection(SchemaProjectionKeys.FamilyParameterNames);
        });
}

internal sealed class ProfileRemapSchemaDefinition : SettingsSchemaDefinition<ProfileRemap> {
    public override void Configure(ISettingsSchemaBuilder<ProfileRemap> builder) =>
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
