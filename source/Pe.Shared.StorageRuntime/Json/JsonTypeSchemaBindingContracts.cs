using System.Reflection;
using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using Pe.Shared.StorageRuntime.Json.FieldOptions;

namespace Pe.Shared.StorageRuntime.Json;

public interface IJsonTypeSchemaBinding {
    JsonObjectType SchemaType { get; }
    JsonConverter? CreateConverter(PropertyInfo propertyInfo);
    IFieldOptionsSource? CreateFieldOptionsSource(PropertyInfo propertyInfo);
}

public sealed class JsonTypeBindingTypeMapper(Type mappedType, IJsonTypeSchemaBinding binding) : ITypeMapper {
    public Type MappedType { get; } = mappedType;
    public bool UseReference => false;

    public void GenerateSchema(JsonSchema schema, TypeMapperContext context) {
        schema.Type = binding.SchemaType;
        schema.Properties.Clear();
        schema.AdditionalPropertiesSchema = null;
        schema.AllowAdditionalProperties = false;
    }
}
