using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using System.Reflection;

namespace Pe.StorageRuntime.Json.SchemaProcessors;

internal static class SchemaDefaultInjector {
    public static JsonSchema ApplyDefaults(JsonSchema schema, Type type) {
        var schemaJObj = JObject.Parse(schema.ToJson());
        ApplyDefaults(schemaJObj, type, false);
        return JsonSchema.FromJsonAsync(schemaJObj.ToString(Formatting.None)).GetAwaiter().GetResult();
    }

    public static JsonSchema ApplyFragmentDefaults(JsonSchema schema, Type itemType) {
        var schemaJObj = JObject.Parse(schema.ToJson());
        ApplyDefaults(schemaJObj, itemType, true);
        return JsonSchema.FromJsonAsync(schemaJObj.ToString(Formatting.None)).GetAwaiter().GetResult();
    }

    private static void ApplyDefaults(JObject schemaJObj, Type type, bool isFragmentRoot) {
        var defaultInstance = DefaultInstanceFactory.TryCreateDefaultInstance(type);
        ApplyDefaultsRecursive(schemaJObj, type, defaultInstance, isFragmentRoot);
    }

    private static void ApplyDefaultsRecursive(
        JObject schemaObject,
        Type currentType,
        object? defaultInstance,
        bool isFragmentRoot
    ) {
        var effectiveType = Nullable.GetUnderlyingType(currentType) ?? currentType;

        if (schemaObject.TryGetValue("properties", out var propertiesToken) &&
            propertiesToken is JObject propertiesObject) {
            foreach (var schemaProperty in propertiesObject.Properties()) {
                var (propertyType, propertyDefault) = ResolvePropertyContext(
                    effectiveType,
                    schemaProperty.Name,
                    defaultInstance,
                    isFragmentRoot
                );
                if (propertyType == null || schemaProperty.Value is not JObject childSchema)
                    continue;

                if (childSchema["default"] == null) {
                    var defaultValue = propertyDefault ?? CreateClrDefault(propertyType);
                    if (TryConvertToToken(defaultValue, out var defaultToken))
                        childSchema["default"] = defaultToken;
                }

                ApplyDefaultsRecursive(childSchema, propertyType, propertyDefault, false);
            }
        }

        if (!schemaObject.TryGetValue("items", out var itemsToken) || itemsToken is not JObject itemSchema)
            return;

        var itemType = ResolveEnumerableItemType(effectiveType);
        if (itemType == null)
            return;

        var itemDefaultInstance = DefaultInstanceFactory.TryCreateDefaultInstance(itemType);
        ApplyDefaultsRecursive(itemSchema, itemType, itemDefaultInstance, false);
    }

    private static (Type? propertyType, object? propertyDefault) ResolvePropertyContext(
        Type declaringType,
        string schemaPropertyName,
        object? defaultInstance,
        bool isFragmentRoot
    ) {
        if (isFragmentRoot && schemaPropertyName.Equals("Items", StringComparison.OrdinalIgnoreCase))
            return (typeof(List<>).MakeGenericType(declaringType), new List<object>());

        var property = ResolvePropertyBySchemaName(declaringType, schemaPropertyName);
        if (property == null)
            return (null, null);

        object? defaultValue = null;
        if (defaultInstance != null) {
            try {
                defaultValue = property.GetValue(defaultInstance);
            } catch {
                defaultValue = null;
            }
        }

        return (property.PropertyType, defaultValue);
    }

    private static PropertyInfo? ResolvePropertyBySchemaName(Type type, string schemaPropertyName) {
        var props = type.GetProperties(BindingFlags.Public | BindingFlags.Instance);
        var byJsonName = props.FirstOrDefault(p =>
            string.Equals(
                p.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName,
                schemaPropertyName,
                StringComparison.OrdinalIgnoreCase
            ));
        if (byJsonName != null)
            return byJsonName;

        return props.FirstOrDefault(p => string.Equals(p.Name, schemaPropertyName, StringComparison.OrdinalIgnoreCase));
    }

    private static Type? ResolveEnumerableItemType(Type type) {
        if (type.IsArray)
            return type.GetElementType();

        if (type.IsGenericType && type.GetGenericArguments().Length == 1)
            return type.GetGenericArguments()[0];

        var enumerableInterface = type.GetInterfaces()
            .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEnumerable<>));
        return enumerableInterface?.GetGenericArguments()[0];
    }

    private static object? CreateClrDefault(Type type) {
        var effectiveType = Nullable.GetUnderlyingType(type) ?? type;
        return effectiveType.IsValueType ? Activator.CreateInstance(effectiveType) : null;
    }

    private static bool TryConvertToToken(object? value, out JToken token) {
        if (value == null) {
            token = JValue.CreateNull();
            return true;
        }

        try {
            token = JToken.FromObject(value, CreateDefaultValueSerializer());
            return true;
        } catch {
            token = JValue.CreateNull();
            return false;
        }
    }

    private static JsonSerializer CreateDefaultValueSerializer() => JsonSerializer.Create(new JsonSerializerSettings {
        NullValueHandling = NullValueHandling.Ignore, Converters = [new StringEnumConverter()]
    });
}