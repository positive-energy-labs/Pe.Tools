using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.Revit.SettingsRuntime.Json.SchemaProcessors;

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
                candidate.DefinitionKind,
                candidate.DefinitionKey,
                candidate.ExamplesSignature
            })
            .ToList();
        var exampleDefinitionIndex = 0;

        foreach (var group in groups) {
            var definitionName = group.Key.DefinitionKind == SchemaDefinitionKind.ConstraintEnum
                ? CreateConstraintDefinitionName(definitions, group.Key.DefinitionKey)
                : NextExampleDefinitionName(definitions, ref exampleDefinitionIndex);
            definitions[definitionName] = CreateDefinitionSchema(group.First());

            foreach (var candidate in group) {
                _ = candidate.Schema.Remove("examples");
                _ = candidate.Schema.Remove("enum");
                _ = candidate.Schema.Remove("x-enumNames");
                AddDefinitionReference(candidate.Schema, definitionName);
            }
        }
    }

    private static JObject CreateDefinitionSchema(SchemaExampleCandidate candidate) {
        if (candidate.DefinitionKind == SchemaDefinitionKind.ConstraintEnum) {
            return new JObject {
                ["type"] = "string",
                ["enum"] = candidate.Examples.DeepClone()
            };
        }

        return new JObject {
            ["examples"] = candidate.Examples.DeepClone()
        };
    }

    private static void AddDefinitionReference(JObject schema, string definitionName) {
        var allOf = schema["allOf"] as JArray;
        if (allOf == null) {
            allOf = new JArray();
            schema["allOf"] = allOf;
        }

        var referencePath = $"#/definitions/{definitionName}";
        var alreadyReferenced = allOf.Children<JObject>()
            .Any(candidate => string.Equals(candidate["$ref"]?.Value<string>(), referencePath, StringComparison.Ordinal));
        if (!alreadyReferenced)
            allOf.Add(new JObject { ["$ref"] = referencePath });
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

        var isConstraintEnum = string.Equals(options["mode"]?.Value<string>(), "Constraint", StringComparison.OrdinalIgnoreCase)
            && options["allowsCustomValue"]?.Value<bool>() == false;
        var definitionKind = isConstraintEnum ? SchemaDefinitionKind.ConstraintEnum : SchemaDefinitionKind.Examples;
        candidate = new SchemaExampleCandidate(
            schema,
            definitionKind,
            providerKey,
            examples,
            examples.ToString(Formatting.None)
        );
        return true;
    }

    private static string NextExampleDefinitionName(JObject definitions, ref int definitionIndex) {
        string definitionName;
        do
            definitionName = $"examples_{++definitionIndex}";
        while (definitions.Property(definitionName) != null);

        return definitionName;
    }

    private static string CreateConstraintDefinitionName(JObject definitions, string definitionKey) {
        var baseName = $"valueDomain_{SanitizeDefinitionKey(definitionKey)}";
        if (definitions.Property(baseName) == null)
            return baseName;

        var suffix = 2;
        while (definitions.Property($"{baseName}_{suffix}") != null)
            suffix++;

        return $"{baseName}_{suffix}";
    }

    private static string SanitizeDefinitionKey(string key) {
        var buffer = new char[key.Length];
        for (var i = 0; i < key.Length; i++) {
            var character = key[i];
            buffer[i] = char.IsLetterOrDigit(character) ? character : '_';
        }

        return new string(buffer);
    }

    private enum SchemaDefinitionKind {
        Examples,
        ConstraintEnum
    }

    private readonly record struct SchemaExampleCandidate(
        JObject Schema,
        SchemaDefinitionKind DefinitionKind,
        string DefinitionKey,
        JArray Examples,
        string ExamplesSignature
    );
}
