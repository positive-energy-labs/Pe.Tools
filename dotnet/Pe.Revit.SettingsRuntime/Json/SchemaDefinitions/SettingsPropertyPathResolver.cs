using System.Linq.Expressions;
using System.Reflection;

namespace Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;

public static class SettingsPropertyPathResolver {
    public static PropertyInfo ResolveProperty<TSettings, TValue>(
        Expression<Func<TSettings, TValue>> propertyExpression
    ) {
        if (propertyExpression == null)
            throw new ArgumentNullException(nameof(propertyExpression));

        var expression = propertyExpression.Body;
        while (expression is UnaryExpression unaryExpression &&
               unaryExpression.NodeType == ExpressionType.Convert)
            expression = unaryExpression.Operand;

        if (expression is not MemberExpression memberExpression ||
            memberExpression.Member is not PropertyInfo property) {
            throw new ArgumentException(
                "Schema property expressions must target a direct property.",
                nameof(propertyExpression)
            );
        }

        return property;
    }

}

