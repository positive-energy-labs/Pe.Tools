using NJsonSchema;
using Pe.Host.Contracts;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

namespace Pe.Host.Services;

internal static class HostJsonSchemaFactory {
    public static SchemaData CreateSchemaData(Type settingsType) {
        var context = CreateProviderContext();
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(
            settingsType,
            CreateOptions(context, false)
        );
        string? fragmentSchemaJson = null;
        try {
            fragmentSchemaJson = JsonSchemaFactory.CreateEditorFragmentSchemaJson(
                settingsType,
                CreateOptions(context, false)
            );
        } catch {
        }

        return new SchemaData(schemaJson, fragmentSchemaJson);
    }

    public static JsonSchema BuildValidationSchema(Type settingsType) =>
        JsonSchemaFactory.BuildAuthoringSchema(
            settingsType,
            CreateOptions(CreateProviderContext(), false)
        );

    private static SettingsProviderContext CreateProviderContext() =>
        new(SettingsCapabilityTier.RevitAssembly);

    private static JsonSchemaBuildOptions CreateOptions(
        SettingsProviderContext context,
        bool resolveExamples
    ) => new(context) {
        ResolveExamples = resolveExamples
    };
}
