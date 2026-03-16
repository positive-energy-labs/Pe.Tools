using NJsonSchema.NewtonsoftJson.Generation;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProcessors;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.StorageRuntime.Revit.Core.Json;

internal sealed class RevitJsonSchemaCapabilityAugmenter : IJsonSchemaCapabilityAugmenter {
    public void Configure(
        NewtonsoftJsonSchemaGeneratorSettings settings,
        SettingsCapabilityTier availableCapabilityTier,
        SettingsProviderContext providerContext
    ) {
        if (availableCapabilityTier < SettingsCapabilityTier.RevitAssembly)
            return;

        RevitTypeRegistry.Initialize();
        foreach (var mapper in RevitTypeRegistry.CreateTypeMappers())
            settings.TypeMappers.Add(mapper);

        settings.SchemaProcessors.Add(new RevitTypeSchemaProcessor(
            availableCapabilityTier,
            providerContext
        ));
    }
}

internal static class RevitJsonSchemaModuleInitializer {
    [ModuleInitializer]
    internal static void RegisterAugmenter() {
        JsonSchemaFactory.RegisterAugmenter(new RevitJsonSchemaCapabilityAugmenter());
    }
}
