using Pe.Host.Contracts.RevitData;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using System.Runtime.CompilerServices;

namespace Pe.Host.Services;

internal sealed class LoadedFamiliesFilterSchemaDefinition
    : SettingsSchemaDefinition<LoadedFamiliesFilter> {
    public override void Configure(ISettingsSchemaBuilder<LoadedFamiliesFilter> builder) {
        builder.Data(SchemaDatasetIds.LoadedFamiliesCatalog, data => {
            data.Provider(SchemaDatasetIds.LoadedFamiliesCatalog);
            data.Load(SettingsSchemaDatasetLoadMode.Eager);
            data.StaleOn(SchemaInvalidationKeys.DocumentChanged);
            data.SupportsProjection(SchemaProjectionKeys.FamilyNames, SchemaProjectionKeys.CategoryNames);
        });

        builder.Property(item => item.FamilyNames, property =>
            property.UseDatasetOptions(SchemaDatasetIds.LoadedFamiliesCatalog, SchemaProjectionKeys.FamilyNames));
        builder.Property(item => item.CategoryNames, property =>
            property.UseDatasetOptions(SchemaDatasetIds.LoadedFamiliesCatalog, SchemaProjectionKeys.CategoryNames));
    }
}

internal static class LoadedFamiliesFilterSchemaDefinitionBootstrapper {
    [ModuleInitializer]
    internal static void Register() =>
        SettingsSchemaDefinitionRegistry.Shared.Register(new LoadedFamiliesFilterSchemaDefinition());
}
