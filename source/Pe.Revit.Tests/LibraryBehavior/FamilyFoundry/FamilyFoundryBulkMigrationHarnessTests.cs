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
            var failure = new FailFamily(families[0].Name);
            Assert.That(families.Select(f => f.Id).Distinct().Count(), Is.EqualTo(2));
            using var processor = new OperationProcessor(project, new ExecutionOptions { SingleTransaction = false });
            var (contexts, _) = processor.SelectFamilies(() => families)
                .WithPerFamilyCallback(_ => receipts.Add(operation.LastReceipt?.Converged ?? false))
                .ProcessQueue(new OperationQueue().Add(operation).Add(failure));
            Assert.That(contexts.Count, Is.EqualTo(2));
            Assert.That(failure.Triggered, Is.True, $"Loaded names: {string.Join(", ", families.Select(f => f.Name))}; contexts: {string.Join(", ", contexts.Select(c => c.FamilyName))}");
            var (_, firstError) = contexts[0].OperationLogs;
            Assert.That(firstError?.Message, Does.Contain("injected failure"));
            Assert.That(receipts, Is.EqualTo(new[] { false, true }));
            foreach (var family in families) {
                var document = project.EditFamily(family);
                try {
                    if (family.Id == families[0].Id) AssertOriginalWidths(document);
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
