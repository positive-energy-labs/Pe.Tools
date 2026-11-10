using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.DB.Structure;
using Pe.Revit.Extensions.FamDocument;
using Newtonsoft.Json;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Piping;

namespace Pe.Revit.Tests;

/// <summary>
///     Hydronic facts from a model the fixture builds itself: no installed test model has a piping system (the Snowdon
///     HVAC sample raises a modal warnings dialog on open and hangs a fresh run). A one-box equipment family with a Supply
///     (Out) and a Return (In) pipe connector feeds two pipes joined by an elbow fitting; nothing is saved.
/// </summary>
[TestFixture, NonParallelizable]
public sealed class PipingReadsTests {
    private Document _document = null!;
    private PipingSystem _system = null!;
    private FamilyInstance _equipment = null!;

    [OneTimeSetUp]
    public void BuildHydronicModel(UIApplication uiApplication) {
        var application = uiApplication.Application;
        _document = NewProject(application);
        using var family = NewEquipmentFamily(application);
        var loaded = family.LoadFamily(_document, new DefaultFamilyLoadOptions());
        using var transaction = new Transaction(_document, "hydronic fixture");
        transaction.Start();
        var symbol = (FamilySymbol)_document.GetElement(loaded.GetFamilySymbolIds().First());
        if (!symbol.IsActive) symbol.Activate();
        var level = new FilteredElementCollector(_document).OfClass(typeof(Level)).FirstElementId();
        var pipeType = new FilteredElementCollector(_document).OfClass(typeof(PipeType)).FirstElementId();
        _equipment = _document.Create.NewFamilyInstance(XYZ.Zero, symbol, (Level)_document.GetElement(level), StructuralType.NonStructural);
        _document.Regenerate();
        var supply = Ports(_equipment).Single(port => port.Direction == FlowDirectionType.Out);
        var first = Pipe.Create(_document, pipeType, level, supply, supply.Origin + supply.CoordinateSystem.BasisZ * 6);
        _document.Regenerate();
        var corner = FreeEnd(first);
        var second = Pipe.Create(_document, first.MEPSystem.GetTypeId(), pipeType, level, corner.Origin, corner.Origin + XYZ.BasisZ * 6);
        _document.Regenerate();
        _document.Create.NewElbowFitting(corner, Ports(second).OrderBy(port => port.Origin.DistanceTo(corner.Origin)).First());
        foreach (var pipe in new[] { first, second }) pipe.get_Parameter(BuiltInParameter.RBS_PIPE_DIAMETER_PARAM).Set(0.1);
        _document.Regenerate();
        _system = (PipingSystem)first.MEPSystem;
        // Revit does not pick base equipment on connection (see DuctFanAssigner): the connector leaves the members, then becomes the base.
        if (_system.BaseEquipment is null) {
            var members = new ConnectorSet();
            members.Insert(supply);
            if (supply.MEPSystem?.Id == _system.Id) _system.Remove(members);
            _system.BaseEquipmentConnector = supply;
            _document.Regenerate();
        }
        transaction.Commit();
    }

    [OneTimeTearDown]
    public void CloseModel() => RevitFamilyFixtureHarness.CloseDocument(_document);

    private static IEnumerable<Connector> Ports(Element element) => MepConnectors.Physical(element, Domain.DomainPiping);
    private static Connector FreeEnd(Pipe pipe) => Ports(pipe).Single(port => !port.IsConnected);

    private static Document NewProject(Autodesk.Revit.ApplicationServices.Application application) {
        var templates = Path.GetDirectoryName(application.DefaultProjectTemplate)!;
        var template = Directory.EnumerateFiles(templates, "Mechanical-Default*.rte", SearchOption.AllDirectories).FirstOrDefault()
            ?? throw new InconclusiveException($"No Mechanical project template under {templates}.");
        return application.NewProjectDocument(template);
    }

    private static Document NewEquipmentFamily(Autodesk.Revit.ApplicationServices.Application application) {
        var template = Directory.EnumerateFiles(application.FamilyTemplatePath, "*Mechanical Equipment.rft", SearchOption.AllDirectories).FirstOrDefault()
            ?? throw new InconclusiveException($"No mechanical equipment family template under {application.FamilyTemplatePath}.");
        var family = application.NewFamilyDocument(template);
        using var transaction = new Transaction(family, "equipment box");
        transaction.Start();
        var plane = SketchPlane.Create(family, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, XYZ.Zero));
        var corners = new[] { new XYZ(-1, -1, 0), new XYZ(1, -1, 0), new XYZ(1, 1, 0), new XYZ(-1, 1, 0) };
        var profile = new CurveArray();
        for (var i = 0; i < 4; i++) profile.Append(Line.CreateBound(corners[i], corners[(i + 1) % 4]));
        var loops = new CurveArrArray();
        loops.Append(profile);
        var box = family.FamilyCreate.NewExtrusion(true, loops, plane, 1);
        family.Regenerate();
        var faces = box.get_Geometry(new Options { ComputeReferences = true }).OfType<Solid>().SelectMany(solid => solid.Faces.Cast<Face>())
            .OfType<PlanarFace>().ToArray();
        Connect(family, faces.Single(face => face.FaceNormal.X > 0.9), PipeSystemType.SupplyHydronic, FlowDirectionType.Out);
        Connect(family, faces.Single(face => face.FaceNormal.X < -0.9), PipeSystemType.ReturnHydronic, FlowDirectionType.In);
        transaction.Commit();
        return family;
    }

    private static void Connect(Document family, PlanarFace face, PipeSystemType type, FlowDirectionType direction) {
        var connector = ConnectorElement.CreatePipeConnector(family, type, face.Reference);
        connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER).Set(0.1);
        connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM).Set((int)direction);
    }

    [Test]
    public void Systems_read_reports_hydronic_members_directions_source_and_bounds() {
        var roster = PipingReads.Systems(_document, new());
        var native = _system;
        Assert.That(native.BaseEquipment?.Id, Is.EqualTo(_equipment.Id), "fixture: the equipment is the system's base equipment");
        var result = PipingReads.Systems(_document, new(native.UniqueId));
        TestContext.WriteLine(JsonConvert.SerializeObject(result));
        var system = result.Systems.Single(row => row.UniqueId == native.UniqueId);
        var pipes = result.Elements.Where(row => row.Kind == "pipe").ToArray();
        Assert.Multiple(() => {
            Assert.That(roster.Elements, Is.Empty, "roster must not eagerly walk networks");
            Assert.That(roster.Systems.Select(row => row.UniqueId), Does.Contain(native.UniqueId));
            Assert.That(system.Source.State, Is.EqualTo(PipingReadState.Value));
            Assert.That(system.Source.Value!.Equipment.UniqueId, Is.EqualTo(native.BaseEquipment.UniqueId));
            Assert.That(pipes, Has.Count.EqualTo(2));
            Assert.That(result.Elements.Count(row => row.Kind == "fitting"), Is.EqualTo(1));
            Assert.That(system.Source.Value!.OutConnectorIds, Has.Count.EqualTo(1));
            Assert.That(pipes.SelectMany(pipe => pipe.Connectors).SelectMany(port => port.Peers)
                .Any(peer => peer.UniqueId == _equipment.UniqueId), Is.True, "a pipe end names the equipment as its peer");
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
