using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.Generation.TypeMappers;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using System.Collections.Concurrent;
using System.Reflection;

namespace Pe.StorageRuntime.Json;

public sealed class JsonTypeSchemaBindingRegistry {
    private readonly ConcurrentDictionary<Type, IJsonTypeSchemaBinding> _bindings = new();

    public static JsonTypeSchemaBindingRegistry Shared { get; } = new();

    public void Register(Type type, IJsonTypeSchemaBinding binding) {
        if (type == null)
            throw new ArgumentNullException(nameof(type));
        if (binding == null)
            throw new ArgumentNullException(nameof(binding));
        this._bindings[type] = binding;
    }

    public bool TryGet(Type type, out IJsonTypeSchemaBinding binding) {
        if (type == null)
            throw new ArgumentNullException(nameof(type));

        if (this._bindings.TryGetValue(type, out binding!))
            return true;

        var match = this._bindings.Keys.FirstOrDefault(registeredType => registeredType == type ||
                                                                         string.Equals(registeredType.FullName,
                                                                             type.FullName, StringComparison.Ordinal) ||
                                                                         string.Equals(registeredType.Name, type.Name,
                                                                             StringComparison.Ordinal));
        if (match == null) {
            binding = null!;
            return false;
        }

        binding = this._bindings[match];
        return true;
    }

    public IEnumerable<ITypeMapper> CreateTypeMappers() =>
        this._bindings.Select(binding => new JsonTypeBindingTypeMapper(binding.Key, binding.Value)).ToArray();

    public void Clear() => this._bindings.Clear();

    public bool TryResolveFieldOptionsSource(PropertyInfo propertyInfo, out IFieldOptionsSource source) {
        if (propertyInfo == null)
            throw new ArgumentNullException(nameof(propertyInfo));

        var targetType = ResolveTargetType(propertyInfo.PropertyType);
        if (!this.TryGet(targetType, out var binding)) {
            source = null!;
            return false;
        }

        source = binding.CreateFieldOptionsSource(propertyInfo)!;
        return source != null;
    }

    public void ApplyPropertyBindings(
        SchemaProcessorContext context,
        JsonSchemaBuildOptions options
    ) {
        var actualSchema = context.Schema.HasReference ? context.Schema.Reference : context.Schema;
        if (actualSchema == null)
            return;

        foreach (var property in context.ContextualType.Type.GetProperties()) {
            var usesItemBinding = ShouldUseItemBinding(property.PropertyType);
            if (!this.TryGet(ResolveTargetType(property.PropertyType), out var binding))
                continue;

            var propertyName = property.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName ??
                               property.Name;
            if (!actualSchema.Properties.TryGetValue(propertyName, out var propertySchema))
                continue;

            var targetSchema = usesItemBinding && propertySchema.Item != null
                ? propertySchema.Item
                : propertySchema;
            ConvertPropertySchema(targetSchema, binding.SchemaType);

            var source = binding.CreateFieldOptionsSource(property);
            if (source == null)
                continue;

            var descriptor = source.Describe();
            IReadOnlyList<FieldOptionItem>? samples = null;
            if (options.ResolveFieldOptionSamples &&
                options.RuntimeMode.Supports(descriptor.RequiredRuntimeMode)) {
                try {
                    samples = source.GetOptionsAsync(options.CreateFieldOptionsExecutionContext())
                        .AsTask()
                        .GetAwaiter()
                        .GetResult();
                } catch {
                }
            }

            SchemaMetadataWriter.ApplyFieldOptions(targetSchema, descriptor, samples);

            if (samples == null || samples.Count == 0)
                continue;

            targetSchema.Enumeration.Clear();
            foreach (var sample in samples)
                targetSchema.Enumeration.Add(JToken.FromObject(sample.Value));
        }
    }

    private static void ConvertPropertySchema(JsonSchema propertySchema, JsonObjectType schemaType) {
        if (propertySchema.HasReference)
            propertySchema.Reference = null;

        var isNullable = propertySchema.OneOf.Any(schema => schema.Type == JsonObjectType.Null);
        propertySchema.OneOf.Clear();
        propertySchema.Type = isNullable ? schemaType | JsonObjectType.Null : schemaType;
        propertySchema.Properties.Clear();
        propertySchema.AdditionalPropertiesSchema = null;
    }

    private static Type ResolveTargetType(Type propertyType) {
        var unwrappedType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (unwrappedType.IsArray)
            return unwrappedType.GetElementType() ?? unwrappedType;
        if (!unwrappedType.IsGenericType)
            return unwrappedType;

        var genericTypeDefinition = unwrappedType.GetGenericTypeDefinition();
        if (genericTypeDefinition != typeof(List<>) &&
            genericTypeDefinition != typeof(IList<>) &&
            genericTypeDefinition != typeof(ICollection<>) &&
            genericTypeDefinition != typeof(IEnumerable<>) &&
            genericTypeDefinition != typeof(IReadOnlyList<>) &&
            genericTypeDefinition != typeof(IReadOnlyCollection<>))
            return unwrappedType;

        return unwrappedType.GetGenericArguments()[0];
    }

    private static bool ShouldUseItemBinding(Type propertyType) {
        var unwrappedType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (unwrappedType.IsArray)
            return true;
        if (!unwrappedType.IsGenericType)
            return false;

        var genericTypeDefinition = unwrappedType.GetGenericTypeDefinition();
        return genericTypeDefinition == typeof(List<>) ||
               genericTypeDefinition == typeof(IList<>) ||
               genericTypeDefinition == typeof(ICollection<>) ||
               genericTypeDefinition == typeof(IEnumerable<>) ||
               genericTypeDefinition == typeof(IReadOnlyList<>) ||
               genericTypeDefinition == typeof(IReadOnlyCollection<>);
    }
}
