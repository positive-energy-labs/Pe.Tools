using Pe.Shared.RevitData.Families;
using System.Globalization;

namespace Pe.Revit.FamilyFoundry.Capture;

/// <summary>
///     Projects the canonical parameter matrix (<see cref="FamilyParameterSnapshot" />, one row per parameter,
///     one cell per type) into <see cref="FamilyModel.Parameters" /> and <see cref="FamilyModel.Types" />.
///     Pure: no Document, so the deterministic lane proves it. Cells are emitted AS READ, one per type;
///     hoisting a uniform value onto the parameter is the reconciler's canonicalization (critic F7), not ours.
///     Value XOR formula: a parameter with a formula emits no cells.
/// </summary>
public static class FamilyModelParameterProjection {
    public sealed record Result(
        Dictionary<string, FamilyModelParameter> Parameters,
        Dictionary<string, Dictionary<string, PortableValue>> Types,
        List<FamilyModelUnmodeledFact> Unmodeled
    );

    public static Result Project(IEnumerable<FamilyParameterSnapshot> rows, IEnumerable<string> typeNames) {
        var parameters = new Dictionary<string, FamilyModelParameter>(StringComparer.Ordinal);
        var types = typeNames.ToDictionary(t => t, _ => new Dictionary<string, PortableValue>(StringComparer.Ordinal), StringComparer.Ordinal);
        var unmodeled = new List<FamilyModelUnmodeledFact>();

        foreach (var row in rows) {
            var d = row.Definition;
            var name = d.Identity.Name;
            if (d.Identity.BuiltInParameterId.HasValue || name.StartsWith("FF_Internal_", StringComparison.Ordinal))
                continue;
            var shared = !string.IsNullOrWhiteSpace(d.Identity.SharedGuid);
            DataType? dataType = null;
            if (!shared) {
                if (d.DataTypeId != null && DataTypeConverter.TryParse(d.DataTypeId, out var token)) dataType = token;
                else if (d.DataTypeLabel != null && DataTypeConverter.TryParse(d.DataTypeLabel, out token)) dataType = token;
                else
                    unmodeled.Add(Fact(UnmodeledReason.KindNotInVocabulary, $"$.parameters.{name}.dataType",
                        ("dataTypeId", d.DataTypeId ?? ""), ("dataTypeLabel", d.DataTypeLabel ?? "")));
            }

            var formula = string.IsNullOrWhiteSpace(row.Formula) ? null : row.Formula;
            parameters[name] = new FamilyModelParameter {
                Shared = shared ? true : null,
                SharedGuid = shared ? Guid.Parse(d.Identity.SharedGuid!) : null,
                SharedSpecId = shared ? d.DataTypeId : null,
                SharedVisible = shared ? d.Visible : null,
                SharedUserModifiable = shared ? d.UserModifiable : null,
                DataType = dataType,
                PropertiesGroup = d.GroupTypeId,
                IsInstance = d.IsInstance,
                Tooltip = d.Description,
                Formula = formula
            };
            if (formula != null) continue;

            foreach (var (typeName, cells) in types) {
                if (!row.ValuesPerType.TryGetValue(typeName, out var text)) {
                    // The snapshot produced no cell for this type: unread, not blank. A null text IS a read blank.
                    unmodeled.Add(Fact(UnmodeledReason.ParameterValueUnreadable, $"$.types.{typeName}.{name}"));
                    continue;
                }
                if (text == null) continue;
                cells[name] = PortableValue.Parse(Canonical(text));
            }
        }

        return new Result(parameters, types, unmodeled);
    }

    /// <summary>
    ///     Revit's display string for an angle is `90.00°`; the portable grammar spells it `90deg`. Every other
    ///     display form (feet-inches, `Yes`, numbers, `120 V`) is admitted by <see cref="PortableValue" /> as is.
    /// </summary>
    public static string Canonical(string text) {
        var t = text.Trim();
        if (t.EndsWith("°", StringComparison.Ordinal) &&
            double.TryParse(t[..^1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var degrees))
            return degrees.ToString("R", CultureInfo.InvariantCulture) + "deg";
        return t;
    }

    internal static FamilyModelUnmodeledFact Fact(UnmodeledReason reason, string path, params (string Key, string Value)[] facts) =>
        new() { Reason = reason, Path = path, Facts = facts.ToDictionary(f => f.Key, f => f.Value, StringComparer.Ordinal) };
}
