using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Space;
using Pe.Shared.RevitData;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.Tests.Bridge;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.Tests;

/// <summary>Full scene membership belongs in the hashed artifact, not the bounded bridge receipt.</summary>
public sealed class SceneArtifactReceiptProofTests {
    [Test]
    public void Summary_keeps_unread_sources_and_each_acquisition_and_gap_outcome() {
        var placement = new Pe.Revit.Space.Placement("host", null);
        var source = new SourceObservation(placement, "host", new(RevisionKind.Observed, 0, null, null), [], SceneSourceState.Loaded);
        var evidence = new SpatialEvidence("host", null, DateTime.UnixEpoch, SpatialEvidence.HostInternalFt,
            new Resolved([], [], [], [], [], Representation: "overview", AcquisitionRequested: false),
            [source, source with { Availability = SceneSourceState.Unloaded }, source with { Availability = SceneSourceState.Unavailable }],
            Enum.GetValues<AcquisitionOutcome>().Select(outcome => new Acquisition(placement, outcome.ToString(), outcome, AcquisitionReason.None)).ToArray(),
            Enum.GetValues<CoverageReason>().Select((reason, i) => new CoverageGap(placement, null, reason, i + 2)).ToArray());
        var artifact = new SceneArtifactReference(new string('a', 64), "/pe/space/scenes/artifact", 1024);
        var summary = SceneEvidence.From(evidence, artifact);
        Assert.Multiple(() => {
            Assert.That(summary.Revision, Is.Null, "Unknown observation must not acquire a revision during summary.");
            Assert.That(summary.Artifact, Is.SameAs(artifact));
            Assert.That(summary.Summary.Sources, Is.EqualTo(new SceneSourceCounts(1, 1, 1)));
            Assert.That(summary.Summary.Acquisition, Is.EqualTo(new SceneAcquisitionCounts(1, 1, 1, 1, 1, 1, 1)));
            Assert.That(summary.Summary.Coverage, Is.EqualTo(new SceneCoverageCounts(2, 3, 4, 5, 6)));
            Assert.That(summary.Summary.AcquisitionRequested, Is.False);
        });
    }

    [Test]
    public async Task LargeArtifactPreservesEveryIdentityWhileRpcReceiptStaysBounded() {
        const int count = 50000;
        var bounds = new Aabb(0, 0, 0, 10, 10, 10);
        var rows = Enumerable.Range(1, count).Select(id => new SceneElement(
            new Handle("host-document", id, $"native-element-{id:D10}", null, "Ducts", id == 1 ? PrimKind.Mesh : PrimKind.Element),
            id == 1 ? 0 : 3, id == 1 ? 3 : 0, bounds, id <= 2, null,
            id == 1 ? SceneRepresentation.Mesh : SceneRepresentation.Run,
            id == 1 ? null : new SceneRun([0, 0, 0], [10, 0, 0], SceneRunShape.Rectangular, 2, 1, null, [0, 1, 0]))).ToArray();
        var placement = new Pe.Revit.Space.Placement("host-document", null);
        double[] transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        var evidence = new SpatialEvidence("host-document", 7, DateTime.UnixEpoch, SpatialEvidence.HostInternalFt,
            new Resolved([SourceKind.Host], ["Ducts"], [PrimKind.Solid, PrimKind.Mesh], [], [], bounds,
                Representation: "overview", AcquisitionRequested: false),
            [new(placement, "host-document", new(RevisionKind.Observed, 7, null, null), transform, SceneSourceState.Loaded)],
            rows.Select(row => new Acquisition(placement, row.Handle.UniqueId,
                row.Representation == SceneRepresentation.Mesh ? AcquisitionOutcome.Acquired : AcquisitionOutcome.Approximate,
                row.Representation == SceneRepresentation.Mesh ? AcquisitionReason.None : AcquisitionReason.Unsupported)).ToArray(),
            rows.Skip(1).Select(row => new CoverageGap(placement, row.Handle.UniqueId, CoverageReason.Approximate, 1)).ToArray());
        var work = new SceneWork(count, 0, 0, 12, AcquiredTriangles: 0, ContextGeometryCalls: 0);
        var metadata = new SceneMetadata("space-scene-v6", evidence, bounds, 1, rows, [1, 2, count + 1], 3,
            [new SceneSource(placement, "host-document", null, transform, SceneSourceState.Loaded, "source", null)],
            "context", [new SceneUnavailableElement(count + 1, "missing-focus", "Ducts", "Unavailable native body.")],
            work, new SceneCompleteness(false, 0, 0, "missing-bounds"), [], new SceneLevels([], [], new SceneLevelWork(0, 0, 0)));
        var directory = Path.Combine(Path.GetTempPath(), "scene-receipt-proof-" + Guid.NewGuid().ToString("N"));
        try {
            using var vertices = new MemoryStream();
            var positions = new float[] { 0, 0, 0, 1, 0, 0, 0, 1, 0 };
            using (var writer = new BinaryWriter(vertices, Encoding.UTF8, true))
                foreach (var position in positions) writer.Write(position);
            vertices.Position = 0;
            var receipt = SpaceSceneOps.Publish(metadata, vertices, directory);
            var artifactPath = Path.Combine(directory, receipt.Id + ".bin");
            var bytes = File.ReadAllBytes(artifactPath);
            Assert.That(bytes.Length, Is.GreaterThan(16777216), "The fixture must cross the real bridge frame boundary.");
            using (var hash = SHA256.Create())
                Assert.That(BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(), Is.EqualTo(receipt.Id));
            Assert.That(receipt.Bytes, Is.EqualTo(bytes.LongLength));
            Assert.That(receipt.Url, Is.EqualTo($"/pe/space/scenes/{receipt.Id}/artifact"));
            using var reader = new BinaryReader(new MemoryStream(bytes));
            Assert.That(reader.ReadInt32(), Is.EqualTo(0x31435350));
            var length = reader.ReadInt32();
            var full = JObject.Parse(Encoding.UTF8.GetString(reader.ReadBytes(length)));
            Assert.That(full["elements"]!.Count(), Is.EqualTo(count));
            Assert.That(full["elements"]!.Select(row => (row["handle"]!["elementId"]!.Value<long>(), row["handle"]!["uniqueId"]!.Value<string>())),
                Is.EqualTo(rows.Select(row => (row.Handle.ElementId, row.Handle.UniqueId))));
            Assert.That(full["elements"]!.Last!["run"]!["widthFt"]!.Value<double>(), Is.EqualTo(2));
            Assert.That(full["sources"]!.Count(), Is.EqualTo(1));
            Assert.That(full["evidence"]!["acquisition"]!.Count(), Is.EqualTo(count));
            Assert.That(full["evidence"]!["coverage"]!.Count(), Is.EqualTo(count - 1));
            Assert.That(full["evidence"]!["acquisition"]!.Last!["subjectUniqueId"]!.Value<string>(), Is.EqualTo(rows.Last().Handle.UniqueId));
            Assert.That(full["unavailableElements"]!.Count(), Is.EqualTo(1));
            Assert.That(full["requestedElementIds"]!.Values<long>(), Is.EqualTo(new long[] { 1, 2, count + 1 }));
            Assert.That(full["work"]!["contextGeometryCalls"]!.Value<int>(), Is.Zero);
            while (reader.BaseStream.Position % 4 != 0) Assert.That(reader.ReadByte(), Is.Zero);
            Assert.That(Enumerable.Range(0, positions.Length).Select(_ => reader.ReadSingle()), Is.EqualTo(positions));
            Assert.That(reader.BaseStream.Position, Is.EqualTo(bytes.LongLength));
            Assert.That(receipt.Scene.Elements, Is.EqualTo(count));
            Assert.That(receipt.Scene.FocusElements, Is.EqualTo(2));
            Assert.That(receipt.Scene.ContextElements, Is.EqualTo(count - 2));
            Assert.That(receipt.Scene.UnavailableElements, Is.EqualTo(1));
            Assert.That(receipt.Scene.RequestedElements, Is.EqualTo(3));
            Assert.That(receipt.Scene.Sources, Is.EqualTo(1));
            Assert.That(receipt.Scene.OmittedElements, Is.EqualTo(3));
            var settings = SdkOperations.Json;
            var rpc = JsonConvert.SerializeObject(receipt, settings);
            // The runner projects this covariant interface, not a field selected by the test.
            var evidenceJson = JsonConvert.SerializeObject(((IEvidenced<IObserved>)receipt).Evidence, settings);
            var payloadBytes = Encoding.UTF8.GetByteCount(rpc);
            var frame = new BridgeFrame(BridgeFrameKind.Response, Response: new BridgeResponse(
                "scene-d11", true, rpc, null, null, null, new(0, 0, 0, 0, payloadBytes),
                EvidenceJson: evidenceJson, Touched: new Touched.None()));
            var frameBytes = Encoding.UTF8.GetByteCount(JsonConvert.SerializeObject(frame, settings));
            TestContext.Progress.WriteLine($"D11 {count} rows: artifact={bytes.Length}, payload={payloadBytes}, evidence={Encoding.UTF8.GetByteCount(evidenceJson)}, frame={frameBytes}");
            using var pair = await BridgeRequestPumpTests.WebSocketPair.ConnectAsync();
            await pair.Client.WriteAsync(frame, CancellationToken.None);
            var delivered = await pair.Server.ReadAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
            Assert.That(delivered!.Response!.PayloadJson, Is.EqualTo(rpc));
            Assert.That(delivered.Response.EvidenceJson, Is.EqualTo(evidenceJson));
            Assert.That(Encoding.UTF8.GetByteCount(rpc), Is.LessThan(4096));
            Assert.That(Encoding.UTF8.GetByteCount(evidenceJson), Is.LessThan(2048));
            Assert.That(frameBytes, Is.LessThan(8192), "The enclosing frame contains BOTH escaped JSON strings.");
            var reference = JObject.Parse(evidenceJson)["artifact"]!;
            Assert.That(reference["id"]!.Value<string>(), Is.EqualTo(receipt.Id));
            Assert.That(reference["url"]!.Value<string>(), Is.EqualTo(receipt.Url));
            Assert.That(reference["bytes"]!.Value<long>(), Is.EqualTo(receipt.Bytes));
            Assert.That(JObject.Parse(evidenceJson)["summary"]!["acquisition"]!["approximate"]!.Value<int>(), Is.EqualTo(count - 1));
            Assert.That(((JObject)JObject.Parse(rpc)["scene"]!).DescendantsAndSelf().OfType<JArray>(), Is.Empty,
                "The count receipt stays bounded; concrete evidence is the separate native evidence member.");
            var small = SceneReceipt.From(metadata with { Elements = rows.Take(1).ToArray() });
            Assert.That(Math.Abs(JsonConvert.SerializeObject(small, settings).Length
                - JsonConvert.SerializeObject(receipt.Scene, settings).Length), Is.LessThan(32));
            var fixture = JsonConvert.SerializeObject(new {
                payload = receipt, evidence = ((IEvidenced<IObserved>)receipt).Evidence
            }, settings) + "\n";
            var recordPath = Environment.GetEnvironmentVariable("PE_RECORD_SCENE_RECEIPT");
            var fixturePath = recordPath ?? Path.Combine(TestContext.CurrentContext.TestDirectory, "scene-artifact.fixture.json");
            if (recordPath is not null) File.WriteAllText(fixturePath, fixture, new UTF8Encoding(false));
            Assert.That(File.ReadAllText(fixturePath).Replace("\r\n", "\n"), Is.EqualTo(fixture), "TS decodes the exact native receipt and separate evidence.");
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
