using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Revit.Core.Json.Converters;
using Pe.StorageRuntime.Revit.Core.Json.RevitTypes;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json;

public static class RevitTypeRegistry {
    private static readonly object SyncRoot = new();
    private static readonly Dictionary<Type, JsonTypeRegistration> Registrations = new();
    private static bool Initialized;

    public static void Initialize() {
        if (Initialized)
            return;

        lock (SyncRoot) {
            if (Initialized)
                return;

            Register<ForgeTypeId>(new JsonTypeRegistration {
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
            Register<BuiltInCategory>(new JsonTypeRegistration {
                SchemaType = JsonObjectType.String,
                ProviderSelector = _ => typeof(CategoryNamesProvider),
                ConverterSelector = _ => typeof(BuiltInCategoryConverter)
            });

            Initialized = true;
        }
    }

    private static void Register<T>(JsonTypeRegistration registration) =>
        Registrations[typeof(T)] = registration;

    public static bool TryGet(Type type, out JsonTypeRegistration? registration) {
        Initialize();

        lock (SyncRoot) {
            if (Registrations.TryGetValue(type, out registration))
                return true;

            var matchingType = Registrations.Keys.FirstOrDefault(key =>
                string.Equals(key.FullName, type.FullName, StringComparison.Ordinal) ||
                string.Equals(key.Name, type.Name, StringComparison.Ordinal)
            );
            if (matchingType == null) {
                registration = null;
                return false;
            }

            registration = Registrations[matchingType];
            return true;
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

public class RevitTypeMapper(Type mappedType, JsonTypeRegistration registration) : ITypeMapper {
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
