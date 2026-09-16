using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.Scripting.Pods;

public sealed record PodComposedDocument(
    string Path,
    string Content,
    IReadOnlyList<PodConsumedDependency> Dependencies
);

public sealed record PodConsumedDependency(
    string PodId,
    string ReleaseHash,
    string SourcePath,
    string Content
);

public sealed record PodCompositionResult(
    PodComposedDocument? Document,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);

/// <summary>Composes `$preset` and `$include` from one captured pod snapshot.</summary>
public static class PodComposer {
    public delegate bool ResolveReference(string reference, out PodConsumedDependency dependency, out string reason);

    public static PodCompositionResult Compose(string path, string source, ResolveReference resolve) {
        var diagnostics = new List<ScriptDiagnostic>();
        var dependencies = new List<PodConsumedDependency>();
        JToken root;
        try {
            root = JToken.Parse(source, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
        } catch (JsonException ex) {
            return new PodCompositionResult(null, [Error("pod.settings.json", path, ex.Message)]);
        }

        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var expanded = ExpandPresets(root, path, resolve, visiting, dependencies, diagnostics);
        expanded = ExpandIncludes(expanded, path, resolve, visiting, dependencies, diagnostics);
        StripSchema(expanded);
        if (diagnostics.Count > 0)
            return new PodCompositionResult(null, diagnostics);

        return new PodCompositionResult(
            new PodComposedDocument(path, expanded.ToString(Formatting.Indented) + Environment.NewLine, dependencies),
            []
        );
    }

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
        try {
            var loaded = JToken.Parse(dependency.Content, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
            return ExpandIncludes(
                ExpandPresets(loaded, dependency.SourcePath, resolve, visiting, dependencies, diagnostics),
                dependency.SourcePath,
                resolve,
                visiting,
                dependencies,
                diagnostics
            );
        } catch (JsonException ex) {
            diagnostics.Add(Error("pod.settings.json", dependency.SourcePath, ex.Message));
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
            var expanded = ExpandIncludes(item, owner, resolve, visiting, dependencies, diagnostics);
            if (item is JObject candidate && candidate.ContainsKey("$include") && expanded is JArray splice)
                foreach (var child in splice)
                    result.Add(child);
            else
                result.Add(expanded);
        }
        return result;
    }

    private static JObject MergeRightWins(JObject left, JObject right) {
        var result = (JObject)left.DeepClone();
        foreach (var property in right.Properties())
            result[property.Name] = result[property.Name] is JObject current && property.Value is JObject replacement
                ? MergeRightWins(current, replacement)
                : property.Value.DeepClone();
        return result;
    }

    private static void StripSchema(JToken token) {
        if (token is JObject obj)
            _ = obj.Remove("$schema");
    }

    private static ScriptDiagnostic Error(string code, string source, string message) =>
        new(code, ScriptDiagnosticSeverity.Error, message, source);
}
