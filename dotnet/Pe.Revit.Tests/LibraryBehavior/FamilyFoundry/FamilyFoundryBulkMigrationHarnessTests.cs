using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Events;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Parameters;
using Pe.App.Host;
using Pe.Shared.HostContracts.Operations;

using Pe.Revit.Failures;

namespace Pe.Revit.Tests;

/// <summary>Normalization acceptance through the processor. Runtime owner runs these on disposable documents.</summary>
[TestFixture]
public sealed class FamilyFoundryBulkMigrationHarnessTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    private Document NewFamily(string name, BuiltInCategory category = BuiltInCategory.OST_GenericModel) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, category, name);
        using var transaction = new Transaction(document, "Seed normalization case");
        transaction.Start();
        var fm = document.FamilyManager;
        var width = fm.AddParameter("Width", GroupTypeId.Geometry, SpecTypeId.Length, false);
        var keep = fm.AddParameter("Keep", GroupTypeId.Data, SpecTypeId.String.Text, false);
        foreach (var type in new[] { "A", "B" }) {
            fm.CurrentType = fm.NewType(type);
            fm.Set(width, type == "A" ? 1.0 : 2.0);
            fm.Set(keep, type);
        }
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return document;
    }

    private static ReconcileFamily WidthPatch(string? expectedHash = null) => new(FamilyPatch.Parse(
        """{"patch":{"parameters":{"Width":{"value":"3ft"}}}}"""), expectedPlanHash: expectedHash);

    private static IReadOnlyList<ParametersApi.Parameters.ParametersResult> CompanyDefinitions() =>
        JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
            RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-aps-definitions.json")))!;

    private static IReadOnlyList<ParametersApi.Parameters.ParametersResult> CompanyCorpusDefinitions() =>
        JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
            RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!;

    private static void VerifyCompanyDefinitions(IReadOnlyList<ParametersApi.Parameters.ParametersResult> definitions,
        JObject evidence, string checkpointPath) {
        var cache = Pe.Shared.StorageRuntime.StorageClient.Default.Global().State()
            .Json<ParametersApi.Parameters>("parameters-service-cache");
        var cachePath = ((Pe.Shared.StorageRuntime.Json.JsonReader<ParametersApi.Parameters>)cache).FilePath;
        var cached = JsonConvert.DeserializeObject<ParametersApi.Parameters>(File.ReadAllText(cachePath))!.Results!;
        var active = cached.Where(d => !d.IsArchived).ToList();
        static JObject Identity(ParametersApi.Parameters.ParametersResult d) => JObject.FromObject(new {
            d.Name, Guid = d.DownloadOptions.GetGuid(), Spec = d.DownloadOptions.GetSpecTypeId().TypeId,
            d.DownloadOptions.IsInstance, Group = d.DownloadOptions.GetGroupTypeId().TypeId,
            Description = d.Description ?? "", d.DownloadOptions.Visible, d.ReadOnly
        });
        var differences = new JArray();
        foreach (var definition in definitions) {
            var matches = active.Where(d => d.Name == definition.Name).ToList();
            if (definition.IsArchived || matches.Count != 1 || !JToken.DeepEquals(Identity(definition), Identity(matches[0])))
                differences.Add(new JObject {
                    ["fixture"] = Identity(definition), ["fixtureArchived"] = definition.IsArchived,
                    ["activeCacheMatches"] = new JArray(matches.Select(Identity))
                });
        }
        static string Hash(string path) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path)));
        evidence["definitions"] = new JObject {
            ["source"] = cachePath, ["sourceSha256"] = Hash(cachePath),
            ["sourceLastWriteUtc"] = File.GetLastWriteTimeUtc(cachePath).ToString("O"),
            ["fixtureSha256"] = Hash(RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")),
            ["activeCount"] = active.Count, ["archivedCount"] = cached.Count - active.Count,
            ["used"] = new JArray(definitions.Select(Identity)), ["differences"] = differences,
            ["status"] = differences.Count == 0 ? "matchedCachedDefinitions" : "definitionMismatch"
        };
        if (differences.Count > 0) evidence["status"] = "definitionMismatch";
        WriteCheckpoint(checkpointPath, evidence);
        Assert.That(differences, Is.Empty, "Company fixture definitions must match one active Parameters Service cache definition per name.");
    }

    [Test]
    public void Native_formula_canonicalization_is_rollback_only_and_distinguishes_changed_literal() {
        const string raw = "if(PE_E___Voltage = 120, 1, 2)";
        var document = this.NewFamily("Formula canonicalization");
        try {
            using (var transaction = new Transaction(document, "Seed formula")) {
                transaction.Start();
                var fm = document.FamilyManager;
                var voltage = fm.AddParameter("PE_E___Voltage", GroupTypeId.Electrical, SpecTypeId.ElectricalPotential, false);
                var types = fm.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B").ToList();
                Assert.That(types, Has.Count.EqualTo(2));
                foreach (var type in types) {
                    fm.CurrentType = type;
                    fm.Set(voltage, UnitUtils.ConvertToInternalUnits(type.Name == "A" ? 120 : 208, UnitTypeId.Volts));
                }
                var poles = fm.AddParameter("PE_E___NumberOfPoles", GroupTypeId.Electrical, SpecTypeId.Int.NumberOfPoles, false);
                fm.SetFormula(poles, raw);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var current = document.CaptureFamilyModel();
            var native = current.Parameters["PE_E___NumberOfPoles"].Formula!;
            Assert.That(native, Is.Not.EqualTo(raw));
            using (var transaction = new Transaction(document, "Accept native formula grammar")) {
                transaction.Start();
                Assert.That(document.GetFamilyDocument().TrySetFormula(
                    document.FamilyManager.get_Parameter("PE_E___NumberOfPoles"), native, out var error), Is.True, error);
                Assert.That(transaction.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
            }
            var before = JToken.Parse(FamilyModelJson.Serialize(current));
            var currentType = document.FamilyManager.CurrentType.Name;
            var modified = document.IsModified;
            var originalPoles = document.FamilyManager.Types.Cast<FamilyType>()
                .Where(type => type.Name is "A" or "B")
                .ToDictionary(type => type.Name, type => type.AsInteger(document.FamilyManager.FindParameter("PE_E___NumberOfPoles")));
            Assert.That(originalPoles, Has.Count.EqualTo(2));
            Assert.That(originalPoles["A"], Is.EqualTo(1));
            Assert.That(originalPoles["B"], Is.EqualTo(2));
            FamilyPatch Patch(string formula) => new() { Patch = new JObject {
                ["parameters"] = new JObject { ["PE_E___NumberOfPoles"] = new JObject { ["formula"] = formula } }
            } };

            var canonical = document.PreviewFamily(Patch(raw));
            Assert.That(canonical.Changes, Is.Empty);
            Assert.That(canonical.Diagnostics, Is.Empty);
            Assert.That(JToken.DeepEquals(
                JToken.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel())), before), Is.True,
                "Preview must preserve the captured model; JSON object property order is not semantic.");
            Assert.That(document.FamilyManager.CurrentType.Name, Is.EqualTo(currentType));
            Assert.That(document.IsModified, Is.EqualTo(modified));

            var changed = document.PreviewFamily(Patch(raw.Replace("120", "208")));
            Assert.That(changed.Changes,
                Has.Some.Matches<FamilyChange>(c => c.Section == "parameters" && c.Key == "PE_E___NumberOfPoles"));
            var apply = new ReconcileFamily(Patch(raw.Replace("120", "208")), expectedPlanHash: changed.PlanHash);
            using (var processor = new OperationProcessor(document))
                _ = processor.ProcessQueue(new OperationQueue().Add(apply));
            var applied = document.CaptureFamilyModel();
            Assert.That(apply.LastReceipt?.Converged, Is.True);
            Assert.That(apply.LastReceipt?.PlanHash, Is.EqualTo(changed.PlanHash));
            Assert.That(applied.Parameters["PE_E___NumberOfPoles"].Formula, Does.Contain("208"));
            var appliedPoles = document.FamilyManager.FindParameter("PE_E___NumberOfPoles");
            var values = document.FamilyManager.Types.Cast<FamilyType>()
                .Where(type => type.Name is "A" or "B")
                .ToDictionary(type => type.Name, type => type.AsInteger(appliedPoles));
            Assert.That(values, Has.Count.EqualTo(2));
            Assert.That(values["A"], Is.EqualTo(2));
            Assert.That(values["B"], Is.EqualTo(1));
        } finally { document.Close(false); }
    }

    [Test]
    public void Preview_refuses_invalid_units_without_mutation() {
        var document = this.NewFamily("FF invalid unit preview");
        try {
            var before = JToken.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel()));
            var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"Width":{"value":"3 bananas"}}}}""");
            var preview = document.PreviewFamily(patch);
            Assert.That(preview.Diagnostics, Is.Not.Empty);
            var apply = new ReconcileFamily(patch);
            Exception? refusal;
            using (var processor = new OperationProcessor(document)) {
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(apply));
                (_, refusal) = contexts.Single().OperationLogs;
            }
            Assert.That(refusal, Is.Not.Null);
            foreach (var diagnostic in preview.Diagnostics)
                Assert.That(refusal!.ToString(), Does.Contain($"{diagnostic.Code}: {diagnostic.Message}"), refusal.ToString());
            Assert.That(apply.LastReceipt, Is.Null);
            Assert.That(JToken.DeepEquals(
                JToken.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel())), before), Is.True,
                "Preview must preserve the captured model; JSON object property order is not semantic.");
        } finally { document.Close(false); }
    }

    [Test]
    public void Preview_and_apply_refuse_the_same_existing_shared_tooltip_change() {
        var document = this.NewFamily("FF shared tooltip preview");
        try {
            var definition = CompanyDefinitions().Single(item => item.Name == "PE_G___Model");
            Func<Document, FamilySharedParameterSource> source = d => new(d, [definition]);
            var parameter = new JObject {
                ["shared"] = true,
                ["sharedGuid"] = definition.DownloadOptions.GetGuid(),
                ["sharedSpecId"] = definition.DownloadOptions.GetSpecTypeId().TypeId,
                ["tooltip"] = definition.Description ?? "",
                ["value"] = "original value"
            };
            var patch = new FamilyPatch { Patch = new JObject { ["parameters"] = new JObject { [definition.Name!] = parameter } } };
            var create = new ReconcileFamily(patch, sharedSource: source);
            using (var processor = new OperationProcessor(document))
                _ = processor.ProcessQueue(new OperationQueue().Add(create));
            Assert.That(create.LastReceipt?.Converged, Is.True);
            var original = document.CaptureFamilyModel().Parameters[definition.Name!];
            var originalValues = document.FamilyManager.Types.Cast<FamilyType>()
                .ToDictionary(type => type.Name, type => type.AsString(document.FamilyManager.FindParameter(definition.Name!)));
            Assert.That(originalValues.Values, Is.All.Not.Empty);

            parameter["tooltip"] = "replacement is unsupported";
            var preview = document.PreviewFamily(patch, sharedSource: source);
            var apply = new ReconcileFamily(patch, sharedSource: source);
            Exception? refusal;
            using (var processor = new OperationProcessor(document)) {
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(apply));
                (_, refusal) = contexts.Single().OperationLogs;
            }
            var diagnostic = preview.Diagnostics.Single();
            Assert.That(diagnostic.Code, Is.EqualTo(FamilyModelDiagnosticCodes.SharedTooltipUnsupported));
            Assert.That(refusal, Is.Not.Null);
            Assert.That(refusal!.ToString(), Does.Contain($"{diagnostic.Code}: {diagnostic.Message}"), refusal.ToString());
            Assert.That(apply.LastReceipt, Is.Null);
            var preserved = document.CaptureFamilyModel().Parameters[definition.Name!];
            Assert.That((preserved.SharedGuid, preserved.Formula), Is.EqualTo((original.SharedGuid, original.Formula)));
            Assert.That(document.FamilyManager.Types.Cast<FamilyType>()
                .ToDictionary(type => type.Name, type => type.AsString(document.FamilyManager.FindParameter(definition.Name!))),
                Is.EqualTo(originalValues));
        } finally { document.Close(false); }
    }

    [Test]
    public void Full_model_build_forwards_execution_options_into_plan_identity() {
        var document = this.NewFamily("FF build options identity");
        try {
            var current = document.CaptureFamilyModel();
            var options = new ExecutionOptions { OptimizeTypeOperations = false };
            ReconcileFamily Dry(ExecutionOptions? executionOptions) {
                var operation = new ReconcileFamily(current, dryRun: true, executionOptions: executionOptions);
                using var processor = new OperationProcessor(document, executionOptions);
                _ = processor.ProcessQueue(new OperationQueue().Add(operation));
                return operation;
            }
            var defaults = Dry(null);
            var nondefault = Dry(options);
            Assert.That(nondefault.LastPlan?.PlanHash, Is.Not.EqualTo(defaults.LastPlan?.PlanHash));
            var receipt = FamilyModelBuild.Reconcile(document, current, options);
            Assert.That(receipt?.PlanHash, Is.EqualTo(nondefault.LastPlan?.PlanHash));
        } finally { document.Close(false); }
    }

    [Test]
    public void Authored_form_view_flags_survive_build_save_and_reopen() {
        var json = JObject.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("a-box.json")));
        var flags = JObject.Parse("""{"planRcp":false,"frontBack":false,"leftRight":true,"onlyWhenCut":false,"coarse":false,"medium":true,"fine":true}""");
        foreach (var form in ((JObject)json["forms"]!).Properties()) form.Value["visibility"] = flags.DeepClone();
        var model = FamilyModelJson.Parse(json.ToString()).Value!;
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Authored_form_view_flags_survive_build_save_and_reopen));
        var path = Path.Combine(output, "Visibility.rfa");
        var built = Pe.Revit.FamilyFoundry.Apply.FamilyModelBuild.BuildAndSave(this._application, model, path);
        Assert.That(built.Receipt?.Converged, Is.True);
        var document = this._application.OpenDocumentFile(path);
        try {
            var manager = document.FamilyManager;
            var type = manager.CurrentType;
            var expectedSize = new XYZ(type.AsDouble(manager.get_Parameter("Width"))!.Value,
                type.AsDouble(manager.get_Parameter("Depth"))!.Value, type.AsDouble(manager.get_Parameter("Height"))!.Value);
            // Identify the authored box independently by its native extents, not the writer's lookup or every extrusion.
            var body = new FilteredElementCollector(document).OfClass(typeof(Extrusion)).Cast<Extrusion>().Single(form => {
                var bounds = form.get_BoundingBox(null);
                return bounds is not null && (bounds.Max - bounds.Min).IsAlmostEqualTo(expectedSize, 1e-6);
            });
            {
                var form = body;
                var visibility = form.GetVisibility();
                Assert.That(new[] { visibility.IsShownInPlanRCPCut, visibility.IsShownInFrontBack, visibility.IsShownInLeftRight,
                    visibility.IsShownOnlyWhenCut, visibility.IsShownInCoarse, visibility.IsShownInMedium, visibility.IsShownInFine },
                    Is.EqualTo(new[] { false, false, true, false, false, true, true }));
            }
        } finally { document.Close(false); }
    }

    [Test]
    public void Omitted_new_parameter_scope_resolves_to_native_type_default_and_reapplies_empty() {
        var document = this.NewFamily("FF parameter scope defaults");
        try {
            var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"Rotation":{"dataType":"Angle","value":"90deg"},"Note":{"dataType":"Text","value":"Rotation"}}}}""");
            var desired = FamilyReconciler.Desired(document.CaptureFamilyModel(), patch).Value!;
            using var source = new FamilySharedParameterSource(document, []);
            var resolved = source.Resolve(desired, patch.Patch);
            Assert.That(resolved.Parameters["Rotation"].IsInstance, Is.False);
            Assert.That(resolved.Parameters["Note"].IsInstance, Is.False);
            using var processor = new OperationProcessor(document);
            for (var pass = 0; pass < 2; pass++) {
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, []));
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
                if (pass == 1) Assert.That(operation.LastPlan!.Changes, Is.Empty);
            }
            Assert.That(document.FamilyManager.FindParameter("Rotation").IsInstance, Is.False);
            Assert.That(document.FamilyManager.FindParameter("Note").IsInstance, Is.False);
        } finally { document.Close(false); }
    }

    [TestCase("PE_P_LoadCalc_CWFU", false, false)]
    [TestCase("PE_P_LoadCalc_CWFU", false, true)]
    [TestCase("PE_P_LoadCalc_CWFU", true, false)]
    [TestCase("PE_P_LoadCalc_CWFU", true, true)]
    [TestCase("PE_E___FLA", false, false)]
    [TestCase("PE_E___FLA", false, true)]
    [TestCase("PE_E___FLA", true, false)]
    [TestCase("PE_E___FLA", true, true)]
    public void Shared_creation_native_group_and_file_scope_probe(string name, bool otherGroup, bool activeTemporaryFile) {
        var document = this.NewFamily("FF shared creation probe");
        var originalFile = this._application.SharedParametersFilename;
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Shared_creation_native_group_and_file_scope_probe));
        var evidence = new JObject { ["name"] = name, ["otherGroup"] = otherGroup, ["activeTemporaryFile"] = activeTemporaryFile };
        try {
            var data = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!.Single(d => d.Name == name);
            var options = data.DownloadOptions;
            using var file = new TempSharedParamFile(document);
            Assert.That(this._application.SharedParametersFilename, Is.EqualTo(file.TempFileName));
            var definition = SharedParameterBinder.EnsureDefinition(file, new SharedDefinitionSpec(name, options.GetSpecTypeId(),
                Guid: options.GetGuid(), Description: data.Description ?? "", Visible: options.Visible, UserModifiable: !data.ReadOnly));
            if (!activeTemporaryFile) this._application.SharedParametersFilename = originalFile;
            try {
                evidence["guid"] = definition.GUID.ToString();
                evidence["spec"] = definition.GetDataType().TypeId;
                using var transaction = new Transaction(document, "Probe exact native shared creation");
                transaction.Start();
                if (!activeTemporaryFile) {
                    Assert.Throws<Autodesk.Revit.Exceptions.InvalidOperationException>(() =>
                        document.FamilyManager.AddParameter(definition, otherGroup ? new ForgeTypeId("") : GroupTypeId.Data, options.IsInstance));
                    evidence["inactiveFileRejected"] = true;
                    transaction.RollBack();
                    return;
                }
                var parameter = document.FamilyManager.AddParameter(definition, otherGroup ? new ForgeTypeId("") : GroupTypeId.Data, options.IsInstance);
                Assert.That(parameter, Is.Not.Null);
                evidence["created"] = true;
                Assert.That(parameter.GUID, Is.EqualTo(options.GetGuid()));
                transaction.RollBack();
            } finally { this._application.SharedParametersFilename = originalFile; }
        } catch (Exception error) { evidence["error"] = error.ToString(); throw; }
        finally {
            this._application.SharedParametersFilename = originalFile;
            File.WriteAllText(Path.Combine(output, "shared-creation-probe.json"), evidence.ToString());
            document.Close(false);
        }
    }

    [Test]
    public void Native_resolution_converts_local_and_shared_group_labels_before_pure_diff() {
        var document = this.NewFamily("FF native group resolution");
        try {
            var label = LabelUtils.GetLabelForGroup(GroupTypeId.IdentityData);
            var patch = new FamilyPatch { Patch = new JObject { ["parameters"] = new JObject {
                ["Width"] = new JObject { ["propertiesGroup"] = label, ["value"] = "4ft" },
                ["Group Shared"] = new JObject { ["shared"] = true, ["sharedGuid"] = Guid.NewGuid().ToString(),
                    ["sharedSpecId"] = SpecTypeId.Length.TypeId, ["isInstance"] = false, ["propertiesGroup"] = label, ["value"] = "5ft" }
            } } };
            var current = document.CaptureFamilyModel();
            var desired = FamilyReconciler.Desired(current, patch).Value!;
            using var source = new FamilySharedParameterSource(document, []);
            var resolved = source.Resolve(desired, patch.Patch);
            Assert.That(resolved.Parameters["Width"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(resolved.Parameters["Group Shared"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(patch.Patch["parameters"]!["Width"]!["propertiesGroup"]!.Value<string>(), Is.EqualTo(label), "Exact authored intent remains available for plan hashing.");
            using var processor = new OperationProcessor(document);
            var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, []));
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var captured = document.CaptureFamilyModel();
            Assert.That(captured.Parameters["Width"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(captured.Parameters["Group Shared"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(FamilyReconciler.Diff(resolved, captured, UnitResolvers.Revit(document)), Is.Empty);
        } finally { document.Close(false); }
    }

    [Test, Timeout(600000)]
    public void Old_template_Mitsubishi_MSZ_GL_preserves_join_graph_or_rolls_back() {
        const string familyName = "Mitsubishi_MSZ-GL";
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_Mitsubishi_MSZ_GL_preserves_join_graph_or_rolls_back));
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        try {
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
            var originalId = family.Id;
            var originalUniqueId = family.UniqueId;
            var before = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
            var beforeJoins = CaptureJoinGraph(project, family);
            Assert.That(beforeJoins, Has.Some.Contains("|Extrusion|"), "The real family must exercise joined extrusion geometry.");

            var mappings = CompanyNormalizationFixture.MechanicalMappings();
            var names = mappings.MappingData.Select(mapping => mapping.NewName).ToHashSet(StringComparer.Ordinal);
            var definitions = CompanyCorpusDefinitions().Where(definition => names.Contains(definition.Name!)).ToList();
            Assert.That(definitions, Has.Count.EqualTo(38));
            var operation = new ReconcileFamily(CompanyNormalizationFixture.Convert(mappings, names),
                sharedSource: document => new FamilySharedParameterSource(document, definitions));
            var failurePath = Path.Combine(output, "join-failures.json");
            var failureEvidence = new JObject { ["status"] = "subscribed", ["failures"] = new JArray() };
            WriteCheckpoint(failurePath, failureEvidence);
            void CaptureFailures(object? _, FailuresProcessingEventArgs args) {
                var accessor = args.GetFailuresAccessor();
                if (accessor == null) return;
                foreach (var failure in accessor.GetFailureMessages())
                    ((JArray)failureEvidence["failures"]!).Add(new JObject {
                        ["capturedAtUtc"] = DateTime.UtcNow.ToString("O"),
                        ["document"] = accessor.GetDocument()?.Title,
                        ["severity"] = failure.GetSeverity().ToString(),
                        ["failureDefinitionId"] = failure.GetFailureDefinitionId().Guid.ToString(),
                        ["description"] = failure.GetDescriptionText()
                    });
                failureEvidence["status"] = "observed";
                WriteCheckpoint(failurePath, failureEvidence);
            }

            this._application.FailuresProcessing += CaptureFailures;
            try {
                using var processor = new OperationProcessor(project);
                var (contexts, _) = processor.SelectFamilies(() => [family]).ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;

                var loaded = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
                var afterJoins = CaptureJoinGraph(project, loaded);
                Assert.That(afterJoins, Is.EqualTo(beforeJoins), "Migration must preserve every authored join edge.");
                if (error is null) {
                    Assert.That(operation.LastReceipt?.Converged, Is.True);
                    var after = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, loaded);
                    var exact = definitions.Count(definition => after.Parameters.Any(parameter =>
                        parameter.Definition.Identity.Name == definition.Name &&
                        parameter.Definition.Identity.SharedGuid == definition.DownloadOptions.GetGuid().ToString()));
                    Assert.That(exact, Is.EqualTo(definitions.Count));
                } else {
                    var joinLossGuid = BuiltInFailures.JoinElementsFailures.CannotKeepJoined.Guid.ToString();
                    Assert.That(error.ToString(), Does.Contain(joinLossGuid), "Rollback must report the exact native join-loss failure GUID.");
                    Assert.That(loaded.Id, Is.EqualTo(originalId));
                    Assert.That(loaded.UniqueId, Is.EqualTo(originalUniqueId));
                    var after = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, loaded);
                    Assert.That(JToken.DeepEquals(JToken.FromObject(after.Parameters), JToken.FromObject(before.Parameters)), Is.True,
                        "Rollback must preserve the complete parameter matrix.");
                }
            } finally {
                this._application.FailuresProcessing -= CaptureFailures;
                failureEvidence["status"] = "unsubscribed";
                WriteCheckpoint(failurePath, failureEvidence);
            }
        } finally {
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash),
                "Original template fixture was modified.");
        }
    }

    private static IReadOnlyList<string> CaptureJoinGraph(Document project, Family family) {
        var document = project.EditFamily(family);
        try {
            static string Describe(CombinableElement element) =>
                $"{element.UniqueId}|{element.GetType().Name}|{element.Category?.Name ?? "<none>"}";
            return new FilteredElementCollector(document).WhereElementIsNotElementType().OfType<CombinableElement>()
                .SelectMany(element => element.Combinations.Cast<GeomCombination>())
                .DistinctBy(combination => combination.Id)
                .Select(combination => combination.AllMembers.Cast<CombinableElement>()
                    .Select(Describe).OrderBy(member => member, StringComparer.Ordinal).ToList())
                .Where(members => members.Count > 1)
                .Select(members => string.Join("<->", members))
                .OrderBy(combination => combination, StringComparer.Ordinal)
                .ToList();
        } finally { document.Close(false); }
    }

    [TestCase("800 - 120v - 11.5 gal/day")]
    [TestCase("800 - 120v - 16 gal/day")]
    [TestCase("800 - 240v - 23.3 gal/day")]
    [TestCase("800 - 240v - 34.6 gal/day")]
    [Timeout(600000)]
    public void AprilAire_dimension_labels_preserve_all_type_values_and_current_type(string currentType) {
        const string familyName = "AprilAire 800 801 Series Humidifier";
        const string profilePath = "CmdFFManager/profiles/SavedEquip/AprilAire 800 Series.json";
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(AprilAire_dimension_labels_preserve_all_type_values_and_current_type));
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        try {
            // The AprilAire 800 profile as FamilyProfileConverter lowered it, frozen before the converter retired.
            var frozen = JObject.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("aprilaire-dimension-labels.patch.json")));
            Assert.That((string)frozen["source"]!, Is.EqualTo(profilePath));
            var serializer = JsonSerializer.Create(FamilyModelJson.Settings);
            var patch = frozen["patch"]!.ToObject<FamilyPatch>(serializer)!;
            var options = frozen["options"]!.ToObject<ExecutionOptions>(serializer)!;
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(candidate => candidate.Name == familyName);
            string CurrentTypeName(Family target) {
                var document = project.EditFamily(target);
                try { return document.FamilyManager.CurrentType.Name; }
                finally { document.Close(false); }
            }
            var seed = project.EditFamily(family);
            try {
                using var transaction = new Transaction(seed, "Select initial type");
                transaction.Start();
                seed.FamilyManager.CurrentType = seed.FamilyManager.Types.Cast<FamilyType>().Single(type => type.Name == currentType);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
                family = seed.LoadFamily(project, new DefaultFamilyLoadOptions());
            } finally { seed.Close(false); }
            Assert.That(CurrentTypeName(family), Is.EqualTo(currentType));

            ReconcileFamily Apply(Family target) {
                var operation = new ReconcileFamily(patch,
                    sharedSource: document => new FamilySharedParameterSource(document, CompanyCorpusDefinitions()));
                using var processor = new OperationProcessor(project, options);
                var (contexts, _) = processor.SelectFamilies(() => [target]).ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True,
                    "Every value, unset state, and formula must survive dimension-label regeneration without residue.");
                return operation;
            }

            Apply(family);
            var loaded = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(candidate => candidate.Name == familyName);
            Assert.That(CurrentTypeName(loaded), Is.EqualTo(currentType));
            var repeated = Apply(loaded);
            Assert.That(repeated.LastPlan!.Changes, Is.Empty);
        } finally {
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash));
        }
    }

    [Test, Timeout(3600000)]
    public void Old_template_all_editable_mechanical_families_migrate_company_mapping() {
        const string selectionVariable = "PE_FF_OLD_TEMPLATE_FAMILY_SELECTION";
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_all_editable_mechanical_families_migrate_company_mapping));
        var checkpointPath = Path.Combine(output, "company-template-migration.json");
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        var evidence = new JObject { ["status"] = "starting", ["fixtureSha256"] = string.Concat(originalHash.Select(value => value.ToString("X2"))),
            ["selectionInput"] = Environment.GetEnvironmentVariable(selectionVariable), ["completed"] = new JArray(), ["remaining"] = new JArray() };
        var failures = new List<string>();
        try {
            var mappings = CompanyNormalizationFixture.MechanicalMappings();
            var names = mappings.MappingData.Select(m => m.NewName).ToHashSet(StringComparer.Ordinal);
            // 2026-09-07 ruling: connector Number of Poles routes explicitly to PE_E___NumberOfPoles, never through legacy Phase.
            // The company MechEquip profiles route all four connector slots; the sweep carries the same rule for every family
            // that already has an electrical connector and never creates one (creation belongs to the profile lane).
            var connectorRule = new ElectricalConnectorParameterRule { Voltage = "PE_E___Voltage", NumberOfPoles = "PE_E___NumberOfPoles",
                ApparentPower = "PE_E___ApparentPower", MinimumCircuitAmpacity = "PE_E___MCA", CreateIfAbsent = false };
            names.UnionWith([connectorRule.Voltage, connectorRule.NumberOfPoles, connectorRule.ApparentPower, connectorRule.MinimumCircuitAmpacity]);
            var definitions = CompanyCorpusDefinitions().Where(d => names.Contains(d.Name!)).ToList();
            Assert.That(definitions.Count, Is.EqualTo(39), "38 mapped mechanical definitions plus the routed PE_E___ApparentPower.");
            VerifyCompanyDefinitions(definitions, evidence, checkpointPath);
            FamilyPatch WithRule(FamilyPatch converted, Dictionary<string, FailureAction>? failures = null) => new() { Select = converted.Select, Patch = converted.Patch,
                Run = new PatchRun { ElectricalConnectorParameters = connectorRule, ParametersIfSourceExists = converted.Run?.ParametersIfSourceExists,
                    Clean = converted.Run?.Clean, Sort = converted.Run?.Sort, BlanksBecome = converted.Run?.BlanksBecome, Failures = failures } };
            var patch = WithRule(CompanyNormalizationFixture.Convert(mappings, names));
            var scopedOverride = CompanyNormalizationFixture.OldTemplateHorsepowerOverride();
            var scopedPatch = WithRule(CompanyNormalizationFixture.Convert(scopedOverride.Mappings, names));
            // 2026-09-08 ruling: PVFY's one-way angular rig (`z Duct Angle = z Type Flow * 180 deg`) posts "Constraints are not satisfied"
            // whenever the type cursor moves; this family alone lets Revit unlock that constraint, and the receipt must say so.
            const string pvfy = "Mitsubishi_PVFY-NAMU-E1";
            var pvfyPatch = WithRule(CompanyNormalizationFixture.Convert(mappings, names), new() { ["constraintsNotSatisfied"] = FailureAction.Resolve });
            var families = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                .Where(f => f.IsEditable && f.FamilyCategory?.BuiltInCategory == BuiltInCategory.OST_MechanicalEquipment)
                .Select(f => f.Name).OrderBy(name => name, StringComparer.Ordinal).ToList();
            Assert.That(families, Is.Not.Empty, "The real template must provide migration candidates.");
            var selectionPath = Environment.GetEnvironmentVariable(selectionVariable);
            var requested = selectionPath is null ? families : File.ReadAllLines(selectionPath)
                .Select(name => name.Trim()).Where(name => name.Length > 0).ToList();
            Assert.That(requested, Is.Not.Empty, $"{selectionVariable} must name at least one family.");
            Assert.That(requested.Distinct(StringComparer.Ordinal).Count(), Is.EqualTo(requested.Count), "Selection contains duplicate family names.");
            Assert.That(requested.Except(families, StringComparer.Ordinal), Is.Empty, "Selection contains ineligible or missing family names.");
            var selected = requested;
            evidence["status"] = "running";
            evidence["eligible"] = new JArray(families);
            evidence["selected"] = new JArray(selected);
            evidence["unselected"] = new JArray(families.Except(selected, StringComparer.Ordinal));
            evidence["remaining"] = new JArray(selected);
            WriteCheckpoint(checkpointPath, evidence);
            foreach (var familyName in selected) {
                var timer = System.Diagnostics.Stopwatch.StartNew();
                var familyFailures = new List<string>();
                var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
                var originalId = family.Id;
                var originalUniqueId = family.UniqueId;
                var before = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
                // The immutable fixture holds the source alias (`Minimum Circuit Ampacity` = `Amperage`); migration creates PE_E___MCA.
                var fantechMcaBefore = familyName == "Fantech - MUAH Heater"
                    ? before.Parameters.SingleOrDefault(parameter => parameter.Definition.Identity.Name == "PE_E___MCA")
                      ?? before.Parameters.Single(parameter => parameter.Definition.Identity.Name == "Minimum Circuit Ampacity")
                    : null;
                var operation = new ReconcileFamily(familyName == pvfy ? pvfyPatch : scopedOverride.Families.Contains(familyName) ? scopedPatch : patch,
                    sharedSource: d => new FamilySharedParameterSource(d, definitions));
                using var processor = new OperationProcessor(project);
                var (contexts, processorMs) = processor.SelectFamilies(() => [family]).ProcessQueue(new OperationQueue().Add(operation));
                var (operationLogs, error) = contexts.Single().OperationLogs;
                var loaded = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().SingleOrDefault(f => f.Name == familyName);
                var assertions = new JObject { ["loadedFamilyPresent"] = loaded is not null,
                    ["committedConverged"] = error is null && operation.LastReceipt?.Converged == true,
                    ["runEffects"] = new JArray(operation.LastReceipt?.RunEffects ?? []) };
                if (familyName == pvfy && operation.LastReceipt?.RunEffects.Any(e => e.Contains($"{FamilyFailurePolicy.ResolvedPrefix}constraintsNotSatisfied", StringComparison.Ordinal)) != true)
                    familyFailures.Add("PVFY receipt does not record the resolved constraint as a RunEffect");
                if (loaded is null) familyFailures.Add("loaded family disappeared");
                else if (error is null && Environment.GetEnvironmentVariable("PE_FF_OLD_TEMPLATE_SAVE_DIR") is { Length: > 0 } saveDir) {
                    // Review export only: the migrated family as an .rfa beside the checkpoint. The project itself is never saved.
                    // Re-opening a family Revit resolved under run.failures can post the same error again (PVFY, run 17); the
                    // failure scope records it on the row instead of a modal dialog, and the export is skipped.
                    var exportDiagnostics = new List<(bool IsError, string Message)>();
                    try {
                        Pe.Revit.Tasks.RevitFailureScope.Execute(project, accessor => FamilyFailurePolicy.Reject.Apply(accessor, exportDiagnostics), () => {
                            var export = new FamilyDocument(project.EditFamily(loaded));
                            try {
                                var fileName = string.Concat(familyName.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)) + ".rfa";
                                export.SaveAs(Path.Combine(saveDir, fileName), new SaveAsOptions { OverwriteExistingFile = true, Compact = true });
                            } finally { _ = export.Close(false); }
                            return true;
                        });
                    } catch (Exception exportFailure) {
                        exportDiagnostics.Add((true, exportFailure.Message));
                    }
                    assertions["reviewExport"] = exportDiagnostics.Count == 0 ? "saved" : string.Join("; ", exportDiagnostics.Select(d => d.Message));
                }
                if (loaded is not null) {
                    var after = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, loaded);
                    if (error is not null || operation.LastReceipt?.Converged != true) {
                        familyFailures.Add(error?.Message ?? "No committed converged receipt");
                        assertions["rollbackIdentityPreserved"] = loaded.Id == originalId && loaded.UniqueId == originalUniqueId;
                        assertions["rollbackParameterMatrixPreserved"] = JToken.DeepEquals(JToken.FromObject(before.Parameters), JToken.FromObject(after.Parameters));
                        if (assertions.Value<bool>("rollbackIdentityPreserved") != true) familyFailures.Add("failed migration changed project identity");
                        if (assertions.Value<bool>("rollbackParameterMatrixPreserved") != true) familyFailures.Add("failed migration changed the loaded parameter matrix");
                    } else {
                        assertions["completeParameterEvidence"] = before.Issues.Count == 0 && after.Issues.Count == 0;
                        if (assertions.Value<bool>("completeParameterEvidence") != true) familyFailures.Add("incomplete parameter evidence");
                        var exact = definitions.Count(definition => after.Parameters.Any(parameter => parameter.Definition.Identity.Name == definition.Name &&
                            parameter.Definition.Identity.SharedGuid == definition.DownloadOptions.GetGuid().ToString()));
                        assertions["exactSharedIdentityCount"] = exact;
                        assertions["all38SharedIdentities"] = exact == definitions.Count;
                        if (exact != definitions.Count) familyFailures.Add($"exact shared identities: {exact}/{definitions.Count}");
                        if (fantechMcaBefore is not null) {
                            var fantechMcaAfter = after.Parameters.Single(parameter => parameter.Definition.Identity.Name == "PE_E___MCA");
                            var valuesPreserved = fantechMcaBefore.ValuesPerType.Count == fantechMcaAfter.ValuesPerType.Count &&
                                fantechMcaBefore.ValuesPerType.All(value => fantechMcaAfter.ValuesPerType.TryGetValue(value.Key, out var afterValue) && afterValue == value.Value);
                            assertions["fantechMcaSourceWasExactAlias"] = fantechMcaBefore.Formula == "Amperage";
                            assertions["fantechMcaValuesPreserved"] = valuesPreserved;
                            assertions["fantechMcaAliasCleared"] = fantechMcaAfter.Formula is null;
                            if (fantechMcaBefore.Formula != "Amperage") familyFailures.Add($"unexpected original PE_E___MCA formula: {fantechMcaBefore.Formula}");
                            if (!valuesPreserved) familyFailures.Add("PE_E___MCA per-type values changed while materializing Amperage alias");
                            if (fantechMcaAfter.Formula is not null) familyFailures.Add($"PE_E___MCA alias remained: {fantechMcaAfter.Formula}");
                        }
                    }
                }
                timer.Stop();
                failures.AddRange(familyFailures.Select(failure => $"{familyName}: {failure}"));
                ((JArray)evidence["completed"]!).Add(new JObject { ["familyName"] = familyName, ["familyId"] = originalId.Value(),
                    ["familyUniqueId"] = originalUniqueId, ["result"] = familyFailures.Count == 0 ? "passed" : "failed",
                    ["elapsedMs"] = timer.Elapsed.TotalMilliseconds, ["processorMs"] = processorMs,
                    // OperationsMs is the reconcile body alone; elapsedMs - operationsMs is EditFamily + LoadFamily + close.
                    ["operationsMs"] = contexts.Single().OperationsMs,
                    ["operations"] = new JArray((operationLogs ?? []).Select(log => new JObject { ["name"] = log.OperationName, ["msElapsed"] = log.MsElapsed })),
                    ["complexity"] = contexts.Single().Complexity is { } complexity ? new JObject { ["sketchPlanes"] = complexity.SketchPlanes,
                        ["elements"] = complexity.Elements, ["types"] = complexity.Types, ["predictedSeconds"] = complexity.PredictedSeconds } : null,
                    ["dependencyGraph"] = contexts.Single().DependencyGraph,
                    ["assertions"] = assertions, ["receipt"] = operation.LastReceipt is null ? null : JObject.FromObject(operation.LastReceipt),
                    ["error"] = error?.ToString(), ["failures"] = new JArray(familyFailures) });
                evidence["remaining"] = new JArray(selected.Skip(((JArray)evidence["completed"]!).Count));
                WriteCheckpoint(checkpointPath, evidence);
            }
            evidence["status"] = failures.Count == 0 ? "passed" : "completedWithFailures";
            WriteCheckpoint(checkpointPath, evidence);
            Assert.That(failures, Is.Empty, string.Join(Environment.NewLine, failures));
        } finally {
            if (evidence.Value<string>("status") == "running") evidence["status"] = "interrupted";
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

        const int attempts = 5;
        for (var attempt = 1; ; attempt++) {
            try {
                File.Replace(pending, path, null);
                return;
            } catch (IOException ex) {
                if (attempt == attempts)
                    throw new IOException($"Checkpoint replace failed after {attempts} attempts (HResult 0x{ex.HResult:X8}). Previous and pending checkpoints were retained.", ex);
                Thread.Sleep(25 * attempt);
            }
        }
    }

    [Test]
    public void Company_shared_definition_replaces_local_source_with_exact_guid_and_values() {
        var document = this.NewFamily("FF company width");
        try {
            var definitions = CompanyDefinitions();
            var requested = definitions.Single(p => p.Name == "PE_G_Dim_Width1");
            var originalSetting = this._application.SharedParametersFilename;
            var converted = CompanyNormalizationFixture.Convert(CompanyNormalizationFixture.MechanicalMappings(), [requested.Name!]);
            converted.Patch["parameters"]![requested.Name!]!["value"] = "5ft";
            var operation = new ReconcileFamily(converted, sharedSource: d => new FamilySharedParameterSource(d, definitions));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var parameter = document.FamilyManager.FindParameter(requested.Name!);
            Assert.That(parameter.GUID, Is.EqualTo(requested.DownloadOptions.GetGuid()));
            Assert.That(document.CaptureFamilyModel().Parameters[requested.Name!].SharedGuid, Is.EqualTo(parameter.GUID));
            Assert.That(document.FamilyManager.FindParameter("Width"), Is.Null);
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                Assert.That(type.AsDouble(parameter), Is.EqualTo(5.0));
            using (var source = new FamilySharedParameterSource(document, definitions))
                Assert.That(source.GetDefinition(requested.Name!).Description, Is.EqualTo(requested.Description), "native source tooltip; not a claim of internal-definition readback");
            Assert.That(this._application.SharedParametersFilename, Is.EqualTo(originalSetting));
        } finally { document.Close(false); }
    }

    [TestCase(true)]
    [TestCase(false)]
    public void Company_horsepower_na_is_missing_only_when_the_mapping_authors_it(bool companyMapping) {
        var document = this.NewFamily(companyMapping ? "FF company missing horsepower" : "FF unrelated horsepower");
        try {
            using (var seed = new Transaction(document, "Seed text horsepower sentinel")) {
                seed.Start();
                var source = document.FamilyManager.AddParameter("Horsepower (HP)", GroupTypeId.Data, SpecTypeId.String.Text, false);
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>()) {
                    document.FamilyManager.CurrentType = type;
                    document.FamilyManager.Set(source, "N/A");
                }
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var definitions = CompanyCorpusDefinitions();
            var definition = definitions.Single(item => item.Name == "PE_G_Perf_Horsepower");
            var options = definition.DownloadOptions;
            var parameter = new JObject {
                ["shared"] = true, ["sharedGuid"] = options.GetGuid().ToString(), ["sharedSpecId"] = options.GetSpecTypeId().TypeId,
                ["sharedVisible"] = options.Visible, ["sharedUserModifiable"] = !definition.ReadOnly,
                ["isInstance"] = options.IsInstance, ["propertiesGroup"] = options.GetGroupTypeId().TypeId, ["tooltip"] = definition.Description,
                ["wasNamed"] = new JArray("Horsepower (HP)", "Pump HP", "PE_G___Horsepower"),
                ["mappingStrategy"] = "CoerceByStorageType", ["fillBlanksFromSources"] = false
            };
            // The Old_template overlay is the only mapping that authors N/A as a missing source value.
            if (companyMapping) parameter["sourceValuesTreatedAsMissing"] = new JArray("N/A");
            var patch = new FamilyPatch {
                Patch = new JObject { ["parameters"] = new JObject { [definition.Name!] = parameter } },
                Run = new PatchRun { BlanksBecome = [new BlankRule { Specs = [DataType.Number], Value = PortableValue.Parse("-1") }] }
            };
            var before = document.CaptureFamilyModel();
            var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            if (!companyMapping) {
                Assert.That(error?.ToString(), Does.Contain("SourceValue='N/A'").And.Contain("PE_G_Perf_Horsepower"));
                Assert.That(JToken.DeepEquals(JToken.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel())),
                    JToken.Parse(FamilyModelJson.Serialize(before))), Is.True,
                    "Refusal must preserve the captured model; JSON object property order is not semantic.");
                return;
            }
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.FamilyManager.FindParameter("Horsepower (HP)"), Is.Null);
            var target = document.FamilyManager.FindParameter(definition.Name!);
            Assert.That(target, Is.Not.Null);
            // kaitpw 2026-09-08 (blank sentinels): a created numeric parameter with nothing to say reads -1, never a silent 0.
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>()) {
                Assert.That(type.HasValue(target), Is.True, $"{type.Name}: the missing source leaves the created target at the -1 sentinel (kaitpw 2026-09-08).");
                Assert.That(type.AsDouble(target), Is.Not.EqualTo(0d), $"{type.Name}: never a silent 0 (kaitpw 2026-09-08).");
                Assert.That(type.AsDouble(target), Is.EqualTo(-1d), $"{type.Name}: a created numeric parameter with nothing to say reads -1 (kaitpw 2026-09-08).");
            }
        } finally { document.Close(false); }
    }

    [Test]
    public void Captured_raw_values_rebuild_despite_rounded_symbol_suppressed_display() {
        var source = this.NewFamily("FF exact capture");
        var target = this.NewFamily("FF exact rebuild");
        var values = new[] {
            (Name: "Width", Spec: SpecTypeId.Length, Unit: UnitTypeId.Millimeters, Raw: 1.23456789012345),
            (Name: "Fine Angle", Spec: SpecTypeId.Angle, Unit: UnitTypeId.Degrees, Raw: 0.123456789012345),
            (Name: "Fine Voltage", Spec: SpecTypeId.ElectricalPotential, Unit: UnitTypeId.Volts, Raw: UnitUtils.ConvertToInternalUnits(123.456789012345, UnitTypeId.Volts)),
            (Name: "ResultVoltageLookupUnit", Spec: SpecTypeId.ElectricalPotential, Unit: UnitTypeId.Volts, Raw: 10.763910416709722),
            (Name: "ResultAirFlowLookupUnit", Spec: SpecTypeId.AirFlow, Unit: UnitTypeId.CubicFeetPerMinute, Raw: 0.016666666666666666),
            (Name: "Fine Temperature", Spec: SpecTypeId.HvacTemperature, Unit: UnitTypeId.Celsius, Raw: UnitUtils.ConvertToInternalUnits(23.456789012345, UnitTypeId.Celsius)),
            (Name: "Fine Number", Spec: SpecTypeId.Number, Unit: UnitTypeId.General, Raw: 1.23456789012345)
        };
        try {
            using (var seed = new Transaction(source, "Seed disposable coarse display settings")) {
                seed.Start();
                var units = source.GetUnits();
                foreach (var value in values) {
                    var parameter = source.FamilyManager.FindParameter(value.Name) ?? source.FamilyManager.AddParameter(value.Name, GroupTypeId.Data, value.Spec, false);
                    foreach (var type in source.FamilyManager.Types.Cast<FamilyType>()) { source.FamilyManager.CurrentType = type; source.FamilyManager.Set(parameter, value.Raw); }
                    if (value.Spec == SpecTypeId.Number) continue;
                    var format = new FormatOptions(value.Unit) { Accuracy = 1 };
                    format.SetSymbolTypeId(new ForgeTypeId(""));
                    units.SetFormatOptions(value.Spec, format);
                }
                source.SetUnits(units);
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var captured = source.CaptureFamilyModel();
            var json = JObject.Parse(FamilyModelJson.Serialize(captured));
            foreach (var basis in values.Where(v => v.Name.EndsWith("LookupUnit", StringComparison.Ordinal)))
                foreach (var type in (JObject)json["types"]!) {
                    var text = type.Value![basis.Name]!.Value<string>();
                    Assert.That(UnitValueResolver.TryParse(target.GetUnits(), basis.Spec, text, out var raw), Is.True, $"{basis.Name}: {text}");
                    Assert.That(raw, Is.EqualTo(basis.Raw).Within(1e-14), $"Captured unit basis {basis.Name}: {text}");
                }
            var patch = new FamilyPatch { Patch = new JObject { ["parameters"] = json["parameters"]!.DeepClone(), ["types"] = json["types"]!.DeepClone() } };
            Assert.That(FamilyModelUnitValidation.Validate(captured, patch.Patch, _ => null), Is.Empty);
            using var processor = new OperationProcessor(target);
            var operation = new ReconcileFamily(patch);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            foreach (var value in values) {
                var parameter = target.FamilyManager.FindParameter(value.Name);
                foreach (var type in target.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsDouble(parameter), Is.EqualTo(value.Raw).Within(Math.Max(1, Math.Abs(value.Raw)) * 1e-12), value.Name);
                if (value.Spec != SpecTypeId.Number) {
                    var format = source.GetUnits().GetFormatOptions(value.Spec);
                    Assert.That(format.Accuracy, Is.EqualTo(1));
                    Assert.That(format.GetSymbolTypeId().TypeId, Is.Empty);
                }
            }
        } finally { source.Close(false); target.Close(false); }
    }

    [Test]
    public void Plumbing_shared_number_definitions_use_native_other_group() {
        var document = this.NewFamily("FF plumbing shared definitions");
        try {
            var names = new[] { "PE_P_LoadCalc_CWFU", "PE_P_LoadCalc_DFU", "PE_P_LoadCalc_HWFU" };
            var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!.Where(d => names.Contains(d.Name)).ToList();
            Assert.That(definitions.Count, Is.EqualTo(3));
            foreach (var definition in definitions) {
                Assert.That(definition.DownloadOptions.GetGroupTypeId().TypeId, Is.Empty);
                Assert.That(definition.DownloadOptions.GetSpecTypeId(), Is.EqualTo(SpecTypeId.Number));
            }
            var patch = CompanyNormalizationFixture.Convert(new(), names);
            foreach (var name in names) patch.Patch["parameters"]![name]!["value"] = name.EndsWith("DFU") ? 2d : 7.5;
            var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            foreach (var definition in definitions) {
                var parameter = document.FamilyManager.FindParameter(definition.Name!);
                Assert.That(parameter.GUID, Is.EqualTo(definition.DownloadOptions.GetGuid()));
                Assert.That(parameter.Definition.GetGroupTypeId().TypeId, Is.Empty);
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsDouble(parameter), Is.EqualTo(definition.Name!.EndsWith("DFU") ? 2d : 7.5));
            }
        } finally { document.Close(false); }
    }

    [Test]
    public void Direct_public_plan_keeps_group_contexts_after_normalization() {
        var document = this.NewFamily("FF public plan");
        try {
            var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"Mapped Width":{"dataType":"Length","wasNamed":["Width"],"value":"3ft"}}}}""");
            var current = document.CaptureFamilyModel();
            var desired = FamilyReconciler.Desired(current, patch);
            Assert.That(desired.Diagnostics, Is.Empty);
            var plan = FamilyReconciler.Reconcile(desired.Value!, current, UnitResolvers.Revit(document), authored: patch.Patch);
            Assert.That(plan.OpOrder.First(), Is.EqualTo("NormalizeParamSources"));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(plan.Queue);
            var (logs, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(logs!.Sum(log => log.PendingCount), Is.Zero);
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Mapped Width")), Is.EqualTo(3d));
        } finally { document.Close(false); }
    }

    [Test]
    public void Reapplying_shared_mapping_has_no_operations_changes_or_effects() {
        var document = this.NewFamily("FF repeated shared mapping");
        try {
            var definitions = CompanyDefinitions();
            var patch = CompanyNormalizationFixture.Convert(CompanyNormalizationFixture.MechanicalMappings(), ["PE_G_Dim_Width1"]);
            patch.Patch["parameters"]!["PE_G_Dim_Width1"]!["value"] = "5ft";
            string? repeatedHash = null;
            for (var pass = 0; pass < 3; pass++) {
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                using var processor = new OperationProcessor(document);
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
                if (pass == 0) continue;
                Assert.That(operation.LastPlan!.Changes, Is.Empty);
                Assert.That(operation.LastPlan.Queue.Operations, Is.Empty);
                Assert.That(operation.LastPlan.RunEffects, Is.Empty);
                if (repeatedHash is not null) Assert.That(operation.LastPlan.PlanHash, Is.EqualTo(repeatedHash));
                repeatedHash = operation.LastPlan.PlanHash;
            }
        } finally { document.Close(false); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Conflicting_source_references_follow_existing_destination_before_source_removal(bool incompatible) {
        var document = this.NewFamily("FF destination wins");
        try {
            using (var seed = new Transaction(document, "Seed conflicting destination and dependent formula")) {
                seed.Start();
                var manager = document.FamilyManager;
                var target = manager.AddParameter("Winning Width", GroupTypeId.Geometry, incompatible ? SpecTypeId.String.Text : SpecTypeId.Length, false);
                var dependent = manager.AddParameter("Dependent Width", GroupTypeId.Geometry, SpecTypeId.Length, false);
                foreach (var type in manager.Types.Cast<FamilyType>()) {
                    manager.CurrentType = type;
                    if (incompatible) manager.Set(target, "destination"); else manager.Set(target, 9d);
                }
                manager.SetFormula(dependent, "Width * 2");
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Winning Width":{"wasNamed":["Width"]}}}}"""));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            if (incompatible) {
                Assert.That(error, Is.Not.Null, "A text destination cannot replace a length reference in multiplication.");
                Assert.That(error!.ToString(), Does.Contain("Dependent Width").And.Contain("Width").And.Contain("Winning Width")
                    .And.Contain("Winning Width * 2").And.Contain("Formula setting failed"));
                Assert.That(operation.LastReceipt?.Converged ?? false, Is.False);
                AssertOriginalWidths(document);
                Assert.That(document.FamilyManager.FindParameter("Dependent Width").Formula, Is.EqualTo("Width * 2"));
                Assert.That(document.FamilyManager.Parameters.Cast<FamilyParameter>().Any(p => p.Definition.Name.StartsWith("FF_Transfer_")), Is.False);
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsString(document.FamilyManager.FindParameter("Winning Width")), Is.EqualTo("destination"));
                return;
            }
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.FamilyManager.FindParameter("Width"), Is.Null);
            var targetParameter = document.FamilyManager.FindParameter("Winning Width");
            var dependentParameter = document.FamilyManager.FindParameter("Dependent Width");
            Assert.That(dependentParameter.Formula, Does.Contain("Winning Width"));
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>()) {
                Assert.That(type.AsDouble(targetParameter), Is.EqualTo(9d));
                Assert.That(type.AsDouble(dependentParameter), Is.EqualTo(18d));
            }
        } finally { document.Close(false); }
    }

    [Test]
    public void Exact_destination_alias_materializes_every_type_and_reapply_is_noop() {
        var document = this.NewFamily("FF exact destination alias");
        try {
            IReadOnlyDictionary<string, double?> beforeValues;
            string unrelatedFormula;
            using (var seed = new Transaction(document, "Seed exact destination alias")) {
                seed.Start();
                var seedManager = document.FamilyManager;
                var source = seedManager.AddParameter("Amperage", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var targetParameter = seedManager.AddParameter("PE_E___MCA", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var related = seedManager.AddParameter("Related Current", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var unrelatedInput = seedManager.AddParameter("Unrelated Current", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var unrelated = seedManager.AddParameter("Unrelated Formula", GroupTypeId.Electrical, SpecTypeId.Current, false);
                foreach (var type in seedManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")) {
                    seedManager.CurrentType = type;
                    seedManager.Set(source, type.Name == "A" ? 10d : 20d);
                    seedManager.Set(unrelatedInput, type.Name == "A" ? 3d : 4d);
                }
                seedManager.SetFormula(targetParameter, "Amperage");
                seedManager.SetFormula(related, "Amperage * 2");
                seedManager.SetFormula(unrelated, "Unrelated Current * 3");
                beforeValues = seedManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")
                    .ToDictionary(type => type.Name, type => type.AsDouble(targetParameter), StringComparer.Ordinal);
                unrelatedFormula = unrelated.Formula;
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"PE_E___MCA":{"wasNamed":["Amperage"]}}}}""");
            using var processor = new OperationProcessor(document);
            var operation = new ReconcileFamily(patch);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var manager = document.FamilyManager;
            var target = manager.FindParameter("PE_E___MCA");
            Assert.That(target.Formula, Is.Null);
            Assert.That(manager.FindParameter("Amperage"), Is.Null);
            foreach (var (typeName, value) in beforeValues)
                Assert.That(manager.Types.Cast<FamilyType>().Single(type => type.Name == typeName).AsDouble(target), Is.EqualTo(value));
            Assert.That(manager.FindParameter("Related Current").Formula, Is.EqualTo("PE_E___MCA * 2"));
            Assert.That(manager.FindParameter("Unrelated Formula").Formula, Is.EqualTo(unrelatedFormula));

            var repeated = new ReconcileFamily(patch);
            var (repeatedContexts, _) = processor.ProcessQueue(new OperationQueue().Add(repeated));
            var (_, repeatedError) = repeatedContexts.Single().OperationLogs;
            Assert.That(repeatedError, Is.Null, repeatedError?.Message);
            Assert.That(repeated.LastReceipt?.Converged, Is.True);
            Assert.That(repeated.LastPlan!.Changes, Is.Empty);
        } finally { document.Close(false); }
    }

    [Test]
    public void Nontrivial_destination_dependency_refuses_without_dropping_formula() {
        var document = this.NewFamily("FF nontrivial destination dependency");
        try {
            using (var seed = new Transaction(document, "Seed nontrivial destination dependency")) {
                seed.Start();
                var manager = document.FamilyManager;
                var source = manager.AddParameter("Amperage", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var target = manager.AddParameter("PE_E___MCA", GroupTypeId.Electrical, SpecTypeId.Current, false);
                foreach (var type in manager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")) {
                    manager.CurrentType = type;
                    manager.Set(source, type.Name == "A" ? 10d : 20d);
                }
                manager.SetFormula(target, "Amperage * 1.25");
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var before = document.CaptureFamilyModel();
            var valuesBefore = document.FamilyManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")
                .ToDictionary(type => type.Name, type => type.AsDouble(document.FamilyManager.FindParameter("Amperage")));
            var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"PE_E___MCA":{"wasNamed":["Amperage"]}}}}"""));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error?.ToString(), Does.Contain("PE_E___MCA").And.Contain("Amperage * 1.25")
                .And.Contain("not an exact alias").And.Contain("Refusing to discard formula intent"));
            var after = document.CaptureFamilyModel();
            Assert.That(document.FamilyManager.FindParameter("PE_E___MCA")!.Formula, Is.EqualTo("Amperage * 1.25"));
            Assert.That(document.FamilyManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")
                .ToDictionary(type => type.Name, type => type.AsDouble(document.FamilyManager.FindParameter("Amperage"))), Is.EqualTo(valuesBefore));
            Assert.That(FamilyReconciler.Diff(before, after, UnitResolvers.Revit(document)), Is.Empty);
            Assert.That(FamilyReconciler.Diff(after, before, UnitResolvers.Revit(document)), Is.Empty);
        } finally { document.Close(false); }
    }

    [Test]
    public void Multiple_targets_receive_a_shared_source_before_cleanup() {
        var document = this.NewFamily("FF batched fallback");
        try {
            var originalType = document.FamilyManager.CurrentType.Name;
            var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Mapped A":{"dataType":"Length","wasNamed":["Width"]},"Mapped B":{"dataType":"Length","wasNamed":["Width"]}}}}"""));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                foreach (var name in new[] { "Mapped A", "Mapped B" })
                    Assert.That(type.AsDouble(document.FamilyManager.FindParameter(name)), Is.EqualTo(type.Name == "A" ? 1d : 2d));
            Assert.That(document.FamilyManager.CurrentType.Name, Is.EqualTo(originalType));
            Assert.That(document.FamilyManager.FindParameter("Keep"), Is.Not.Null);
        } finally { document.Close(false); }
    }

    [Test]
    public void Explicit_units_are_independent_of_display_units_and_implicit_literals_fail_before_writes() {
        foreach (var displayUnit in new[] { UnitTypeId.Feet, UnitTypeId.Millimeters }) {
            var document = this.NewFamily("FF explicit units");
            try {
                using (var seed = new Transaction(document, "Seed disposable display units")) {
                    seed.Start();
                    var units = document.GetUnits();
                    units.SetFormatOptions(SpecTypeId.Length, new FormatOptions(displayUnit));
                    document.SetUnits(units);
                    Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
                }
                var invalid = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Width":{"value":3},"NeverAdded":{"dataType":"Number","value":2}}}}"""));
                using (var processor = new OperationProcessor(document)) {
                    var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(invalid));
                    var (_, error) = contexts.Single().OperationLogs;
                    Assert.That(error, Is.Not.Null);
                    Assert.That(document.FamilyManager.FindParameter("NeverAdded"), Is.Null);
                }
                var valid = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Width":{"value":"3ft"},"Count":{"dataType":"Integer","value":2},"Ratio":{"dataType":"Number","value":1.5}}}}"""));
                using (var processor = new OperationProcessor(document)) {
                    var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(valid));
                    var (_, error) = contexts.Single().OperationLogs;
                    Assert.That(error, Is.Null, error?.Message);
                    Assert.That(valid.LastReceipt?.Converged, Is.True);
                }
                var width = document.FamilyManager.FindParameter("Width");
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsDouble(width), Is.EqualTo(3).Within(1e-9));
                Assert.That(document.GetUnits().GetFormatOptions(SpecTypeId.Length).GetUnitTypeId(), Is.EqualTo(displayUnit));
            } finally { document.Close(false); }
        }
    }

    [Test]
    public void Captured_shared_definitions_rebuild_offline_without_APS_cache() {
        var original = this.NewFamily("FF offline source");
        var target = this.NewFamily("FF offline rebuild");
        try {
            var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!;
            var mappingNames = CompanyNormalizationFixture.MechanicalMappings().MappingData.Select(m => m.NewName).ToHashSet();
            definitions = definitions.Where(d => mappingNames.Contains(d.Name!)).ToList();
            Assert.That(definitions.Count, Is.EqualTo(38), "Every target in the real mechanical mapping fragment has an exact frozen definition.");
            var patch = CompanyNormalizationFixture.Convert(CompanyNormalizationFixture.MechanicalMappings(),
                definitions.Select(d => d.Name!));
            using (var processor = new OperationProcessor(original)) {
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
            }
            var captured = original.CaptureFamilyModel();
            var json = JObject.Parse(FamilyModelJson.Serialize(captured));
            var offline = new FamilyPatch { Patch = new JObject { ["parameters"] = json["parameters"]!.DeepClone(), ["types"] = json["types"]!.DeepClone() } };
            using (var processor = new OperationProcessor(target)) {
                // Empty injected source deliberately makes every APS lookup fail.
                var operation = new ReconcileFamily(offline, sharedSource: d => new FamilySharedParameterSource(d, []));
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
            }
            var rebuilt = target.CaptureFamilyModel();
            foreach (var definition in definitions) {
                var before = captured.Parameters[definition.Name!];
                var after = rebuilt.Parameters[definition.Name!];
                Assert.That(after.SharedGuid, Is.EqualTo(before.SharedGuid));
                Assert.That(after.SharedSpecId, Is.EqualTo(before.SharedSpecId));
                Assert.That(after.SharedVisible, Is.EqualTo(before.SharedVisible));
                Assert.That(after.SharedUserModifiable, Is.EqualTo(before.SharedUserModifiable));
            }
        } finally { original.Close(false); target.Close(false); }
    }

    [TestCase(false, false)]
    [TestCase(true, false)]
    [TestCase(false, true)]
    [TestCase(true, true)]
    public void Ranked_company_sources_fill_only_opted_in_blanks_and_explicit_values_always_win(bool fill, bool explicitValue) {
        var document = this.NewFamily("FF company model");
        try {
            using (var transaction = new Transaction(document, "Seed company source candidates")) {
                transaction.Start();
                var fm = document.FamilyManager;
                var sparse = fm.get_Parameter(BuiltInParameter.ALL_MODEL_MODEL)
                    ?? throw new InvalidOperationException("Generic Model template has no built-in Model source.");
                var dense = fm.AddParameter("Mech Equip Model Number", GroupTypeId.Data, SpecTypeId.String.Text, false);
                var target = fm.AddParameter("PE_G___Model", GroupTypeId.Data, SpecTypeId.String.Text, false);
                foreach (var type in fm.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B")) {
                    fm.CurrentType = type;
                    fm.Set(sparse, type.Name == "A" ? "sparse" : "");
                    fm.Set(dense, "dense-" + type.Name);
                    fm.Set(target, type.Name == "A" ? "destination" : "");
                }
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var parameter = JObject.Parse("""{"shared":true,"wasNamed":["Model","Mech Equip Model Number"]}""");
            parameter["fillBlanksFromSources"] = fill;
            if (explicitValue) parameter["value"] = "explicit";
            var operation = new ReconcileFamily(new FamilyPatch { Patch = new JObject { ["parameters"] = new JObject { ["PE_G___Model"] = parameter } } },
                sharedSource: d => new FamilySharedParameterSource(d, CompanyDefinitions()));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var targetParameter = document.FamilyManager.FindParameter("PE_G___Model");
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                Assert.That(type.AsString(targetParameter), Is.EqualTo(explicitValue ? "explicit" : type.Name == "A" ? "destination" : fill ? "dense-B" : ""));
            Assert.That(document.FamilyManager.FindParameter("Model"), Is.Not.Null, "Revit owns the built-in source; it cannot be removed.");
            Assert.That(document.FamilyManager.FindParameter("Mech Equip Model Number"), Is.Null, "Conflicting user-defined source is removed after transfer; destination wins.");
        } finally { document.Close(false); }
    }

    [Test]
    public void Explicit_value_updates_every_type_preserves_unmentioned_parameter_and_does_not_save() {
        var document = this.NewFamily("FF normalization values");
        try {
            var path = document.PathName;
            var operation = WidthPatch();
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.PathName, Is.EqualTo(path));
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B")) {
                Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(3.0));
                Assert.That(type.AsString(document.FamilyManager.FindParameter("Keep")), Is.EqualTo(type.Name));
            }
        } finally { document.Close(false); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Failed_dependent_work_rolls_back_the_entire_family_and_receipt(bool singleTransaction) {
        var document = this.NewFamily("FF normalization rollback");
        try {
            var operation = WidthPatch();
            // The per-operation shape is the execution options the Constrained Box profile authored.
            var options = singleTransaction
                ? new ExecutionOptions()
                : new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = false };
            using var processor = new OperationProcessor(document, options);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation).Add(new FailFamily()));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Not.Null);
            Assert.That(operation.LastReceipt?.Converged ?? false, Is.False);
            Assert.That(operation.LastReceipt?.Residue, Is.Empty, "Rollback must not replace measured post-apply residue with the requested plan.");
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Caller_owned_transaction_does_not_publish_committed_receipt() {
        var document = this.NewFamily("FF normalization caller transaction");
        try {
            using var transaction = new Transaction(document, "Caller owns commit");
            transaction.Start();
            var operation = WidthPatch();
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.False);
            Assert.That(operation.LastReceipt?.Residue, Is.Empty, "Staged edits have no measured residue, but the caller still owns commit.");
            transaction.RollBack();
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Stale_plan_is_rejected_before_parameter_mutation() {
        var document = this.NewFamily("FF normalization drift");
        try {
            var operation = WidthPatch("stale");
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error?.Message, Does.Contain("Plan hash drifted"));
            Assert.That(operation.LastReceipt, Is.Null);
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Failed_family_does_not_load_and_next_family_can_succeed() {
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(this._application);
        try {
            var families = new List<Family>();
            foreach (var name in new[] { "FF fail", "FF pass" }) {
                var document = this.NewFamily(name);
                try { families.Add(document.LoadFamily(project, new DefaultFamilyLoadOptions())); }
                finally { document.Close(false); }
            }
            var operation = WidthPatch();
            var receipts = new List<bool>();
            var familyIds = families.Select(f => f.Id).ToArray();
            var familyNames = families.Select(f => f.Name).ToArray();
            var failure = new FailFamily(familyNames[0]);
            Assert.That(familyIds.Distinct().Count(), Is.EqualTo(2));
            using var processor = new OperationProcessor(project, new ExecutionOptions { SingleTransaction = false });
            var (contexts, _) = processor.SelectFamilies(() => families)
                .WithPerFamilyCallback(_ => receipts.Add(operation.LastReceipt?.Converged ?? false))
                .ProcessQueue(new OperationQueue().Add(operation).Add(failure));
            Assert.That(contexts.Count, Is.EqualTo(2));
            var (_, firstError) = contexts[0].OperationLogs;
            Assert.That(failure.Triggered, Is.True, $"Earlier failure: {firstError}; loaded names: {string.Join(", ", familyNames)}; contexts: {string.Join(", ", contexts.Select(c => c.FamilyName))}");
            Assert.That(firstError?.Message, Does.Contain("injected failure"));
            Assert.That(receipts, Is.EqualTo(new[] { false, true }));
            for (var index = 0; index < familyNames.Length; index++) {
                var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                    .Single(f => f.Name == familyNames[index]);
                if (index == 0) Assert.That(family.Id, Is.EqualTo(familyIds[0]), "Failed family must retain its original project identity.");
                var document = project.EditFamily(family);
                try {
                    if (index == 0) AssertOriginalWidths(document);
                    else foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                        Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(3.0));
                } finally { document.Close(false); }
            }
        } finally { project.Close(false); }
    }

    private static void AssertOriginalWidths(Document document) {
        foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
            Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(type.Name == "A" ? 1.0 : 2.0));
    }

    private sealed class FailFamily(string? family = null) : DocOperation<DefaultOperationSettings>(new()) {
        public override string Description => "Injected dependent failure";
        public bool Triggered { get; private set; }
        public override OperationLog Execute(FamilyDocument document, FamilyProcessingContext context, OperationContext group) {
            var reject = family is null || family == context.FamilyName;
            this.Triggered |= reject;
            return new(this.Name, [reject ? new LogEntry("dependent").Error("injected failure") : new LogEntry("dependent").Success("accepted")]);
        }
    }
}
