using NJsonSchema;

namespace Pe.StorageRuntime.Json;

public delegate bool JsonTypeRegistrationLookup(Type type, out JsonTypeRegistration? registration);

public sealed class JsonTypeRegistration {
    public JsonObjectType SchemaType { get; init; }
    public Type? DiscriminatorType { get; init; }
    public Func<Attribute?, Type?>? ProviderSelector { get; init; }
    public Func<Attribute?, Type?>? ConverterSelector { get; init; }
}
