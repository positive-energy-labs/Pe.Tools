using System.Diagnostics;
using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.Tests;

/// <summary>
///     Read-only census of candidate wall-time proxies for Family Foundry, one pass over every editable mechanical
///     family in the immutable Old Template. Every feature is timed so its cost is part of the result; nothing is
///     mutated and nothing is loaded back into the project. Joined offline against the measured migration durations.
/// </summary>
[TestFixture]
public sealed class FamilyWallTimeProxyProbe {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    /// <summary>Times a read and records its cost. Failures are recorded, never thrown: one bad family must not end the census.</summary>
    private static void Measure(JObject features, JObject costs, string name, Func<JToken?> read) {
        var timer = Stopwatch.StartNew();
        try { features[name] = read(); }
        catch (Exception exception) {
            features[name] = null;
            features[name + "__error"] = exception.GetType().Name + ": " + exception.Message;
        } finally {
            timer.Stop();
            costs[name] = timer.Elapsed.TotalMilliseconds;
        }
    }

    private static string SanitizeFileName(string name) =>
        string.Concat(name.Select(character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));

    [Test, Timeout(3600000)]
    public void Old_template_mechanical_families_expose_timed_wall_time_proxy_features() {
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_mechanical_families_expose_timed_wall_time_proxy_features));
        var checkpointPath = Path.Combine(output, "wall-time-proxy-features.json");
        var saveDirectory = Path.Combine(output, "rfa");
        Directory.CreateDirectory(saveDirectory);
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        var evidence = new JObject {
            ["status"] = "starting",
            ["fixtureSha256"] = string.Concat(originalHash.Select(value => value.ToString("X2"))),
            ["families"] = new JArray(),
            ["remaining"] = new JArray()
        };
        try {
            var families = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                .Where(f => f.IsEditable && f.FamilyCategory?.BuiltInCategory == BuiltInCategory.OST_MechanicalEquipment)
                .Select(f => f.Name).OrderBy(name => name, StringComparer.Ordinal).ToList();
            Assert.That(families, Is.Not.Empty, "The real template must provide migration candidates.");

            // One project-wide instance index. Its cost is amortised across all families, so it is reported once and a
            // per-family dictionary lookup is what a proxy built on it would actually pay.
            var indexTimer = Stopwatch.StartNew();
            var instancesByFamily = new FilteredElementCollector(project).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .GroupBy(instance => instance.Symbol.Family.Id).ToDictionary(group => group.Key, group => group.ToList());
            indexTimer.Stop();
            evidence["projectInstanceIndexMs"] = indexTimer.Elapsed.TotalMilliseconds;
            evidence["projectInstanceIndexFamilies"] = instancesByFamily.Count;
            evidence["status"] = "running";
            evidence["selected"] = new JArray(families);
            evidence["remaining"] = new JArray(families);
            WriteCheckpoint(checkpointPath, evidence);

            foreach (var familyName in families) {
                var row = new JObject { ["familyName"] = familyName };
                var features = new JObject();
                var costs = new JObject();
                row["features"] = features;
                row["costMs"] = costs;
                var wall = Stopwatch.StartNew();
                string? savedPath = null;
                try {
                    var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
                    row["familyId"] = family.Id.Value();

                    // ---- project side: no EditFamily ------------------------------------------------------------
                    var symbolIds = family.GetFamilySymbolIds().ToList();
                    Measure(features, costs, "p_typeCount", () => family.GetFamilySymbolIds().Count);
                    Measure(features, costs, "p_isInPlace", () => family.IsInPlace);
                    Measure(features, costs, "p_category", () => family.FamilyCategory?.Name);
                    Measure(features, costs, "p_familyParamCount", () => family.Parameters.Size);
                    Measure(features, costs, "p_instanceCount", () => instancesByFamily.TryGetValue(family.Id, out var placed) ? placed.Count : 0);
                    Measure(features, costs, "p_symbolParamCount", () => symbolIds.Count == 0 ? 0
                        : ((FamilySymbol)project.GetElement(symbolIds[0])).Parameters.Size);
                    Measure(features, costs, "p_symbolOrderedParamCount", () => symbolIds.Count == 0 ? 0
                        : ((FamilySymbol)project.GetElement(symbolIds[0])).GetOrderedParameters().Count);
                    Measure(features, costs, "p_symbolParamCountUnion", () => symbolIds
                        .Select(id => (FamilySymbol)project.GetElement(id))
                        .SelectMany(symbol => symbol.Parameters.Cast<Parameter>().Select(parameter => parameter.Definition.Name))
                        .Distinct(StringComparer.Ordinal).Count());
                    Measure(features, costs, "p_paramsTimesTypes", () => symbolIds.Count == 0 ? 0
                        : ((FamilySymbol)project.GetElement(symbolIds[0])).Parameters.Size * symbolIds.Count);
                    Measure(features, costs, "p_instanceParamCount", () =>
                        instancesByFamily.TryGetValue(family.Id, out var placed) && placed.Count > 0 ? placed[0].Parameters.Size : (int?)null);
                    // Does the project expose nesting at all? Only shared nested families surface, and only through a placed instance.
                    Measure(features, costs, "p_subComponentCount", () =>
                        instancesByFamily.TryGetValue(family.Id, out var placed) && placed.Count > 0 ? placed[0].GetSubComponentIds().Count : (int?)null);
                    Measure(features, costs, "p_dependentElementCount", () => family.GetDependentElements(null).Count);
                    Measure(features, costs, "p_dependentFamilyCount", () => family.GetDependentElements(null)
                        .Count(id => project.GetElement(id) is Family));
                    Measure(features, costs, "p_dependentKinds", () => new JArray(family.GetDependentElements(null)
                        .Select(id => project.GetElement(id)?.GetType().Name ?? "?")
                        .Distinct(StringComparer.Ordinal).OrderBy(name => name, StringComparer.Ordinal)));

                    // ---- open/close round trip, cold: itself a candidate proxy ----------------------------------
                    var openTimer = Stopwatch.StartNew();
                    var cold = project.EditFamily(family);
                    openTimer.Stop();
                    costs["f_editFamilyColdMs"] = openTimer.Elapsed.TotalMilliseconds;
                    features["f_editFamilyColdMs"] = openTimer.Elapsed.TotalMilliseconds;
                    var closeTimer = Stopwatch.StartNew();
                    cold.Close(false);
                    closeTimer.Stop();
                    costs["f_closeColdMs"] = closeTimer.Elapsed.TotalMilliseconds;
                    features["f_closeColdMs"] = closeTimer.Elapsed.TotalMilliseconds;
                    features["f_roundTripColdMs"] = openTimer.Elapsed.TotalMilliseconds + closeTimer.Elapsed.TotalMilliseconds;

                    // ---- family side: read-only inside a second EditFamily --------------------------------------
                    var warmTimer = Stopwatch.StartNew();
                    var document = project.EditFamily(family);
                    warmTimer.Stop();
                    costs["f_editFamilyWarmMs"] = warmTimer.Elapsed.TotalMilliseconds;
                    features["f_editFamilyWarmMs"] = warmTimer.Elapsed.TotalMilliseconds;
                    try {
                        var famDoc = document.GetFamilyDocument();
                        var fm = document.FamilyManager;

                        Measure(features, costs, "f_elementCount", () =>
                            new FilteredElementCollector(document).WhereElementIsNotElementType().ToElementIds().Count);
                        Measure(features, costs, "f_elementTypeCount", () =>
                            new FilteredElementCollector(document).WhereElementIsElementType().ToElementIds().Count);

                        // One materialising pass, then every class count comes free from it.
                        var classCounts = new JObject();
                        Measure(features, costs, "f_classHistogramTotal", () => {
                            var elements = new FilteredElementCollector(document).WhereElementIsNotElementType().ToElements();
                            foreach (var group in elements.GroupBy(element => element.GetType().Name).OrderBy(g => g.Key, StringComparer.Ordinal))
                                classCounts[group.Key] = group.Count();
                            return elements.Count;
                        });
                        features["f_classCounts"] = classCounts;
                        int Klass(string name) => classCounts.Value<int?>(name) ?? 0;
                        features["f_dimensionCount"] = Klass("Dimension");
                        features["f_referencePlaneCount"] = Klass("ReferencePlane");
                        features["f_modelLineCount"] = Klass("ModelLine") + Klass("ModelArc") + Klass("ModelEllipse")
                                                       + Klass("ModelNurbSpline") + Klass("ModelHermiteSpline");
                        features["f_symbolicLineCount"] = Klass("SymbolicCurve") + Klass("DetailLine") + Klass("DetailArc")
                                                          + Klass("DetailNurbSpline") + Klass("DetailEllipse");
                        features["f_formCount"] = Klass("Extrusion") + Klass("Blend") + Klass("Revolution")
                                                  + Klass("Sweep") + Klass("SweptBlend") + Klass("Form");
                        features["f_nestedInstanceCount"] = Klass("FamilyInstance");
                        features["f_connectorCount"] = Klass("ConnectorElement");
                        features["f_dataStorageCount"] = Klass("DataStorage");
                        features["f_arrayCount"] = Klass("LinearArray") + Klass("RadialArray") + Klass("BaseArray");
                        features["f_sketchPlaneCount"] = Klass("SketchPlane");

                        // Individually collected counts, for the cost a single-signal proxy would actually pay.
                        Measure(features, costs, "f_dimensionCountSolo", () =>
                            new FilteredElementCollector(document).OfClass(typeof(Dimension)).ToElementIds().Count);
                        Measure(features, costs, "f_referencePlaneCountSolo", () =>
                            new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).ToElementIds().Count);
                        Measure(features, costs, "f_genericFormCountSolo", () =>
                            new FilteredElementCollector(document).OfClass(typeof(GenericForm)).ToElementIds().Count);
                        Measure(features, costs, "f_nestedInstanceCountSolo", () =>
                            new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).ToElementIds().Count);
                        Measure(features, costs, "f_connectorCountSolo", () =>
                            new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).ToElementIds().Count);
                        Measure(features, costs, "f_sketchCountSolo", () =>
                            new FilteredElementCollector(document).OfClass(typeof(Sketch)).ToElementIds().Count);
                        Measure(features, costs, "f_curveElementCountSolo", () =>
                            new FilteredElementCollector(document).OfClass(typeof(CurveElement)).ToElementIds().Count);

                        // FamilyManager: the parameter matrix.
                        var parameters = fm.Parameters.OfType<FamilyParameter>().ToList();
                        Measure(features, costs, "f_paramCount", () => fm.Parameters.Size);
                        Measure(features, costs, "f_typeCount", () => fm.Types.Size);
                        features["f_paramsTimesTypes"] = fm.Parameters.Size * Math.Max(1, fm.Types.Size);
                        Measure(features, costs, "f_formulaCount", () => parameters.Count(parameter => {
                            try { return !string.IsNullOrWhiteSpace(parameter.Formula); }
                            catch (Autodesk.Revit.Exceptions.ApplicationException) { return false; }
                        }));
                        Measure(features, costs, "f_sharedParamCount", () => parameters.Count(parameter => parameter.IsShared));
                        Measure(features, costs, "f_instanceParamCount", () => parameters.Count(parameter => parameter.IsInstance));
                        Measure(features, costs, "f_typeParamCount", () => parameters.Count(parameter => !parameter.IsInstance));
                        Measure(features, costs, "f_reportingParamCount", () => parameters.Count(parameter => parameter.IsReporting));
                        Measure(features, costs, "f_determinedByFormulaCount", () => parameters.Count(parameter => parameter.IsDeterminedByFormula));
                        // Association count without building the graph: the cheapest family-side geometry-coupling signal.
                        Measure(features, costs, "f_associatedParamCount", () => parameters.Sum(parameter => {
                            try { return parameter.AssociatedParameters.Size; }
                            catch (Autodesk.Revit.Exceptions.ApplicationException) { return 0; }
                        }));

                        // Labelled dimensions, and how many of those labels carry a formula (chained geometry drivers).
                        Measure(features, costs, "f_labelledDimensionCount", () => {
                            var labelled = 0;
                            foreach (var dimension in new FilteredElementCollector(document).OfClass(typeof(Dimension)).Cast<Dimension>()) {
                                try { if (dimension.FamilyLabel is not null) labelled++; }
                                catch (Autodesk.Revit.Exceptions.InvalidOperationException) { }
                            }
                            return labelled;
                        });
                        Measure(features, costs, "f_formulaDrivenDimensionCount", () => {
                            var driven = 0;
                            foreach (var dimension in new FilteredElementCollector(document).OfClass(typeof(Dimension)).Cast<Dimension>()) {
                                FamilyParameter? label;
                                try { label = dimension.FamilyLabel; }
                                catch (Autodesk.Revit.Exceptions.InvalidOperationException) { continue; }
                                if (label is null) continue;
                                try { if (!string.IsNullOrWhiteSpace(label.Formula)) driven++; }
                                catch (Autodesk.Revit.Exceptions.ApplicationException) { }
                            }
                            return driven;
                        });

                        // Nested depth: does any nested family itself contain a nested family? Answered without opening
                        // the nested family, through the shared-nesting sub-component chain.
                        Measure(features, costs, "f_nestedSubComponentCount", () =>
                            new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                                .Sum(instance => instance.GetSubComponentIds().Count));
                        Measure(features, costs, "f_nestedFamilyElementCount", () =>
                            new FilteredElementCollector(document).OfClass(typeof(Family)).ToElementIds().Count);

                        // Calibration only: not a runtime proxy, but the ground truth for "how big is this family".
                        var saveTimer = Stopwatch.StartNew();
                        savedPath = Path.Combine(saveDirectory, SanitizeFileName(familyName) + ".rfa");
                        document.SaveAs(savedPath, new SaveAsOptions { OverwriteExistingFile = true });
                        saveTimer.Stop();
                        costs["f_saveAsMs"] = saveTimer.Elapsed.TotalMilliseconds;
                        features["f_saveAsMs"] = saveTimer.Elapsed.TotalMilliseconds;
                        features["f_rfaBytes"] = new FileInfo(savedPath).Length;
                    } finally {
                        var closeWarm = Stopwatch.StartNew();
                        document.Close(false);
                        closeWarm.Stop();
                        costs["f_closeWarmMs"] = closeWarm.Elapsed.TotalMilliseconds;
                    }
                    if (savedPath is not null && File.Exists(savedPath)) File.Delete(savedPath);
                } catch (Exception exception) {
                    row["error"] = exception.ToString();
                }
                wall.Stop();
                row["probeWallMs"] = wall.Elapsed.TotalMilliseconds;
                ((JArray)evidence["families"]!).Add(row);
                evidence["remaining"] = new JArray(families.Skip(((JArray)evidence["families"]!).Count));
                WriteCheckpoint(checkpointPath, evidence);
            }

            var errors = ((JArray)evidence["families"]!).Count(entry => entry["error"] is not null);
            evidence["status"] = errors == 0 ? "passed" : "completedWithErrors";
            evidence["familyErrorCount"] = errors;
            WriteCheckpoint(checkpointPath, evidence);
            Assert.That((JArray)evidence["families"]!, Is.Not.Empty);
        } finally {
            if (evidence.Value<string>("status") is "starting" or "running") evidence["status"] = "interrupted";
            WriteCheckpoint(checkpointPath, evidence);
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash), "Original template fixture was modified.");
        }
    }

    private static void WriteCheckpoint(string path, JObject evidence) {
        var pending = path + ".pending";
        File.WriteAllText(pending, evidence.ToString());
        if (!File.Exists(path)) {
            File.Move(pending, path);
            return;
        }
        for (var attempt = 1; ; attempt++) {
            try { File.Replace(pending, path, null); return; }
            catch (IOException) when (attempt < 5) { Thread.Sleep(25 * attempt); }
        }
    }
}
