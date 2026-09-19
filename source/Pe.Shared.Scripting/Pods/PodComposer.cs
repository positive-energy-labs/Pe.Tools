using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.Scripting.Pods;

/// <summary>One consumed fragment: the pod whose manifest id owns it, its pod-relative path, and its bytes' SHA-256.</summary>
public sealed record PodConsumedDependency(
    string PodId,
    string Path,
    string Sha256,
    byte[] Bytes,
    string Content
);

public sealed record PodCompositionResult(
    string? Content,
    IReadOnlyList<PodConsumedDependency> Dependencies,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);

/// <summary>
///     Composes `$preset` and `$include` for one member. `resolve` receives the reference as written in the
///     member; inside a foreign fragment, `@local/` is rewritten to that fragment's own `@&lt;pod-id&gt;/`.
/// </summary>
public static class PodComposer {
    public const string LocalPrefix = "@local/";

    public delegate bool ResolveReference(string reference, out PodConsumedDependency dependency, out string reason);

    public static PodCompositionResult Compose(string path, string source, ResolveReference resolve) {
        var diagnostics = new List<ScriptDiagnostic>();
        var dependencies = new List<PodConsumedDependency>();
        JToken root;
        try {
            root = Parse(source);
        } catch (JsonException ex) {
            return new PodCompositionResult(null, dependencies, [Error("pod.settings.json", path, ex.Message)]);
        }

        ValidateDirectives(root, path, diagnostics);
        if (diagnostics.Count > 0)
            return new PodCompositionResult(null, dependencies, diagnostics);

        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var expanded = ExpandPresets(root, path, resolve, visiting, dependencies, diagnostics);
        expanded = ExpandIncludes(expanded, path, resolve, visiting, dependencies, diagnostics);
        StripSchema(expanded);
        if (ContainsDirective(expanded))
            diagnostics.Add(Error("pod.settings.directive", path, "Composed settings contain an unresolved directive."));
        if (diagnostics.Count > 0)
            return new PodCompositionResult(null, dependencies, diagnostics);

        return new PodCompositionResult(
            expanded.ToString(Formatting.Indented).Replace("\r\n", "\n") + "\n",
            dependencies,
            []
        );
    }

    /// <summary>Every `$preset`/`$include` string value in the token, in document order.</summary>
    public static IEnumerable<JValue> DirectiveReferences(JToken token) => token switch {
        JObject obj => obj.Properties().SelectMany(property =>
            property.Name is "$preset" or "$include" && property.Value is JValue { Type: JTokenType.String } value
                ? new[] { value }
                : DirectiveReferences(property.Value)),
        JArray array => array.SelectMany(DirectiveReferences),
        _ => Enumerable.Empty<JValue>()
    };

    public static bool ContainsDirective(JToken token) => token switch {
        JObject obj => obj.ContainsKey("$include") || obj.ContainsKey("$preset") || obj.Properties().Any(property => ContainsDirective(property.Value)),
        JArray array => array.Any(ContainsDirective),
        _ => false
    };

    private static JToken? Load(
        string reference,
        string owner,
        ResolveReference resolve,
        ISet<string> visiting,
        ICollection<PodConsumedDependency> dependencies,
        ICollection<ScriptDiagnostic> diagnostics
    ) {
        if (!visiting.Add(reference)) {
            diagnostics.Add(Error("pod.settings.cycle", owner, $"Directive cycle through '{reference}'."));
            return null;
        }
        if (!resolve(reference, out var dependency, out var reason)) {
            diagnostics.Add(Error("pod.settings.reference", owner, reason));
            visiting.Remove(reference);
            return null;
        }
        dependencies.Add(dependency);
        var scoped = reference.StartsWith(LocalPrefix, StringComparison.Ordinal)
            ? resolve
            : (string nested, out PodConsumedDependency nestedDependency, out string nestedReason) => resolve(
                nested.StartsWith(LocalPrefix, StringComparison.Ordinal) ? $"@{dependency.PodId}/{nested.Substring(LocalPrefix.Length)}" : nested,
                out nestedDependency,
                out nestedReason
            );
        try {
            var loaded = Parse(dependency.Content);
            return ExpandIncludes(
                ExpandPresets(loaded, dependency.Path, scoped, visiting, dependencies, diagnostics),
                dependency.Path,
                scoped,
                visiting,
                dependencies,
                diagnostics
            );
        } catch (JsonException ex) {
            diagnostics.Add(Error("pod.settings.json", dependency.Path, ex.Message));
            return null;
        } finally {
            visiting.Remove(reference);
        }
    }

    private static JToken ExpandPresets(
        JToken token,
        string owner,
        ResolveReference resolve,
        ISet<string> visiting,
        ICollection<PodConsumedDependency> dependencies,
        ICollection<ScriptDiagnostic> diagnostics
    ) => token switch {
        JObject obj when obj["$preset"]?.Type == JTokenType.String => ExpandPresetObject(obj, owner, resolve, visiting, dependencies, diagnostics),
        JObject obj => new JObject(obj.Properties().Select(property => new JProperty(
            property.Name,
            ExpandPresets(property.Value, owner, resolve, visiting, dependencies, diagnostics)
        ))),
        JArray array => new JArray(array.Select(item => ExpandPresets(item, owner, resolve, visiting, dependencies, diagnostics))),
        _ => token.DeepClone()
    };

    private static JToken ExpandPresetObject(
        JObject obj,
        string owner,
        ResolveReference resolve,
        ISet<string> visiting,
        ICollection<PodConsumedDependency> dependencies,
        ICollection<ScriptDiagnostic> diagnostics
    ) {
        var reference = obj["$preset"]!.Value<string>()!;
        var basis = Load(reference, owner, resolve, visiting, dependencies, diagnostics);
        var delta = new JObject(obj.Properties()
            .Where(property => property.Name != "$preset")
            .Select(property => new JProperty(property.Name, ExpandPresets(property.Value, owner, resolve, visiting, dependencies, diagnostics))));
        if (basis is not JObject basisObject) {
            if (basis is not null)
                diagnostics.Add(Error("pod.settings.preset", owner, $"Preset '{reference}' must resolve to a JSON object."));
            return delta;
        }
        return MergeRightWins(basisObject, delta);
    }

    private static JToken ExpandIncludes(
        JToken token,
        string owner,
        ResolveReference resolve,
        ISet<string> visiting,
        ICollection<PodConsumedDependency> dependencies,
        ICollection<ScriptDiagnostic> diagnostics
    ) {
        if (token is JObject include && include["$include"]?.Type == JTokenType.String) {
            var siblings = include.Properties().Where(property => property.Name != "$include").Select(property => property.Name).ToList();
            if (siblings.Count > 0) {
                diagnostics.Add(Error("pod.settings.include", owner, "$include cannot have sibling properties because includes never override."));
                return JValue.CreateNull();
            }
            return Load(include["$include"]!.Value<string>()!, owner, resolve, visiting, dependencies, diagnostics) ?? JValue.CreateNull();
        }
        if (token is JObject obj)
            return new JObject(obj.Properties().Select(property => new JProperty(
                property.Name,
                ExpandIncludes(property.Value, owner, resolve, visiting, dependencies, diagnostics)
            )));
        if (token is not JArray array)
            return token.DeepClone();

        var result = new JArray();
        foreach (var item in array) {
            var before = diagnostics.Count;
            var expanded = ExpandIncludes(item, owner, resolve, visiting, dependencies, diagnostics);
            if (item is not JObject candidate || candidate["$include"]?.Type != JTokenType.String || diagnostics.Count > before) {
                result.Add(expanded);
                continue;
            }
            if (Spliced(expanded) is { } splice) {
                foreach (var child in splice)
                    result.Add(child);
                continue;
            }
            // Any other object is one element, inserted as is.
            if (expanded is not JObject)
                diagnostics.Add(Error("pod.settings.include", owner,
                    $"Include '{candidate["$include"]}' in an array must resolve to an object, an array or an `Items` fragment; it resolved to {Shape(expanded)}."));
            result.Add(expanded);
        }
        return result;
    }

    /// <summary>What an array-position include splices: a raw array, or the `Items` of a `{ "$schema"?, "Items": [...] }` fragment.</summary>
    private static JArray? Spliced(JToken expanded) =>
        expanded switch {
            JArray array => array,
            JObject fragment when fragment["Items"] is JArray items
                && fragment.Properties().All(property => property.Name is "Items" or "$schema") => items,
            _ => null
        };

    private static string Shape(JToken token) => $"a {token.Type.ToString().ToLowerInvariant()}";

    private static JObject MergeRightWins(JObject left, JObject right) {
        var result = (JObject)left.DeepClone();
        foreach (var property in right.Properties())
            result[property.Name] = result[property.Name] is JObject current && property.Value is JObject replacement
                ? MergeRightWins(current, replacement)
                : property.Value.DeepClone();
        return result;
    }

    private static JToken Parse(string source) => JToken.Parse(
        source.Length > 0 && source[0] == '\uFEFF' ? source.Substring(1) : source,
        new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });

    private static void ValidateDirectives(JToken token, string owner, ICollection<ScriptDiagnostic> diagnostics) {
        if (token is JObject obj) {
            foreach (var name in new[] { "$preset", "$include" })
                if (obj.TryGetValue(name, out var value) && value.Type != JTokenType.String)
                    diagnostics.Add(Error("pod.settings.directive", owner, $"{name} must be a string reference."));
            foreach (var property in obj.Properties())
                ValidateDirectives(property.Value, owner, diagnostics);
        } else if (token is JArray array) {
            foreach (var item in array)
                ValidateDirectives(item, owner, diagnostics);
        }
    }

    private static void StripSchema(JToken token) {
        if (token is JObject obj)
            _ = obj.Remove("$schema");
    }

    private static ScriptDiagnostic Error(string code, string source, string message) =>
        new(code, ScriptDiagnosticSeverity.Error, message, source);
}
