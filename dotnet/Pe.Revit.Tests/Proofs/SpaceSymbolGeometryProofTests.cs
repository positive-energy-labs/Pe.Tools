using Pe.Revit.Space;
using System.Globalization;
using Vector3 = System.Numerics.Vector3;

namespace Pe.Revit.Tests;

/// <summary>Real mapped symbol geometry must retain nested transforms and winding without instance copies.</summary>
public sealed class SpaceSymbolGeometryProofTests {
    [Test]
    public void NestedSymbolsMatchCopiedGeometryInRotatedReflectedHostFrame(UIApplication uiApplication) {
        Assert.Multiple(() => {
            foreach (var (instanceReflections, reflectedHost) in new[] { (0, false), (1, false), (0, true), (1, true), (2, false), (2, true) })
                AssertNestedSymbols(uiApplication, instanceReflections, reflectedHost);
        });
    }

    private static void AssertNestedSymbols(UIApplication uiApplication, int instanceReflections, bool reflectedHost) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape subject;
            using (var transaction = new Transaction(document, "Create nested mapped geometry")) {
                transaction.Start();
                var category = new ElementId(BuiltInCategory.OST_GenericModel);
                using var library = DirectShapeLibrary.GetDirectShapeLibrary(document);
                var definition = "symbol-proof-" + Guid.NewGuid().ToString("N");
                var type = DirectShapeType.Create(document, definition, category);
                using var body = Block(2, 3, 5);
                type.SetShape([body]);
                library.AddDefinitionType(definition, type.Id);
                using var localPlane = Plane.CreateByNormalAndOrigin(XYZ.BasisX, XYZ.Zero);
                using var localReflection = Transform.CreateReflection(localPlane);
                // More than the former four-level walk limit; copied geometry used a different expansion path.
                for (var depth = 0; depth < 6; depth++) {
                    using var rotation = Transform.CreateRotation(XYZ.BasisZ, 0.17 + depth * 0.03);
                    using var translation = Transform.CreateTranslation(new XYZ(1 + depth, -2, 0.25));
                    using var oriented = translation.Multiply(rotation);
                    using var local = (instanceReflections > 0 && depth == 2) || (instanceReflections > 1 && depth == 4)
                        ? oriented.Multiply(localReflection)
                        : oriented.Multiply(Transform.Identity);
                    var parentName = definition + "-" + depth;
                    var parent = DirectShapeType.Create(document, parentName, category);
                    parent.SetShape(DirectShape.CreateGeometryInstance(document, definition, local));
                    library.AddDefinitionType(parentName, parent.Id);
                    type = parent;
                    definition = parentName;
                }
                using var placement = Transform.CreateTranslation(new XYZ(13, 7, 2));
                subject = DirectShape.CreateElementInstance(document, type.Id, category, definition, placement);
                transaction.Commit();
            }
            using var options = new Options { DetailLevel = ViewDetailLevel.Medium, ComputeReferences = false };
            using (var geometry = subject.get_Geometry(options))
                Assert.That(geometry!.OfType<GeometryInstance>().Any(), Is.True, "Fixture must exercise actual mapped GeometryInstance.");

            using var rotationToHost = Transform.CreateRotation(XYZ.BasisZ, 0.43);
            using var translationToHost = Transform.CreateTranslation(new XYZ(-31, 17, 4));
            using var hostFrame = translationToHost.Multiply(rotationToHost);
            using var plane = Plane.CreateByNormalAndOrigin(XYZ.BasisX, XYZ.Zero);
            using var reflection = Transform.CreateReflection(plane);
            using var toHost = reflectedHost ? hostFrame.Multiply(reflection) : hostFrame.Multiply(Transform.Identity);
            var copied = Copied(subject, options, toHost);
            var actual = new List<Tri>();
            var rows = new List<PrimRow>();
            Ingest.Element(subject, 0, 0, actual, toHost, rows, false);

            Assert.That(copied.Count, Is.GreaterThan(0), "The reference must contain real triangles.");
            Assert.That(actual.Count, Is.EqualTo(copied.Count), "Nested symbol geometry must not be truncated.");
            if (copied.Count == 0 || actual.Count != copied.Count) return;
            AssertMatchingTriangles(actual, copied, $"instance reflections={instanceReflections}, host reflection={reflectedHost}");
        } finally { document.Close(false); }
    }

    [Test]
    public void DirectSolidCaptureKeepsCurrentEditedBody(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape subject;
            using (var transaction = new Transaction(document, "Create direct body")) {
                transaction.Start();
                subject = DirectShape.CreateElement(document, new ElementId(BuiltInCategory.OST_GenericModel));
                using var initial = Block(2, 3, 5);
                subject.SetShape([initial]);
                transaction.Commit();
            }
            using (var transaction = new Transaction(document, "Change instance-specific body")) {
                transaction.Start();
                using var edited = Block(7, 3, 5);
                subject.SetShape([edited]);
                transaction.Commit();
            }
            using var options = new Options { DetailLevel = ViewDetailLevel.Medium, ComputeReferences = false };
            using (var geometry = subject.get_Geometry(options))
                Assert.That(geometry!.OfType<Solid>().Any(), Is.True, "Fixture must exercise the direct body path.");
            var expected = Copied(subject, options, Transform.Identity);
            var actual = new List<Tri>();
            Ingest.Element(subject, 0, 0, actual, Transform.Identity, [], false);
            Assert.That(Canonical(actual), Is.EqualTo(Canonical(expected)));
            Assert.That(actual.SelectMany(t => new[] { t.A.X, t.B.X, t.C.X }).Max(), Is.EqualTo(7));
        } finally { document.Close(false); }
    }

    private static Solid Block(double x, double y, double z) {
        var points = new[] { XYZ.Zero, new XYZ(x, 0, 0), new XYZ(x, y, 0), new XYZ(0, y, 0) };
        using var loop = new CurveLoop();
        for (var i = 0; i < points.Length; i++)
            loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
        return GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, z);
    }

    private static List<Tri> Copied(Element element, Options options, Transform toHost) {
        var triangles = new List<Tri>();
        using var geometry = element.get_Geometry(options);
        if (geometry is not null) Walk(geometry);
        return triangles;

        void Walk(GeometryElement current) {
            foreach (var child in current) {
                if (child is GeometryInstance instance) {
                    using var inner = instance.GetInstanceGeometry();
                    if (inner is not null) Walk(inner);
                } else if (child is Solid solid) {
                    using var faces = solid.Faces;
                    foreach (Face face in faces) {
                        using var mesh = face.Triangulate();
                        if (mesh is not null) Emit(mesh);
                    }
                } else if (child is Mesh mesh) Emit(mesh);
            }
        }
        void Emit(Mesh mesh) {
            var points = mesh.Vertices.Select(v => {
                var p = toHost.IsIdentity ? v : toHost.OfPoint(v);
                return new Vector3((float)p.X, (float)p.Y, (float)p.Z);
            }).ToArray();
            for (var i = 0; i < mesh.NumTriangles; i++) {
                var t = mesh.get_Triangle(i);
                var triangle = new Tri { A = points[t.get_Index(0)], B = points[t.get_Index(1)], C = points[t.get_Index(2)] };
                if (!triangle.IsDegenerate) triangles.Add(triangle);
            }
        }
    }

    private static string[] Canonical(IEnumerable<Tri> triangles) => triangles.Select(t => {
        string Point(Vector3 p) => string.Join(",", new[] { p.X, p.Y, p.Z }
            .Select(v => Math.Round(v, 5).ToString("F5", CultureInfo.InvariantCulture)));
        var a = Point(t.A); var b = Point(t.B); var c = Point(t.C);
        return new[] { a + "|" + b + "|" + c, b + "|" + c + "|" + a, c + "|" + a + "|" + b }
            .OrderBy(x => x, StringComparer.Ordinal).First();
    }).OrderBy(x => x, StringComparer.Ordinal).ToArray();

    private static void AssertMatchingTriangles(IReadOnlyList<Tri> actual, IReadOnlyList<Tri> expected, string scenario) {
        var scale = Math.Max(1, actual.Concat(expected).SelectMany(t => new[] { t.A, t.B, t.C })
            .SelectMany(p => new[] { Math.Abs(p.X), Math.Abs(p.Y), Math.Abs(p.Z) }).Max());
        // Affine composition rounds before float quantization; use the existing proximity gate's scale margin.
        var tolerance = scale * Math.Pow(2, -21);
        var unmatched = expected.ToList();
        var maximum = 0.0;
        foreach (var triangle in actual) {
            var points = new[] { triangle.A, triangle.B, triangle.C };
            var best = double.PositiveInfinity;
            var match = -1;
            for (var i = 0; i < unmatched.Count; i++) {
                var candidate = unmatched[i];
                var vertices = new[] { candidate.A, candidate.B, candidate.C };
                // Cyclic permutations preserve winding; reversing vertices is deliberately forbidden.
                for (var shift = 0; shift < 3; shift++) {
                    var distance = 0.0;
                    for (var vertex = 0; vertex < 3; vertex++)
                        distance = Math.Max(distance, Distance(points[vertex], vertices[(vertex + shift) % 3]));
                    if (distance >= best) continue;
                    best = distance;
                    match = i;
                }
            }
            unmatched.RemoveAt(match);
            maximum = Math.Max(maximum, best);
        }
        TestContext.Progress.WriteLine($"Symbol geometry {scenario}: triangles={actual.Count}, maxVertexDistanceFt={maximum:R}, floatMarginFt={tolerance:R}");
        Assert.That(unmatched, Is.Empty, "Every expected triangle must be consumed exactly once.");
        Assert.That(maximum, Is.LessThanOrEqualTo(tolerance), $"Triangle coordinates or winding changed ({scenario}).");
    }

    private static double Distance(Vector3 a, Vector3 b) {
        double x = (double)a.X - b.X, y = (double)a.Y - b.Y, z = (double)a.Z - b.Z;
        return Math.Sqrt(x * x + y * y + z * z);
    }
}
