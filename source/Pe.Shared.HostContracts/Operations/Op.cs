using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.ExceptionServices;

namespace Pe.Shared.HostContracts.Operations;

public enum OpIntent {
    Read,
    Mutate
}

public enum OpCost {
    Cheap,
    Bounded,
    Expensive,
    Mutation
}

public enum OpTier {
    Default,
    Escalation,
    Expert
}

public enum OpThread {
    Any,
    Revit
}

[AttributeUsage(AttributeTargets.Method)]
public sealed class OpAttribute(string key) : Attribute {
    public string Key { get; } = key;
    public string? Title { get; init; }
    public required string Does { get; init; }
    public string[]? Finds { get; init; }
    public OpIntent Intent { get; init; } = OpIntent.Read;
    public OpCost Cost { get; init; } = OpCost.Cheap;
    public OpTier Tier { get; init; } = OpTier.Escalation;
    public string? Example { get; init; }
    public bool IsPublic { get; init; } = true;
    public OpThread Thread { get; init; } = OpThread.Any;
}

public sealed class Op {
    private static readonly JsonSerializerSettings JsonSettings = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false,
                OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };

    private readonly MethodInfo _method;
    private readonly object? _target;

    internal Op(HostOperationDefinition definition, MethodInfo method, object? target, OpThread thread) {
        this.Definition = definition;
        this._method = method;
        this._target = target;
        this.Thread = definition.Needs == OpNeeds.Nothing ? thread : OpThread.Revit;
    }

    public HostOperationDefinition Definition { get; }
    public string Key => this.Definition.Key;
    public OpThread Thread { get; }

    internal bool SameHandler(Op other) => this._method == other._method;

    public async Task<object?> ExecuteAsync(string payloadJson, object? document, CancellationToken cancellationToken) {
        object? request;
        try {
            request = JsonConvert.DeserializeObject(payloadJson, this.Definition.RequestType, JsonSettings);
        } catch (JsonException exception) {
            throw BridgeOperationExceptions.BadRequest(
                $"Bridge op '{this.Key}': request does not match {this.Definition.RequestType.Name}: {exception.Message}"
            );
        }

        if (request is null)
            throw BridgeOperationExceptions.BadRequest(
                $"Bridge op '{this.Key}': request payload is null or empty; expected {this.Definition.RequestType.Name}."
            );
        if (!this._method.IsStatic && this._target == null)
            throw new InvalidOperationException($"Bridge op '{this.Key}' has no bound handler instance.");

        var arguments = new List<object?> { request };
        if (this.Definition.Needs != OpNeeds.Nothing)
            arguments.Add(document ?? throw new InvalidOperationException($"Bridge op '{this.Key}' has no resolved document."));
        if (this._method.GetParameters().Last().ParameterType == typeof(CancellationToken))
            arguments.Add(cancellationToken);
        object? result;
        try {
            result = this._method.Invoke(this._target, arguments.ToArray());
        } catch (TargetInvocationException exception) when (exception.InnerException != null) {
            ExceptionDispatchInfo.Capture(exception.InnerException).Throw();
            throw;
        }

        if (result is not Task task)
            return result;

        await task.ConfigureAwait(false);
        return task.GetType().GetProperty(nameof(Task<object>.Result))!.GetValue(task);
    }
}

public static class OpRegistry {
    private static readonly ConcurrentDictionary<string, Op> Registered = new(StringComparer.Ordinal);

    public static IEnumerable<Op> All => Registered.Values.OrderBy(op => op.Key, StringComparer.Ordinal);

    public static bool TryGet(string key, out Op op) => Registered.TryGetValue(key, out op!);

    public static int RegisterFromLoadedPeAssemblies() => RegisterFrom(
        AppDomain.CurrentDomain.GetAssemblies()
            .Where(assembly => !assembly.IsDynamic)
            .Where(assembly => assembly.GetName().Name?.StartsWith("Pe.", StringComparison.Ordinal) == true)
            // A type can only declare [Op] methods when its assembly directly references this
            // contract assembly. Avoid reflecting across unrelated feature assemblies: optional
            // feature dependencies need not load merely because the host bridge reconnects.
            .Where(assembly => ReferenceEquals(assembly, typeof(OpRegistry).Assembly)
                || assembly.GetReferencedAssemblies().Any(reference =>
                    string.Equals(reference.Name,
                        typeof(OpRegistry).Assembly.GetName().Name,
                        StringComparison.Ordinal)))
            .ToArray()
    );

    public static int RegisterFrom(params Assembly[] assemblies) {
        var discovered = Discover(assemblies, null);
        Commit(discovered);
        return discovered.Count;
    }

    public static int Bind(params object[] handlers) {
        var discovered = new Dictionary<string, Op>(StringComparer.Ordinal);
        foreach (var handler in handlers) {
            foreach (var method in handler.GetType().GetMethods(
                         BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)) {
                var attribute = GetOpAttribute(method);
                if (attribute != null)
                    Add(discovered, Create(attribute, method, handler));
            }
        }

        Commit(discovered);
        return discovered.Count;
    }

    private static Dictionary<string, Op> Discover(IEnumerable<Assembly> assemblies, object? target) {
        var discovered = new Dictionary<string, Op>(StringComparer.Ordinal);
        foreach (var assembly in assemblies) {
            foreach (var type in assembly.GetTypes()) {
                foreach (var method in type.GetMethods(
                             BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance)) {
                    var attribute = GetOpAttribute(method);
                    if (attribute != null)
                        Add(discovered, Create(attribute, method, target));
                }
            }
        }

        return discovered;
    }

    private static void Commit(Dictionary<string, Op> discovered) {
        foreach (var op in discovered.Values)
            Validate(op);
        foreach (var op in discovered.Values)
            Registered.AddOrUpdate(op.Key, op, (_, current) => current.SameHandler(op) ? op :
                throw new InvalidOperationException($"Bridge op '{op.Key}' is registered twice with different handlers."));
    }

    private static void Add(Dictionary<string, Op> discovered, Op op) {
        if (discovered.TryGetValue(op.Key, out var existing) && !existing.SameHandler(op))
            throw new InvalidOperationException($"Bridge op '{op.Key}' is registered twice with different handlers.");
        discovered[op.Key] = op;
    }

    private static OpAttribute? GetOpAttribute(MethodInfo method) {
        var data = method.CustomAttributes.SingleOrDefault(attribute => attribute.AttributeType == typeof(OpAttribute));
        return data == null ? null : ReadAttribute(data);
    }

    public static OpAttribute ReadAttribute(CustomAttributeData data) {
        object? Named(string name) => data.NamedArguments
            .SingleOrDefault(argument => argument.MemberName == name).TypedValue.Value;
        string[]? Strings(string name) => Named(name) is IReadOnlyCollection<CustomAttributeTypedArgument> values
            ? values.Select(value => (string)value.Value!).ToArray()
            : null;
        int EnumValue(string name, int fallback) => Named(name) is { } value ? Convert.ToInt32(value) : fallback;

        return new OpAttribute((string)data.ConstructorArguments[0].Value!) {
            Title = Named(nameof(OpAttribute.Title)) as string,
            Does = Named(nameof(OpAttribute.Does)) as string
                   ?? throw new InvalidOperationException("[Op] requires Does."),
            Finds = Strings(nameof(OpAttribute.Finds)),
            Intent = (OpIntent)EnumValue(nameof(OpAttribute.Intent), (int)OpIntent.Read),
            Cost = (OpCost)EnumValue(nameof(OpAttribute.Cost), (int)OpCost.Cheap),
            Tier = (OpTier)EnumValue(nameof(OpAttribute.Tier), (int)OpTier.Escalation),
            Example = Named(nameof(OpAttribute.Example)) as string,
            IsPublic = Named(nameof(OpAttribute.IsPublic)) as bool? ?? true,
            Thread = (OpThread)EnumValue(nameof(OpAttribute.Thread), (int)OpThread.Any)
        };
    }

    private static Op Create(OpAttribute attribute, MethodInfo method, object? target) {
        return new Op(Define(attribute, method), method, target, attribute.Thread);
    }

    public static HostOperationDefinition Define(
        OpAttribute attribute,
        MethodInfo method,
        Func<Type, Type>? resolveRuntimeType = null
    ) {
        var parameters = method.GetParameters();
        var responseType = method.ReturnType.IsGenericType
                           && method.ReturnType.GetGenericTypeDefinition().FullName == typeof(Task<>).FullName
            ? method.ReturnType.GetGenericArguments()[0]
            : method.ReturnType;
        var hasCancellationToken = parameters.Length > 1
                                   && parameters[^1].ParameterType.FullName == typeof(CancellationToken).FullName;
        var documentParameter = parameters.Length - (hasCancellationToken ? 1 : 0) == 2 ? parameters[1].ParameterType : null;
        var needs = GetNeeds(documentParameter);
        var signatureIsValid = parameters.Length is >= 1 and <= 3
                               && parameters.Length == 1 + (documentParameter == null ? 0 : 1) + (hasCancellationToken ? 1 : 0)
                               && responseType.FullName != typeof(void).FullName
                               && method.ReturnType.FullName != typeof(Task).FullName;
        if (!signatureIsValid)
            throw new InvalidOperationException(
                $"[Op(\"{attribute.Key}\")] on '{method.DeclaringType?.FullName}.{method.Name}' must return TResponse or Task<TResponse> and accept a request, optional RevitDocument/ProjectDocument/FamilyDocument, and optional CancellationToken."
            );

        resolveRuntimeType ??= type => type;
        return Define(
            attribute,
            resolveRuntimeType(parameters[0].ParameterType),
            resolveRuntimeType(responseType),
            needs
        );
    }

    private static OpNeeds GetNeeds(Type? documentParameter) => documentParameter?.FullName switch {
        null => OpNeeds.Nothing,
        "Pe.Revit.Operations.RevitDocument" => OpNeeds.Document,
        "Pe.Revit.Operations.ProjectDocument" => OpNeeds.ProjectDocument,
        "Pe.Revit.Operations.FamilyDocument" => OpNeeds.FamilyDocument,
        _ => throw new InvalidOperationException(
            $"Unsupported [Op] document parameter '{documentParameter.FullName}'; use RevitDocument, ProjectDocument, or FamilyDocument.")
    };

    public static HostOperationDefinition Define(
        OpAttribute attribute,
        Type requestType,
        Type responseType,
        OpNeeds needs = OpNeeds.Nothing
    ) {
        var metadata = HostOperationAgentMetadata.Create(
            attribute.Does,
            attribute.Finds,
            (HostOperationIntent)attribute.Intent,
            (HostOperationCostTier)attribute.Cost,
            attribute.Tier switch {
                OpTier.Default => HostOperationVisibility.DefaultVisible,
                OpTier.Expert => HostOperationVisibility.ExpertOnly,
                _ => HostOperationVisibility.EscalationVisible
            },
            attribute.Example == null
                ? null
                : [new HostOperationRequestExample("example", "Example request.", attribute.Example)]
        );
        var definition = new HostOperationDefinition(
            attribute.Key,
            requestType,
            responseType,
            attribute.IsPublic,
            attribute.Title,
            metadata,
            needs
        );
        Validate(definition);
        return definition;
    }

    private static readonly JsonSerializerSettings StrictRequestJsonSettings = new() {
        MissingMemberHandling = MissingMemberHandling.Error,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false,
                OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };

    private static void Validate(Op op) {
        Validate(op.Definition);
    }

    private static void Validate(HostOperationDefinition definition) {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(definition.Key))
            errors.Add("operation key is required.");

        var metadata = definition.AgentMetadata;
        foreach (var example in metadata.RequestExamples)
            ValidateRequestJson(definition, $"request example '{example.Name}'", example.Json, errors);
        if (metadata.SafeDefaultRequestJson is { } safeDefault)
            ValidateRequestJson(definition, "safe default request", safeDefault, errors);

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

    private static void ValidateRequestJson(
        HostOperationDefinition definition,
        string label,
        string json,
        List<string> errors
    ) {
        try {
            JsonConvert.DeserializeObject(json, definition.RequestType, StrictRequestJsonSettings);
        } catch (Exception exception) {
            errors.Add($"{definition.Key}: {label} does not deserialize to {definition.RequestType.Name}: {exception.Message}");
        }
    }

    private static bool IsValidPublicRevitKey(string key) {
        var parts = key.Split('.');
        return parts.Length is >= 3 and <= 4
               && parts[0] == "revit"
               && parts[1] is "glance" or "context" or "catalog" or "matrix" or "detail" or "resolve" or "apply"
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
    string Needs,
    string Description,
    IReadOnlyList<string> SearchTerms,
    IReadOnlyList<HostOperationRequestExample> RequestExamples,
    string? SafeDefaultRequestJson,
    IReadOnlyList<string> CallGuidance,
    string RequestSchemaJson,
    string ResponseSchemaJson
) {
    public static HostOpsCatalogEntry FromOp(Op op) {
        return FromDefinition(op.Definition);
    }

    public static HostOpsCatalogEntry FromDefinition(HostOperationDefinition definition) {
        var metadata = definition.AgentMetadata;
        return new HostOpsCatalogEntry(
            definition.Key,
            definition.DisplayName,
            metadata.Intent.ToString(),
            metadata.CostTier.ToString(),
            metadata.Visibility.ToString(),
            definition.Needs switch {
                OpNeeds.Document => "document",
                OpNeeds.ProjectDocument => "project-document",
                OpNeeds.FamilyDocument => "family-document",
                _ => "nothing"
            },
            metadata.Description,
            metadata.SearchTerms,
            metadata.RequestExamples,
            metadata.SafeDefaultRequestJson,
            metadata.CallGuidance,
            BridgeOpSchemaGenerator.GetRequestSchemaJson(definition.RequestType),
            BridgeOpSchemaGenerator.GetResponseSchemaJson(definition.ResponseType)
        );
    }
}

public sealed record HostOpsCatalogData(IReadOnlyList<HostOpsCatalogEntry> Operations);

public static class OpDocumentGate {
    public static void Require(OpNeeds needs, bool hasDocument, bool isFamilyDocument) {
        var expected = needs switch {
            OpNeeds.Document => "Revit document",
            OpNeeds.ProjectDocument => "project document",
            OpNeeds.FamilyDocument => "family document",
            _ => null
        };
        if (expected == null)
            return;

        var actual = !hasDocument ? "no document" : isFamilyDocument ? "family document" : "project document";
        if (hasDocument && (needs == OpNeeds.Document
                            || needs == OpNeeds.ProjectDocument && !isFamilyDocument
                            || needs == OpNeeds.FamilyDocument && isFamilyDocument))
            return;

        var message = $"Operation requires a {expected}, but the active document is {actual}.";
        throw BridgeOperationExceptions.BadRequest(
            message,
            [BridgeOperationExceptions.Issue("$", "InvalidRequest", message, $"Open a {expected} and retry.")]);
    }
}
