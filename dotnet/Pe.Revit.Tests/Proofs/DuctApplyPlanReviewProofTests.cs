using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Structure;
using Newtonsoft.Json;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Global.Lib.Mep;
using Pe.Revit.Global.Services.Host;
using Pe.Shared.RevitData.Ducts;
using Pe.Shared.RevitData.Serialization;
using System.Globalization;
using System.Reflection;

namespace Pe.Revit.Tests.Proofs;

/// <summary>Real native Plan bodies, including unset settings, executed in Revit's read-only DocumentChanged callback.</summary>
[TestFixture, NonParallelizable]
public sealed class DuctApplyPlanReviewProofTests {
    private static readonly Guid SpecificLoss = new("46245996-eebb-4536-ac17-9c1cd917d8cf");
    private static readonly Guid Ashrae = new("8baf7d75-8b9b-46d0-b8ce-3ad1c19e6b19");
    private static readonly ForgeTypeId PressureUnit = UnitTypeId.InchesOfWater60DegreesFahrenheit;
    private static readonly ForgeTypeId FlowUnit = UnitTypeId.CubicFeetPerMinute;

    [Test]
    public void Accessory_method_unset_existing_loss_and_reported_pressure_are_native(UIApplication ui) {
        var path = Environment.GetEnvironmentVariable("PE_DUCT_REVIEW_FIXTURE");
        Assert.That(File.Exists(path), Is.True, "PE_DUCT_REVIEW_FIXTURE must name an owned copy of the existing duct model");
        using var info = BasicFileInfo.Extract(path);
        using var options = new OpenOptions { DetachFromCentralOption = info.IsWorkshared
            ? DetachFromCentralOption.DetachAndDiscardWorksets : DetachFromCentralOption.DoNotDetach };
        var doc = ui.Application.OpenDocumentFile(ModelPathUtils.ConvertUserVisiblePathToModelPath(path), options);
        Assert.That(doc.IsWorkshared, Is.False, "proof setup never borrows from a central model");
        try {
            var idText = Environment.GetEnvironmentVariable("PE_DUCT_REVIEW_ACCESSORY_ID");
            var accessory = idText is null
                ? new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DuctAccessory).WhereElementIsNotElementType().FirstElement()
                : doc.GetElement(long.Parse(idText, CultureInfo.InvariantCulture).ToElementId());
            Assert.That(accessory, Is.Not.Null);
            var schema = (ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService)
                ?.GetServer(SpecificLoss) as IDuctFittingAndAccessoryPressureDropServer)?.GetDataSchema();
            Assert.That(schema, Is.Not.Null, "Revit's actual Specific Loss server schema");
            var results = new List<DuctWrite>();
            DuctApplyRequest Ask(long id) => new(null, [], [], [new(id, 0.03980584344921083, "native proof")], [], [], [], Store(doc));
            string State() => JsonConvert.SerializeObject(new {
                method = accessory!.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM)?.AsString(),
                entity = accessory.GetEntity(schema!).IsValid() ? accessory.GetEntity(schema!).Get<string>(schema!.GetField("PressureLoss")) : null,
                reported = Reported(accessory), store = DuctApplier.ReadStore(doc).Store?.ToJson()
            });

            // Preserve the fixture's untouched native pressure availability before any regeneration.
            var initial = Read(ui, doc, "accessory-initial", Ask(accessory!.Id.Value()), State);
            results.Add(initial.Writes.Single(w => w.Kind == "component"));
            foreach (var specific in new[] { false, true }) {
                using (var tx = new Transaction(doc, "Seed native loss method and setting")) {
                    tx.Start();
                    var method = accessory.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM);
                    Assert.That(method.Set((specific ? SpecificLoss : Ashrae).ToString()), Is.True);
                    if (specific) {
                        var entity = new Entity(schema!);
                        entity.Set(schema!.GetField("PressureLoss"), UnitUtils.ConvertToInternalUnits(0.125, PressureUnit).ToString("R", CultureInfo.InvariantCulture));
                        accessory.SetEntity(entity);
                    } else accessory.DeleteEntity(schema!);
                    Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
                }
                var result = Read(ui, doc, specific ? "accessory-specific-loss" : "accessory-ashrae-unset", Ask(accessory.Id.Value()), State);
                var row = result.Writes.Single(w => w.Kind == "component");
                results.Add(row);
                Identity(row, accessory, "Specific Loss", "instance");
                Assert.Multiple(() => {
                    Assert.That(row.Outcome, Is.EqualTo("planned"), row.Reason);
                    Assert.That(row.Before, Is.EqualTo(specific ? "0.125 in-wg" : "unset"));
                    Assert.That(row.After, Is.EqualTo("0.0398 in-wg"));
                    Assert.That(row.Changes!.Select(c => c.Parameter), Is.EqualTo(new[] { "Loss Method", "Specific Loss" }));
                    Assert.That(row.Changes[0].Before, Is.EqualTo(specific ? "specific-loss" : "ashrae-table"));
                    Assert.That(row.Changes[0].After, Is.EqualTo("specific-loss"));
                    Assert.That(row.Changes[1].Before, Is.EqualTo(row.Before));
                    Assert.That(row.ReportedPressureDropInWg, Is.EqualTo(Reported(accessory)), "reported effective pressure is independently read, never the stored setting");
                });
            }
            // A copied, disconnected accessory gives the same native reader a second pressure-availability case.
            Element disconnected;
            using (var tx = new Transaction(doc, "Disconnected accessory control")) {
                tx.Start();
                disconnected = doc.GetElement(ElementTransformUtils.CopyElement(doc, accessory.Id, new XYZ(500, 0, 0)).Single());
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var control = Read(ui, doc, "accessory-disconnected", Ask(disconnected.Id.Value()),
                () => JsonConvert.SerializeObject(new { reported = Reported(disconnected), store = DuctApplier.ReadStore(doc).Store?.ToJson() }));
            var controlRow = control.Writes.Single(w => w.Kind == "component");
            results.Add(controlRow);
            Identity(controlRow, disconnected, "Specific Loss", "instance");
            Assert.That(controlRow.ReportedPressureDropInWg, Is.EqualTo(Reported(disconnected)));
            Assert.Multiple(() => {
                Assert.That(results.Any(r => r.ReportedPressureDropInWg is null), Is.True, "native unavailable reported-pressure case was actually reached");
                Assert.That(results.Any(r => r.ReportedPressureDropInWg is not null), Is.True, "native available reported-pressure case was actually reached");
            });
            var missing = Read(ui, doc, "accessory-missing", Ask(999999999L), State).Writes.Single(w => w.Kind == "component");
            Assert.That(missing.Outcome, Is.EqualTo("refused"));
            Assert.That(missing.Reason, Does.Contain("not in the document"));
        } finally { RevitFamilyFixtureHarness.CloseDocument(doc); }
    }

    [Test]
    public void Fan_instance_and_type_parameters_publish_identity_scope_values_and_missing_parameter_refusals(UIApplication ui) {
        var family = RevitFamilyFixtureHarness.CreateFamilyDocument(ui.Application, BuiltInCategory.OST_MechanicalEquipment, "NativeReviewFan");
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        try {
            using (var tx = new Transaction(family, "Native review fan parameters")) {
                tx.Start();
                RevitFamilyFixtureHarness.SetCurrentType(family, "Proof");
                foreach (var instance in new[] { true, false }) {
                    var prefix = instance ? "Instance" : "Type";
                    var pressure = family.FamilyManager.AddParameter(prefix + "Static", GroupTypeId.Mechanical, SpecTypeId.HvacPressure, instance);
                    var flow = family.FamilyManager.AddParameter(prefix + "Flow", GroupTypeId.Mechanical, SpecTypeId.AirFlow, instance);
                    family.FamilyManager.Set(pressure, UnitUtils.ConvertToInternalUnits(0.125, PressureUnit));
                    family.FamilyManager.Set(flow, UnitUtils.ConvertToInternalUnits(880, FlowUnit));
                }
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var loaded = family.LoadFamily(doc, new DefaultFamilyLoadOptions());
            FamilyInstance fan;
            using (var tx = new Transaction(doc, "One fan, complete type cohort")) {
                tx.Start();
                var symbol = loaded.GetFamilySymbolIds().Select(id => (FamilySymbol)doc.GetElement(id)).Single(s => s.Name == "Proof");
                symbol.Activate();
                var level = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().FirstOrDefault() ?? Level.Create(doc, 0);
                fan = doc.Create.NewFamilyInstance(XYZ.Zero, symbol, level, StructuralType.NonStructural);
                fan.get_Parameter(BuiltInParameter.ALL_MODEL_MARK).Set("NATIVE-FAN-1");
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            string State() => JsonConvert.SerializeObject(new {
                instanceStatic = fan.LookupParameter("InstanceStatic").AsDouble(), instanceFlow = fan.LookupParameter("InstanceFlow").AsDouble(),
                typeStatic = fan.Symbol.LookupParameter("TypeStatic").AsDouble(), typeFlow = fan.Symbol.LookupParameter("TypeFlow").AsDouble(),
                store = DuctApplier.ReadStore(doc).Store?.ToJson()
            });
            foreach (var scope in new[] { "instance", "type", "missing" }) {
                var prefix = scope == "type" ? "Type" : scope == "instance" ? "Instance" : "Missing";
                var request = new DuctApplyRequest(new DuctParameterSlotOverrides(FanStatic: prefix + "Static", FanFlow: prefix + "Flow"),
                    [], [], [], [new(fan.Id.Value(), 0.25)], [], [new(fan.Id.Value(), 1000, "native proof")], Store(doc));
                var result = Read(ui, doc, "fan-" + scope, request, State);
                foreach (var kind in new[] { "equipment", "equipment-flow" }) {
                    var row = result.Writes.Single(w => w.Kind == kind);
                    Identity(row, fan, prefix + (kind == "equipment" ? "Static" : "Flow"), scope == "missing" ? "instance" : scope);
                    if (scope == "missing") {
                        Assert.That(row.Outcome, Is.EqualTo("refused"));
                        Assert.That(row.Reason, Does.Contain("neither the instance nor its type"));
                    } else {
                        Assert.That(row.Outcome, Is.EqualTo("planned"), row.Reason);
                        Assert.That(row.Before, Is.EqualTo(kind == "equipment" ? "0.125 in-wg" : "880 cfm"));
                        Assert.That(row.After, Does.Contain(kind == "equipment" ? "0.25 in-wg" : "1000 cfm"));
                    }
                }
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(family);
            RevitFamilyFixtureHarness.CloseDocument(doc);
        }
    }

    private static DuctLossStore Store(Document doc) => DuctApplier.ReadStore(doc).Store ?? new() { Version = DuctLossStore.CurrentVersion };
    private static double? Reported(Element element) => element.get_Parameter(BuiltInParameter.RBS_DUCT_PRESSURE_DROP)
        is { HasValue: true, StorageType: StorageType.Double } p
        ? Math.Round(UnitUtils.ConvertFromInternalUnits(p.AsDouble(), PressureUnit), 6) + 0.0 : null;

    private static void Identity(DuctWrite row, Element element, string parameter, string scope) {
        Assert.Multiple(() => {
            Assert.That(row.Id, Is.EqualTo(element.Id.Value()));
            Assert.That(row.UniqueId, Is.EqualTo(element.UniqueId));
            Assert.That(row.ElementLabel, Is.Not.Null.And.Not.Empty);
            Assert.That(row.Parameter, Is.EqualTo(parameter));
            Assert.That(row.Scope, Is.EqualTo(scope));
        });
    }

    private static DuctApplyResult Read(UIApplication ui, Document doc, string name, DuctApplyRequest request, Func<string> state) {
        var method = typeof(RevitDataRequestService).GetMethod("PreviewDuctsCore", BindingFlags.Static | BindingFlags.NonPublic)!;
        DuctApplyResult? result = null;
        Exception? failure = null;
        string? before = null, after = null;
        var readOnly = false;
        var callbackCount = 0;
        string? triggerIdentity = null;
        void Changed(object? sender, DocumentChangedEventArgs args) {
            callbackCount++;
            // Revit may return another Document wrapper. The owned trigger's native identity selects this callback.
            if (triggerIdentity is null || args.GetDocument().GetElement(triggerIdentity) is null || result is not null || failure is not null) return;
            try {
                readOnly = args.GetDocument().IsReadOnly && !args.GetDocument().IsModifiable;
                before = state();
                var wrapper = Activator.CreateInstance(method.GetParameters()[1].ParameterType,
                    BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, [doc], null);
                result = (DuctApplyResult)method.Invoke(null, [request, wrapper])!;
                after = state();
            } catch (Exception ex) { failure = ex is TargetInvocationException { InnerException: { } inner } ? inner : ex; }
        }
        ui.Application.DocumentChanged += Changed;
        try {
            using var trigger = new Transaction(doc, "Read-only native Plan proof trigger");
            trigger.Start();
            triggerIdentity = DataStorage.Create(doc).UniqueId;
            Assert.That(trigger.Commit(), Is.EqualTo(TransactionStatus.Committed));
        } finally { ui.Application.DocumentChanged -= Changed; }
        var output = Environment.GetEnvironmentVariable("PE_DUCT_REVIEW_OUTPUT")
            ?? Path.Combine(Path.GetTempPath(), "pe-duct-review-proof");
        Directory.CreateDirectory(output);
        var settings = RevitDataJson.CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        settings.NullValueHandling = NullValueHandling.Include;
        File.WriteAllText(Path.Combine(output, name + ".json"), JsonConvert.SerializeObject(new {
            operation = "ducts.apply.plan", entryPoint = method.Name, callbackCount, readOnlyCallback = readOnly,
            stateBefore = before, stateAfter = after, response = result, error = failure?.ToString()
        }, Formatting.Indented, settings));
        Assert.That(failure, Is.Null, failure?.ToString());
        Assert.That(callbackCount, Is.GreaterThan(0), "native event delivered the proof trigger");
        Assert.That(readOnly, Is.True, "Revit's DocumentChanged callback forbids transactions: Plan must succeed here");
        Assert.That(result, Is.Not.Null);
        Assert.That(result!.PreviewOnly, Is.True);
        Assert.That(after, Is.EqualTo(before), "the native Read did not change element values or the loss store");
        return result;
    }
}
