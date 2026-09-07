using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamManager;
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

    /// <summary>Ask Revit to canonicalize formulas without retaining any document mutation. Missing add-then-formula references remain authored until apply.</summary>
    public static FamilyModel ResolveNativeFormulas(FamilyModel desired, Document document) {
        var fm = document.FamilyManager;
        var pending = desired.Parameters.Where(p => p.Value.Formula is not null)
            .Select(p => (p.Key, p.Value, Target: fm.FindParameter(p.Key)))
            .Where(p => p.Target is not null && p.Target.Formula != p.Value.Formula).ToList();
        if (pending.Count == 0) return desired;
        var json = JObject.Parse(FamilyModelJson.Serialize(desired));
        Transaction? transaction = null;
        SubTransaction? subTransaction = null;
        var started = false;
        try {
            if (document.IsModifiable) { subTransaction = new SubTransaction(document); subTransaction.Start(); }
            else { transaction = new Transaction(document, "Interpret family formulas"); transaction.Start(); }
            started = true;
            foreach (var (name, parameter, target) in pending) {
                if (FamilyModelValidator.FormulaNames(parameter.Formula!).Any(reference => fm.FindParameter(reference) is null)) continue;
                fm.SetFormula(target!, parameter.Formula);
                document.Regenerate();
                json["parameters"]![name]!["formula"] = target!.Formula
                    ?? throw new InvalidOperationException($"Revit did not retain formula for '{name}'.");
            }
        } finally {
            if (started) {
                if (subTransaction is not null) subTransaction.RollBack();
                else transaction!.RollBack();
            }
            subTransaction?.Dispose();
            transaction?.Dispose();
        }
        return FamilyModelJson.Parse(json.ToString()).Value!;
    }

    public static FamilyPlan Reconcile(FamilyModel desired, FamilyModel current, UnitResolver units, PatchRun? run = null,
        Func<string, ExternalDefinition?>? sharedSource = null, JObject? authored = null, object? sharedDefinitions = null) {
        var refusals = desired.Unmodeled
            .Select(f => new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.UnmodeledState, f.Path, "A desired document may not carry unmodeled facts."))
            .ToList();
        if (desired.RoomCalculationPoint is { Enabled: true, Offset.Parameter: not null })
            refusals.Add(new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.UnmodeledState, "$.roomCalculationPoint.offset",
                "Room calculation point offset requires an explicit length; parameter binding is not supported."));
        if (refusals.Count > 0) return new FamilyPlan([], new OperationQueue(), refusals, [], Hash([]));
        var changes = Diff(desired, current, units);
        var names = (authored?["parameters"] as JObject)?.Properties().Where(p => p.Value is JObject).Select(p => p.Name).ToList() ?? [];
        var mappings = desired.Parameters.Where(p => names.Contains(p.Key) && NeedsNormalization(p.Key, p.Value, current, names)).ToList();
        var normalization = mappings.Count == 0 ? null : new NormalizeParamSources(desired, names,
            sharedSource ?? (_ => throw new InvalidOperationException("No shared definition source.")), mappings.Select(p => p.Key).ToList());
        var (queue, effects) = Lower(changes, desired, current, run, sharedSource, normalization);
        if (mappings.Count > 0) {
            changes = changes.Concat(mappings.Select(p => new FamilyChange("parameters.sources", p.Key, ChangeKind.Update, null,
                current.Parameters.Where(c => c.Key == p.Key || p.Value.WasNamed?.Contains(c.Key) == true).ToDictionary(c => c.Key, c => c.Value), p.Value))).ToList();
        }
        var sourceEffects = mappings.Select(p => $"normalize.sources: {p.Key}; ranked candidates={JsonConvert.SerializeObject(p.Value.WasNamed ?? [])}; fill existing blanks={p.Value.FillBlanksFromSources == true}; strategy={p.Value.MappingStrategy ?? "CoerceByStorageType"}; native replacement or copy, transfer dependencies, remove user-defined sources even when values differ (built-ins cannot be removed); explicit writes follow");
        var definitionEffects = sharedDefinitions is null || mappings.Count == 0 ? [] : new[] { "shared.definitions (tooltip supplied to native creation, readback unobservable): " + JsonConvert.SerializeObject(sharedDefinitions) };
        return new FamilyPlan(changes, queue, [], effects.Concat(sourceEffects).Concat(definitionEffects).ToList(), Hash(changes, current, run, desired, authored, sharedDefinitions));
    }

    private static bool NeedsNormalization(string name, FamilyModelParameter desired, FamilyModel current, IReadOnlyCollection<string> authoredNames) {
        var sources = desired.WasNamed ?? [];
        if (!current.Parameters.TryGetValue(name, out var have)) return desired.Shared.HasValue || sources.Count > 0;
        if (desired.Shared == false && have.Shared == true || desired.Shared == true &&
            (have.Shared != true || desired.SharedGuid != have.SharedGuid || desired.SharedSpecId != have.SharedSpecId ||
             desired.SharedVisible != have.SharedVisible || desired.SharedUserModifiable != have.SharedUserModifiable)) return true;
        if (sources.Any(source => source != name && !authoredNames.Contains(source) && current.Parameters.ContainsKey(source))) return true;
        return desired.FillBlanksFromSources == true && sources.Count > 0 && have.Formula is null && current.Types.Values.Any(row =>
            !row.TryGetValue(name, out var value) || string.IsNullOrWhiteSpace(value.Text));
    }

    /// <summary>Merge a patch fragment onto the captured current and parse it as the desired document.</summary>
    public static FamilyModelParseResult Desired(FamilyModel current, FamilyPatch patch) {
        var effective = patch.ResolveParameterRules(current);
        var captured = JObject.Parse(FamilyModelJson.Serialize(current));
        JObject merged;
        try { merged = FamilyPatch.Apply(captured, effective); }
        catch (JsonException exception) {
            return new FamilyModelParseResult(null, [new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.InvalidJson, "$", exception.Message)]);
        }
        merged.Remove("coverage");
        merged.Remove("unmodeled");
        var parsed = FamilyModelJson.Parse(merged.ToString());
        if (parsed.Value is { } candidate) {
            var observed = StructuralEntries(current).ToList();
            var renamed = false;
            foreach (var (section, key, spec) in StructuralEntries(candidate)) {
                if (effective[section] is not JObject authored || authored[key] is not JObject || captured[section]?[key] is not null) continue;
                var matches = observed.Where(entry => entry.Section == section && authored[entry.Key] is null &&
                    StructuralIdentity(entry.Spec) == StructuralIdentity(spec)).ToList();
                if (matches.Count != 1) continue;
                var old = matches[0].Key;
                ((JObject)captured[section]!)[key] = captured[section]![old]!.DeepClone();
                ((JObject)captured[section]!).Remove(old);
                if (section == "nested")
                    foreach (var array in ((JObject?)captured["arrays"])?.Properties() ?? [])
                        if ((string?)array.Value["member"] == old) array.Value["member"] = key;
                renamed = true;
            }
            if (renamed) {
                merged = FamilyPatch.Apply(captured, effective);
                merged.Remove("coverage");
                merged.Remove("unmodeled");
                parsed = FamilyModelJson.Parse(merged.ToString());
            }
        }
        var existingDiagnostics = FamilyModelValidator.Validate(current);
        var authoredSections = effective.Properties().Where(p => p.Value is not JObject o || o.HasValues)
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
        var drivenPlanes = desired.Dimensions.Values
            .Where(d => d.Label is not null || d.Locked is not null || d.Equality == true)
            .SelectMany(d => d.Between).ToHashSet(StringComparer.Ordinal);
        Keyed(changes, "refPlanes", desired.RefPlanes, current.RefPlanes, units, same: (name, want, have) => {
            var a = JObject.FromObject(want, Serializer);
            var b = JObject.FromObject(have, Serializer);
            if (drivenPlanes.Contains(name)) { a.Remove("at"); b.Remove("at"); }
            return Same(a, b, units, null);
        });
        Keyed(changes, "refLines", desired.RefLines, current.RefLines, units);
        Keyed(changes, "lookupTables", desired.LookupTables, current.LookupTables, units);
        Structural(changes, "dimensions", desired.Dimensions, current.Dimensions, units);
        Structural(changes, "forms", desired.Forms, current.Forms, units);
        Structural(changes, "nested", desired.Nested, current.Nested, units);
        Structural(changes, "arrays", desired.Arrays, current.Arrays, units);
        Structural(changes, "connectors", desired.Connectors, current.Connectors, units);
        Structural(changes, "details", desired.Details, current.Details, units);
        Singleton(changes, "settings", desired.Settings, current.Settings, units);
        if (desired.RoomCalculationPoint is { } roomPoint) {
            var actual = current.RoomCalculationPoint;
            var same = roomPoint.Enabled == (actual?.Enabled == true) && (!roomPoint.Enabled ||
                Same(roomPoint.Offset ?? PortableLength.FromFeet(1), actual?.Offset ?? PortableLength.FromFeet(1), units, null));
            if (!same) changes.Add(new FamilyChange("roomCalculationPoint", "roomCalculationPoint", ChangeKind.Update, null, actual, roomPoint));
        }

        Cascade(changes, desired);
        return Verifiability(changes, current);
    }

    public static string ConnectorKey(FamilyModelConnector c) =>
        $"{c.Domain}|{c.On}|{string.Join(",", c.At.OrderBy(a => a, StringComparer.Ordinal))}";

    internal static string StructuralIdentity(object entry) => entry switch {
        FamilyModelDim x => $"{x.Label}|{string.Join(",", x.Between)}",
        FamilyModelForm x => $"{x.SketchPlane}|{string.Join(",", OnPlanes(x).OrderBy(p => p, StringComparer.Ordinal))}|{x.Start ?? x.SketchPlane}|{x.End}",
        FamilyModelNested x => $"{x.Family}|{x.Type}|{x.Host}",
        FamilyModelArray x => $"{x.Member}|{x.Direction}|{x.Label}",
        FamilyModelConnector x => ConnectorKey(x),
        FamilyModelDetail x => $"{x.View}|{x.Family}|{x.Type}|{string.Join(",", (x.Curves?.SelectMany(l => l.Curves).Select(c => c.On ?? string.Join("+", (c.Center ?? []).OrderBy(p => p, StringComparer.Ordinal))) ?? []).OrderBy(p => p, StringComparer.Ordinal))}",
        _ => throw new ArgumentException($"No structural identity for {entry.GetType().Name}.", nameof(entry))
    };

    private static IEnumerable<(string Section, string Key, object Spec)> StructuralEntries(FamilyModel model) =>
        model.Dimensions.Select(p => ("dimensions", p.Key, (object)p.Value))
            .Concat(model.Forms.Select(p => ("forms", p.Key, (object)p.Value)))
            .Concat(model.Nested.Select(p => ("nested", p.Key, (object)p.Value)))
            .Concat(model.Arrays.Select(p => ("arrays", p.Key, (object)p.Value)))
            .Concat(model.Connectors.Select(p => ("connectors", p.Key, (object)p.Value)))
            .Concat(model.Details.Select(p => ("details", p.Key, (object)p.Value)));

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
            if (string.IsNullOrEmpty(p.Value.PropertiesGroup)) o.Remove("propertiesGroup");
            o.Remove("value");
            if (p.Value.Shared == false) o.Remove("shared");
            if (p.Value.Shared == true) o.Remove("tooltip");
            o.Remove("wasNamed");
            o.Remove("mappingStrategy");
            o.Remove("fillBlanksFromSources");
            return o;
        }, StringComparer.Ordinal);
        return (parameters, cells);
    }

    // ── section rules ──

    private static void Keyed<T>(List<FamilyChange> changes, string section, IReadOnlyDictionary<string, T> desired,
        IReadOnlyDictionary<string, T> current, UnitResolver units, Func<string, List<string>?>? wasNamed = null,
        Func<string, T, T, bool>? same = null) where T : class {
        var renamedAway = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (key, want) in desired) {
            if (current.TryGetValue(key, out var have)) {
                if (!(same?.Invoke(key, want, have) ?? Same(want, have, units, section == "parameters" ? key : null)))
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
        IReadOnlyDictionary<string, T> current, UnitResolver units) where T : class {
        var byIdentity = current.GroupBy(p => StructuralIdentity(p.Value), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var matched = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (slug, want) in desired) {
            if (byIdentity.TryGetValue(StructuralIdentity(want), out var hit)) {
                matched.Add(hit.Key);
                if (!StructuralSame(want, hit.Value, units))
                    changes.Add(new FamilyChange(section, slug, ChangeKind.Recreate, null, hit.Value, want));
                continue;
            }
            changes.Add(new FamilyChange(section, slug, ChangeKind.Add, null, null, want));
        }
        foreach (var (slug, have) in current)
            if (!matched.Contains(slug)) changes.Add(new FamilyChange(section, slug, ChangeKind.Delete, null, have, null));
    }

    private static bool StructuralSame(object want, object have, UnitResolver units) {
        var a = StructuralToken(want);
        var b = StructuralToken(have);
        // An omitted view or visibility field does not constrain native defaults.
        if (want is FamilyModelDim { View: null }) b.Remove("view");
        if (want is FamilyModelForm) {
            if (a["visibility"] is not JObject visibility) b.Remove("visibility");
            else if (b["visibility"] is JObject observed)
                foreach (var field in observed.Properties().Where(p => visibility[p.Name] is null).ToList()) field.Remove();
        }
        return TokenSame(a, b, units, null);
    }

    private static JObject StructuralToken(object value) {
        var token = JObject.FromObject(value, Serializer);
        if (value is FamilyModelConnector && token["at"] is JArray at)
            token["at"] = new JArray(at.OrderBy(x => (string?)x, StringComparer.Ordinal));
        var loopField = value is FamilyModelForm ? "profile" : "curves";
        if (value is FamilyModelForm or FamilyModelDetail && token[loopField] is JArray profile) {
            foreach (var loop in profile.OfType<JObject>()) {
                var curves = ((JArray)loop["curves"]!).ToList();
                foreach (var curve in curves.OfType<JObject>())
                    if (curve["center"] is JArray center)
                        curve["center"] = new JArray(center.OrderBy(x => (string?)x, StringComparer.Ordinal));
                // A closed loop has no distinguished first edge or traversal direction; adjacency still matters.
                if (curves.Count > 0)
                    loop["curves"] = new[] { curves, curves.AsEnumerable().Reverse().ToList() }
                        .SelectMany(order => Enumerable.Range(0, order.Count).Select(i => new JArray(order.Skip(i).Concat(order.Take(i)))))
                        .OrderBy(order => order.ToString(Formatting.None), StringComparer.Ordinal).First();
            }
            token[loopField] = new JArray(profile.OrderBy(loop => loop.ToString(Formatting.None), StringComparer.Ordinal));
        }
        return token;
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
        form.Profile?.SelectMany(l => l.Curves).Select(c => c.On ?? string.Join("+", (c.Center ?? []).OrderBy(p => p, StringComparer.Ordinal))) ?? [];

    private static string Hash(IReadOnlyList<FamilyChange> changes, FamilyModel? current = null, PatchRun? run = null, FamilyModel? desired = null, JObject? authored = null, object? sharedDefinitions = null) {
        var json = JsonConvert.SerializeObject(
            new { Changes = changes, Current = current, Run = run, Desired = desired, Authored = authored, SharedDefinitions = sharedDefinitions }, FamilyModelJson.Settings);
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(json))).Replace("-", "")[..16];
    }

    // ── lowering: the ordering DAG (r2-reconcile §4) ──

    private static (OperationQueue, IReadOnlyList<string>) Lower(IReadOnlyList<FamilyChange> changes, FamilyModel d, FamilyModel c, PatchRun? run, Func<string, ExternalDefinition?>? sharedSource, NormalizeParamSources? normalization = null) {
        var q = new OperationQueue();
        if (normalization is not null) q.Add(normalization);
        var effects = new List<string>();
        FamilyChange[] Of(string section, params ChangeKind[] kinds) => changes.Where(x => x.Section == section && kinds.Contains(x.Kind)).ToArray();
        (string Slug, T Spec)[] After<T>(string section) => Of(section, ChangeKind.Add, ChangeKind.Recreate).Select(x => (x.Key, (T)x.After!)).ToArray();
        var gone = new[] { ChangeKind.Delete, ChangeKind.Recreate };

        // 1 geometry deletes, dependents first (a labeled dim blocks DeleteParams: gotcha 21)
        foreach (var section in new[] { "details", "connectors", "arrays", "nested", "forms", "dimensions", "refLines", "refPlanes" })
            if (Of(section, gone) is { Length: > 0 } dead)
                q.Add(new DeleteByName(section, dead.Select(x => section is "refPlanes" or "refLines" ? x.Key : x.Before!).ToArray()));
        // 2 renames before adds (gotcha 26), 3 param deletes, formula length descending
        if (normalization is null && Of("parameters", ChangeKind.Rename) is { Length: > 0 } renames)
            q.Add(new RenameParams(renames.Select(x => (x.MappedFrom!, x.Key)).ToArray()));
        if (Of("parameters", ChangeKind.Delete) is { Length: > 0 } dels)
            q.Add(new DeleteParams(new DeleteParamsSettings {
                Names = dels.OrderByDescending(x => FormulaLength(x.Before)).Select(x => x.Key).ToList()
            }));
        // 4 types, 5 params + metadata (instance/type before formulas: gotcha 4)
        if (Of("types", ChangeKind.Add) is { Length: > 0 } types) q.Add(new CreateFamilyTypes(types.Select(x => x.Key).ToArray()));
        var paramAdds = Of("parameters", ChangeKind.Add).Select(x => (x.Key, d.Parameters[x.Key])).ToArray();
        if (paramAdds.Length > 0) q.Add(new AddParams(paramAdds, sharedSource));
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
            q.Add(new AddRoomDingler(new AddRoomDinglerSettings { Enabled = true }, rcp));
        // 20 run: after every add; clean never deletes a desired parameter
        if (RunSettings<CleanFamilyDocumentSettings>(run?.Clean) is { Enabled: true } clean) {
            q.Add(new CleanFamilyDocument(clean, d.Parameters.Keys));
            effects.Add("run.clean");
        }
        if (RunSettings<SortParamsSettings>(run?.Sort) is { Enabled: true } sort) {
            q.Add(new SortParams(sort));
            effects.Add("run.sort");
        }
        // 21 type deletes, last; never the last type (gotcha 11)
        if (Of("types", ChangeKind.Delete) is { Length: > 0 } deadTypes) q.Add(new DeleteFamilyTypes(deadTypes.Select(x => x.Key).ToArray()));
        return (q, effects);
    }

    private static int FormulaLength(object? before) =>
        before is JObject o ? o.Value<string>("formula")?.Length ?? 0 : (before as FamilyModelParameter)?.Formula?.Length ?? 0;

    private static T? RunSettings<T>(JToken? policy) where T : class, IOperationSettings, new() => policy switch {
        null or { Type: JTokenType.Null } => null,
        { Type: JTokenType.Boolean } => policy.Value<bool>() ? new T() : null,
        JObject settings => settings.ToObject<T>(JsonSerializer.Create(new JsonSerializerSettings { MissingMemberHandling = MissingMemberHandling.Error })),
        _ => throw new JsonSerializationException($"Run policy for {typeof(T).Name} must be a boolean or a settings object.")
    };

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
