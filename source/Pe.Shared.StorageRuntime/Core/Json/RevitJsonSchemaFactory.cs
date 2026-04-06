using NJsonSchema;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Context;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json;

public static class RevitJsonSchemaFactory {
    public static JsonSchema BuildAuthoringSchema(
        Type type,
        SettingsRuntimeMode runtimeMode,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        bool resolveFieldOptionSamples = true
    ) {
        RevitJsonSchemaModuleInitializer.EnsureRegistered();
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
        RevitJsonSchemaModuleInitializer.EnsureRegistered();
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
        RevitJsonSchemaModuleInitializer.EnsureRegistered();
        return JsonSchemaFactory.CreateEditorSchemaData(
            type,
            CreateOptions(runtimeMode, documentContextAccessor, resolveFieldOptionSamples)
        );
    }

    private static JsonSchemaBuildOptions CreateOptions(
        SettingsRuntimeMode runtimeMode,
        ISettingsDocumentContextAccessor? documentContextAccessor,
        bool resolveFieldOptionSamples
    ) => new(runtimeMode, documentContextAccessor) {
        ResolveFieldOptionSamples = resolveFieldOptionSamples
    };
}
