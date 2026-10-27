using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Space;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.Tests;

/// <summary>Full scene membership belongs in the hashed artifact, not the bounded bridge receipt.</summary>
public sealed class SceneArtifactReceiptProofTests {
    [Test]
    public void LargeArtifactPreservesEveryIdentityWhileRpcReceiptStaysBounded() {
        const int count = 50000;
        var bounds = new Aabb(0, 0, 0, 10, 10, 10);
        var rows = Enumerable.Range(1, count).Select(id => new SceneElement(
            new Handle("source-document", id, $"native-element-{id:D10}", null, "Ducts", id == 1 ? PrimKind.Mesh : PrimKind.Element),
            id == 1 ? 0 : 3, id == 1 ? 3 : 0, bounds, id <= 2, (long)BuiltInCategory.OST_DuctCurves,
            id == 1 ? SceneRepresentation.Mesh : SceneRepresentation.Run,
            id == 1 ? null : new SceneRun([0, 0, 0], [10, 0, 0], SceneRunShape.Rectangular, 2, 1, null, [0, 1, 0]))).ToArray();
        var stamp = new Stamp("host-document", 7, Stamp.HostInternalFt, DateTime.UtcNow, [], true,
            new Resolved([SourceKind.Host], ["Ducts"], [PrimKind.Solid, PrimKind.Mesh], [], []));
        var work = new SceneWork(count, 0, 0, 12, AcquiredTriangles: 0, ContextGeometryCalls: 0);
        var metadata = new SceneMetadata("space-scene-v3", stamp, bounds, 1, rows, [1, 2, count + 1], 3,
            [new SceneSource("source-document", null, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])],
            "context", [new SceneUnavailableElement(count + 1, "missing-focus", "Ducts", "Unavailable native body.")],
            work, new SceneCompleteness(false, 0, 0, "missing-bounds"));
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
            var settings = new JsonSerializerSettings {
                NullValueHandling = NullValueHandling.Ignore,
                ContractResolver = new CamelCasePropertyNamesContractResolver(),
                Converters = [new StringEnumConverter()]
            };
            var rpc = JsonConvert.SerializeObject(receipt, settings);
            Assert.That(Encoding.UTF8.GetByteCount(rpc), Is.LessThan(4096));
            Assert.That(JObject.Parse(rpc).DescendantsAndSelf().OfType<JArray>(), Is.Empty,
                "Growing membership, source and unavailable arrays must never cross the receipt transport.");
            var small = SceneReceipt.From(metadata with { Elements = rows.Take(1).ToArray() });
            Assert.That(Math.Abs(JsonConvert.SerializeObject(small, settings).Length
                - JsonConvert.SerializeObject(receipt.Scene, settings).Length), Is.LessThan(32));
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
