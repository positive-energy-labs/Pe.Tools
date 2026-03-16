using NJsonSchema;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Context;
using Pe.StorageRuntime.Json;

namespace Pe.StorageRuntime.Revit.Core.Json;

public static class RevitJsonSchemaFactory {
    public static JsonSchema BuildAuthoringSchema(
        Type type,
        SettingsRuntimeCapabilities capabilities,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        bool resolveFieldOptionSamples = true
    ) => JsonSchemaFactory.BuildAuthoringSchema(
        type,
        CreateOptions(capabilities, documentContextAccessor, resolveFieldOptionSamples)
    );

    public static JsonSchema BuildFragmentSchema(
        Type itemType,
        SettingsRuntimeCapabilities capabilities,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        bool resolveFieldOptionSamples = true
    ) => JsonSchemaFactory.BuildFragmentSchema(
        itemType,
        CreateOptions(capabilities, documentContextAccessor, resolveFieldOptionSamples)
    );



    public static JsonSchemaData CreateEditorSchemaData(
        Type type,
        SettingsRuntimeCapabilities capabilities,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        bool resolveFieldOptionSamples = false
    ) => JsonSchemaFactory.CreateEditorSchemaData(
        type,
        CreateOptions(capabilities, documentContextAccessor, resolveFieldOptionSamples)
    );

    private static JsonSchemaBuildOptions CreateOptions(
        SettingsRuntimeCapabilities capabilities,
        ISettingsDocumentContextAccessor? documentContextAccessor,
        bool resolveFieldOptionSamples
    ) => new(capabilities, documentContextAccessor) {
        ResolveFieldOptionSamples = resolveFieldOptionSamples
    };
}
