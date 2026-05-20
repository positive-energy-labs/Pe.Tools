using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using System.Reflection;

namespace Pe.Revit.SettingsRuntime.Json;

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct)]
public sealed class JsonTypeSchemaBindingAttribute(Type bindingType) : Attribute {
    public Type BindingType { get; } = bindingType;
}

public interface IJsonTypeSchemaBinding {
    JsonObjectType SchemaType { get; }
    JsonConverter? CreateConverter(PropertyInfo propertyInfo);
    void ConfigureTypeSchema(JsonSchema schema, TypeMapperContext context);
    void ConfigurePropertySchema(JsonSchema schema, PropertyInfo propertyInfo, JsonSchemaBuildOptions options);
}

public sealed class JsonTypeBindingTypeMapper(Type mappedType, IJsonTypeSchemaBinding binding) : ITypeMapper {
    public Type MappedType { get; } = mappedType;
    public bool UseReference => false;

    public void GenerateSchema(JsonSchema schema, TypeMapperContext context) =>
        binding.ConfigureTypeSchema(schema, context);
}
