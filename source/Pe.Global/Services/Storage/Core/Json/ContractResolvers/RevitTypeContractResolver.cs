using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Pe.Global.Services.Storage.Core.Json.ContractResolvers;

/// <summary>
///     Contract resolver that applies discriminator-based converters to properties.
///     For ForgeTypeId properties with [ForgeKind] attributes, this applies the
///     appropriate converter (SpecTypeConverter or GroupTypeConverter) based on the discriminator.
/// </summary>
public class RevitTypeContractResolver : OrderedContractResolver {
    protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization) {
        var property = base.CreateProperty(member, memberSerialization);

        if (member is not PropertyInfo propInfo) return property;

        // Get the target type - for collections, get the element type
        var targetType = propInfo.PropertyType;
        if (targetType.IsGenericType) {
            var genericTypeDef = targetType.GetGenericTypeDefinition();
            if (genericTypeDef == typeof(List<>) ||
                genericTypeDef == typeof(IList<>) ||
                genericTypeDef == typeof(ICollection<>) ||
                genericTypeDef == typeof(IEnumerable<>))
                targetType = targetType.GetGenericArguments()[0];
        }

        // Check if property type is registered in RevitTypeRegistry
        if (RevitTypeRegistry.TryGet(targetType, out var registration) && registration != null) {
            Type? converterType = null;

            // If type has discriminator, check for attribute and select converter
            if (registration.DiscriminatorType is { } discriminatorType &&
                registration.ConverterSelector is { } converterSelector) {
                var discriminatorAttr = propInfo.GetCustomAttribute(discriminatorType);
                if (discriminatorAttr != null)
                    converterType = converterSelector(discriminatorAttr);
            }

            // Fall back to default converter if no discriminator or no match
            converterType ??= registration.DefaultConverter;

            // Apply converter to property - use ItemConverter for collections
            if (converterType == null) return property;
            var converterInstance = Activator.CreateInstance(converterType);
            if (converterInstance is not JsonConverter converter)
                throw new InvalidOperationException($"Converter {converterType.FullName} could not be created.");
            if (propInfo.PropertyType != targetType)
                property.ItemConverter = converter;
            else
                property.Converter = converter;
        }

        return property;
    }
}