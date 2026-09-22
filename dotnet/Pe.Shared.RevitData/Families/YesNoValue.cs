using Newtonsoft.Json.Linq;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     The one Yes/No reader (F-J3-5b, authority ruling msg-authority-domains-bool-plan.md): yes/no/true/false in any case, trimmed, and
///     exactly 1/0. Nothing else is a Yes/No value. The written and captured form is "Yes"/"No".
/// </summary>
public static class YesNoValue {
    public static bool TryParse(string? text, out bool value) {
        value = false;
        var t = text?.Trim();
        if (string.IsNullOrEmpty(t)) return false;
        if (t == "1" || t.Equals("yes", StringComparison.OrdinalIgnoreCase) || t.Equals("true", StringComparison.OrdinalIgnoreCase)) return value = true;
        return t == "0" || t.Equals("no", StringComparison.OrdinalIgnoreCase) || t.Equals("false", StringComparison.OrdinalIgnoreCase);
    }

    public static string Canonical(bool value) => value ? "Yes" : "No";

    /// <summary>
    ///     Rewrites every accepted spelling on a Yes/No parameter (declared dataType, or the sharedSpecId capture records) to "Yes"/"No",
    ///     before the model is typed, so a plan and a capture compare equal. Anything outside the set is left as written for the validator
    ///     to refuse.
    /// </summary>
    public static void Canonicalize(JObject model) {
        if (model["parameters"] is not JObject parameters) return;
        var yesNo = new HashSet<string>(parameters.Properties().Where(p => p.Value is JObject spec && IsYesNo(spec)).Select(p => p.Name), StringComparer.Ordinal);
        if (yesNo.Count == 0) return;
        foreach (var name in yesNo)
            if (parameters[name] is JObject spec && Read(spec["value"]) is { } value) spec["value"] = value;
        foreach (var row in (model["types"] as JObject)?.Properties().Select(p => p.Value).OfType<JObject>() ?? [])
            foreach (var name in yesNo)
                if (Read(row[name]) is { } value) row[name] = value;
    }

    private static bool IsYesNo(JObject spec) =>
        new[] { spec["dataType"], spec["sharedSpecId"] }.Any(token =>
            token?.Type == JTokenType.String && DataTypeConverter.TryParse((string)token!, out var dataType) && dataType == DataType.YesNo);

    private static string? Read(JToken? token) =>
        token is JValue { Type: JTokenType.String or JTokenType.Integer or JTokenType.Boolean } v && TryParse(v.ToString(), out var value) ? Canonical(value) : null;
}
