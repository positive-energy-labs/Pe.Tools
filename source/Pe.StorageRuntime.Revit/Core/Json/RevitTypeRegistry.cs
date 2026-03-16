using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using Pe.StorageRuntime.Revit.Core.Json.Converters;
using Pe.StorageRuntime.Revit.Core.Json.RevitTypes;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json;

public class TypeRegistration {
    public JsonObjectType SchemaType { get; init; }
    public Type? DiscriminatorType { get; init; }
    public Func<Attribute, Type?>? ProviderSelector { get; init; }
    public Func<Attribute, Type?>? ConverterSelector { get; init; }
}

public static class RevitTypeRegistry {
    private static readonly object SyncRoot = new();
    private static readonly Dictionary<Type, TypeRegistration> Registrations = new();
    private static bool Initialized;

    public static void Initialize() {
        if (Initialized)
            return;

        lock (SyncRoot) {
            if (Initialized)
                return;

            Register<ForgeTypeId>(new TypeRegistration {
                SchemaType = JsonObjectType.String,
                DiscriminatorType = typeof(ForgeKindAttribute),
                ProviderSelector = attr => attr switch {
                    ForgeKindAttribute { Kind: ForgeKind.Spec } => typeof(SpecNamesProvider),
                    ForgeKindAttribute { Kind: ForgeKind.Group } => typeof(PropertyGroupNamesProvider),
                    _ => null
                },
                ConverterSelector = attr => attr switch {
                    ForgeKindAttribute { Kind: ForgeKind.Spec } => typeof(SpecTypeConverter),
                    ForgeKindAttribute { Kind: ForgeKind.Group } => typeof(GroupTypeConverter),
                    _ => null
                }
            });

            // Built-in categories round-trip without a live document.
            Register<BuiltInCategory>(new TypeRegistration {
                SchemaType = JsonObjectType.String,
                ProviderSelector = _ => typeof(CategoryNamesProvider),
                ConverterSelector = _ => typeof(BuiltInCategoryConverter)
            });

            Initialized = true;
        }
    }

    private static void Register<T>(TypeRegistration registration) =>
        Registrations[typeof(T)] = registration;

    public static bool TryGet(Type type, out TypeRegistration? registration) {
        lock (SyncRoot) {
            if (Registrations.TryGetValue(type, out registration))
                return true;

            registration = Registrations.Values.FirstOrDefault(_ =>
                Registrations.Keys.Any(key => key.Name == type.Name));
            return registration != null;
        }
    }

    public static void Clear() {
        lock (SyncRoot) {
            Registrations.Clear();
            Initialized = false;
        }
    }

    public static IEnumerable<ITypeMapper> CreateTypeMappers() {
        Initialize();
        lock (SyncRoot) return Registrations.Select(kvp => new RevitTypeMapper(kvp.Key, kvp.Value)).ToArray();
    }
}

public class RevitTypeMapper(Type mappedType, TypeRegistration registration) : ITypeMapper {
    private readonly JsonObjectType _schemaType = registration.SchemaType;

    public Type MappedType { get; } = mappedType;
    public bool UseReference => false;

    public void GenerateSchema(JsonSchema schema, TypeMapperContext context) {
        schema.Type = this._schemaType;
        schema.Properties.Clear();
        schema.AdditionalPropertiesSchema = null;
        schema.AllowAdditionalProperties = false;
    }
}