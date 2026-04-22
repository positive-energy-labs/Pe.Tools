using NJsonSchema;
using Pe.Revit.SettingsRuntime.Context;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Core.Json;

public static class RevitJsonSchemaFactory {
    public static JsonSchema BuildAuthoringSchema(
        Type type,
        SettingsRuntimeMode runtimeMode,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        bool resolveFieldOptionSamples = true
    ) {
        RevitTypeRegistry.Initialize();
        return JsonSchemaFactory.BuildAuthoringSchema(
            type,
            CreateOptions(runtimeMode, documentContextAccessor, resolveFieldOptionSamples)
        );
    }

    public static JsonSchema BuildFragmentSchema(
        Type itemType,
        SettingsRuntimeMode runtimeMode,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        bool resolveFieldOptionSamples = true
    ) {
        RevitTypeRegistry.Initialize();
        return JsonSchemaFactory.BuildFragmentSchema(
            itemType,
            CreateOptions(runtimeMode, documentContextAccessor, resolveFieldOptionSamples)
        );
    }

    public static JsonSchemaData CreateEditorSchemaData(
        Type type,
        SettingsRuntimeMode runtimeMode,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        bool resolveFieldOptionSamples = false
    ) {
        RevitTypeRegistry.Initialize();
        return JsonSchemaFactory.CreateEditorSchemaData(
            type,
            CreateOptions(runtimeMode, documentContextAccessor, resolveFieldOptionSamples)
        );
    }

    private static JsonSchemaBuildOptions CreateOptions(
        SettingsRuntimeMode runtimeMode,
        ISettingsDocumentContextAccessor? documentContextAccessor,
        bool resolveFieldOptionSamples
    ) => new(runtimeMode, documentContextAccessor) { ResolveFieldOptionSamples = resolveFieldOptionSamples };
}