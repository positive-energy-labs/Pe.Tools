using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Reflection;

namespace Pe.StorageRuntime.Json.ContractResolvers;

public class RegisteredTypeContractResolver(JsonTypeRegistrationLookup? registrationLookup = null) : OrderedContractResolver {
    private readonly JsonTypeRegistrationLookup? _registrationLookup = registrationLookup;

    protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization) {
        var property = base.CreateProperty(member, memberSerialization);
        if (member is not PropertyInfo propertyInfo)
            return property;

        var targetType = ResolveTargetType(propertyInfo.PropertyType);
        if (!this.TryGetTypeRegistration(targetType, out var registration) || registration == null)
            return property;

        var converter = CreateConverter(propertyInfo, registration);
        if (converter == null)
            return property;

        if (ShouldUseItemConverter(propertyInfo.PropertyType))
            property.ItemConverter = converter;
        else
            property.Converter = converter;

        return property;
    }

    protected virtual bool TryGetTypeRegistration(Type type, out JsonTypeRegistration? registration) {
        if (this._registrationLookup == null) {
            registration = null;
            return false;
        }

        return this._registrationLookup(type, out registration);
    }

    protected static Type ResolveTargetType(Type propertyType) {
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
            genericTypeDefinition != typeof(IReadOnlyCollection<>)) {

            return unwrappedType;
        }


        return unwrappedType.GetGenericArguments()[0];
    }

    protected static bool ShouldUseItemConverter(Type propertyType) {
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

    private static JsonConverter? CreateConverter(PropertyInfo propertyInfo, JsonTypeRegistration registration) {
        Type? converterType = null;

        if (registration is { DiscriminatorType: { } discriminatorType, ConverterSelector: { } converterSelector }) {
            var discriminatorAttribute = propertyInfo.GetCustomAttribute(discriminatorType);
            if (discriminatorAttribute != null)
                converterType = converterSelector(discriminatorAttribute);
        } else if (registration.ConverterSelector is { } defaultConverterSelector) {
            converterType = defaultConverterSelector(null);
        }


        if (converterType == null)
            return null;

        var converterInstance = Activator.CreateInstance(converterType);
        if (converterInstance is JsonConverter converter)
            return converter;

        throw new InvalidOperationException(
            $"Converter {converterType.FullName} could not be created."
        );
    }
}
