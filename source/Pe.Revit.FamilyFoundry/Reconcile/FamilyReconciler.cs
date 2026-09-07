using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Reconcile;

public enum ChangeKind { Add, Update, Delete, Rename, Recreate, Unverifiable }

/// <summary>One difference between desired and current. Section + Key is the address; Kind is the verb.</summary>
public sealed record FamilyChange(string Section, string Key, ChangeKind Kind, string? MappedFrom, object? Before, object? After);

/// <summary>Diff, queue, refusals, run effects, hash. Refusals non-empty means the queue is empty.</summary>
public sealed record FamilyPlan(
    IReadOnlyList<FamilyChange> Changes,
    OperationQueue Queue,
    IReadOnlyList<FamilyModelDiagnostic> Refusals,
    IReadOnlyList<string> RunEffects,
    string PlanHash
) {
    /// <summary>Op type names in queue order; the deterministic tests assert this against the DAG.</summary>
    [JsonIgnore]
    public IReadOnlyList<string> OpOrder => this.Queue.Operations.Select(o => o.GetType().Name).ToList();
}

public sealed record ChangeOutcome(FamilyChange Change, LogStatus Status, string? Message);

/// <summary>Residue is Diff(desired, capture-after-apply). Residue.Count == 0 is the definition of converged.</summary>
public sealed record FamilyReceipt(
    string Family,
    string PlanHash,
    IReadOnlyList<ChangeOutcome> Outcomes,
    IReadOnlyList<string> RunEffects,
    IReadOnlyList<FamilyChange> Residue,
    IReadOnlyList<FamilyModelUnmodeledFact> Unmodeled,
    bool Converged
);

/// <summary>
///     Desired (family.json, macros already expanded by <see cref="FamilyModelJson.Parse" />) against current
///     (captured). Pure: no Document. A patch is not a second mode: <see cref="FamilyPatch.Apply" /> merges the
///     fragment onto the captured document first (<see cref="Desired" />), so one Diff serves build, patch and
///     normalize. Identity: parameters, types, datums, planes, lines, tables by exact name; dimensions by
///     label + references; forms by sketch plane + locked planes + end; nested by family + type + host; arrays by
///     member + direction + label; connectors by (domain, on, sorted at); details by view + family + type + curves.
/// </summary>
public static class FamilyReconciler {
    private const double Tolerance = 1e-9;
    private static readonly JsonSerializer Serializer = JsonSerializer.Create(FamilyModelJson.Settings);

    public static FamilyPlan Reconcile(FamilyModel desired, FamilyModel current, UnitResolver units, PatchRun? run = null) {
        var refusals = desired.Unmodeled
            .Select(f => new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.UnmodeledState, f.Path, "A desired document may not carry unmodeled facts."))
            .ToList();
        if (refusals.Count > 0) return new FamilyPlan([], new OperationQueue(), refusals, [], Hash([]));
        var changes = Diff(desired, current, units);
        var (queue, effects) = Lower(changes, desired, current, run);
        return new FamilyPlan(changes, queue, [], effects, Hash(changes, current, run));
    }

    /// <summary>Merge a patch fragment onto the captured current and parse it as the desired document.</summary>
    public static FamilyModelParseResult Desired(FamilyModel current, FamilyPatch patch) {
        var merged = FamilyPatch.Apply(JObject.Parse(FamilyModelJson.Serialize(current)), patch.Patch);
        merged.Remove("coverage");
        merged.Remove("unmodeled");
        var parsed = FamilyModelJson.Parse(merged.ToString());
        var existingDiagnostics = FamilyModelValidator.Validate(current);
        var authoredSections = patch.Patch.Properties().Where(p => p.Value is not JObject o || o.HasValues)
            .Select(p => "$." + p.Name).ToList();
        return parsed with { Diagnostics = parsed.Diagnostics.Where(d => !existingDiagnostics.Contains(d) ||
            authoredSections.Any(section => d.Path == section || d.Path.StartsWith(section + ".", StringComparison.Ordinal))).ToList() };
    }

    public static IReadOnlyList<FamilyChange> Diff(FamilyModel desired, FamilyModel current, UnitResolver units) {
        var changes = new List<FamilyChange>();
        var (dParams, dCells) = Canonical(desired);
        var (cParams, cCells) = Canonical(current);

        Keyed(changes, "parameters", dParams, cParams, units, p => desired.Parameters[p].WasNamed);
        foreach (var type in desired.Types.Keys.Where(t => !current.Types.ContainsKey(t)))
            changes.Add(new FamilyChange("types", type, ChangeKind.Add, null, null, desired.Types[type]));
        foreach (var type in current.Types.Keys.Where(t => !desired.Types.ContainsKey(t)))
            changes.Add(new FamilyChange("types", type, ChangeKind.Delete, null, current.Types[type], null));
        foreach (var (cell, want) in dCells) {
            cCells.TryGetValue(cell, out var have);
            if (have is null || !ScalarSame(want, have, units, cell[(cell.IndexOf('/') + 1)..]))
                changes.Add(new FamilyChange("types.cell", cell, ChangeKind.Update, null, have, want));
        }

        Keyed(changes, "datums", desired.Datums, current.Datums, units);
        Keyed(changes, "refPlanes", desired.RefPlanes, current.RefPlanes, units);
        Keyed(changes, "refLines", desired.RefLines, current.RefLines, units);
        Keyed(changes, "lookupTables", desired.LookupTables, current.LookupTables, units);
        Structural(changes, "dimensions", desired.Dimensions, current.Dimensions, units, x => $"{x.Label}|{string.Join(",", x.Between)}");
        Structural(changes, "forms", desired.Forms, current.Forms, units, x => $"{x.SketchPlane}|{string.Join(",", OnPlanes(x))}|{x.End}");
        Structural(changes, "nested", desired.Nested, current.Nested, units, x => $"{x.Family}|{x.Type}|{x.Host}");
        Structural(changes, "arrays", desired.Arrays, current.Arrays, units, x => $"{x.Member}|{x.Direction}|{x.Label}");
        Structural(changes, "connectors", desired.Connectors, current.Connectors, units, ConnectorKey);
        Structural(changes, "details", desired.Details, current.Details, units,
            x => $"{x.View}|{x.Family}|{x.Type}|{string.Join(",", x.Curves?.SelectMany(l => l.Curves).Select(c => c.On) ?? [])}");
        Singleton(changes, "settings", desired.Settings, current.Settings, units);
        Singleton(changes, "roomCalculationPoint", desired.RoomCalculationPoint, current.RoomCalculationPoint, units);

        Cascade(changes, desired);
        return Verifiability(changes, current);
    }

    public static string ConnectorKey(FamilyModelConnector c) =>
        $"{c.Domain}|{c.On}|{string.Join(",", c.At.OrderBy(a => a, StringComparer.Ordinal))}";

    // ── canonical form (F7): the uniform value becomes a cell in every type; parameters diff without it ──

    private static (Dictionary<string, JObject> Params, Dictionary<string, string> Cells) Canonical(FamilyModel m) {
        var cells = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (type, row) in m.Types)
            foreach (var (param, value) in row) cells[$"{type}/{param}"] = value.Text;
        foreach (var (name, p) in m.Parameters)
            if (p.Value is { } v)
                foreach (var type in m.Types.Keys) cells.TryAdd($"{type}/{name}", v.Text);
        var parameters = m.Parameters.ToDictionary(p => p.Key, p => {
            var o = JObject.FromObject(p.Value, Serializer);
            o.Remove("value");
            o.Remove("wasNamed");
            return o;
        }, StringComparer.Ordinal);
        return (parameters, cells);
    }

    // ── section rules ──

    private static void Keyed<T>(List<FamilyChange> changes, string section, IReadOnlyDictionary<string, T> desired,
        IReadOnlyDictionary<string, T> current, UnitResolver units, Func<string, List<string>?>? wasNamed = null) where T : class {
        var renamedAway = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (key, want) in desired) {
            if (current.TryGetValue(key, out var have)) {
                if (!Same(want, have, units, section == "parameters" ? key : null))
                    changes.Add(new FamilyChange(section, key, IsGeometry(section) ? ChangeKind.Recreate : ChangeKind.Update, null, have, want));
                continue;
            }
            var source = wasNamed?.Invoke(key)?.FirstOrDefault(current.ContainsKey);
            if (source is null) changes.Add(new FamilyChange(section, key, ChangeKind.Add, null, null, want));
            else {
                renamedAway.Add(source);
                changes.Add(new FamilyChange(section, key, ChangeKind.Rename, source, current[source], want));
            }
        }
        foreach (var (key, have) in current)
            if (!desired.ContainsKey(key) && !renamedAway.Contains(key))
                changes.Add(new FamilyChange(section, key, ChangeKind.Delete, null, have, null));
    }

    private static void Structural<T>(List<FamilyChange> changes, string section, IReadOnlyDictionary<string, T> desired,
        IReadOnlyDictionary<string, T> current, UnitResolver units, Func<T, string> identity) where T : class {
        var byIdentity = current.GroupBy(p => identity(p.Value), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var matched = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (slug, want) in desired) {
            if (byIdentity.TryGetValue(identity(want), out var hit)) {
                matched.Add(hit.Key);
                if (!Same(want, hit.Value, units, null))
                    changes.Add(new FamilyChange(section, slug, ChangeKind.Recreate, null, hit.Value, want));
                continue;
            }
            changes.Add(new FamilyChange(section, slug, ChangeKind.Add, null, null, want));
        }
        foreach (var (slug, have) in current)
            if (!matched.Contains(slug)) changes.Add(new FamilyChange(section, slug, ChangeKind.Delete, null, have, null));
    }

    private static void Singleton<T>(List<FamilyChange> changes, string section, T? want, T? have, UnitResolver units) where T : class {
        if (want is null) return; // omitted means leave what the template produced
        if (have is not null && Same(want, have, units, null)) return;
        changes.Add(new FamilyChange(section, section, ChangeKind.Update, null, have, want));
    }

    /// <summary>Verdict 4: a changed plane or line takes every desired entry that references it down with it.</summary>
    private static void Cascade(List<FamilyChange> changes, FamilyModel d) {
        var dying = changes
            .Where(c => c.Section is "refPlanes" or "refLines" or "datums" && c.Kind is ChangeKind.Recreate or ChangeKind.Delete)
            .Select(c => c.Key).ToHashSet(StringComparer.Ordinal);
        var recreated = changes.Where(c => c.Kind is ChangeKind.Recreate or ChangeKind.Add)
            .Select(c => $"{c.Section}:{c.Key}").ToHashSet(StringComparer.Ordinal);

        bool Dies(string? name) => name is not null && (dying.Contains(name) ||
            (name.StartsWith("line:", StringComparison.Ordinal) && name.LastIndexOf('.') > 5 && dying.Contains(name[5..name.LastIndexOf('.')])));

        void Mark<T>(string section, IReadOnlyDictionary<string, T> entries, Func<T, IEnumerable<string?>> refs) where T : class {
            foreach (var (slug, e) in entries) {
                if (recreated.Contains($"{section}:{slug}") || !refs(e).Any(Dies)) continue;
                var i = changes.FindIndex(c => c.Section == section && c.Key == slug);
                if (i >= 0) changes[i] = changes[i] with { Kind = ChangeKind.Recreate };
                else changes.Add(new FamilyChange(section, slug, ChangeKind.Recreate, null, e, e));
                recreated.Add($"{section}:{slug}");
                if (section is "refLines") dying.Add(slug);
                if (section is "nested") dying.Add("nested:" + slug);
            }
        }

        Mark("refLines", d.RefLines, l => new[] { l.On, l.AngleFrom }.Concat(l.From));
        Mark("dimensions", d.Dimensions, x => x.Between);
        Mark("forms", d.Forms, f => new[] { f.SketchPlane, f.Start, f.End }
            .Concat(f.Profile?.SelectMany(l => l.Curves).SelectMany(c => new[] { c.On }.Concat(c.Center ?? [])) ?? []));
        Mark("nested", d.Nested, n => new[] { n.Host }.Concat(n.Align?.Select(a => a.To) ?? []));
        Mark("arrays", d.Arrays, a => new[] { a.SpacingPlane, "nested:" + a.Member });
        Mark("connectors", d.Connectors, c => new[] { c.On }.Concat(c.At));
        Mark("details", d.Details, x => (x.Align?.Select(a => a.To) ?? []).Concat(x.Curves?.SelectMany(l => l.Curves).Select(c => c.On) ?? []));
    }

    /// <summary>F6/F9: a change in a section capture did not fully read is Unverifiable by construction.</summary>
    private static List<FamilyChange> Verifiability(List<FamilyChange> changes, FamilyModel current) {
        if (current.Coverage.Count == 0) return changes; // authored current: fully stated
        return changes.Select(c => {
            var section = c.Section == "types.cell" ? "types" : c.Section;
            var state = current.Coverage.TryGetValue(section, out var s) ? s : CoverageState.NotRead;
            return state == CoverageState.Read ? c : c with { Kind = ChangeKind.Unverifiable };
        }).ToList();
    }

    // ── equality through units ──

    private static bool Same(object want, object have, UnitResolver units, string? parameter) =>
        TokenSame(JToken.FromObject(want, Serializer), JToken.FromObject(have, Serializer), units, parameter);

    private static bool TokenSame(JToken a, JToken b, UnitResolver units, string? parameter) {
        if (a is JObject oa && b is JObject ob) {
            var keys = oa.Properties().Select(p => p.Name).Union(ob.Properties().Select(p => p.Name)).ToList();
            return keys.All(k => oa[k] is { } x && ob[k] is { } y && TokenSame(x, y, units, parameter));
        }
        if (a is JArray xa && b is JArray xb)
            return xa.Count == xb.Count && xa.Zip(xb, (x, y) => TokenSame(x, y, units, parameter)).All(t => t);
        if (a.Type == JTokenType.String && b.Type == JTokenType.String)
            return ScalarSame((string)a!, (string)b!, units, parameter);
        return JToken.DeepEquals(a, b);
    }

    private static bool ScalarSame(string a, string b, UnitResolver units, string? parameter) {
        if (PortableScalar.TryParse(a, out var x) && PortableScalar.TryParse(b, out var y)) {
            if (x.Kind != y.Kind) return false;
            var (va, vb) = x.Kind == PortableScalarKind.Length ? (x.Feet, y.Feet) : (x.Value, y.Value);
            return Math.Abs(va - vb) < Tolerance;
        }
        if (parameter is not null && units(parameter, a, out var ua) && units(parameter, b, out var ub)) return Math.Abs(ua - ub) < Tolerance;
        return string.Equals(a.Trim(), b.Trim(), StringComparison.Ordinal);
    }

    private static bool IsGeometry(string section) => section is "refPlanes" or "refLines" or "datums";

    private static IEnumerable<string> OnPlanes(FamilyModelForm form) =>
        form.Profile?.SelectMany(l => l.Curves).Select(c => c.On ?? string.Join("+", c.Center ?? [])) ?? [];

    private static string Hash(IReadOnlyList<FamilyChange> changes, FamilyModel? current = null, PatchRun? run = null) {
        var json = JsonConvert.SerializeObject(
            new { Changes = changes, Current = current, Run = run }, FamilyModelJson.Settings);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))[..16];
    }

    // ── lowering: the ordering DAG (r2-reconcile §4) ──

    private static (OperationQueue, IReadOnlyList<string>) Lower(IReadOnlyList<FamilyChange> changes, FamilyModel d, FamilyModel c, PatchRun? run) {
        var q = new OperationQueue();
        var effects = new List<string>();
        FamilyChange[] Of(string section, params ChangeKind[] kinds) => changes.Where(x => x.Section == section && kinds.Contains(x.Kind)).ToArray();
        (string Slug, T Spec)[] After<T>(string section) => Of(section, ChangeKind.Add, ChangeKind.Recreate).Select(x => (x.Key, (T)x.After!)).ToArray();
        var gone = new[] { ChangeKind.Delete, ChangeKind.Recreate };

        // 1 geometry deletes, dependents first (a labeled dim blocks DeleteParams: gotcha 21)
        foreach (var section in new[] { "details", "connectors", "arrays", "nested", "forms", "dimensions", "refLines", "refPlanes" })
            if (Of(section, gone) is { Length: > 0 } dead)
                q.Add(new DeleteByName(section, dead.Select(x => section is "refPlanes" or "refLines" ? x.Key : x.Before!).ToArray()));
        // 2 renames before adds (gotcha 26), 3 param deletes, formula length descending
        if (Of("parameters", ChangeKind.Rename) is { Length: > 0 } renames)
            q.Add(new RenameParams(renames.Select(x => (x.MappedFrom!, x.Key)).ToArray()));
        if (Of("parameters", ChangeKind.Delete) is { Length: > 0 } dels)
            q.Add(new DeleteParams(new DeleteParamsSettings {
                Names = dels.OrderByDescending(x => FormulaLength(x.Before)).Select(x => x.Key).ToList()
            }));
        // 4 types, 5 params + metadata (instance/type before formulas: gotcha 4)
        if (Of("types", ChangeKind.Add) is { Length: > 0 } types) q.Add(new CreateFamilyTypes(types.Select(x => x.Key).ToArray()));
        var paramAdds = Of("parameters", ChangeKind.Add).Select(x => (x.Key, d.Parameters[x.Key])).ToArray();
        if (paramAdds.Length > 0) q.Add(new AddParams(paramAdds));
        var metadata = Of("parameters", ChangeKind.Add, ChangeKind.Update, ChangeKind.Rename).Select(x => (x.Key, d.Parameters[x.Key])).ToArray();
        if (metadata.Length > 0) q.Add(new SetParamMetadata(metadata));
        // 6 clear formulas that become values
        var clear = d.Parameters
            .Where(p => p.Value.Formula is null && c.Parameters.TryGetValue(p.Key, out var have) && have.Formula is not null)
            .Select(p => p.Key).ToArray();
        if (clear.Length > 0) q.Add(new ClearFormulas(clear));
        // 7 lookup tables (size_lookup formulas name the table)
        if (Of("lookupTables", ChangeKind.Add, ChangeKind.Update) is { Length: > 0 } tables)
            q.Add(SetLookupTables.FromCsv(tables.Select(x => (x.Key, ((FamilyModelLookupTable)x.After!).Csv))));
        // 8 values (per-type cells), then run.blanksBecome
        var cells = Of("types.cell", ChangeKind.Update);
        if (cells.Length > 0) q.Add(new SetKnownParams(Values(cells)));
        if (run?.BlanksBecome is { Count: > 0 } rules) {
            q.Add(new SetBlankValues(rules));
            effects.Add($"run.blanksBecome: {rules.Count} rules");
        }
        // 9-11 planes, lines, dims
        if (After<FamilyModelRefPlane>("refPlanes") is { Length: > 0 } planes) q.Add(new MakeRefPlanes(planes));
        if (After<FamilyModelRefLine>("refLines") is { Length: > 0 } lines) q.Add(new MakeRefLines(lines, d));
        if (After<FamilyModelDim>("dimensions") is { Length: > 0 } dims) q.Add(new MakeDims(dims, d));
        // 12 formulas, after dims (a labeled dim on a formula-driven param regenerates against the formula)
        var formulas = d.Parameters
            .Where(p => p.Value.Formula is not null && (!c.Parameters.TryGetValue(p.Key, out var have) || have.Formula != p.Value.Formula))
            .ToArray();
        if (formulas.Length > 0)
            q.Add(new SetKnownParams(new SetKnownParamsSettings {
                GlobalAssignments = formulas.Select(p => new GlobalParamAssignment { Parameter = p.Key, Kind = ParamAssignmentKind.Formula, Value = p.Value.Formula! }).ToList()
            }));
        // 13-17 forms, nested, arrays, connectors, details
        if (After<FamilyModelForm>("forms") is { Length: > 0 } forms) q.Add(new MakeForms(forms, d));
        if (After<FamilyModelNested>("nested") is { Length: > 0 } nested) q.Add(new PlaceNested(nested, d));
        if (After<FamilyModelArray>("arrays") is { Length: > 0 } arrays) q.Add(new MakeArrays(arrays, d));
        if (After<FamilyModelConnector>("connectors") is { Length: > 0 } connectors) q.Add(new MakeConnectors(connectors, d));
        if (After<FamilyModelDetail>("details") is { Length: > 0 } details) q.Add(new PlaceDetails(details, d));
        // 18 visibility: the element and the Yes/No parameter both exist now
        var visible = After<FamilyModelForm>("forms").Where(f => f.Spec.Visible is not null).Select(f => (f.Slug, "forms", f.Spec.Visible!))
            .Concat(After<FamilyModelNested>("nested").Where(n => n.Spec.Visible is not null).Select(n => (n.Slug, "nested", n.Spec.Visible!)))
            .Concat(After<FamilyModelDetail>("details").Where(x => x.Spec.Visible is not null).Select(x => (x.Slug, "details", x.Spec.Visible!)))
            .ToArray();
        if (visible.Length > 0) q.Add(new SetVisibility(visible, d));
        // 19 family-level
        if (Of("settings", ChangeKind.Update).Length > 0 && d.Settings is { } settings) q.Add(new SetFamilySettings(settings));
        if (Of("roomCalculationPoint", ChangeKind.Update).Length > 0 && d.RoomCalculationPoint is { } rcp)
            q.Add(new AddRoomDingler(new AddRoomDinglerSettings { Enabled = rcp.Enabled, OffsetFeet = rcp.Offset?.Feet ?? 1.0 }));
        // 20 run: after every add; clean never deletes a desired parameter
        if (run?.Clean == true) {
            q.Add(new CleanFamilyDocument(new CleanFamilyDocumentSettings(), d.Parameters.Keys));
            effects.Add("run.clean");
        }
        if (run?.Sort == true) {
            q.Add(new SortParams(new SortParamsSettings()));
            effects.Add("run.sort");
        }
        // 21 type deletes, last; never the last type (gotcha 11)
        if (Of("types", ChangeKind.Delete) is { Length: > 0 } deadTypes) q.Add(new DeleteFamilyTypes(deadTypes.Select(x => x.Key).ToArray()));
        return (q, effects);
    }

    private static int FormulaLength(object? before) =>
        before is JObject o ? o.Value<string>("formula")?.Length ?? 0 : (before as FamilyModelParameter)?.Formula?.Length ?? 0;

    private static SetKnownParamsSettings Values(FamilyChange[] cells) {
        var rows = new Dictionary<string, PerTypeAssignmentRow>(StringComparer.Ordinal);
        foreach (var cell in cells) {
            var slash = cell.Key.IndexOf('/');
            var (type, param) = (cell.Key[..slash], cell.Key[(slash + 1)..]);
            if (!rows.TryGetValue(param, out var row)) rows[param] = row = new PerTypeAssignmentRow { Parameter = param };
            row.ValuesByType[type] = (string)cell.After!;
        }
        return new SetKnownParamsSettings { PerTypeAssignmentsTable = rows.Values.ToList() };
    }
}
