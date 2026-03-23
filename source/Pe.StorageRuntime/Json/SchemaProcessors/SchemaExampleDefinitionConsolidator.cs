using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.StorageRuntime.Json.SchemaProcessors;

internal static class SchemaExampleDefinitionConsolidator {
    public static JsonSchema Consolidate(JsonSchema schema) {
        var root = JObject.Parse(schema.ToJson());
        Consolidate(root);
        return JsonSchema.FromJsonAsync(root.ToString(Formatting.None)).GetAwaiter().GetResult();
    }

    private static void Consolidate(JObject root) {
        var candidates = new List<SchemaExampleCandidate>();
        CollectCandidates(root, candidates);
        if (candidates.Count == 0)
            return;

        var definitions = root["definitions"] as JObject;
        if (definitions == null) {
            definitions = new JObject();
            root["definitions"] = definitions;
        }

        var groups = candidates
            .GroupBy(candidate => new {
                candidate.ProviderKey,
                candidate.ExamplesSignature
            })
            .ToList();
        var definitionIndex = 0;

        foreach (var group in groups) {
            var definitionName = NextDefinitionName(definitions, ref definitionIndex);
            definitions[definitionName] = new JObject {
                ["examples"] = group.First().Examples.DeepClone()
            };

            foreach (var candidate in group) {
                _ = candidate.Schema.Remove("examples");
                var allOf = candidate.Schema["allOf"] as JArray;
                if (allOf == null) {
                    allOf = new JArray();
                    candidate.Schema["allOf"] = allOf;
                }

                allOf.Add(new JObject {
                    ["$ref"] = $"#/definitions/{definitionName}"
                });
            }
        }
    }

    private static void CollectCandidates(JToken token, ICollection<SchemaExampleCandidate> candidates) {
        if (token is JObject obj) {
            if (TryCreateCandidate(obj, out var candidate))
                candidates.Add(candidate);

            foreach (var property in obj.Properties())
                CollectCandidates(property.Value, candidates);

            return;
        }

        if (token is not JArray array)
            return;

        foreach (var item in array)
            CollectCandidates(item, candidates);
    }

    private static bool TryCreateCandidate(JObject schema, out SchemaExampleCandidate candidate) {
        candidate = default;
        if (schema["x-options"] is not JObject options ||
            options["key"]?.Value<string>() is not { Length: > 0 } providerKey ||
            schema["examples"] is not JArray examples) {
            return false;
        }

        candidate = new SchemaExampleCandidate(
            schema,
            providerKey,
            examples,
            examples.ToString(Formatting.None)
        );
        return true;
    }

    private static string NextDefinitionName(JObject definitions, ref int definitionIndex) {
        string definitionName;
        do {
            definitionName = $"examples_{++definitionIndex}";
        } while (definitions.Property(definitionName) != null);

        return definitionName;
    }

    private readonly record struct SchemaExampleCandidate(
        JObject Schema,
        string ProviderKey,
        JArray Examples,
        string ExamplesSignature
    );
}
