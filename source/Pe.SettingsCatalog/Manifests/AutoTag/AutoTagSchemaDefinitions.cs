using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.SettingsCatalog.Manifests.AutoTag;

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
