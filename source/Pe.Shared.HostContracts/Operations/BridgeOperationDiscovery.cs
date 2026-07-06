using System.Collections.Concurrent;
using System.Reflection;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     Marks a static method as a bridge operation. Required signature:
///     <c>static Task&lt;TResponse&gt; Method(TRequest request, IBridgeOperationContext context, CancellationToken ct)</c>.
///     For ops with rich agent metadata (request examples, call guidance), declare a static
///     <see cref="BridgeOp" /> field instead — fields self-register by type, no attribute needed.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class BridgeOperationAttribute(string key) : Attribute {
    public string Key { get; } = key;
    public string? DisplayName { get; init; }
    public string? Description { get; init; }
    public string[]? SearchTerms { get; init; }
    public HostOperationIntent Intent { get; init; } = HostOperationIntent.Read;
    public bool RequiresActiveDocument { get; init; } = true;
}

/// <summary>
///     The runtime operation registry — the only catalog. Populated by scanning loaded Pe.*
///     assemblies for static <see cref="BridgeOp" /> fields/properties and
///     <see cref="BridgeOperationAttribute" /> methods. Dispatch, /ops, and typegen all read here.
/// </summary>
public static class BridgeOpRegistry {
    private static readonly ConcurrentDictionary<string, BridgeOp> Registered = new(StringComparer.Ordinal);

    public static IEnumerable<BridgeOp> All =>
        Registered.Values.OrderBy(op => op.Key, StringComparer.Ordinal);

    public static bool TryGet(string key, out BridgeOp op) => Registered.TryGetValue(key, out op!);

    public static void Register(BridgeOp op) {
        ValidateOperation(op);
        if (!Registered.TryAdd(op.Key, op) && !ReferenceEquals(Registered[op.Key], op))
            throw new InvalidOperationException($"Bridge op '{op.Key}' is registered twice with different definitions.");
    }

    /// <summary>Scans loaded Pe.* assemblies for bridge operations. Idempotent.</summary>
    public static int RegisterFromLoadedPeAssemblies() =>
        RegisterFrom(
            AppDomain.CurrentDomain.GetAssemblies()
                .Where(assembly => !assembly.IsDynamic)
                .Where(assembly =>
                    assembly.GetName().Name?.StartsWith("Pe.", StringComparison.Ordinal) == true)
                .ToArray()
        );

    public static int RegisterFrom(params Assembly[] assemblies) {
        var registeredCount = 0;
        foreach (var assembly in assemblies) {
            foreach (var type in EnumerateTypes(assembly)) {
                foreach (var op in EnumerateDeclaredOps(type)) {
                    Register(op);
                    registeredCount++;
                }

                foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)) {
                    var attribute = method.GetCustomAttribute<BridgeOperationAttribute>();
                    if (attribute == null)
                        continue;

                    Register(CreateOpFromMethod(attribute, method));
                    registeredCount++;
                }
            }
        }

        return registeredCount;
    }

    private static IEnumerable<Type> EnumerateTypes(Assembly assembly) {
        try {
            return assembly.GetTypes();
        } catch (ReflectionTypeLoadException ex) {
            return ex.Types.Where(type => type != null).Cast<Type>();
        }
    }

    private static IEnumerable<BridgeOp> EnumerateDeclaredOps(Type type) {
        const BindingFlags staticMembers = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
        foreach (var field in type.GetFields(staticMembers)) {
            if (field.FieldType == typeof(BridgeOp) && field.GetValue(null) is BridgeOp op)
                yield return op;
        }

        foreach (var property in type.GetProperties(staticMembers)) {
            if (property.PropertyType == typeof(BridgeOp) &&
                property.GetIndexParameters().Length == 0 &&
                property.GetValue(null) is BridgeOp op)
                yield return op;
        }
    }

    private static BridgeOp CreateOpFromMethod(BridgeOperationAttribute attribute, MethodInfo method) {
        var parameters = method.GetParameters();
        var isValidSignature =
            parameters.Length == 3 &&
            parameters[1].ParameterType == typeof(IBridgeOperationContext) &&
            parameters[2].ParameterType == typeof(CancellationToken) &&
            method.ReturnType.IsGenericType &&
            method.ReturnType.GetGenericTypeDefinition() == typeof(Task<>);
        if (!isValidSignature)
            throw new InvalidOperationException(
                $"[BridgeOperation(\"{attribute.Key}\")] on '{method.DeclaringType?.FullName}.{method.Name}' must be " +
                "static Task<TResponse> (TRequest, IBridgeOperationContext, CancellationToken)."
            );

        var requestType = parameters[0].ParameterType;
        var responseType = method.ReturnType.GetGenericArguments()[0];
        var handlerType = typeof(Func<,,,>).MakeGenericType(
            requestType,
            typeof(IBridgeOperationContext),
            typeof(CancellationToken),
            method.ReturnType
        );
        var handler = method.CreateDelegate(handlerType);
        var metadata = HostOperationAgentMetadata.Create(
            attribute.Description ?? attribute.DisplayName ?? attribute.Key,
            attribute.SearchTerms,
            attribute.Intent,
            attribute.RequiresActiveDocument
        );
        var create = typeof(BridgeOp)
            .GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Single(candidate => candidate.Name == nameof(BridgeOp.Create))
            .MakeGenericMethod(requestType, responseType);
        return (BridgeOp)create.Invoke(null, [attribute.Key, attribute.DisplayName, metadata, handler])!;
    }

    // Key taxonomy + metadata budget rules, enforced on every registration.
    private static void ValidateOperation(BridgeOp op) {
        var definition = op.Definition;
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(definition.Key) || definition.RequestType == null || definition.ResponseType == null)
            errors.Add($"{definition.Key}: incomplete definition (key/request/response required).");

        var metadata = definition.AgentMetadata;
        if (metadata.CallGuidance.Count > 2)
            errors.Add($"{definition.Key}: CallGuidance has {metadata.CallGuidance.Count} entries; max 2.");
        if (metadata.RequestExamples.Count > 2)
            errors.Add($"{definition.Key}: RequestExamples has {metadata.RequestExamples.Count} entries; max 2.");

        if (definition.IsPublic) {
            var dotIndex = definition.Key.IndexOf(".", StringComparison.Ordinal);
            var topLevel = dotIndex < 0 ? definition.Key : definition.Key[..dotIndex];
            if (topLevel is "rvt" or "rfa" or "rvtrfa")
                errors.Add($"{definition.Key}: document kind must be metadata, not a top-level route family.");
            if (definition.Key.StartsWith("revit.", StringComparison.Ordinal) && !IsValidPublicRevitKey(definition.Key))
                errors.Add($"{definition.Key}: Revit public keys must follow revit.<layer>.<noun>[.<variant>].");
        }

        if (errors.Count != 0)
            throw new InvalidOperationException(
                $"Invalid bridge operation:{Environment.NewLine}  {string.Join($"{Environment.NewLine}  ", errors)}"
            );
    }

    private static bool IsValidPublicRevitKey(string key) {
        var parts = key.Split('.');
        if (parts.Length is < 3 or > 4)
            return false;
        if (!string.Equals(parts[0], "revit", StringComparison.Ordinal))
            return false;
        return parts[1] is "context" or "catalog" or "matrix" or "detail" or "resolve" or "apply"
            && !string.IsNullOrWhiteSpace(parts[2])
            && (parts.Length == 3 || !string.IsNullOrWhiteSpace(parts[3]));
    }
}

public sealed record HostOpsCatalogEntry(
    string Key,
    string? DisplayName,
    string Intent,
    string CostTier,
    string Visibility,
    bool RequiresActiveDocument,
    string Description,
    IReadOnlyList<string> SearchTerms,
    IReadOnlyList<HostOperationRequestExample> RequestExamples,
    string? SafeDefaultRequestJson,
    IReadOnlyList<string> CallGuidance,
    string RequestSchemaJson,
    string ResponseSchemaJson
);

public sealed record HostOpsCatalogData(
    IReadOnlyList<HostOpsCatalogEntry> Operations
);
