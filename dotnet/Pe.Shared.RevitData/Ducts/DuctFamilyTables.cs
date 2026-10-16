using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData.Families;
using System.Globalization;
using System.Text;

namespace Pe.Shared.RevitData.Ducts;

// The `ducts.family-patch` contract: the Family Foundry patch that gives a fitting family its own loss coefficient
// (pressure-drop ledger, 2026-10-08: the family owns the number). One embedded lookup table built from Revit's
// shipped ASHRAE grids, one instance parameter with a rounding size_lookup formula, and the run policy that lets
// Revit disconnect a fitting it cannot keep joined on reload. Revit-free; the web or Pea hands the patch to
// `families.plan` / `families.apply`.

/// <summary>Family is the loaded family name to select; Parameter is the coefficient parameter the formula fills (the FittingCoefficient slot).</summary>
public sealed record DuctFamilyPatchRequest(string Family, DuctFamilyKind Kind = DuctFamilyKind.RoundElbow, string Parameter = DuctParameterSlots.DefaultFittingCoefficient);

[Newtonsoft.Json.JsonConverter(typeof(Newtonsoft.Json.Converters.StringEnumConverter))]
public enum DuctFamilyKind {
    /// <summary>Revit's Round Elbow shape: instance Angle, Duct Radius and type Radius Multiplier (r/D); table PeElbowC over r/D, angle and D.</summary>
    [System.Runtime.Serialization.EnumMember(Value = "round-elbow")] RoundElbow
}

/// <summary>Patch is the FamilyPatch JSON as `families.plan` reads it; Rows counts the table; Sources names the ASHRAE grids behind it.</summary>
public sealed record DuctFamilyPatchData(JObject Patch, string Table, int Rows, IReadOnlyList<string> Sources, string Formula);

public static class DuctFamilyTables {
    public const string ElbowTable = "PeElbowC";

    /// <summary>The grids the elbow table is built from: (r/D, angle) to ASHRAE id. r/D 2.0 reuses 1.5; r/D 0.75 has no die-stamped grid and stays unpriced (-1).</summary>
    public static readonly IReadOnlyList<string> ElbowSources = ["CD3-2", "CD3-4", "CD3-1", "CD3-3"];

    /// <summary>
    ///     The formula Revit accepts through Family Foundry (its validator refuses the inch mark, so inches are
    ///     written as `1' / 12`): the lookup keys are rounded to the table's grid because size_lookup matches every
    ///     numeric key exactly (PROVEN 2026-10-08, lk-2-semantics). -1 is the unpriced default.
    /// </summary>
    public static string ElbowFormula(string table = ElbowTable) =>
        $"size_lookup(\"{table}\", \"C\", -1, Radius Multiplier, round(Angle / 1° / 5) * 5, round(Duct Radius * 24 / 1') * 1' / 12)";

    public static DuctFamilyPatchData Patch(DuctFamilyPatchRequest request, DuctTablesData tables) {
        if (string.IsNullOrWhiteSpace(request.Family)) throw new ArgumentException("Family is required.", nameof(request));
        if (string.IsNullOrWhiteSpace(request.Parameter)) throw new ArgumentException("Parameter is required.", nameof(request));
        var (csv, rows) = request.Kind switch {
            DuctFamilyKind.RoundElbow => ElbowCsv(tables),
            _ => throw new ArgumentOutOfRangeException(nameof(request), request.Kind, "unknown family kind")
        };
        var formula = ElbowFormula();
        var patch = new JObject {
            ["select"] = new JObject { ["names"] = new JArray(request.Family) },
            ["patch"] = new JObject {
                ["parameters"] = new JObject {
                    [request.Parameter] = new JObject {
                        ["dataType"] = "Number",
                        ["isInstance"] = true,
                        // ParamOps.Group takes a GroupTypeId TypeId or a Revit label; the TypeId is the one that never depends on LabelUtils.
                        ["propertiesGroup"] = "autodesk.parameter.group:mechanicalAirflow-1.0.0",
                        ["formula"] = formula
                    }
                },
                ["lookupTables"] = new JObject { [ElbowTable] = new JObject { ["csv"] = csv } }
            },
            // Reload may disconnect a fitting Revit cannot keep joined; accepted as a tradeoff (ruling 2026-10-08).
            ["run"] = new JObject { ["failures"] = new JObject { ["cantKeepConnectivity"] = nameof(FailureAction.Resolve) } }
        };
        return new DuctFamilyPatchData(patch, ElbowTable, rows, ElbowSources, formula);
    }

    /// <summary>
    ///     Dense PeElbowC: r/D in {1, 1.5, 2}, every 5° from 5 to 90, every inch from 3 to 60. Grids: 45° and 90° die
    ///     stamped only; angles between are linear, below 45° scale by angle/45; a diameter between grid points holds
    ///     the smaller diameter's value (conservative); r/D 2 reuses 1.5. The recipe behind the 2026-10-08 spike CSV.
    /// </summary>
    public static (string Csv, int Rows) ElbowCsv(DuctTablesData tables) {
        var grid = new Dictionary<(double RD, int Angle), AshraeGrid> {
            [(1.0, 90)] = Co(tables, "CD3-2"),
            [(1.0, 45)] = Co(tables, "CD3-4"),
            [(1.5, 90)] = Co(tables, "CD3-1"),
            [(1.5, 45)] = Co(tables, "CD3-3")
        };
        var sb = new StringBuilder();
        // The first header cell is empty: Revit ignores the first column and refuses any token there (CannotParseColumnHeader).
        sb.Append(",rD##number##general,AngleDeg##number##general,D##length##inches,C##number##general\n");
        var rows = 0;
        foreach (var (rd, src) in new[] { (1.0, 1.0), (1.5, 1.5), (2.0, 1.5) })
            for (var d = 3; d <= 60; d++) {
                var c45 = Hold(grid[(src, 45)], d);
                var c90 = Hold(grid[(src, 90)], d);
                for (var a = 5; a <= 90; a += 5) {
                    var c = a <= 45 ? c45 * a / 45 : c45 + (c90 - c45) * (a - 45) / 45;
                    sb.Append(FormattableString.Invariant($"r{rd:0.#}_a{a}_d{d},{rd:0.#},{a},{d},{Math.Round(c, 3)}\n"));
                    rows++;
                }
            }
        return (sb.ToString(), rows);
    }

    private static AshraeGrid Co(DuctTablesData tables, string id) =>
        tables.Tables.TryGetValue(id, out var t) && t.TryGetValue("Co", out var co) && co.Y is null
            ? co
            : throw new InvalidOperationException($"ASHRAE table {id} (Co over D) is required to build {ElbowTable}; read it with ducts.tables");

    /// <summary>The value at the largest grid diameter not above D, else the smallest grid value.</summary>
    private static double Hold(AshraeGrid g, double d) {
        var values = (IReadOnlyList<double>)g.Grid;
        var at = -1;
        for (var i = 0; i < g.X.Count; i++) if (g.X[i] <= d) at = i;
        return values[at < 0 ? 0 : at];
    }
}
