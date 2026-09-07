using Autodesk.Revit.ApplicationServices;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Parameters;

namespace Pe.Revit.Tests;

/// <summary>Normalization acceptance through the processor. Runtime owner runs these on disposable documents.</summary>
[TestFixture]
public sealed class FamilyFoundryBulkMigrationHarnessTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    private Document NewFamily(string name) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_GenericModel, name);
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
    public void Old_template_all_editable_mechanical_families_migrate_company_mapping() {
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_all_editable_mechanical_families_migrate_company_mapping));
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        var evidence = new JArray();
        var failures = new List<string>();
        try {
            var mappings = CompanyNormalizationFixture.MechanicalMappings();
            var names = mappings.MappingData.Select(m => m.NewName).ToHashSet(StringComparer.Ordinal);
            var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!.Where(d => names.Contains(d.Name!)).ToList();
            Assert.That(definitions.Count, Is.EqualTo(38));
            var patch = CompanyNormalizationFixture.Convert(mappings, names);
            var families = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                .Where(f => f.IsEditable && f.FamilyCategory?.BuiltInCategory == BuiltInCategory.OST_MechanicalEquipment)
                .OrderBy(f => f.Name, StringComparer.Ordinal).ToList();
            Assert.That(families, Is.Not.Empty, "The real template must provide migration candidates.");
            foreach (var family in families) {
                var before = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                using var processor = new OperationProcessor(project);
                var (contexts, _) = processor.SelectFamilies(() => [family]).ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                var after = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
                var entry = new JObject { ["family"] = family.Name, ["receipt"] = operation.LastReceipt is null ? null : JObject.FromObject(operation.LastReceipt), ["error"] = error?.ToString() };
                evidence.Add(entry);
                if (error is not null || operation.LastReceipt?.Converged != true) {
                    failures.Add($"{family.Name}: {error?.Message ?? "No committed converged receipt"}");
                    if (!JToken.DeepEquals(JToken.FromObject(before.Parameters), JToken.FromObject(after.Parameters)))
                        failures.Add($"{family.Name}: failed migration changed the loaded parameter matrix");
                    continue;
                }
                if (before.Issues.Count != 0 || after.Issues.Count != 0) failures.Add($"{family.Name}: incomplete parameter evidence");
                foreach (var definition in definitions) {
                    var parameter = after.Parameters.SingleOrDefault(p => p.Definition.Identity.Name == definition.Name);
                    if (parameter?.Definition.Identity.SharedGuid != definition.DownloadOptions.GetGuid().ToString())
                        failures.Add($"{family.Name}: exact shared identity missing for {definition.Name}");
                }
            }
            File.WriteAllText(Path.Combine(output, "company-template-migration.json"), evidence.ToString());
            Assert.That(failures, Is.Empty, string.Join(Environment.NewLine, failures));
        } finally {
            File.WriteAllText(Path.Combine(output, "company-template-migration.json"), evidence.ToString());
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash), "Original template fixture was modified.");
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
            using var source = new FamilySharedParameterSource(document, definitions);
            Assert.That(source.GetDefinition(requested.Name!).Description, Is.EqualTo(requested.Description), "native source tooltip; not a claim of internal-definition readback");
            Assert.That(this._application.SharedParametersFilename, Is.EqualTo(originalSetting));
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
                    Assert.That(UnitFormatUtils.TryParse(target.GetUnits(), basis.Spec, text, out var raw), Is.True, $"{basis.Name}: {text}");
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
    public void Company_numeric_literals_use_known_legacy_units_and_number_stays_unitless() {
        var assignments = new Pe.Revit.FamilyFoundry.OperationSettings.SetKnownParamsSettings {
            GlobalAssignments = [new() { Parameter = "Voltage", Kind = Pe.Revit.FamilyFoundry.OperationSettings.ParamAssignmentKind.Value, Value = "480" },
                new() { Parameter = "Ratio", Kind = Pe.Revit.FamilyFoundry.OperationSettings.ParamAssignmentKind.Value, Value = "1.5" }]
        };
        var specs = new Dictionary<string, ForgeTypeId> { ["Voltage"] = SpecTypeId.ElectricalPotential, ["Ratio"] = SpecTypeId.Number };
        Assert.Throws<InvalidOperationException>(() => CompanyNormalizationFixture.Convert(new(), [], assignments, specs: specs));
        var units = new Units(UnitSystem.Metric);
        units.SetFormatOptions(SpecTypeId.ElectricalPotential, new FormatOptions(UnitTypeId.Volts));
        var patch = CompanyNormalizationFixture.Convert(new(), [], assignments, specs: specs, legacyUnits: units);
        Assert.That(patch.Patch["parameters"]!["Voltage"]!["value"]!.ToString(), Does.Contain("V"));
        Assert.That(patch.Patch["parameters"]!["Ratio"]!["value"]!.ToString(), Is.EqualTo("1.5"));
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
            using var processor = new OperationProcessor(document, new ExecutionOptions { SingleTransaction = singleTransaction });
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation).Add(new FailFamily()));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Not.Null);
            Assert.That(operation.LastReceipt?.Converged ?? false, Is.False);
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
            Assert.That(failure.Triggered, Is.True, $"Loaded names: {string.Join(", ", familyNames)}; contexts: {string.Join(", ", contexts.Select(c => c.FamilyName))}");
            var (_, firstError) = contexts[0].OperationLogs;
            Assert.That(firstError?.Message, Does.Contain("injected failure"));
            Assert.That(receipts, Is.EqualTo(new[] { false, true }));
            foreach (var familyId in familyIds) {
                var family = project.GetElement(familyId) as Family ?? throw new InvalidOperationException($"Loaded family {familyId} disappeared.");
                var document = project.EditFamily(family);
                try {
                    if (familyId == familyIds[0]) AssertOriginalWidths(document);
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
