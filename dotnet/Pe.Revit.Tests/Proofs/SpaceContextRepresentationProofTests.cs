using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

/// <summary>Native representations preserve element frames, curved paths, insulation and mesh-only context.</summary>
public sealed class SpaceContextRepresentationProofTests {
    [Test]
    public void DefaultUsesNativeMeshesForDirectShapesWithoutAnElementFrame(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape focus;
            var expectedIds = new List<long>();
            using (var transaction = new Transaction(document, "Create context boxes")) {
                transaction.Start();
                // Default templates can contain eligible model elements; isolate this exact-membership scope.
                focus = Cube(document, 10000);
                expectedIds.Add(focus.Id.Value());
                for (var i = 1; i <= 40; i++) expectedIds.Add(Cube(document, 10000 + i * 2).Id.Value());
                transaction.Commit();
            }
            using var bytes = new MemoryStream();
            var scene = Scene.Write(document, new SceneRequest([focus.Id.Value()], 100, MaxTriangles: 1000), bytes);
            Assert.That(scene.Format, Is.EqualTo("space-scene-v4"));
            Assert.That(scene.Elements.Select(row => row.Handle.ElementId), Is.EquivalentTo(expectedIds),
                "A triangle budget must not become a box candidate cap. Actual: " + string.Join(", ",
                    scene.Elements.Select(row => $"{row.Handle.ElementId}:{row.Handle.Category}")));
            Assert.That(scene.Elements.All(row => row.Representation == SceneRepresentation.Mesh
                && row.VertexCount == 36 && row.Run is null && row.OrientedBox is null), Is.True);
            Assert.That(scene.Work.ContextGeometryCalls, Is.EqualTo(40));
            Assert.That(scene.Work.ExtractedElements, Is.EqualTo(41));
            Assert.That(scene.Triangles, Is.EqualTo(41 * 12));
            Assert.That(scene.Completeness.Complete, Is.True);
            using var noneBytes = new MemoryStream();
            var none = Scene.Write(document, new SceneRequest([focus.Id.Value()], ContextRepresentation: SceneContextRepresentation.None), noneBytes);
            Assert.That(none.Work.BroadCandidates, Is.Zero);
            Assert.That(none.Elements, Has.Count.EqualTo(1));
            Assert.That(none.Work.ContextGeometryCalls, Is.Zero);
        } finally { document.Close(false); }
    }

    [Test]
    public void StraightRoundAndRolledRectangularRunsKeepNativeSizesAndHostFrame(UIApplication uiApplication) {
        var document = MechanicalDocument(uiApplication);
        try {
            Duct round, rectangular;
            SceneRun before;
            using (var transaction = new Transaction(document, "Create sized rolled runs")) {
                transaction.Start();
                round = DuctOfShape(document, ConnectorProfileType.Round, new XYZ(0, 0, 10));
                round.get_Parameter(BuiltInParameter.RBS_CURVE_DIAMETER_PARAM).Set(1.25);
                rectangular = DuctOfShape(document, ConnectorProfileType.Rectangular, new XYZ(0, 5, 10));
                rectangular.get_Parameter(BuiltInParameter.RBS_CURVE_WIDTH_PARAM).Set(2);
                rectangular.get_Parameter(BuiltInParameter.RBS_CURVE_HEIGHT_PARAM).Set(1);
                document.Regenerate();
                before = Scene.ReadRun(rectangular, Transform.Identity)!;
                Assert.That(before, Is.Not.Null);
                ElementTransformUtils.RotateElement(document, rectangular.Id, Line.CreateBound(new XYZ(0, 5, 10), new XYZ(10, 5, 10)), 0.37);
                transaction.Commit();
            }
            using var bytes = new MemoryStream();
            var scene = Scene.Write(document, new SceneRequest([round.Id.Value(), rectangular.Id.Value()], FocusOnly: true), bytes);
            Assert.That(scene.Elements.All(row => row.Focus && row.Representation == SceneRepresentation.Run && row.VertexCount == 0), Is.True);
            Assert.That(scene.Triangles, Is.Zero);
            Assert.That(scene.Work.NativeGeometryCalls, Is.Zero);
            Assert.That(bytes.Length, Is.Zero);
            var circle = scene.Elements.Single(row => row.Handle.ElementId == round.Id.Value()).Run!;
            Assert.That(circle.Shape, Is.EqualTo(SceneRunShape.Round));
            Assert.That(circle.DiameterFt, Is.EqualTo(1.25).Within(1e-8));
            Assert.That(circle.WidthFt, Is.Null);
            var rectangle = scene.Elements.Single(row => row.Handle.ElementId == rectangular.Id.Value()).Run!;
            Assert.That(rectangle.WidthFt, Is.EqualTo(2).Within(1e-8));
            Assert.That(rectangle.HeightFt, Is.EqualTo(1).Within(1e-8));
            using var roll = Transform.CreateRotation(XYZ.BasisX, 0.37);
            AssertPoint(rectangle.CrossSectionXAxis, roll.OfVector(Point(before.CrossSectionXAxis)));
            AssertRunBoundsMatchNative(rectangular, rectangle);

            // The same transform used for linked sources must affect points and width axes exactly once.
            using var plane = Plane.CreateByNormalAndOrigin(XYZ.BasisY, XYZ.Zero);
            using var reflection = Transform.CreateReflection(plane);
            using var rotation = Transform.CreateRotation(XYZ.BasisZ, 0.61);
            using var translation = Transform.CreateTranslation(new XYZ(31, -17, 4));
            using var oriented = rotation.Multiply(reflection);
            using var toHost = translation.Multiply(oriented);
            var transformed = Scene.ReadRun(rectangular, toHost)!;
            AssertPoint(transformed.Start, toHost.OfPoint(Point(rectangle.Start)));
            AssertPoint(transformed.End, toHost.OfPoint(Point(rectangle.End)));
            AssertPoint(transformed.CrossSectionXAxis, toHost.OfVector(Point(rectangle.CrossSectionXAxis)).Normalize());
            Assert.That(transformed.WidthFt, Is.EqualTo(rectangle.WidthFt));
            Assert.That(transformed.HeightFt, Is.EqualTo(rectangle.HeightFt));
        } finally { document.Close(false); }
    }

    [Test]
    public void InsulatedHostAndCurvedFlexUseNativeDimensionsAndLocationPath(UIApplication uiApplication) {
        var document = MechanicalDocument(uiApplication);
        try {
            DuctInsulation insulation;
            FlexDuct flex;
            Duct duct;
            using (var transaction = new Transaction(document, "Create unsupported parametric focus")) {
                transaction.Start();
                duct = DuctOfShape(document, ConnectorProfileType.Round, new XYZ(0, 0, 10));
                var insulationType = new FilteredElementCollector(document).OfClass(typeof(DuctInsulationType)).FirstElementId();
                var flexTypes = new FilteredElementCollector(document).OfClass(typeof(FlexDuctType)).Cast<FlexDuctType>().ToList();
                var flexType = flexTypes.FirstOrDefault(type => type.Shape == ConnectorProfileType.Round);
                Assert.That(insulationType, Is.Not.EqualTo(ElementId.InvalidElementId), "Mechanical template needs insulation.");
                Assert.That(flexType, Is.Not.Null, "Mechanical template needs a round flex duct type. Types: "
                    + string.Join("; ", flexTypes.Select(type => $"{type.Id.Value()}:{type.Name}, shape={type.Shape}, {SizeParameters(type)}")));
                insulation = DuctInsulation.Create(document, duct.Id, insulationType, 0.1);
                var system = new FilteredElementCollector(document).OfClass(typeof(MechanicalSystemType)).FirstElementId();
                var level = new FilteredElementCollector(document).OfClass(typeof(Level)).FirstElementId();
                flex = FlexDuct.Create(document, system, flexType!.Id, level, XYZ.BasisX, XYZ.BasisX,
                    new List<XYZ> { new(0, 5, 10), new(3, 5, 10), new(7, 7, 10), new(10, 7, 10) });
                document.Regenerate();
                Assert.That(flex.FlexDuctType.Shape, Is.EqualTo(ConnectorProfileType.Round));
                var diameter = flex.get_Parameter(BuiltInParameter.RBS_CURVE_DIAMETER_PARAM);
                Assert.That(diameter, Is.Not.Null, $"Flex type {flexType.Id.Value()}:{flexType.Name}, shape={flexType.Shape}; "
                    + "instance " + SizeParameters(flex));
                Assert.That(diameter.IsReadOnly, Is.False, "The round flex diameter must be writable.");
                Assert.That(diameter.StorageType, Is.EqualTo(StorageType.Double));
                diameter.Set(1.0);
                Assert.That(diameter.AsDouble(), Is.EqualTo(1.0).Within(1e-8));
                document.Regenerate();
                transaction.Commit();
            }
            Assert.That(NativeTriangleCount(flex), Is.GreaterThan(0),
                "Fixture precondition: the explicitly sized curved flex must expose a native body before Scene capture.");
            Assert.That(insulation, Is.InstanceOf<MEPCurve>(), "This subtype caused the broad-MEPCurve experiment to lose focus.");
            Assert.That(Scene.ReadRun(insulation, Transform.Identity), Is.Null);
            var flexRun = Scene.ReadRun(flex, Transform.Identity)!;
            Assert.That(flexRun, Is.Not.Null);
            Assert.That(flexRun.Path, Is.Not.Null);
            Assert.That(flexRun.DiameterFt, Is.EqualTo(1).Within(1e-8));
            var curve = ((LocationCurve)flex.Location).Curve;
            var nativePath = curve.Tessellate();
            Assert.That(flexRun.Path!.Count, Is.EqualTo(nativePath.Count));
            for (var i = 0; i < nativePath.Count; i++) AssertPoint(flexRun.Path[i], nativePath[i]);
            var hostRun = Scene.ReadRun(duct, Transform.Identity)!;
            using var manager = duct.ConnectorManager;
            var connector = manager.Connectors.Cast<Connector>().First();
            Assert.That(hostRun.DiameterFt, Is.EqualTo(2 * connector.Radius + 2 * insulation.Thickness).Within(1e-8));
            using var bytes = new MemoryStream();
            var scene = Scene.Write(document, new SceneRequest([insulation.Id.Value(), flex.Id.Value()], FocusOnly: true), bytes);
            Assert.That(scene.UnavailableElements, Is.Empty);
            Assert.That(scene.Elements.Select(row => row.Handle.ElementId), Is.EquivalentTo(new[] { insulation.Id.Value(), flex.Id.Value() }));
            Assert.That(scene.Elements.All(row => row.Focus), Is.True);
            Assert.That(scene.Elements.Single(row => row.Handle.ElementId == flex.Id.Value()).Representation, Is.EqualTo(SceneRepresentation.Run));
            Assert.That(scene.Elements.Single(row => row.Handle.ElementId == insulation.Id.Value()).Representation, Is.EqualTo(SceneRepresentation.Mesh));
            Assert.That(scene.Work.NativeGeometryCalls, Is.GreaterThan(0));
        } finally { document.Close(false); }
    }

    private static Document MechanicalDocument(UIApplication uiApplication) {
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            $"Autodesk/RVT {uiApplication.Application.VersionNumber}/Templates/English-Imperial/Mechanical-Default.rte");
        Assert.That(File.Exists(path), Is.True, path);
        RevitTestFailureGuard.EnsureInstalled(uiApplication.Application);
        return uiApplication.Application.NewProjectDocument(path);
    }

    private static Duct DuctOfShape(Document document, ConnectorProfileType shape, XYZ start) {
        var type = new FilteredElementCollector(document).OfClass(typeof(DuctType)).Cast<DuctType>().First(row => row.Shape == shape).Id;
        var system = new FilteredElementCollector(document).OfClass(typeof(MechanicalSystemType)).FirstElementId();
        var level = new FilteredElementCollector(document).OfClass(typeof(Level)).FirstElementId();
        return Duct.Create(document, system, type, level, start, start + new XYZ(10, 0, 0));
    }

    private static void AssertRunBoundsMatchNative(Element element, SceneRun run) {
        var triangles = new List<Tri>();
        var rows = new List<PrimRow>();
        Ingest.Element(element, 0, 0, triangles, Transform.Identity, rows, false);
        Assert.That(rows, Has.Count.EqualTo(1));
        var x = Point(run.CrossSectionXAxis);
        var z = (Point(run.End) - Point(run.Start)).Normalize();
        var y = z.CrossProduct(x).Normalize();
        var corners = new List<XYZ>();
        foreach (var end in new[] { Point(run.Start), Point(run.End) })
        foreach (var sx in new[] { -1, 1 })
        foreach (var sy in new[] { -1, 1 })
            corners.Add(end + x * (sx * run.WidthFt!.Value / 2) + y * (sy * run.HeightFt!.Value / 2));
        var bounds = rows.Single().Box;
        Assert.That(new[] { corners.Min(p => p.X), corners.Min(p => p.Y), corners.Min(p => p.Z),
                corners.Max(p => p.X), corners.Max(p => p.Y), corners.Max(p => p.Z) },
            Is.EqualTo(new[] { bounds.MinX, bounds.MinY, bounds.MinZ, bounds.MaxX, bounds.MaxY, bounds.MaxZ }).Within(1e-4));
    }

    private static XYZ Point(IReadOnlyList<double> values) => new(values[0], values[1], values[2]);
    private static void AssertPoint(IReadOnlyList<double> actual, XYZ expected) =>
        Assert.That(actual, Is.EqualTo(new[] { expected.X, expected.Y, expected.Z }).Within(1e-8));

    private static int NativeTriangleCount(Element element) {
        using var options = new Options { DetailLevel = ViewDetailLevel.Fine, ComputeReferences = false };
        using var geometry = element.get_Geometry(options);
        int Count(GeometryElement? body) {
            if (body is null) return 0;
            var count = 0;
            foreach (var item in body) {
                using (item) switch (item) {
                    case Mesh mesh: count += mesh.NumTriangles; break;
                    case Solid solid:
                        foreach (Face face in solid.Faces) {
                            using (face)
                            using (var tessellation = face.Triangulate()) count += tessellation.NumTriangles;
                        }
                        break;
                    case GeometryInstance instance:
                        using (var symbol = instance.GetSymbolGeometry()) count += Count(symbol);
                        break;
                }
            }
            return count;
        }
        return Count(geometry);
    }

    private static string SizeParameters(Element element) => "size parameters=[" + string.Join(", ",
        element.Parameters.Cast<Parameter>()
            .Where(parameter => new[] { "diameter", "width", "height", "size" }
                .Any(word => parameter.Definition.Name.IndexOf(word, StringComparison.OrdinalIgnoreCase) >= 0))
            .Select(parameter => $"{parameter.Id.Value()}:{parameter.Definition.Name}, storage={parameter.StorageType}, readOnly={parameter.IsReadOnly}")) + "]";

    private static DirectShape Cube(Document document, double x) {
        var points = new[] { new XYZ(x, 0, 0), new XYZ(x + 1, 0, 0), new XYZ(x + 1, 1, 0), new XYZ(x, 1, 0) };
        using var loop = new CurveLoop();
        for (var i = 0; i < 4; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % 4]));
        var shape = DirectShape.CreateElement(document, new ElementId(BuiltInCategory.OST_GenericModel));
        using var solid = GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, 1);
        shape.SetShape([solid]);
        return shape;
    }
}
