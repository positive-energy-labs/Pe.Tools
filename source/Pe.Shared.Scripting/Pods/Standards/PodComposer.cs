using Newtonsoft.Json.Linq;

namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>
///     Resolves a reference to authored JSON. `@local/x` reads this pod's `settings/`;
///     `@other/x` reads that pod's `composed/` (verdict 7: no transitive resolution).
/// </summary>
public interface IPodReferenceResolver {
    /// <summary>Returns the authored JSON text, or null with a reason the caller can print.</summary>
    string? Resolve(PodReference reference, out string? reason);
}

/// <summary>
///     A document proven free of directives. Constructible only through
///     <see cref="PodComposer" /> or <see cref="TryAdopt" />, which re-runs the proof.
///     "composed document still holding a $include" is unrepresentable.
/// </summary>
public sealed class ComposedDocument {
    private ComposedDocument(PodPath path, JToken json) {
        this.Path = path;
        this.Json = json;
    }

    public PodPath Path { get; }
    public JToken Json { get; }

    public string Serialize() => this.Json.ToString(Newtonsoft.Json.Formatting.Indented) + "\n";

    internal static ComposedDocument Trusted(PodPath path, JToken json) => new(path, json);

    /// <summary>Adopt already-written JSON as composed, only if it really carries no directive.</summary>
    public static bool TryAdopt(PodPath path, JToken json, out ComposedDocument document, out string? reason) {
        document = null!;
        var directive = PodComposer.FindDirective(json);
        if (directive is not null) {
            reason = $"'{path}' still contains a '{directive}' directive; composed documents are closed.";
            return false;
        }

        document = new ComposedDocument(path, json);
        reason = null;
        return true;
    }
}

public sealed record PodComposeResult(ComposedDocument? Document, IReadOnlyList<string> Errors, IReadOnlyList<PodReference> Dependencies);

/// <summary>
///     Spike port of the two directives that matter, from
///     `source/pe-tools/apps/host/src/settings.ts` (`expandPresets` :716, `expandIncludes` :788,
///     `resolveDirective` :857). Semantics kept: `$include` is strictly no-override and splices
///     arrays; `$preset` is recursive right-wins with `$schema` stripped; cycles are refused.
/// </summary>
public static class PodComposer {
    public const string IncludeKey = "$include";
    public const string PresetKey = "$preset";
    private const string SchemaKey = "$schema";

    public static PodComposeResult Compose(PodPath path, string sourceJson, IPodReferenceResolver resolver) {
        var errors = new List<string>();
        var dependencies = new List<PodReference>();

        JToken root;
        try {
            root = JToken.Parse(sourceJson);
        } catch (Newtonsoft.Json.JsonException ex) {
            return new PodComposeResult(null, [$"'{path}' is not valid JSON: {ex.Message}"], []);
        }

        var context = new ComposeContext(resolver, errors, dependencies);
        var expanded = ExpandPresets(root, context, []);
        expanded = ExpandIncludes(expanded, context, []);
        StripSchema(expanded);

        if (errors.Count > 0)
            return new PodComposeResult(null, errors, dependencies);

        return new PodComposeResult(ComposedDocument.Trusted(path, expanded), [], dependencies);
    }

    /// <summary>Names the first surviving directive key, or null. Used by the closed-composed gate.</summary>
    public static string? FindDirective(JToken token) {
        switch (token) {
        case JObject obj:
            if (obj.ContainsKey(IncludeKey)) return IncludeKey;
            if (obj.ContainsKey(PresetKey)) return PresetKey;
            return obj.Properties().Select(p => FindDirective(p.Value)).FirstOrDefault(found => found is not null);
        case JArray array:
            return array.Select(FindDirective).FirstOrDefault(found => found is not null);
        default:
            return null;
        }
    }

    /// <summary>Every `@x/` reference anywhere in a document, valid or not, with its raw text.</summary>
    public static IEnumerable<string> RawReferences(JToken token) {
        switch (token) {
        case JObject obj:
            foreach (var property in obj.Properties()) {
                if (property.Name is IncludeKey or PresetKey && property.Value.Type == JTokenType.String)
                    yield return property.Value.Value<string>()!;
                foreach (var nested in RawReferences(property.Value))
                    yield return nested;
            }

            break;
        case JArray array:
            foreach (var nested in array.SelectMany(RawReferences))
                yield return nested;
            break;
        }
    }

    private sealed record ComposeContext(IPodReferenceResolver Resolver, List<string> Errors, List<PodReference> Dependencies);

    private static JToken? Load(string rawReference, ComposeContext context, ISet<string> visiting) {
        if (!PodReference.TryParse(rawReference, out var reference, out var reason)) {
            context.Errors.Add(reason!);
            return null;
        }

        var key = reference.ToString()!.ToLowerInvariant();
        if (!visiting.Add(key)) {
            context.Errors.Add($"Directive cycle through '{reference}'.");
            return null;
        }

        var text = context.Resolver.Resolve(reference, out var resolveReason);
        if (text is null) {
            context.Errors.Add(resolveReason ?? $"Reference '{reference}' does not resolve.");
            visiting.Remove(key);
            return null;
        }

        context.Dependencies.Add(reference);
        JToken loaded;
        try {
            loaded = JToken.Parse(text);
        } catch (Newtonsoft.Json.JsonException ex) {
            context.Errors.Add($"Reference '{reference}' is not valid JSON: {ex.Message}");
            visiting.Remove(key);
            return null;
        }

        var expanded = ExpandIncludes(ExpandPresets(loaded, context, visiting), context, visiting);
        visiting.Remove(key);
        return expanded;
    }

    private static JToken ExpandPresets(JToken token, ComposeContext context, ISet<string> visiting) {
        switch (token) {
        case JObject obj when obj[PresetKey]?.Type == JTokenType.String: {
            var raw = obj[PresetKey]!.Value<string>()!;
            var baseToken = Load(raw, context, visiting);
            var delta = new JObject(obj.Properties().Where(p => p.Name != PresetKey).Select(p => new JProperty(p.Name, ExpandPresets(p.Value, context, visiting))));
            if (baseToken is not JObject baseObj) {
                if (baseToken is not null)
                    context.Errors.Add($"'{PresetKey}' target '{raw}' must be a JSON object.");
                return delta;
            }

            return MergeRightWins(baseObj, delta);
        }
        case JObject obj:
            return new JObject(obj.Properties().Select(p => new JProperty(p.Name, ExpandPresets(p.Value, context, visiting))));
        case JArray array:
            return new JArray(array.Select(item => ExpandPresets(item, context, visiting)));
        default:
            return token;
        }
    }

    private static JToken ExpandIncludes(JToken token, ComposeContext context, ISet<string> visiting) {
        switch (token) {
        case JObject obj when obj[IncludeKey]?.Type == JTokenType.String: {
            var raw = obj[IncludeKey]!.Value<string>()!;
            var siblings = obj.Properties().Where(p => p.Name != IncludeKey).Select(p => p.Name).ToArray();
            if (siblings.Length > 0) {
                // settings.ts :997-999, :1029-1031 — include is strictly no-override.
                context.Errors.Add($"'{IncludeKey}' of '{raw}' cannot sit beside {string.Join(", ", siblings.Select(s => $"'{s}'"))}; includes never override.");
                return JValue.CreateNull();
            }

            return Load(raw, context, visiting) ?? JValue.CreateNull();
        }
        case JObject obj:
            return new JObject(obj.Properties().Select(p => new JProperty(p.Name, ExpandIncludes(p.Value, context, visiting))));
        case JArray array: {
            var next = new JArray();
            foreach (var item in array) {
                var expanded = ExpandIncludes(item, context, visiting);
                // An included array splices into the host array rather than nesting.
                if (item is JObject candidate && candidate.ContainsKey(IncludeKey) && expanded is JArray spliced)
                    foreach (var element in spliced)
                        next.Add(element);
                else
                    next.Add(expanded);
            }

            return next;
        }
        default:
            return token;
        }
    }

    private static JObject MergeRightWins(JObject left, JObject right) {
        var merged = (JObject)left.DeepClone();
        foreach (var property in right.Properties()) {
            if (merged[property.Name] is JObject existing && property.Value is JObject incoming)
                merged[property.Name] = MergeRightWins(existing, incoming);
            else
                merged[property.Name] = property.Value.DeepClone();
        }

        return merged;
    }

    private static void StripSchema(JToken token) {
        if (token is JObject obj)
            obj.Remove(SchemaKey);
    }
}
