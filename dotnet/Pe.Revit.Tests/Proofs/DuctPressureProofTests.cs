using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.DB.Mechanical;
using Newtonsoft.Json;
using Pe.Revit.Global.Lib.Mep;
using Serilog;
using System.Globalization;

namespace Pe.Revit.Tests.Proofs;

/// <summary>
///     Pressure-drop campaign proofs on the user's detached 320 MB MEP fixture (env PE_PDROP_FIXTURE). Each test opens it,
///     runs inside one TransactionGroup that is ROLLED BACK (never committed, never saved), and writes its facts as JSON
///     under .artifacts/runs/pdrop-proofs-20261004 in a finally block so the evidence survives a failed assertion.
///     Lifted from DuctApplier (private): the engine switch, the Not Defined then Specific Coefficient write recipe, the
///     Coefficient field. Lifted from DuctSnapshots (private): the in-wg / fpm / cfm parameter readers. Never reads
///     Connector.Flow: it is an access violation under network-based calculations (pdrop-w3).
/// </summary>
[TestFixture]
public sealed class DuctPressureProofTests {
    private const string FixtureVariable = "PE_PDROP_FIXTURE";
    private const string OutDir = @"C:\Users\kaitp\source\repos\Pe.Tools-pdrop\.artifacts\runs\pdrop-proofs-20261004";
    private const long TargetTerminal = 5873746;

    private static readonly Guid NotDefined = new("76eff5da-2e71-45f7-b940-cc5716328ba0");
    private static readonly Guid SpecificCoefficient = new("5a598293-1504-46cc-a9c0-de55c82848b9");
    private static readonly ForgeTypeId InWg = UnitTypeId.InchesOfWater60DegreesFahrenheit;

    [Test]
    public void TapSingleCoefficientVelocityPressureBasis(UIApplication uiapp) {
        var facts = new Dictionary<string, object?> { ["test"] = nameof(this.TapSingleCoefficientVelocityPressureBasis) };
        Document? doc = null;
        var owned = false;
        TransactionGroup? group = null;
        var measured = new List<Dictionary<string, object?>>();
        try {
            (doc, owned) = Fixture(uiapp, facts);
            group = new TransactionGroup(doc, "pdrop proof: tap coefficient basis");
            _ = group.Start();

            facts["engineBefore"] = DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations;
            Run(doc, "engine on", () => DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations = true);
            facts["engineAfter"] = DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations;

            // Three through-flow taps (run 2 read a slope of 0.02426 on tap 6648809, a velocity no adjacent duct reports)
            // plus one plain elbow as the calibration control for C x Pv on a two-port fitting.
            foreach (var tap in QualifyingTaps(doc, facts, 3)) {
                var m = Measure(doc, tap.Id, "tap");
                m["branch"] = DuctFacts(doc, tap.BranchId);
                m["mains"] = tap.MainIds.Select(id => DuctFacts(doc, id)).ToList();
                m["candidates"] = Candidates(doc, m, tap.MainSet.Prepend(tap.BranchId).Distinct().ToList());
                measured.Add(m);
            }
            facts["taps"] = measured;

            var elbow = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DuctFitting).WhereElementIsNotElementType()
                .OfType<FamilyInstance>()
                .Where(f => f.MEPModel is MechanicalFitting { PartType: PartType.Elbow })
                .Select(f => (Fitting: f, Ducts: Neighbours(f).Where(n => n.Other is MEPCurve).Select(n => n.Other.Id.Value()).Distinct().ToList()))
                .FirstOrDefault(x => x.Ducts.Count == 2 && x.Ducts.All(d => VelocityFpm(doc, d) is > 400));
            if (elbow.Fitting is not null) {
                var m = Measure(doc, elbow.Fitting.Id.Value(), "elbow");
                m["ducts"] = elbow.Ducts.Select(id => DuctFacts(doc, id)).ToList();
                m["candidates"] = Candidates(doc, m, elbow.Ducts);
                facts["elbow"] = m;
            }
        } catch (Exception ex) {
            facts["error"] = ex.ToString();
            Log.Error(ex, "pdrop tap proof failed");
            throw;
        } finally {
            Finish(doc, owned, group, nameof(this.TapSingleCoefficientVelocityPressureBasis), facts);
        }
        Assert.Multiple(() => {
            Assert.That(measured, Is.Not.Empty, "no through-flow tap qualified; see JSON");
            foreach (var m in measured) Assert.That(m["linear"], Is.True, $"tap {m["id"]} loss is not linear in C; see JSON");
        });
    }

    /// <summary>Write C = 1, 2, 4 on one fitting and read Revit's loss each time: slope, intercept, linearity, plus the fitting's own facts.</summary>
    private static Dictionary<string, object?> Measure(Document doc, long id, string kind) {
        var e = (FamilyInstance)doc.GetElement(id.ToElementId());
        var m = new Dictionary<string, object?> {
            ["id"] = id, ["kind"] = kind, ["family"] = e.Symbol?.FamilyName, ["type"] = e.Symbol?.Name,
            ["partType"] = (e.MEPModel as MechanicalFitting)?.PartType.ToString(),
            ["lossMethodBefore"] = e.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM)?.AsString(),
            ["lossBeforeInWg"] = LossInWg(doc, id),
            ["connectors"] = DuctSnapshots.HvacConnectors(e).Select(c => new Dictionary<string, object?> {
                ["type"] = c.ConnectorType.ToString(), ["direction"] = c.Direction.ToString(), ["shape"] = c.Shape.ToString(),
                ["sizeIn"] = c.Shape == ConnectorProfileType.Round ? $"{c.Radius * 24:0.##} dia" : $"{c.Width * 12:0.##} x {c.Height * 12:0.##}",
                ["areaSqFt"] = c.Shape == ConnectorProfileType.Round ? Math.PI * c.Radius * c.Radius : c.Width * c.Height,
                ["connected"] = c.IsConnected,
                ["other"] = c.IsConnected ? c.AllRefs.OfType<Connector>().Select(r => r.Owner?.Id.Value()).FirstOrDefault(o => o != id) : null,
            }).ToList(),
        };
        var losses = new Dictionary<string, object?>();
        foreach (var c in new[] { 1.0, 2.0, 4.0 }) {
            WriteCoefficient(doc, id, c);
            losses[c.ToString(CultureInfo.InvariantCulture)] = LossInWg(doc, id);
        }
        m["lossByCoefficient"] = losses;
        m["lossMethodAfter"] = e.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM)?.AsString();
        m["parametersAfter"] = e.Parameters.Cast<Parameter>()
            .Where(p => p.Definition.Name is { } n && (n.Contains("Velocity") || n.Contains("Flow") || n.Contains("Coefficient") || n.Contains("Pressure") || n.Contains("Loss")))
            .GroupBy(p => p.Definition.Name).Select(g => g.First())
            .ToDictionary(p => p.Definition.Name, p => (object?)(p.StorageType == StorageType.Double ? p.AsValueString() ?? p.AsDouble().ToString(CultureInfo.InvariantCulture) : p.AsValueString() ?? p.AsString()));
        var l1 = losses["1"] as double?;
        var l2 = losses["2"] as double?;
        var l4 = losses["4"] as double?;
        var slope = l1 is { } a && l2 is { } b ? (double?)(b - a) : null;
        var slope24 = l2 is { } b2 && l4 is { } d ? (double?)((d - b2) / 2) : null;
        m["slopeInWgPerC"] = slope;
        m["slope24InWgPerC"] = slope24;
        m["interceptInWg"] = l1 is { } a1 && slope is { } s1 ? a1 - s1 : null;
        m["linear"] = slope is { } sa && slope24 is { } sb && Math.Abs(sa - sb) <= Math.Max(0.0002, 0.02 * Math.Abs(sa));
        m["slopeVelocityFpm"] = slope is > 0 ? 4005.0 * Math.Sqrt(slope.Value) : null;

        // Run 3 read the fitting parameter as C x (Pv branch + Pv main downstream) while the palette showed C x Pv branch.
        // The sections say what the critical path actually charges: per section, the coefficient and drop for this member.
        WriteCoefficient(doc, id, 1.0);
        m["lossAtC1AgainInWg"] = LossInWg(doc, id);
        m["pressureParams"] = e.Parameters.Cast<Parameter>()
            .Where(p => p.StorageType == StorageType.Double && p.Definition.Name is { } n && n.Contains("Pressure"))
            .Select(p => new Dictionary<string, object?> {
                ["name"] = p.Definition.Name, ["id"] = p.Id.Value(), ["builtIn"] = (p.Definition as InternalDefinition)?.BuiltInParameter.ToString(),
                ["inWg"] = UnitUtils.ConvertFromInternalUnits(p.AsDouble(), InWg), ["display"] = p.AsValueString(),
            }).ToList();
        m["sections"] = SectionCharges(doc, id);
        return m;
    }

    private static HashSet<int> Critical(MechanicalSystem system) {
        try { return [.. system.GetCriticalPathSectionNumbers() ?? []]; } catch (Exception) { return []; }
    }

    /// <summary>Every section of every mechanical system that counts this element as a member: its flow, and the coefficient and drop it charges the element.</summary>
    private static List<Dictionary<string, object?>> SectionCharges(Document doc, long id) {
        var eid = id.ToElementId();
        var rows = new List<Dictionary<string, object?>>();
        foreach (var system in new FilteredElementCollector(doc).OfClass(typeof(MechanicalSystem)).Cast<MechanicalSystem>()) {
            int count;
            try { count = system.SectionsCount; } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) { continue; }
            for (var k = 1; k <= count; k++) {
                MEPSection section;
                try { section = system.GetSectionByNumber(k); } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) { continue; }
                if (section is null) continue;
                var members = section.GetElementIds();
                if (members is null || !members.Contains(eid)) continue;
                var row = new Dictionary<string, object?> {
                    ["system"] = system.Name, ["systemId"] = system.Id.Value(), ["section"] = k,
                    ["flowCfm"] = UnitUtils.ConvertFromInternalUnits(section.Flow, UnitTypeId.CubicFeetPerMinute),
                    ["totalLossInWg"] = UnitUtils.ConvertFromInternalUnits(section.TotalPressureLoss, InWg),
                    ["members"] = members.Count,
                    ["onCriticalPath"] = Critical(system).Contains(k),
                };
                try { row["coefficient"] = section.GetCoefficient(eid); } catch (Exception ex) { row["coefficientError"] = ex.Message; }
                try { row["dropInWg"] = UnitUtils.ConvertFromInternalUnits(section.GetPressureDrop(eid), InWg); } catch (Exception ex) { row["dropError"] = ex.Message; }
                rows.Add(row);
            }
        }
        return rows;
    }

    /// <summary>Each adjacent duct's Pv against the measured slope; the one nearest a ratio of 1 is the basis Revit used.</summary>
    private static List<Dictionary<string, object?>> Candidates(Document doc, Dictionary<string, object?> m, List<long> ductIds) {
        var slope = m["slopeInWgPerC"] as double?;
        var list = ductIds.Select(id => {
            var v = VelocityFpm(doc, id);
            var pv = v is { } vv ? Pv(vv) : (double?)null;
            return new Dictionary<string, object?> {
                ["ductId"] = id, ["flowCfm"] = FlowCfm(doc, id), ["velocityFpm"] = v, ["pvInWg"] = pv,
                ["slopeOverPv"] = slope is { } s && pv is > 0 ? s / pv : null,
            };
        }).ToList();
        var best = list.Where(c => c["slopeOverPv"] is double).OrderBy(c => Math.Abs((double)c["slopeOverPv"]! - 1)).FirstOrDefault();
        m["bestBasisDuct"] = best?["ductId"];
        m["bestSlopeOverPv"] = best?["slopeOverPv"];
        return list;
    }

    private static List<Tap> QualifyingTaps(Document doc, Dictionary<string, object?> facts, int max) {
        var all = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DuctFitting).WhereElementIsNotElementType().ToElements()
            .OfType<FamilyInstance>()
            .Where(f => f.MEPModel is MechanicalFitting { PartType: PartType.TapAdjustable }
                        || (f.Symbol?.FamilyName ?? "").Contains("Takeoff", StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f.Id.Value())
            .ToList();
        facts["tapCandidates"] = all.Count;
        var taps = new List<Tap>();
        foreach (var f in all) {
            var tap = Qualify(doc, f);
            if (tap is null) continue;
            var qb = FlowCfm(doc, tap.BranchId) ?? 0;
            var qc = tap.MainSet.Select(mm => FlowCfm(doc, mm) ?? 0).DefaultIfEmpty(0).Max();
            if (qb < 30 || qc < 1.5 * qb || VelocityFpm(doc, tap.BranchId) is not > 300) continue;
            taps.Add(tap);
            if (taps.Count >= max) break;
        }
        facts["tapsQualified"] = taps.Count;
        return taps;
    }

    [Test]
    public void TerminalFlowUnderNetworkBasedCalculations(UIApplication uiapp) {
        var facts = new Dictionary<string, object?> { ["test"] = nameof(this.TerminalFlowUnderNetworkBasedCalculations) };
        Document? doc = null;
        var owned = false;
        TransactionGroup? group = null;
        try {
            (doc, owned) = Fixture(uiapp, facts);
            group = new TransactionGroup(doc, "pdrop proof: terminal flow");
            _ = group.Start();

            facts["engineBefore"] = DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations;
            var ids = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DuctTerminal)
                .WhereElementIsNotElementType().ToElementIds().Select(id => id.Value()).ToList();
            facts["terminalCount"] = ids.Count;
            facts["targetPresent"] = ids.Contains(TargetTerminal);

            var before = ids.ToDictionary(id => id, id => TerminalFacts(doc, id));
            Run(doc, "engine on", () => DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations = true);
            facts["engineAfter"] = DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations;
            var after = ids.ToDictionary(id => id, id => TerminalFacts(doc, id));

            bool Has(TerminalFact f) => f.FlowCfm is > 1e-9;
            var lost = ids.Where(id => Has(before[id]) && !Has(after[id])).ToList();
            var kept = ids.Where(id => Has(before[id]) && Has(after[id])).ToList();
            facts["hadFlowBefore"] = ids.Count(id => Has(before[id]));
            facts["lostCount"] = lost.Count;
            facts["keptCount"] = kept.Count;
            facts["lostIds"] = lost;
            facts["signatures"] = ids.Where(id => Has(before[id]))
                .GroupBy(id => before[id].Signature)
                .Select(g => new Dictionary<string, object?> {
                    ["signature"] = g.Key, ["lost"] = g.Count(lost.Contains), ["kept"] = g.Count(kept.Contains)
                }).OrderByDescending(s => (int)s["lost"]!).ToList();

            if (before.ContainsKey(TargetTerminal)) {
                facts["targetBefore"] = before[TargetTerminal];
                facts["targetAfterFlip"] = after[TargetTerminal];
            }
            var keptId = kept.Where(id => id != TargetTerminal).FirstOrDefault();
            if (keptId != 0) {
                facts["keptId"] = keptId;
                facts["keptBefore"] = before[keptId];
                facts["keptAfterFlip"] = after[keptId];
            }

            // Does a flow Pe writes survive? Write 77 cfm on the target and read it back after regeneration.
            var write = new Dictionary<string, object?>();
            facts["write77"] = write;
            if (before.ContainsKey(TargetTerminal)) {
                Run(doc, "write terminal flow", () => {
                    var p = doc.GetElement(TargetTerminal.ToElementId()).get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_PARAM);
                    write["parameterNull"] = p is null;
                    write["isReadOnly"] = p?.IsReadOnly;
                    try {
                        write["setReturned"] = p?.Set(UnitUtils.ConvertToInternalUnits(78.0, UnitTypeId.CubicFeetPerMinute));
                    } catch (Exception ex) {
                        write["setThrew"] = ex.GetType().FullName + ": " + ex.Message;
                    }
                });
                write["after"] = TerminalFacts(doc, TargetTerminal);
                // Is the designer's 77 destroyed or only masked? Flip the engine back and read again.
                Run(doc, "engine off", () => DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations = false);
                write["afterFlipBack"] = TerminalFacts(doc, TargetTerminal);
                write["keptAfterFlipBack"] = TerminalFacts(doc, (long)facts["keptId"]!);
                Run(doc, "engine on again", () => DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations = true);
                write["afterReflip"] = TerminalFacts(doc, TargetTerminal);
            }
            Log.Information("pdrop terminals: {Lost} lost, {Kept} kept of {Total}", lost.Count, kept.Count, ids.Count);
        } catch (Exception ex) {
            facts["error"] = ex.ToString();
            Log.Error(ex, "pdrop terminal proof failed");
            throw;
        } finally {
            Finish(doc, owned, group, nameof(this.TerminalFlowUnderNetworkBasedCalculations), facts);
        }
        Assert.That(facts.ContainsKey("lostCount") && facts.ContainsKey("write77"), Is.True, "facts were not recorded; see JSON");
    }

    // ---- gate, evidence, transactions

    /// <summary>
    /// The session's active project document, or a headless-opened project document, when one is open (the attached rung: `pe-revit doc open --detach` has
    /// already dismissed the link and hatch warning dialogs that block a raw OpenDocumentFile inside a test, FALSIFIED
    /// 2026-10-04 on the fresh rung); otherwise the PE_PDROP_FIXTURE file, which the test then owns and closes.
    /// </summary>
    private static (Document doc, bool owned) Fixture(UIApplication uiapp, Dictionary<string, object?> facts) {
        var active = uiapp.ActiveUIDocument?.Document
            ?? uiapp.Application.Documents.Cast<Document>().FirstOrDefault(d => !d.IsFamilyDocument && !d.IsLinked);
        if (active is { IsFamilyDocument: false }) {
            facts["fixture"] = active.PathName;
            facts["opened"] = active.Title;
            facts["owned"] = false;
            return (active, false);
        }
        var path = FixturePath();
        var doc = uiapp.Application.OpenDocumentFile(path);
        facts["fixture"] = path;
        facts["opened"] = doc.Title;
        facts["owned"] = true;
        return (doc, true);
    }

    private static string FixturePath() {
        var path = Environment.GetEnvironmentVariable(FixtureVariable);
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) {
            Assert.Ignore($"{FixtureVariable} is unset or names a missing file ({path ?? "unset"}); the pressure-drop proofs need the detached MEP fixture.");
        }
        return path!;
    }

    private static void Finish(Document? doc, bool owned, TransactionGroup? group, string name, Dictionary<string, object?> facts) {
        try {
            if (group is { } g && g.HasStarted() && !g.HasEnded()) facts["groupRollBack"] = g.RollBack().ToString();
        } catch (Exception ex) {
            facts["groupRollBackError"] = ex.Message;
            Log.Error(ex, "pdrop {Test} group rollback", name);
        }
        try {
            if (owned) doc?.Close(false);
            facts["closed"] = owned && doc is not null;
        } catch (Exception ex) {
            facts["closeError"] = ex.Message;
            Log.Error(ex, "pdrop {Test} close", name);
        }
        _ = Directory.CreateDirectory(OutDir);
        File.WriteAllText(Path.Combine(OutDir, name + ".json"), JsonConvert.SerializeObject(facts, Formatting.Indented));
    }

    /// <summary>One committed transaction with a regenerate; the enclosing TransactionGroup is what gets rolled back.</summary>
    private static void Run(Document doc, string name, Action action) {
        using var tx = new Transaction(doc, "pdrop proof: " + name);
        _ = tx.Start();
        var options = tx.GetFailureHandlingOptions();
        _ = options.SetFailuresPreprocessor(new SwallowWarnings());
        _ = options.SetForcedModalHandling(false);
        tx.SetFailureHandlingOptions(options);
        action();
        doc.Regenerate();
        var status = tx.Commit();
        if (status != TransactionStatus.Committed) throw new InvalidOperationException($"transaction '{name}' ended {status}");
    }

    private sealed class SwallowWarnings : IFailuresPreprocessor {
        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor) {
            accessor.DeleteAllWarnings();
            return FailureProcessingResult.Continue;
        }
    }

    // ---- lifted: DuctApplier write recipe (Not Defined committed, then the server's entity, then the server)

    private static void WriteCoefficient(Document doc, long id, double coefficient) {
        var schema = (ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService)
            ?.GetServer(SpecificCoefficient) as IDuctFittingAndAccessoryPressureDropServer)?.GetDataSchema()
            ?? throw new InvalidOperationException("Revit's Specific Coefficient server has no data schema");
        Run(doc, "not defined", () => {
            var e = doc.GetElement(id.ToElementId());
            _ = e.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM).Set(NotDefined.ToString());
        });
        Run(doc, $"coefficient {coefficient}", () => {
            var e = doc.GetElement(id.ToElementId());
            var entity = new Entity(schema);
            entity.Set("Coefficient", coefficient.ToString("R", CultureInfo.InvariantCulture));
            e.SetEntity(entity);
            _ = e.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM).Set(SpecificCoefficient.ToString());
        });
    }

    // ---- lifted: DuctSnapshots readers (parameter, converted units; 0 is a value here, absence is null)

    private static double? Read(Element? e, BuiltInParameter p, ForgeTypeId unit) =>
        e?.get_Parameter(p) is { HasValue: true, StorageType: StorageType.Double } param
            ? Math.Round(UnitUtils.ConvertFromInternalUnits(param.AsDouble(), unit), 5)
            : null;

    private static double? LossInWg(Document doc, long id) => Read(doc.GetElement(id.ToElementId()), BuiltInParameter.RBS_PRESSURE_DROP, InWg);
    private static double? FlowCfm(Document doc, long id) => Read(doc.GetElement(id.ToElementId()), BuiltInParameter.RBS_DUCT_FLOW_PARAM, UnitTypeId.CubicFeetPerMinute);
    private static double? VelocityFpm(Document doc, long id) => Read(doc.GetElement(id.ToElementId()), BuiltInParameter.RBS_VELOCITY, UnitTypeId.FeetPerMinute);
    private static double Pv(double fpm) => Math.Pow(fpm / 4005.0, 2);

    private static Dictionary<string, object?> DuctFacts(Document doc, long id) => new() {
        ["id"] = id,
        ["category"] = doc.GetElement(id.ToElementId())?.Category?.Name,
        ["flowCfm"] = FlowCfm(doc, id),
        ["velocityFpm"] = VelocityFpm(doc, id)
    };

    // ---- tap search

    private sealed record Tap(long Id, long BranchId, List<long> MainIds, List<long> MainSet);

    private static IEnumerable<(Connector Own, Element Other)> Neighbours(Element e) {
        foreach (var c in DuctSnapshots.HvacConnectors(e)) {
            if (!c.IsConnected) continue;
            foreach (Connector other in c.AllRefs)
                if (other.Owner.Id != e.Id && other.ConnectorType is ConnectorType.End or ConnectorType.Curve)
                    yield return (c, other.Owner);
        }
    }

    private static Tap? Qualify(Document doc, FamilyInstance fitting) {
        var links = Neighbours(fitting).Where(n => n.Other is MEPCurve).ToList();
        var ends = links.Where(n => n.Own.ConnectorType == ConnectorType.End).ToList();
        if (ends.Count == 0) return null;
        // The branch is the smallest End connector that meets a duct; every other duct on the fitting is the main.
        var branch = ends.OrderBy(n => Math.Abs(n.Own.Shape == ConnectorProfileType.Round ? n.Own.Radius : n.Own.Width * n.Own.Height)).First();
        var branchId = branch.Other.Id.Value();
        var mains = links.Where(n => n.Other.Id.Value() != branchId).Select(n => n.Other.Id.Value()).Distinct().ToList();
        if (mains.Count == 0) return null;
        if (FlowCfm(doc, branchId) is not > 0 || mains.Any(m => FlowCfm(doc, m) is not > 0)) return null;

        // Main set: the main duct(s) plus the ducts one pass-through hop away (a duct to duct join, or a 2-port fitting).
        var set = new HashSet<long>(mains);
        foreach (var main in mains.Select(m => doc.GetElement(m.ToElementId()))) {
            foreach (var (_, next) in Neighbours(main)) {
                if (next.Id == fitting.Id) continue;
                if (next is MEPCurve) {
                    _ = set.Add(next.Id.Value());
                    continue;
                }
                var through = Neighbours(next).ToList();
                if (DuctSnapshots.HvacConnectors(next).Count() != 2) continue;
                foreach (var (_, far) in through)
                    if (far is MEPCurve && far.Id != main.Id && far.Id.Value() != branchId) _ = set.Add(far.Id.Value());
            }
        }
        return new Tap(fitting.Id.Value(), branchId, mains, set.ToList());
    }

    // ---- terminal facts

    private sealed record ConnectorFact(
        string ConnectorType, string? Domain, string? Direction, string? DuctSystemType, bool IsConnected,
        long? ConnectedOwnerId, string? ConnectedOwnerCategory, double? ConnectedOwnerFlowCfm, bool? IsPrimary, bool? IsSecondary, string? InfoType);

    private sealed record TerminalFact(
        long Id, string? Family, string? Type, double? FlowCfm, bool? FlowReadOnly, List<ConnectorFact> Connectors) {
        public string Signature => string.Join(" | ", Family, Type, $"readOnly={FlowReadOnly}",
            string.Join(" ; ", Connectors.Select(c => $"{c.Direction}/{c.DuctSystemType}/connected={c.IsConnected}/primary={c.IsPrimary}/{c.ConnectedOwnerCategory}")));
    }

    private static T? Try<T>(Func<T?> read) {
        try {
            return read();
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
            return default;
        }
    }

    // Re-fetched by id on every call: a Regenerate invalidates element and Connector wrappers. Never reads Connector.Flow.
    private static TerminalFact TerminalFacts(Document doc, long id) {
        var e = doc.GetElement(id.ToElementId());
        var p = e?.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_PARAM);
        var fi = e as FamilyInstance;
        var connectors = e is null ? [] : DuctSnapshots.HvacConnectors(e).Select(c => {
            var other = c.IsConnected ? c.AllRefs.Cast<Connector>().FirstOrDefault(o => o.Owner.Id != e.Id && o.ConnectorType is ConnectorType.End or ConnectorType.Curve) : null;
            var info = Try(() => c.GetMEPConnectorInfo());
            return new ConnectorFact(
                c.ConnectorType.ToString(),
                Try(() => c.Domain.ToString()),
                Try(() => c.Direction.ToString()),
                Try(() => c.DuctSystemType.ToString()),
                c.IsConnected,
                other?.Owner.Id.Value(),
                other?.Owner.Category?.Name,
                other?.Owner is MEPCurve ? FlowCfm(doc, other.Owner.Id.Value()) : null,
                Try(() => (bool?)info?.IsPrimary),
                Try(() => (bool?)info?.IsSecondary),
                info?.GetType().Name);
        }).ToList();
        return new TerminalFact(id, fi?.Symbol?.FamilyName, fi?.Symbol?.Name,
            Read(e, BuiltInParameter.RBS_DUCT_FLOW_PARAM, UnitTypeId.CubicFeetPerMinute), p?.IsReadOnly, connectors);
    }
}
