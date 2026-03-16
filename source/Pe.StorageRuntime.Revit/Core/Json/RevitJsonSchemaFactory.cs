using NJsonSchema;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.SchemaProviders;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json;

public static class RevitJsonSchemaFactory {
    public static JsonSchema BuildAuthoringSchema(
        Type type,
        SettingsProviderContext context,
        bool resolveExamples = true
    ) => JsonSchemaFactory.BuildAuthoringSchema(
        type,
        CreateOptions(context, resolveExamples)
    );

    public static JsonSchema BuildFragmentSchema(
        Type itemType,
        SettingsProviderContext context,
        bool resolveExamples = true
    ) => JsonSchemaFactory.BuildFragmentSchema(
        itemType,
        CreateOptions(context, resolveExamples)
    );



    public static JsonSchemaData CreateEditorSchemaData(
        Type type,
        SettingsProviderContext context,
        bool resolveExamples = false
    ) => JsonSchemaFactory.CreateEditorSchemaData(
        type,
        CreateOptions(context, resolveExamples)
    );

    private static JsonSchemaBuildOptions CreateOptions(
        SettingsProviderContext context,
        bool resolveExamples
    ) => new(context) {
        ResolveExamples = resolveExamples
    };
}
