using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     The one patch file shape (VERDICTS-R1 §8, amended by R2 F13/F14): `{ select, patch, run }`.
///     <para><see cref="Patch" /> is a FRAGMENT of <see cref="FamilyModel" />, not a second contract: it is
///     held as a <see cref="JObject" /> and merged onto the current document's JSON by <see cref="Apply" />
///     with three rules — omission = unchanged, `null` = delete, `{}` = ensure exists (a full object creates
///     or replaces, a scalar or array replaces) — and the MERGED JSON is then parsed by
///     <see cref="FamilyModelJson.Parse" />. Every slot grammar, enum, converter, macro and validator rule
///     therefore applies to a patch for free, and there is no nullable twin of the model to drift.</para>
///     <para><see cref="Select" /> is `{ names[], categories[], placedOnly }`; `{}` selects every family
///     (8 of 51 corpus profiles had no selector). <see cref="Run" /> holds non-document rules; a wildcard
///     value rule is a run rule, never a document value, because names are identity.</para>
///     The fragment schema is derived mechanically by <see cref="FamilyPatchSchema.Derive" />.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyPatch {
    [JsonProperty("select")]
    public PatchSelect Select { get; init; } = new();

    [JsonProperty("patch", Required = Required.Always)]
    public JObject Patch { get; init; } = new();

    [JsonProperty("run", NullValueHandling = NullValueHandling.Ignore)]
    public PatchRun? Run { get; init; }

    /// <summary>Evaluate creation rules against this family; explicit patch fields always take precedence.</summary>
    public JObject ResolveParameterRules(FamilyModel current) {
        var conditional = new JObject();
        foreach (var (name, parameter) in this.Run?.ParametersIfSourceExists ?? [])
            if (current.Parameters.ContainsKey(name) || parameter.WasNamed?.Any(current.Parameters.ContainsKey) == true)
                conditional[name] = JToken.FromObject(parameter, JsonSerializer.Create(FamilyModelJson.Settings));
        var resolved = new JObject();
        if (conditional.HasValues) resolved["parameters"] = conditional;
        resolved.Merge(this.Patch, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace, MergeNullValueHandling = MergeNullValueHandling.Merge });
        return resolved;
    }

    public static readonly JsonSerializerSettings Settings = new() {
        MissingMemberHandling = MissingMemberHandling.Error,
        NullValueHandling = NullValueHandling.Ignore,
        Formatting = Formatting.Indented
    };

    /// <summary>Strict parse of a patch file; the fragment itself is checked only when merged and parsed as a model.</summary>
    public static FamilyPatch Parse(string json) {
        var token = JToken.Parse(json, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
        if (token is JObject o) o.Remove("$schema");
        return token.ToObject<FamilyPatch>(JsonSerializer.Create(Settings)) ?? throw new JsonSerializationException("Patch deserialized to null.");
    }

    /// <summary>Merge the fragment onto one current document. Pure; returns the merged JSON to parse.</summary>
    public static JObject Apply(JObject current, JObject patch) {
        patch = ExpandMacros(current, patch);
        var result = (JObject)current.DeepClone();
        Merge(result, patch);
        foreach (var parameter in (patch["parameters"] as JObject)?.Properties() ?? []) {
            var authored = parameter.Value as JObject;
            var merged = result["parameters"]?[parameter.Name] as JObject;
            if (authored?.Value<bool?>("shared") == false)
                foreach (var field in new[] { "sharedGuid", "sharedSpecId", "sharedVisible", "sharedUserModifiable" }) merged?.Remove(field);
            if (authored?.Value<bool?>("shared") == true) {
                if (!authored.ContainsKey("dataType")) merged?.Remove("dataType");
                if (!authored.ContainsKey("tooltip")) merged?.Remove("tooltip");
            }
            if (authored?["value"] is { Type: not JTokenType.Null }) merged?.Remove("formula");
            if (authored?["formula"] is { Type: not JTokenType.Null }) merged?.Remove("value");
            if (parameter.Value.Type != JTokenType.Null && authored?["value"] is not { Type: not JTokenType.Null } && authored?["formula"] is not { Type: not JTokenType.Null }) continue;
            foreach (var type in (result["types"] as JObject)?.Properties() ?? []) {
                // Explicit type cells override an explicit uniform value; captured cells do not.
                if (patch["types"]?[type.Name] is JObject row && row.ContainsKey(parameter.Name)) continue;
                (type.Value as JObject)?.Remove(parameter.Name);
            }
        }
        return result;
    }

    private static JObject ExpandMacros(JObject current, JObject patch) {
        var forms = (patch["forms"] as JObject)?.Properties().Where(p => p.Value is JObject form &&
            Enum.TryParse((string?)form["kind"], true, out FormKind kind) && kind is FormKind.Prism or FormKind.Cylinder).ToList() ?? [];
        var details = (patch["details"] as JObject)?.Properties().Where(p => p.Value is JObject detail && detail["curves"] is JArray { Count: > 1 }).ToList() ?? [];
        if (forms.Count == 0 && details.Count == 0) return patch;

        // Expand authored shorthand before it encounters the native expanded representation.
        var parameters = (JObject?)current["parameters"]?.DeepClone() ?? new JObject();
        if (patch["parameters"] is JObject authoredParameters) Merge(parameters, authoredParameters);
        var input = new JObject { ["family"] = (current["family"] ?? patch["family"])?.DeepClone(), ["parameters"] = parameters, ["forms"] = new JObject(forms.Select(p => new JProperty(p.Name, p.Value.DeepClone()))) };
        foreach (var section in new[] { "datums", "refPlanes", "dimensions", "details" })
            if (patch[section] is JObject declarations)
                input[section] = new JObject(declarations.Properties().Where(p => p.Value is JObject).Select(p => new JProperty(p.Name, p.Value.DeepClone())));
        var model = input.ToObject<FamilyModel>(JsonSerializer.Create(FamilyModelJson.Settings))!;
        var diagnostics = FamilyModelMacros.Expand(model);
        if (diagnostics.Count > 0)
            throw new JsonSerializationException(string.Join("; ", diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        var expanded = JObject.Parse(FamilyModelJson.Serialize(model));
        var result = (JObject)patch.DeepClone();
        foreach (var detail in details) ((JObject)result["details"]!).Remove(detail.Name);
        foreach (var section in new[] { "forms", "refPlanes", "dimensions", "details" })
            foreach (var entry in ((JObject)expanded[section]!).Properties()) {
                result[section] ??= new JObject();
                result[section]![entry.Name] = entry.Value.DeepClone();
            }
        return result;
    }

    /// <summary>Merge, parse, validate in one call.</summary>
    public static FamilyModelParseResult Apply(string currentJson, string patchJson) =>
        FamilyModelJson.Parse(Apply(JObject.Parse(currentJson), JObject.Parse(patchJson)).ToString());

    private static void Merge(JObject target, JObject patch) {
        foreach (var prop in patch.Properties()) {
            switch (prop.Value.Type) {
                case JTokenType.Null:
                    target.Remove(prop.Name);                       // null = delete
                    break;
                case JTokenType.Object when target[prop.Name] is JObject existing:
                    Merge(existing, (JObject)prop.Value);           // recurse: omission inside = unchanged
                    break;
                default:
                    target[prop.Name] = prop.Value.DeepClone();     // {} = ensure exists; object/scalar/array = create or replace
                    break;
            }
        }
    }
}

/// <summary>The whole observed selector vocabulary of the 51-profile corpus. Empty = every family.</summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class PatchSelect {
    [JsonProperty("names", NullValueHandling = NullValueHandling.Ignore)]
    public List<string>? Names { get; init; }

    [JsonProperty("categories", NullValueHandling = NullValueHandling.Ignore)]
    public List<FamilyCategory>? Categories { get; init; }

    /// <summary>Only families with at least one placed instance (`IncludeUnusedFamilies == false` in the legacy selector).</summary>
    [JsonProperty("placedOnly", NullValueHandling = NullValueHandling.Ignore)]
    public bool? PlacedOnly { get; init; }
}

/// <summary>Non-document rules applied after the merge, per family, per type.</summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class PatchRun {
    /// <summary>Ensure each target only when it or a named source exists in the current family. Retained in exported intent.</summary>
    [JsonProperty("parametersIfSourceExists", NullValueHandling = NullValueHandling.Ignore)]
    public Dictionary<string, FamilyModelParameter>? ParametersIfSourceExists { get; init; }

    [JsonProperty("electricalConnectorParameters", NullValueHandling = NullValueHandling.Ignore)]
    public ElectricalConnectorParameterRule? ElectricalConnectorParameters { get; init; }

    /// <summary>
    ///     Blank cells (per type: `HasValue(FamilyType, FamilyParameter)` false) of parameters whose
    ///     <see cref="DataType" /> is in <see cref="BlankRule.Specs" /> become <see cref="BlankRule.Value" />.
    ///     Spec-keyed on purpose (critic F14): one scalar would set blank lengths to minus one foot and
    ///     flip blank Yes/No on. Lengths and Yes/No are opt-in by naming their spec.
    /// </summary>
    [JsonProperty("blanksBecome", NullValueHandling = NullValueHandling.Ignore)]
    public List<BlankRule>? BlanksBecome { get; init; }

    [JsonProperty("clean", NullValueHandling = NullValueHandling.Ignore)]
    public JToken? Clean { get; init; }

    [JsonProperty("sort", NullValueHandling = NullValueHandling.Ignore)]
    public JToken? Sort { get; init; }
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class ElectricalConnectorParameterRule {
    [JsonProperty("voltage", Required = Required.Always)]
    public string Voltage { get; init; } = null!;

    [JsonProperty("numberOfPoles", Required = Required.Always)]
    public string NumberOfPoles { get; init; } = null!;

    [JsonProperty("apparentPower", Required = Required.Always)]
    public string ApparentPower { get; init; } = null!;

    /// <summary>Retained family-parameter intent. No connector target is assumed until native capability is proven.</summary>
    [JsonProperty("minimumCircuitAmpacity", Required = Required.Always)]
    public string MinimumCircuitAmpacity { get; init; } = null!;
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class BlankRule {
    [JsonProperty("specs", Required = Required.Always)]
    public List<DataType> Specs { get; init; } = [];

    [JsonProperty("value", Required = Required.Always)]
    public PortableValue Value { get; init; }
}

/// <summary>Derives the patch-fragment schema from the model schema: same `$defs`, `required` stripped, every property and map value nullable.</summary>
public static class FamilyPatchSchema {
    public static JObject Derive(JObject modelSchema) {
        var patch = (JObject)modelSchema.DeepClone();
        patch["$id"] = "https://pe.tools/schemas/family-patch.json";
        patch.Remove("required");
        Nullify(patch["properties"] as JObject);
        foreach (var def in (patch["$defs"] as JObject ?? patch["definitions"] as JObject)?.Properties().Select(p => p.Value as JObject) ?? []) {
            def?.Remove("required");
            Nullify(def?["properties"] as JObject);
        }
        return patch;
    }

    private static void Nullify(JObject? properties) {
        if (properties == null) return;
        foreach (var prop in properties.Properties()) {
            if (prop.Value is not JObject slot) continue;
            slot.Remove("required");
            Nullify(slot["properties"] as JObject);
            if (slot["additionalProperties"] is JObject map) {
                map.Remove("required");
                Nullify(map["properties"] as JObject);
                slot["additionalProperties"] = new JObject { ["anyOf"] = new JArray(new JObject { ["type"] = "null" }, map) };
            }
            prop.Value = new JObject { ["anyOf"] = new JArray(new JObject { ["type"] = "null" }, slot) };
        }
    }
}
