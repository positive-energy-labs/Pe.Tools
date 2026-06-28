using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Host.Operations;

internal static class HostEndpointMapper {
    public static void MapOperations(WebApplication app) {
        var registry = app.Services.GetRequiredService<HostOperationRegistry>();

        foreach (var operation in registry.Operations.Where(operation => operation.Definition.IsPublicHttp)) {
            _ = operation.Definition.Verb switch {
                HostHttpVerb.Get => app.MapGet(
                    operation.Definition.Route,
                    (HttpContext httpContext, HostOperationExecutor executor, CancellationToken cancellationToken) =>
                        ExecuteAsync(httpContext, operation, executor, cancellationToken)
                ),
                HostHttpVerb.Post => app.MapPost(
                    operation.Definition.Route,
                    (HttpContext httpContext, HostOperationExecutor executor, CancellationToken cancellationToken) =>
                        ExecuteAsync(httpContext, operation, executor, cancellationToken)
                ),
                _ => throw new InvalidOperationException(
                    $"Unsupported HTTP verb '{operation.Definition.Verb}' for route '{operation.Definition.Route}'."
                )
            };
        }
    }

    private static async Task<IResult> ExecuteAsync(
        HttpContext httpContext,
        IHostOperation operation,
        HostOperationExecutor executor,
        CancellationToken cancellationToken
    ) {
        try {
            var request = await BindRequestAsync(httpContext, operation.Definition, cancellationToken);
            return await executor.ExecuteHttpAsync(
                operation,
                request,
                HostOperationContext.Create(httpContext.RequestServices, ResolveRequestId(httpContext)),
                cancellationToken
            );
        } catch (HostOperationException ex) {
            return HostProblemResult.Create(
                ex.StatusCode,
                ex.Message,
                ResolveRequestId(httpContext),
                operation.Definition.Key,
                ex.Issues,
                ex
            );
        }
    }

    private static string ResolveRequestId(HttpContext httpContext) {
        if (httpContext.Request.Headers.TryGetValue("X-Pe-Request-Id", out var requestIds)) {
            var requestId = requestIds.FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(requestId))
                return requestId.Trim();
        }

        return httpContext.TraceIdentifier;
    }

    private static async Task<object> BindRequestAsync(
        HttpContext httpContext,
        HostOperationDefinition definition,
        CancellationToken cancellationToken
    ) {
        var requestType = definition.RequestType;
        if (requestType == typeof(NoRequest)) {
            RejectUnknownQueryKeys(httpContext.Request.Query, new HashSet<string>(StringComparer.OrdinalIgnoreCase), definition);
            return new NoRequest();
        }

        if (HttpMethods.IsGet(httpContext.Request.Method))
            return BindGetRequest(httpContext.Request.Query, requestType, httpContext.RequestServices, definition);

        var jsonOptions = httpContext.RequestServices.GetRequiredService<IOptions<JsonOptions>>();
        return await BindPostRequestAsync(
            httpContext,
            requestType,
            definition,
            jsonOptions.Value.SerializerOptions,
            cancellationToken
        );
    }

    private static async Task<object> BindPostRequestAsync(
        HttpContext httpContext,
        Type requestType,
        HostOperationDefinition definition,
        JsonSerializerOptions serializerOptions,
        CancellationToken cancellationToken
    ) {
        JsonDocument document;
        try {
            document = await JsonDocument.ParseAsync(httpContext.Request.Body, cancellationToken: cancellationToken);
        } catch (JsonException ex) {
            throw CreateRequestValidationException(
                definition,
                [CreateIssue("$", null, "MalformedJson", "Request body is not valid JSON.", ex.Message)]
            );
        }

        using (document) {
            if (document.RootElement.ValueKind != JsonValueKind.Object) {
                throw CreateRequestValidationException(
                    definition,
                    [CreateIssue("$", null, "UnsupportedRequestShape", "Request body must be a JSON object.", $"Pass a {requestType.Name} JSON object.")]
                );
            }

            var issues = new List<ValidationIssue>();
            AddUnknownPropertyIssues(document.RootElement, requestType, "$", definition, issues);
            if (issues.Count != 0)
                throw CreateRequestValidationException(definition, issues);

            try {
                return document.RootElement.Deserialize(requestType, serializerOptions)
                       ?? throw CreateRequestValidationException(
                           definition,
                           [CreateIssue("$", null, "MissingRequestBody", "Request body is required.", $"Pass a {requestType.Name} JSON object.")]
                       );
            } catch (JsonException ex) {
                throw CreateRequestValidationException(
                    definition,
                    [CreateIssue(ex.Path ?? "$", null, "InvalidJsonValue", ex.Message, "Check enum names, value types, and nested request wrappers.")]
                );
            }
        }
    }

    private static object BindGetRequest(
        IQueryCollection query,
        Type requestType,
        IServiceProvider services,
        HostOperationDefinition definition
    ) {
        var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        var knownQueryKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in requestType.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            _ = knownQueryKeys.Add(property.Name);
            _ = knownQueryKeys.Add(ToCamelCase(property.Name));
            if (!TryGetQueryValue(query, property.Name, out var raw))
                continue;

            try {
                values[property.Name] = ConvertQueryValue(raw, property.PropertyType);
            } catch (Exception ex) when (ex is ArgumentException or FormatException or InvalidOperationException) {
                var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                var suggestion = propertyType.IsEnum
                    ? $"Allowed values: {string.Join(", ", Enum.GetNames(propertyType))}."
                    : $"Expected {propertyType.Name}.";
                throw CreateRequestValidationException(
                    definition,
                    [CreateIssue($"/{ToCamelCase(property.Name)}", raw.ToString(), "InvalidQueryValue", $"Invalid query value for '{ToCamelCase(property.Name)}'.", suggestion)]
                );
            }
        }

        RejectUnknownQueryKeys(query, knownQueryKeys, definition);

        var jsonOptions = services.GetRequiredService<IOptions<JsonOptions>>();
        return JsonSerializer.Deserialize(
                   JsonSerializer.Serialize(values, jsonOptions.Value.SerializerOptions),
                   requestType,
                   jsonOptions.Value.SerializerOptions
               )
               ?? throw new InvalidOperationException(
                   $"Failed to bind querystring request for '{requestType.Name}'."
               );
    }

    private static void AddUnknownPropertyIssues(
        JsonElement element,
        Type requestType,
        string path,
        HostOperationDefinition definition,
        List<ValidationIssue> issues
    ) {
        var knownProperties = GetJsonProperties(requestType);
        if (knownProperties.Count == 0)
            return;

        foreach (var jsonProperty in element.EnumerateObject()) {
            if (!knownProperties.TryGetValue(jsonProperty.Name, out var propertyInfo)) {
                issues.Add(CreateIssue(
                    $"{path}.{jsonProperty.Name}",
                    null,
                    "UnknownJsonProperty",
                    $"Unknown request property '{jsonProperty.Name}' is not allowed for operation '{definition.Key}'.",
                    $"Use one of: {string.Join(", ", knownProperties.Keys.OrderBy(key => key, StringComparer.OrdinalIgnoreCase))}."
                ));
                continue;
            }

            var propertyType = Nullable.GetUnderlyingType(propertyInfo.PropertyType) ?? propertyInfo.PropertyType;
            AddInvalidEnumIssues(jsonProperty.Value, propertyType, $"{path}.{jsonProperty.Name}", issues);
            if (jsonProperty.Value.ValueKind == JsonValueKind.Object && IsStrictObjectType(propertyType))
                AddUnknownPropertyIssues(jsonProperty.Value, propertyType, $"{path}.{jsonProperty.Name}", definition, issues);
            else if (jsonProperty.Value.ValueKind == JsonValueKind.Array && IsStrictArrayType(propertyType, out var elementType)) {
                var index = 0;
                foreach (var arrayElement in jsonProperty.Value.EnumerateArray()) {
                    AddInvalidEnumIssues(arrayElement, elementType, $"{path}.{jsonProperty.Name}[{index}]", issues);
                    if (arrayElement.ValueKind == JsonValueKind.Object)
                        AddUnknownPropertyIssues(arrayElement, elementType, $"{path}.{jsonProperty.Name}[{index}]", definition, issues);
                    index++;
                }
            }
        }
    }

    private static void AddInvalidEnumIssues(JsonElement value, Type type, string path, List<ValidationIssue> issues) {
        var enumType = Nullable.GetUnderlyingType(type) ?? type;
        if (!enumType.IsEnum || value.ValueKind != JsonValueKind.String)
            return;

        var attemptedValue = value.GetString();
        if (string.IsNullOrWhiteSpace(attemptedValue) || Enum.TryParse(enumType, attemptedValue, true, out _))
            return;

        issues.Add(CreateIssue(
            path,
            attemptedValue,
            "InvalidEnumValue",
            $"'{attemptedValue}' is not a valid value for {enumType.Name}.",
            $"Allowed values: {string.Join(", ", Enum.GetNames(enumType))}."
        ));
    }

    private static Dictionary<string, PropertyInfo> GetJsonProperties(Type type) {
        var properties = new Dictionary<string, PropertyInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            properties[property.Name] = property;
            properties[ToCamelCase(property.Name)] = property;
            var jsonName = property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name;
            if (!string.IsNullOrWhiteSpace(jsonName))
                properties[jsonName] = property;
        }

        return properties;
    }

    private static bool IsStrictObjectType(Type type) =>
        type != typeof(string)
        && !type.IsPrimitive
        && !type.IsEnum
        && type != typeof(decimal)
        && type != typeof(Guid)
        && type != typeof(DateTimeOffset)
        && !typeof(System.Collections.IEnumerable).IsAssignableFrom(type);

    private static bool IsStrictArrayType(Type type, out Type elementType) {
        elementType = typeof(object);
        if (type.IsArray) {
            elementType = type.GetElementType() ?? typeof(object);
            return IsStrictObjectType(elementType);
        }

        if (!type.IsGenericType)
            return false;

        var genericType = type.GetGenericTypeDefinition();
        if (genericType != typeof(List<>) && genericType != typeof(IReadOnlyList<>) && genericType != typeof(IEnumerable<>))
            return false;

        elementType = type.GetGenericArguments()[0];
        return IsStrictObjectType(elementType);
    }

    private static HostOperationException CreateRequestValidationException(
        HostOperationDefinition definition,
        IReadOnlyList<ValidationIssue> issues
    ) => new(
        StatusCodes.Status400BadRequest,
        $"Invalid request for operation '{definition.Key}'.",
        issues
    );

    private static ValidationIssue CreateIssue(
        string path,
        string? attemptedValue,
        string code,
        string message,
        string? hint
    ) => new(path, attemptedValue, code, "Error", message, hint);

    private static bool TryGetQueryValue(
        IQueryCollection query,
        string propertyName,
        out StringValues value
    ) {
        if (query.TryGetValue(propertyName, out value))
            return true;

        return query.TryGetValue(ToCamelCase(propertyName), out value);
    }

    private static void RejectUnknownQueryKeys(
        IQueryCollection query,
        IReadOnlySet<string> knownQueryKeys,
        HostOperationDefinition definition
    ) {
        var unknownKeys = query.Keys
            .Where(key => !knownQueryKeys.Contains(key))
            .OrderBy(key => key, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (unknownKeys.Count == 0)
            return;

        var expected = knownQueryKeys.Count == 0
            ? "no query parameters"
            : string.Join(", ", knownQueryKeys.OrderBy(key => key, StringComparer.OrdinalIgnoreCase));
        throw new HostOperationException(
            StatusCodes.Status400BadRequest,
            $"Unknown query parameter(s) for operation '{definition.Key}': {string.Join(", ", unknownKeys)}. Expected {expected}.",
            unknownKeys.Select(key => new ValidationIssue(
                $"/{key}",
                null,
                "UnknownQueryParameter",
                "Error",
                $"Unknown query parameter '{key}' is not allowed for operation '{definition.Key}'.",
                $"Use one of: {expected}."
            )).ToList()
        );
    }

    private static string ToCamelCase(string value) => char.ToLowerInvariant(value[0]) + value[1..];

    private static object? ConvertQueryValue(StringValues rawValue, Type targetType) {
        var value = rawValue.ToString();
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var underlyingType = Nullable.GetUnderlyingType(targetType) ?? targetType;
        if (underlyingType == typeof(string))
            return value;
        if (underlyingType == typeof(bool))
            return bool.Parse(value);
        if (underlyingType == typeof(int))
            return int.Parse(value, CultureInfo.InvariantCulture);
        if (underlyingType == typeof(long))
            return long.Parse(value, CultureInfo.InvariantCulture);
        if (underlyingType == typeof(double))
            return double.Parse(value, CultureInfo.InvariantCulture);
        if (underlyingType == typeof(DateTimeOffset))
            return DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);
        if (underlyingType.IsEnum)
            return Enum.Parse(underlyingType, value, true);

        throw new InvalidOperationException(
            $"Unsupported querystring binding type '{underlyingType.Name}'."
        );
    }
}
