using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.FamilyFoundry;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ElectricalConnectorAssociationTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    [Test]
    public void Existing_electrical_connectors_are_all_associated_and_exact_reapply_is_noop() {
        var document = this.NewFamily("Electrical connector associations");
        try {
            IReadOnlyList<ConnectorElement> connectors;
            using (var transaction = new Transaction(document, "Seed connectors")) {
                transaction.Start();
                connectors = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                    .OrderBy(plane => plane.Id.Value()).Take(2)
                    .Select(plane => ConnectorElement.CreateElectricalConnector(document, ElectricalSystemType.PowerBalanced, plane.GetReference())).ToList();
                document.Regenerate();
                var wrong = document.FamilyManager.AddParameter("Wrong Voltage", GroupTypeId.Electrical, SpecTypeId.ElectricalPotential, false);
                document.FamilyManager.AssociateElementParameterToFamilyParameter(
                    connectors[0].get_Parameter(BuiltInParameter.RBS_ELEC_VOLTAGE), wrong);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            var changed = Apply(document, Mappings);
            Assert.That(changed.Select(id => id.Value()), Is.EquivalentTo(connectors.Select(connector => connector.Id.Value())));
            AssertAssociations(document, connectors);
            Assert.That(Apply(document, Mappings), Is.Empty);
            AssertAssociations(document, connectors);
        } finally { document.Close(false); }
    }

    [Test]
    public void Missing_electrical_connector_is_created_on_a_supported_native_host_once() {
        var document = this.NewFamily("Electrical connector creation");
        try {
            var changed = Apply(document, Mappings);
            var connectors = ElectricalConnectors(document);
            Assert.That(connectors, Has.Count.EqualTo(1));
            Assert.That(changed.Select(id => id.Value()), Is.EqualTo(new[] { connectors[0].Id.Value() }));
            Assert.That(connectors[0].SystemClassification.ToString(), Is.EqualTo("PowerBalanced"));
            AssertAssociations(document, connectors);
            Assert.That(Apply(document, Mappings), Is.Empty);
            Assert.That(ElectricalConnectors(document), Has.Count.EqualTo(1));
        } finally { document.Close(false); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Missing_or_incompatible_requested_association_rolls_the_family_visit_back(bool missing) {
        var document = this.NewFamily("Electrical connector rollback");
        try {
            _ = Apply(document, Mappings);
            var connector = ElectricalConnectors(document).Single();
            var ordered = Mappings.Keys.OrderBy(key => (int)key).ToList();
            using (var transaction = new Transaction(document, "Seed rollback association")) {
                transaction.Start();
                var manager = document.FamilyManager;
                var target = connector.get_Parameter(ordered[0]);
                var source = manager.get_Parameter(Mappings[ordered[0]]);
                var wrong = manager.AddParameter("Wrong rollback source", GroupTypeId.Electrical, source.Definition.GetDataType(), false);
                manager.AssociateElementParameterToFamilyParameter(target, null);
                manager.AssociateElementParameterToFamilyParameter(target, wrong);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var before = AssociationIds(document, connector);
            var invalid = new Dictionary<BuiltInParameter, string>(Mappings);
            invalid[missing ? ordered[0] : ordered[^1]] = missing ? "Missing" : Mappings[ordered[0]];
            Assert.Throws<InvalidOperationException>(() => Apply(document, invalid));
            Assert.That(ElectricalConnectors(document).Select(item => item.Id.Value()), Is.EqualTo(new[] { connector.Id.Value() }));
            Assert.That(AssociationIds(document, connector), Is.EqualTo(before));
        } finally { document.Close(false); }
    }

    [Test]
    public void Electrical_connector_run_rule_failure_rolls_the_whole_reconciliation_back() {
        var document = this.NewFamily("Electrical connector run rollback");
        try {
            var before = FamilyModelJson.Serialize(document.CaptureFamilyModel());
            var patch = new FamilyPatch { Patch = new Newtonsoft.Json.Linq.JObject(), Run = new PatchRun {
                ElectricalConnectorParameters = new ElectricalConnectorParameterRule {
                    Voltage = "Voltage", NumberOfPoles = "Number of Poles", ApparentPower = "Voltage", MinimumCircuitAmpacity = "MCA"
                }
            } };
            var operation = new ReconcileFamily(patch);
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Not.Null);
            Assert.That(FamilyModelJson.Serialize(document.CaptureFamilyModel()), Is.EqualTo(before));
            Assert.That(ElectricalConnectors(document), Is.Empty);
        } finally { document.Close(false); }
    }

    private static readonly IReadOnlyDictionary<BuiltInParameter, string> Mappings = new Dictionary<BuiltInParameter, string> {
        [BuiltInParameter.RBS_ELEC_VOLTAGE] = "Voltage",
        [BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES] = "Number of Poles",
        [BuiltInParameter.RBS_ELEC_APPARENT_LOAD] = "Apparent Power"
    };

    private Document NewFamily(string name) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_MechanicalEquipment, name);
        using var transaction = new Transaction(document, "Seed electrical parameters");
        transaction.Start();
        var manager = document.FamilyManager;
        manager.AddParameter("Voltage", GroupTypeId.Electrical, SpecTypeId.ElectricalPotential, false);
        manager.AddParameter("Number of Poles", GroupTypeId.Electrical, SpecTypeId.Int.NumberOfPoles, false);
        manager.AddParameter("Apparent Power", GroupTypeId.Electrical, SpecTypeId.ApparentPower, false);
        manager.AddParameter("MCA", GroupTypeId.Electrical, SpecTypeId.Current, false);
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return document;
    }

    private static IReadOnlyList<ElementId> Apply(Document document, IReadOnlyDictionary<BuiltInParameter, string> mappings) {
        IReadOnlyList<ElementId> changed = [];
        _ = FamilyVisit.InPlace(new FamilyDocument(document), scope => scope.Edit("Ensure electrical connector associations",
            family => changed = family.EnsureElectricalConnectorAssociations(mappings)));
        return changed;
    }

    private static List<ConnectorElement> ElectricalConnectors(Document document) => new FilteredElementCollector(document)
        .OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>()
        .Where(connector => connector.Domain == Domain.DomainElectrical)
        .OrderBy(connector => connector.Id.Value()).ToList();

    private static void AssertAssociations(Document document, IEnumerable<ConnectorElement> connectors) {
        foreach (var connector in connectors)
            foreach (var mapping in Mappings) {
                var target = connector.get_Parameter(mapping.Key);
                Assert.That(document.FamilyManager.GetAssociatedFamilyParameter(target)?.Id,
                    Is.EqualTo(document.FamilyManager.get_Parameter(mapping.Value).Id), $"{connector.Id.Value()}: {mapping.Key}");
            }
    }

    private static IReadOnlyList<long> AssociationIds(Document document, ConnectorElement connector) => Mappings.Keys
        .Select(key => document.FamilyManager.GetAssociatedFamilyParameter(connector.get_Parameter(key))?.Id.Value() ?? -1).ToList();
}
