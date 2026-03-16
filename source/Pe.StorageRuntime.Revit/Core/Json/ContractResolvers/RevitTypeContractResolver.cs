using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Reflection;

namespace Pe.StorageRuntime.Revit.Core.Json.ContractResolvers;

public class RevitTypeContractResolver : OrderedContractResolver {
    protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization) {
        var property = base.CreateProperty(member, memberSerialization);

        if (member is not PropertyInfo propInfo)
            return property;

        var targetType = propInfo.PropertyType;
        if (targetType.IsGenericType) {
            var genericTypeDef = targetType.GetGenericTypeDefinition();
            if (genericTypeDef == typeof(List<>) ||
                genericTypeDef == typeof(IList<>) ||
                genericTypeDef == typeof(ICollection<>) ||
                genericTypeDef == typeof(IEnumerable<>))
                targetType = targetType.GetGenericArguments()[0];
        }

        if (RevitTypeRegistry.TryGet(targetType, out var registration) && registration != null) {
            Type? converterType = null;

            // Check for discriminator-based selection first
            if (registration.DiscriminatorType is { } discriminatorType &&
                registration.ConverterSelector is { } converterSelector) {
                var discriminatorAttr = propInfo.GetCustomAttribute(discriminatorType);
                if (discriminatorAttr != null)
                    converterType = converterSelector(discriminatorAttr);
            }
            // If no discriminator, but has a converter selector, call it with null
            else if (registration.ConverterSelector is { } defaultConverterSelector)
                converterType = defaultConverterSelector(null!);

            if (converterType == null)
                return property;
            var converterInstance = Activator.CreateInstance(converterType);
            if (converterInstance is not JsonConverter converter) {
                throw new InvalidOperationException(
                    $"Converter {converterType.FullName} could not be created."
                );
            }

            if (propInfo.PropertyType != targetType)
                property.ItemConverter = converter;
            else
                property.Converter = converter;
        }

        return property;
    }
}