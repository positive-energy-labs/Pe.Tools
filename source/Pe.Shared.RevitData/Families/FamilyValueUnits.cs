using System.Globalization;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.RevitData.Families;

/// <summary>Authored literal validation only. Captured, unmentioned cells and explicit formulas are untouched.</summary>
public static class FamilyValueUnits {
    public static IReadOnlyList<FamilyModelDiagnostic> Validate(JObject authored, Func<string, bool> isMeasurable) {
        var diagnostics = new List<FamilyModelDiagnostic>();
        void Check(string parameter, JToken? value, string path) {
            if (value is null || value.Type == JTokenType.Null || !isMeasurable(parameter)) return;
            var text = value.ToString();
            if (double.TryParse(text, NumberStyles.Float | NumberStyles.AllowThousands, CultureInfo.InvariantCulture, out _) ||
                !Regex.IsMatch(text, "[\\p{L}'\"\u00B0%]"))
                diagnostics.Add(new("explicit-units-required", path, "Authored measurable values require explicit units; Number and Integer remain unitless. Formulas use Revit formula syntax."));
        }
        foreach (var parameter in (authored["parameters"] as JObject)?.Properties() ?? [])
            if (parameter.Value is JObject definition) Check(parameter.Name, definition["value"], $"$.parameters.{parameter.Name}.value");
        foreach (var type in (authored["types"] as JObject)?.Properties() ?? [])
            foreach (var cell in (type.Value as JObject)?.Properties() ?? []) Check(cell.Name, cell.Value, $"$.types.{type.Name}.{cell.Name}");
        return diagnostics;
    }
}
