using NJsonSchema;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json;

public static class RevitJsonSchemaFactory {
    public static JsonSchema BuildAuthoringSchema(
        Type type,
        SettingsRuntimeMode runtimeMode,
        bool resolveFieldOptionSamples = true
    ) {
        RevitTypeRegistry.Initialize();
        return JsonSchemaFactory.BuildAuthoringSchema(
            type,
            CreateOptions(runtimeMode, resolveFieldOptionSamples)
        );
    }

    public static JsonSchema BuildFragmentSchema(
        Type itemType,
        SettingsRuntimeMode runtimeMode,
        bool resolveFieldOptionSamples = true
    ) {
        RevitTypeRegistry.Initialize();
        return JsonSchemaFactory.BuildFragmentSchema(
            itemType,
            CreateOptions(runtimeMode, resolveFieldOptionSamples)
        );
    }

    public static JsonSchemaData CreateEditorSchemaData(
        Type type,
        SettingsRuntimeMode runtimeMode,
        bool resolveFieldOptionSamples = false,
        Document? document = null
    ) {
        RevitTypeRegistry.Initialize();
        return JsonSchemaFactory.CreateEditorSchemaData(
            type,
            CreateOptions(runtimeMode, resolveFieldOptionSamples, document)
        );
    }

    private static JsonSchemaBuildOptions CreateOptions(
        SettingsRuntimeMode runtimeMode,
        bool resolveFieldOptionSamples,
        Document? document = null
    ) => new(runtimeMode, document) { ResolveValueDomainSamples = resolveFieldOptionSamples };
}
