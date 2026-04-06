using NJsonSchema;
using NJsonSchema.Generation;

namespace Pe.Shared.StorageRuntime.Json.SchemaProcessors;

public class SchemaOneOfProcessor : ISchemaProcessor {
    public void Process(SchemaProcessorContext context) {
        var type = context.ContextualType.Type;
        var oneOfAttr = type.GetCustomAttributes(typeof(OneOfPropertiesAttribute), false)
            .Cast<OneOfPropertiesAttribute>()
            .FirstOrDefault();

        if (oneOfAttr == null)
            return;

        var schema = context.Schema;
        var propertyNames = oneOfAttr.PropertyNames;
        var existingProps = propertyNames.Where(schema.Properties.ContainsKey).ToList();
        if (existingProps.Count < 2)
            return;

        var notSchema = new JsonSchema();
        foreach (var propName in existingProps)
            notSchema.RequiredProperties.Add(propName);

        schema.Not = notSchema;

        if (!oneOfAttr.AllowNone) {
            foreach (var propName in existingProps) {
                var anyOfSchema = new JsonSchema();
                anyOfSchema.RequiredProperties.Add(propName);
                schema.AnyOf.Add(anyOfSchema);
            }
        }
    }
}

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct)]
public class OneOfPropertiesAttribute(params string[] propertyNames) : Attribute {
    public string[] PropertyNames { get; } = propertyNames;

    public bool AllowNone { get; init; }
}