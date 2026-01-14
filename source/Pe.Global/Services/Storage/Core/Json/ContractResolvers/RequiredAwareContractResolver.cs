using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Collections;
using System.ComponentModel.DataAnnotations;
using System.Runtime.CompilerServices;

namespace Pe.Global.Services.Storage.Core.Json.ContractResolvers;

/// <summary>
///     Contract resolver that:
///     1. Applies discriminator-based converters to properties - inherited from RevitTypeContractResolver
///     2. Orders properties by declaration order (respecting inheritance) - inherited from OrderedContractResolver
///     3. Always serializes properties marked with [Required] attribute or 'required' keyword
///     4. Skips serializing non-required properties when they equal their class-defined default values
/// </summary>
public class RequiredAwareContractResolver : RevitTypeContractResolver {
    private readonly Dictionary<Type, object> _defaultInstanceCache = new();

    protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization) {
        var property = base.CreateProperty(member, memberSerialization);

        if (property.PropertyType == null || member is not PropertyInfo propInfo) return property;

        // Check if property is required
        if (this.IsRequiredProperty(propInfo)) {
            // Always serialize required properties, even if they have default values
            property.DefaultValueHandling = DefaultValueHandling.Include;
            return property;
        }

        // For non-required properties, skip when they equal their default value
        var declaringType = propInfo.DeclaringType;
        if (declaringType == null) return property;

        var defaultInstance = this.GetOrCreateDefaultInstance(declaringType);
        if (defaultInstance == null) {
            // If we can't create a default instance, fall back to CLR default handling
            property.DefaultValueHandling = DefaultValueHandling.Ignore;
            return property;
        }

        // Get the default value for this property from the default instance
        var defaultValue = this.GetDefaultValue(propInfo, defaultInstance);

        // Set ShouldSerialize to skip when value equals default
        property.ShouldSerialize = instance => {
            var actualValue = propInfo.GetValue(instance);
            var shouldSerialize = !this.AreValuesEqual(actualValue, defaultValue, propInfo.PropertyType);
            // Debug.WriteLine($"{property.DeclaringType}.{property.PropertyName} {shouldSerialize}");
            return shouldSerialize;
        };

        return property;
    }

    /// <summary>
    ///     Checks if a property is required (either via [Required] attribute or C# 'required' keyword).
    /// </summary>
    private bool IsRequiredProperty(PropertyInfo propertyInfo) {
        // Check for [Required] attribute from System.ComponentModel.DataAnnotations
        if (propertyInfo.GetCustomAttribute<RequiredAttribute>() != null) return true;

        // Check for RequiredMemberAttribute (C# 'required' keyword)
        if (propertyInfo.GetCustomAttribute<RequiredMemberAttribute>() != null) return true;

        return false;
    }

    /// <summary>
    ///     Gets or creates a cached default instance for the given type.
    /// </summary>
    private object GetOrCreateDefaultInstance(Type type) {
        if (this._defaultInstanceCache.TryGetValue(type, out var cached)) return cached;

        var instance = this.TryCreateDefaultInstance(type);
        this._defaultInstanceCache[type] = instance;
        return instance;
    }

    /// <summary>
    ///     Attempts to create a default instance of the type for comparison.
    ///     Handles types with parameterless constructors and types with required properties.
    /// </summary>
    private object? TryCreateDefaultInstance(Type type) {
        try {
            // Try regular parameterless construction first
            return Activator.CreateInstance(type);
        } catch {
            try {
                // For types with required properties, try to find a constructor and pass default values
                var constructors = type.GetConstructors(BindingFlags.Public | BindingFlags.Instance);

                // Try to find the simplest constructor (one that might be generated for records with required properties)
                var constructor = constructors.OrderBy(c => c.GetParameters().Length).FirstOrDefault();
                if (constructor != null) {
                    var parameters = constructor.GetParameters();
                    var paramValues = new object[parameters.Length];

                    for (var i = 0; i < parameters.Length; i++) {
                        var paramType = parameters[i].ParameterType;
                        // Try to create a default value for each parameter
                        paramValues[i] = paramType.IsValueType ? Activator.CreateInstance(paramType) : default;
                    }

                    return constructor.Invoke(paramValues);
                }
            } catch {
                // Ignore and fall through
            }

            // If all else fails, return null (will skip default value comparisons)
            return null;
        }
    }

    /// <summary>
    ///     Gets the default value for a property from the default instance.
    /// </summary>
    private object GetDefaultValue(PropertyInfo propertyInfo, object defaultInstance) {
        try {
            // if (defaultInstance == null) Debug.WriteLine($"property {propertyInfo.Name} is null");
            if (defaultInstance == null) return null;
            return propertyInfo.GetValue(defaultInstance);
        } catch {
            // If we can't get the value, return null (property will be serialized)
            return null;
        }
    }

    /// <summary>
    ///     Compares two values for equality, handling null and collection types properly.
    /// </summary>
    private bool AreValuesEqual(object? value1, object? value2, Type propertyType) {
        // Handle null cases
        if (value1 == null && value2 == null) return true;

        if (value1 == null || value2 == null) return false;

        // Special handling for collections - compare by content, not reference
        if (value1 is IEnumerable enum1 && value2 is IEnumerable enum2) {
            // Don't treat strings as collections
            if (value1 is string || value2 is string) return Equals(value1, value2);

            var list1 = enum1.Cast<object>().ToList();
            var list2 = enum2.Cast<object>().ToList();

            if (list1.Count != list2.Count) return false;

            // For empty collections, consider them equal
            if (list1.Count == 0 && list2.Count == 0) return true;

            // For non-empty collections, compare element by element
            return list1.SequenceEqual(list2);
        }

        // Use EqualityComparer for proper comparison
        var comparerType = typeof(EqualityComparer<>).MakeGenericType(propertyType);
        var defaultComparer = comparerType.GetProperty("Default", BindingFlags.Public | BindingFlags.Static)
            ?.GetValue(null);
        if (defaultComparer == null) return Equals(value1, value2);

        var equalsMethod = comparerType.GetMethod("Equals", new[] { propertyType, propertyType });
        if (equalsMethod != null)
            return (bool)(equalsMethod.Invoke(defaultComparer, new[] { value1, value2 }) ?? false);

        return Equals(value1, value2);
    }
}