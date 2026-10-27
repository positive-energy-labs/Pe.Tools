using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests;

/// <summary>
///     `ducts.ports` on one real duct: both end ports with finite frames, and Connector.Flow withheld (absent, never read)
///     under network-based calculations, where its getter can kill Revit. Rolled back; nothing is committed.
/// </summary>
[TestFixture]
public sealed class DuctPortsTests {
    [Test]
    public void Reads_both_end_ports_and_withholds_connector_flow_under_network_calculations(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var ductType = new FilteredElementCollector(document).OfClass(typeof(DuctType)).FirstElementId();
            var systemType = new FilteredElementCollector(document).OfClass(typeof(MechanicalSystemType)).FirstElementId();
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).FirstElementId();
            if (ductType == ElementId.InvalidElementId || systemType == ElementId.InvalidElementId)
                Assert.Inconclusive("The default project template has no duct type or mechanical system type.");

            using var transaction = new Transaction(document, "ducts.ports proof");
            _ = transaction.Start();
            var duct = Duct.Create(document, systemType, ductType, level, XYZ.Zero, new XYZ(10, 0, 0));
            document.Regenerate();

            DuctSettings.GetDuctSettings(document).NetworkBasedCalculations = false;
            var legacy = DuctPorts.Read(document, [duct.Id.Value()]);
            DuctSettings.GetDuctSettings(document).NetworkBasedCalculations = true;
            document.Regenerate();
            var network = DuctPorts.Read(document, [duct.Id.Value(), duct.Id.Value()]);
            _ = transaction.RollBack();

            var ports = legacy.Elements.Single().Ports;
            Assert.Multiple(() => {
                Assert.That(ports.Select(port => port.Kind), Is.EqualTo(new[] { "end", "end" }));
                Assert.That(ports.Select(port => port.ConnectorId).Distinct().Count(), Is.EqualTo(2));
                Assert.That(ports.All(port => port.OriginFt.Concat(port.BasisZ).All(double.IsFinite)), Is.True);
                Assert.That(ports.All(port => port.PhysicalPeers.Count == 0 && !port.IsConnected), Is.True);
                Assert.That(legacy.NetworkBasedCalculations, Is.False);
                Assert.That(ports.All(port => port.RevitFlow.State != DuctReadState.Absent), Is.True);
                Assert.That(network.NetworkBasedCalculations, Is.True);
                Assert.That(network.Elements, Has.Count.EqualTo(1), "duplicate ids are read once");
                Assert.That(network.Elements.Single().Ports.All(port => port.RevitFlow.State == DuctReadState.Absent), Is.True);
            });
            Assert.Throws<ArgumentException>(() => DuctPorts.Read(document, [level.Value()]));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
