using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using System.Runtime.CompilerServices;

namespace Pe.Shared.StorageRuntime.AutoTag;

internal sealed class AutoTagConfigurationSchemaDefinition : SettingsSchemaDefinition<AutoTagConfiguration> {
    public override void Configure(ISettingsSchemaBuilder<AutoTagConfiguration> builder) {
        builder.Property(config => config.TagFamilyName, property => property.UseFieldOptions<AnnotationTagFamilyNamesProvider>());
        builder.Property(config => config.TagTypeName, property => property.UseFieldOptions<AnnotationTagTypeNamesProvider>());
    }
}

internal static class AutoTagSchemaDefinitionBootstrapper {
    [ModuleInitializer]
    internal static void Register() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new AutoTagConfigurationSchemaDefinition());
    }
}
