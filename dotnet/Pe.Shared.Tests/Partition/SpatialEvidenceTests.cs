using System.Numerics;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

public sealed class SpatialEvidenceTests {
    private static readonly Placement Host = new("host", null);
    private static readonly double[] Identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    private static SpatialEvidence Evidence() => new("host", 7, DateTime.UnixEpoch, SpatialEvidence.HostInternalFt,
        new Resolved([SourceKind.Host], [], [PrimKind.Solid, PrimKind.Mesh], [], [], new Aabb(0, 0, 0, 10, 10, 10)),
        [new(Host, "host", new(RevisionKind.Observed, 7, null, null), Identity, SceneSourceState.Loaded)], [], []);

    [Test]
    public void Missing_or_corrupt_basis_refuses_and_same_basis_survives_wire_round_trip() {
        var evidence = Evidence();
        Assert.DoesNotThrow(() => evidence.RequireBasis("host", 7));
        Assert.Throws<InvalidOperationException>(() => evidence.RequireBasis("host", 8));
        foreach (var corrupt in new[] {
            evidence with { Revision = null }, evidence with { Sources = [] }, evidence with { ObservedAt = default },
            evidence with { Resolved = evidence.Resolved with { AcquisitionRequested = false } },
            evidence with { Sources = [evidence.Sources[0] with { ToHost = [1, 2] }] },
            evidence with { Acquisition = [new(new("host", "absent"), "subject", AcquisitionOutcome.Partial, AcquisitionReason.Triangulate)] }
        }) Assert.Throws<InvalidOperationException>(() => corrupt.RequireBasis("host", 7));
        var decoded = JsonConvert.DeserializeObject<SpatialEvidence>(JsonConvert.SerializeObject(evidence))!;
        Assert.That(evidence.SameSources(decoded), Is.True, "Matrix values, not array references, define the same basis.");
        Assert.DoesNotThrow(() => decoded.RequireBasis("host", 7));
        var unloaded = new SourceObservation(new("host", "link"), null,
            new(RevisionKind.Unavailable, null, null, RevisionUnavailableReason.SourceUnread), Identity, SceneSourceState.Unloaded);
        Assert.That(evidence.SameSources(evidence with { Sources = [.. evidence.Sources, unloaded] }), Is.False);
        Assert.That(evidence.SameSources(evidence with { Sources = [evidence.Sources[0] with { Revision = new(RevisionKind.Observed, 8, null, null) }] }), Is.False);
    }

    [TestCase(AcquisitionOutcome.Partial, AcquisitionReason.Triangulate, true)]
    [TestCase(AcquisitionOutcome.Failed, AcquisitionReason.GeometryRead, false)]
    [TestCase(AcquisitionOutcome.Empty, AcquisitionReason.None, false)]
    public void Cache_reuse_preserves_acquisition_with_or_without_triangles(AcquisitionOutcome outcome, AcquisitionReason reason, bool triangles) {
        var directory = Path.Combine(Path.GetTempPath(), "evidence-cache-" + Guid.NewGuid().ToString("N"));
        try {
            var acquisition = new GeometryRead { Failed = outcome is AcquisitionOutcome.Partial or AcquisitionOutcome.Failed, Reason = reason }
                .Finish(Host, "subject", triangles ? 1 : 0);
            Assert.That(acquisition.Outcome, Is.EqualTo(outcome));
            var geometry = new LinkedGeometryStore.Geometry(triangles
                    ? [new(0, 10, "subject", "Walls", PrimKind.Solid, new(0, 0, 0, 1, 1, 0), 1)] : [],
                triangles ? [new Tri { A = Vector3.Zero, B = Vector3.UnitX, C = Vector3.UnitY }] : [], acquisition);
            new LinkedGeometryStore(directory).Read("subject", () => geometry);
            var reused = new LinkedGeometryStore(directory).Read("subject", () => throw new AssertionException("Evidence must survive a cache hit."));
            Assert.That(reused.Acquisition, Is.EqualTo(acquisition));
            Assert.That(reused.Triangles.Length, Is.EqualTo(triangles ? 1 : 0));
            var settings = new JsonSerializerSettings {
                ContractResolver = new CamelCasePropertyNamesContractResolver(), Converters = [new StringEnumConverter()]
            };
            var wire = JObject.FromObject(Evidence() with { Acquisition = [reused.Acquisition] }, JsonSerializer.Create(settings));
            Assert.That(wire["acquisition"]![0]!["outcome"]!.Value<string>(), Is.EqualTo(outcome.ToString().ToLowerInvariant()));
            Assert.That(wire["fresh"], Is.Null);
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Test]
    public void Unread_placement_serializes_as_unavailable_rather_than_empty_geometry() {
        var unread = new Placement("host", "unread-link");
        var evidence = Evidence() with {
            Sources = [.. Evidence().Sources, new(unread, null,
                new(RevisionKind.Unavailable, null, null, RevisionUnavailableReason.SourceUnread), Identity, SceneSourceState.Unloaded)],
            Coverage = [new(unread, null, CoverageReason.SourceUnread, 1)]
        };
        var decoded = JsonConvert.DeserializeObject<SpatialEvidence>(JsonConvert.SerializeObject(evidence))!;
        Assert.That(decoded.Sources[1].Revision.Kind, Is.EqualTo(RevisionKind.Unavailable));
        Assert.That(decoded.Sources[1].DocumentKey, Is.Null);
        Assert.That(decoded.Coverage.Single().Reason, Is.EqualTo(CoverageReason.SourceUnread));
        Assert.That(decoded.Acquisition, Is.Empty);
    }
}
