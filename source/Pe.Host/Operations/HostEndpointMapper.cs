using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Pe.Shared.HostContracts.Operations;
using System.Globalization;
using System.Reflection;
using System.Text.Json;

namespace Pe.Host.Operations;

internal static class HostEndpointMapper {
    public static void MapOperations(WebApplication app) {
        var registry = app.Services.GetRequiredService<HostOperationRegistry>();

        foreach (var operation in registry.Operations) {
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
        var request = await BindRequestAsync(httpContext, operation.Definition.RequestType, cancellationToken);
        return await executor.ExecuteHttpAsync(
            operation,
            request,
            HostOperationContext.Create(httpContext.RequestServices),
            cancellationToken
        );
    }

    private static async Task<object> BindRequestAsync(
        HttpContext httpContext,
        Type requestType,
        CancellationToken cancellationToken
    ) {
        if (requestType == typeof(NoRequest))
            return new NoRequest();

        if (HttpMethods.IsGet(httpContext.Request.Method))
            return BindGetRequest(httpContext.Request.Query, requestType, httpContext.RequestServices);

        var jsonOptions = httpContext.RequestServices.GetRequiredService<IOptions<JsonOptions>>();
        return await httpContext.Request.ReadFromJsonAsync(
                   requestType,
                   jsonOptions.Value.SerializerOptions,
                   cancellationToken
               )
               ?? throw new InvalidOperationException(
                   $"Request body is required for '{httpContext.Request.Path}'."
               );
    }

    private static object BindGetRequest(
        IQueryCollection query,
        Type requestType,
        IServiceProvider services
    ) {
        var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in requestType.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            if (!TryGetQueryValue(query, property.Name, out var raw))
                continue;

            values[property.Name] = ConvertQueryValue(raw, property.PropertyType);
        }

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

    private static bool TryGetQueryValue(
        IQueryCollection query,
        string propertyName,
        out StringValues value
    ) {
        if (query.TryGetValue(propertyName, out value))
            return true;

        var camelCaseName = char.ToLowerInvariant(propertyName[0]) + propertyName[1..];
        return query.TryGetValue(camelCaseName, out value);
    }

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