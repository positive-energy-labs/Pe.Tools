using Autodesk.Revit.DB.Plumbing;
using Newtonsoft.Json;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Piping;

namespace Pe.Revit.Tests;

/// <summary>Real hydronic facts from a disposable copy of the SDK acceptance model, never the owner's document.</summary>
[TestFixture, NonParallelizable]
public sealed class PipingReadsTests {
    private Document _document = null!;
    private string _directory = null!;

    [OneTimeSetUp]
    public void OpenCopy(UIApplication uiApplication) {
        _directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(PipingReadsTests));
        var sample = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Autodesk",
            $"Revit {uiApplication.Application.VersionNumber}", "Samples", "Snowdon Towers Sample HVAC.rvt");
        var copy = Path.Combine(_directory, "hydronic.rvt");
        File.Copy(sample, copy);
        _document = uiApplication.Application.OpenDocumentFile(copy);
    }

    [OneTimeTearDown]
    public void CloseCopy() {
        if (_document is not null) RevitFamilyFixtureHarness.CloseDocument(_document);
        if (_directory is not null) Directory.Delete(_directory, true);
    }

    [Test]
    public void Systems_read_reports_hydronic_members_directions_source_and_bounds() {
        var roster = PipingReads.Systems(_document, new());
        var native = new FilteredElementCollector(_document).OfClass(typeof(PipingSystem)).Cast<PipingSystem>()
            .Where(system => system.SystemType is PipeSystemType.SupplyHydronic or PipeSystemType.ReturnHydronic)
            .First(system => system.BaseEquipment is not null && system.PipingNetwork.Cast<Element>().Any(element => element is Pipe));
        var result = PipingReads.Systems(_document, new(native.UniqueId));
        TestContext.WriteLine(JsonConvert.SerializeObject(result));
        var system = result.Systems.Single(row => row.UniqueId == native.UniqueId);
        var pipes = result.Elements.Where(row => row.Kind == "pipe").ToArray();
        Assert.Multiple(() => {
            Assert.That(roster.Elements, Is.Empty, "roster must not eagerly walk networks");
            Assert.That(roster.Systems.Select(row => row.UniqueId), Does.Contain(native.UniqueId));
            Assert.That(system.Source.State, Is.EqualTo(PipingReadState.Value));
            Assert.That(system.Source.Value!.Equipment.UniqueId, Is.EqualTo(native.BaseEquipment.UniqueId));
            Assert.That(pipes, Is.Not.Empty);
            Assert.That(pipes.SelectMany(pipe => pipe.Connectors).Any(port => port.Direction.State == PipingReadState.Value &&
                port.Direction.Value is "In" or "Out" or "Bidirectional"), Is.True);
            Assert.That(pipes.SelectMany(pipe => pipe.Connectors).SelectMany(port => port.Peers), Is.Not.Empty);
        });
        foreach (var pipe in pipes) {
            var actual = (Pipe)_document.GetElement(pipe.UniqueId);
            Assert.That(pipe.NominalDiameterFt.Value, Is.EqualTo(actual.Diameter));
            Assert.That(pipe.LengthFt.Value, Is.EqualTo(actual.get_Parameter(BuiltInParameter.CURVE_ELEM_LENGTH).AsDouble()));
            Assert.That(pipe.PipeType.Value!.UniqueId, Is.EqualTo(_document.GetElement(actual.GetTypeId()).UniqueId));
            foreach (Connector connector in actual.ConnectorManager.Connectors) {
                var port = pipe.Connectors.Single(row => row.ConnectorId == connector.Id);
                Assert.That(port.Direction.Value, Is.EqualTo(connector.Direction.ToString()));
                var peers = connector.AllRefs.Cast<Connector>().Where(peer => peer.Domain == Domain.DomainPiping &&
                    peer.ConnectorType is ConnectorType.End or ConnectorType.Curve && peer.Owner.Id != connector.Owner.Id)
                    .Select(peer => new PipingPeer(peer.Owner.UniqueId, peer.Owner.Id.Value(), peer.Id)).Distinct();
                Assert.That(port.Peers, Is.EquivalentTo(peers));
            }
        }
        var outIds = native.BaseEquipment.MEPModel.ConnectorManager.Connectors.Cast<Connector>()
            .Where(port => port.Domain == Domain.DomainPiping && port.ConnectorType is ConnectorType.End or ConnectorType.Curve &&
                port.MEPSystem?.Id == native.Id && port.Direction == FlowDirectionType.Out).Select(port => port.Id);
        Assert.That(system.Source.Value!.OutConnectorIds, Is.EquivalentTo(outIds));
        Assert.Throws<ArgumentException>(() => PipingReads.Systems(_document, new(native.UniqueId, MaxElements: 1)));
        Assert.Throws<ArgumentException>(() => PipingReads.Systems(_document, new("missing")));
        Assert.Throws<ArgumentOutOfRangeException>(() => PipingReads.Systems(_document, new(MaxSystems: 0)));
    }

    [Test]
    public void Size_catalog_preserves_every_native_segment_and_all_three_diameters() {
        var result = PipingReads.Sizes(_document, new());
        var native = new FilteredElementCollector(_document).OfClass(typeof(PipeSegment)).Cast<PipeSegment>().ToArray();
        TestContext.WriteLine(JsonConvert.SerializeObject(result));
        Assert.That(result.Segments.Select(row => row.UniqueId), Is.EquivalentTo(native.Select(segment => segment.UniqueId)));
        Assert.That(result.Segments.SelectMany(row => row.Sizes), Is.Not.Empty);
        foreach (var segment in native) {
            var row = result.Segments.Single(candidate => candidate.UniqueId == segment.UniqueId);
            Assert.That(row.Sizes, Is.EqualTo(segment.GetSizes().Select(size =>
                new PipeSizeRow(size.NominalDiameter, size.InnerDiameter, size.OuterDiameter))));
        }
        Assert.Throws<ArgumentException>(() => PipingReads.Sizes(_document, new(MaxSizesPerSegment: 1)));
        Assert.Throws<ArgumentOutOfRangeException>(() => PipingReads.Sizes(_document, new(MaxSegments: 0)));
    }
}
