using NJsonSchema;
using Pe.StorageRuntime.Json;
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

    public static string CreateEditorSchemaJson(
        Type type,
        SettingsProviderContext context,
        bool resolveExamples = false
    ) => JsonSchemaFactory.CreateEditorSchemaJson(
        type,
        CreateOptions(context, resolveExamples)
    );

    public static string CreateEditorFragmentSchemaJson(
        Type itemType,
        SettingsProviderContext context,
        bool resolveExamples = false
    ) => JsonSchemaFactory.CreateEditorFragmentSchemaJson(
        itemType,
        CreateOptions(context, resolveExamples)
    );

    private static JsonSchemaBuildOptions CreateOptions(
        SettingsProviderContext context,
        bool resolveExamples
    ) => new(context) {
        ResolveExamples = resolveExamples
    };
}
