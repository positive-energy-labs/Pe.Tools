using System.Linq.Expressions;
using System.Reflection;

namespace Pe.Shared.StorageRuntime.Json.SchemaDefinitions;

public static class SettingsPropertyPathResolver {
    public static PropertyInfo ResolveProperty<TSettings, TValue>(
        Expression<Func<TSettings, TValue>> propertyExpression
    ) {
        if (propertyExpression == null)
            throw new ArgumentNullException(nameof(propertyExpression));

        var expression = propertyExpression.Body;
        while (expression is UnaryExpression unaryExpression &&
               unaryExpression.NodeType == ExpressionType.Convert) {
            expression = unaryExpression.Operand;
        }

        if (expression is not MemberExpression memberExpression || memberExpression.Member is not PropertyInfo property)
            throw new ArgumentException(
                "Schema property expressions must target a direct property.",
                nameof(propertyExpression)
            );

        return property;
    }

    public static PropertyInfo? ResolveProperty(Type rootType, string propertyPath) {
        if (rootType == null)
            throw new ArgumentNullException(nameof(rootType));
        if (string.IsNullOrWhiteSpace(propertyPath))
            throw new ArgumentException("Property path is required.", nameof(propertyPath));

        var parts = propertyPath.Split('.');
        var currentType = rootType;
        PropertyInfo? property = null;

        foreach (var part in parts) {
            if (string.Equals(part, "items", StringComparison.OrdinalIgnoreCase)) {
                currentType = UnwrapCollectionItemType(currentType) ?? currentType;
                continue;
            }

            property = currentType.GetProperty(
                part,
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase
            );
            if (property == null)
                return null;

            currentType = UnwrapCollectionItemType(property.PropertyType) ?? property.PropertyType;
        }

        return property;
    }

    private static Type? UnwrapCollectionItemType(Type type) {
        var unwrappedType = Nullable.GetUnderlyingType(type) ?? type;
        if (unwrappedType.IsArray)
            return unwrappedType.GetElementType();
        if (!unwrappedType.IsGenericType)
            return null;

        var genericTypeDefinition = unwrappedType.GetGenericTypeDefinition();
        if (genericTypeDefinition != typeof(List<>) &&
            genericTypeDefinition != typeof(IList<>) &&
            genericTypeDefinition != typeof(ICollection<>) &&
            genericTypeDefinition != typeof(IEnumerable<>) &&
            genericTypeDefinition != typeof(IReadOnlyList<>) &&
            genericTypeDefinition != typeof(IReadOnlyCollection<>)) {
            return null;
        }

        return unwrappedType.GetGenericArguments()[0];
    }
}
