using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;
using System.Reflection;

namespace Pe.Revit.FamilyFoundry;

public static class FamilyModelSettingsRegistration {
    public const string ModuleKey = "FamilyFoundry";
    public const string RootKey = "models";
    public const string PatchRootKey = "patches";

    public static StructuralSettingsModuleDescriptor Module { get; } = new(
        ModuleKey,
        RootKey,
        [new SettingsRootDescriptor(RootKey, "Family Models"), new SettingsRootDescriptor(PatchRootKey, "Family Patches")],
        SettingsStorageProfiles.SharedAuthoring,
        SettingsModuleHostScope.Session,
        SettingsModuleActiveDocumentKind.Any
    );

    public static ISettingsRootBinding<FamilyModel> Root { get; } =
        new SettingsRootBinding<FamilyModel>(Module, RootKey);

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static ISettingsRootBinding<FamilyPatch> PatchRoot { get; } =
        new SettingsRootBinding<FamilyPatch>(Module, PatchRootKey);

    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Root, PatchRoot];

    /// <summary>Registers the strict validator and tells the schema generator that the slot-grammar structs are strings.</summary>
    public static void RegisterValidator() {
        SettingsDocumentValidatorRegistry.Shared.Register<FamilyModel>(Validate);
        SettingsDocumentValidatorRegistry.Shared.Register<FamilyPatch>(ValidatePatch);
        foreach (var slot in new[] { typeof(PortableLength), typeof(PortableAngle), typeof(PortableValue) })
            JsonTypeSchemaBindingRegistry.Shared.Register(slot, StringSlotSchemaBinding.Instance);
    }

    private static IReadOnlyList<SettingsDocumentValidationIssue> ValidatePatch(SettingsDocumentValidationContext context) {
        try {
            _ = FamilyPatch.Parse(context.ComposedContent);
            return [];
        } catch (Newtonsoft.Json.JsonException ex) {
            return [new SettingsDocumentValidationIssue("$", FamilyModelDiagnosticCodes.InvalidJson, "error", ex.Message)];
        }
    }

    private static IReadOnlyList<SettingsDocumentValidationIssue> Validate(
        SettingsDocumentValidationContext context
    ) {
        var raw = FamilyModelJson.Parse(context.RawContent);
        var result = raw.Value == null
            ? raw
            : FamilyModelJson.Parse(context.ComposedContent);
        return result.Diagnostics
            .Select(issue => new SettingsDocumentValidationIssue(
                issue.Path,
                issue.Code,
                "error",
                issue.Message))
            .ToList();
    }
}

/// <summary>
///     A <see cref="PortableLength" />/<see cref="PortableAngle" />/<see cref="PortableValue" /> is one JSON
///     string parsed by its own converter; the generator must not expand the record struct into an object.
/// </summary>
internal sealed class StringSlotSchemaBinding : IJsonTypeSchemaBinding {
    public static readonly StringSlotSchemaBinding Instance = new();

    public JsonObjectType SchemaType => JsonObjectType.String;

    public JsonConverter? CreateConverter(PropertyInfo propertyInfo) => null;

    public void ConfigureTypeSchema(JsonSchema schema, TypeMapperContext context) => AsString(schema, false);

    public void ConfigurePropertySchema(JsonSchema schema, PropertyInfo propertyInfo, JsonSchemaBuildOptions options) {
        var nullable = schema.OneOf.Any(c => c.Type == JsonObjectType.Null) || Nullable.GetUnderlyingType(propertyInfo.PropertyType) != null;
        if (schema.HasReference) schema.Reference = null;
        AsString(schema, nullable);
    }

    private static void AsString(JsonSchema schema, bool nullable) {
        schema.Type = nullable ? JsonObjectType.String | JsonObjectType.Null : JsonObjectType.String;
        schema.OneOf.Clear();
        schema.AnyOf.Clear();
        schema.AllOf.Clear();
        schema.Properties.Clear();
        schema.Item = null;
        schema.AdditionalPropertiesSchema = null;
        schema.AllowAdditionalProperties = false;
    }
}
