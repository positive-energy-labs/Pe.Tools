using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;
using System.Reflection;

namespace Pe.Revit.FamilyFoundry;

/// <summary>One module: `FamilyFoundry`, roots `models` (family.json) and `patches` (patch.json).</summary>
public static class FamilyModelSettingsRegistration {
    static FamilyModelSettingsRegistration() => RegisterValidator();

    public const string ModuleKey = "FamilyFoundry";
    public const string RootKey = "models";
    public const string PatchRootKey = "patches";

    public static StructuralSettingsModuleDescriptor Module { get; } = new(
        ModuleKey,
        [new SettingsRootDescriptor(RootKey, "Family Models"), new SettingsRootDescriptor(PatchRootKey, "Family Patches")]
    );

    public static ISettingsRootBinding<FamilyModel> Root { get; } =
        new SettingsRootBinding<FamilyModel>(Module, RootKey);

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static ISettingsRootBinding<FamilyPatch> PatchRoot { get; } =
        new SettingsRootBinding<FamilyPatch>(Module, PatchRootKey);

    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Root, PatchRoot];

    /// <summary>Registers the strict validator and tells the schema generator that the slot-grammar structs are strings.</summary>
    private static void RegisterValidator() {
        SettingsDocumentValidatorRegistry.Shared.Register<FamilyModel>(Validate);
        SettingsDocumentValidatorRegistry.Shared.Register<FamilyPatch>(ValidatePatch);
        foreach (var slot in new[] { typeof(PortableLength), typeof(PortableAngle) })
            JsonTypeSchemaBindingRegistry.Shared.Register(slot, ScalarSlotSchemaBinding.String);
        JsonTypeSchemaBindingRegistry.Shared.Register(typeof(PortableValue), ScalarSlotSchemaBinding.Value);
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
        try {
            _ = JToken.Parse(context.RawContent, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
        } catch (JsonException ex) {
            return [new SettingsDocumentValidationIssue("$", FamilyModelDiagnosticCodes.InvalidJson, "error", ex.Message)];
        }
        var result = FamilyModelJson.Parse(context.ComposedContent);
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
///     scalar parsed by its own converter; the generator must not expand the record struct into an object.
/// </summary>
internal sealed class ScalarSlotSchemaBinding(JsonObjectType types) : IJsonTypeSchemaBinding {
    public static readonly ScalarSlotSchemaBinding String = new(JsonObjectType.String);
    public static readonly ScalarSlotSchemaBinding Value = new(JsonObjectType.String | JsonObjectType.Number | JsonObjectType.Boolean | JsonObjectType.Object);

    public JsonObjectType SchemaType => types;

    public JsonConverter? CreateConverter(PropertyInfo propertyInfo) => null;

    public void ConfigureTypeSchema(JsonSchema schema, TypeMapperContext context) => Configure(schema, false);

    public void ConfigurePropertySchema(JsonSchema schema, PropertyInfo propertyInfo, JsonSchemaBuildOptions options) {
        var nullable = schema.OneOf.Any(c => c.Type == JsonObjectType.Null) || Nullable.GetUnderlyingType(propertyInfo.PropertyType) != null;
        if (schema.HasReference) schema.Reference = null;
        Configure(schema, nullable);
    }

    private void Configure(JsonSchema schema, bool nullable) {
        schema.Type = nullable ? types | JsonObjectType.Null : types;
        schema.OneOf.Clear();
        schema.AnyOf.Clear();
        schema.AllOf.Clear();
        schema.Properties.Clear();
        schema.Item = null;
        schema.AdditionalPropertiesSchema = null;
        schema.AllowAdditionalProperties = false;
    }
}
