using System.IO;
using System.Reflection;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Operations;
using Pe.Revit.Takeoff;
using Pe.Shared.RevitData.Serialization;
using Pe.Shared.RevitData.Takeoffs;

namespace Pe.Revit.Tests;

/// <summary>Retain actual operation DTOs on an owned project copy for TS admission replay.</summary>
public sealed class TakeoffNativeFixtureRecorder {
    [Test]
    public void Record_takeoff_native_DTOs_on_an_owned_project_copy(UIApplication ui) {
        var output = Environment.GetEnvironmentVariable("PE_NATIVE_FIXTURE_OUTPUT")
            ?? Path.Combine(Path.GetTempPath(), "pe-takeoff-native-fixture");
        Directory.CreateDirectory(output);
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        var model = RevitFamilyFixtureHarness.SaveDocumentCopy(doc, output, "native-fixture-model");
        var settings = RevitDataJson.CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        settings.NullValueHandling = NullValueHandling.Include;
        var sequence = 0;
        T? Capture<T>(string operation, string entryPoint, object request) where T : class {
            T? response = null;
            Exception? failure = null;
            try {
                response = Invoke<T>(entryPoint, doc, request);
            } catch (Exception error) {
                failure = error is TargetInvocationException { InnerException: { } inner } ? inner : error;
            }
            var path = Path.Combine(output, $"{++sequence:D2}-{operation}.json");
            File.WriteAllText(path, JsonConvert.SerializeObject(new {
                operation, entryPoint, request, response, error = failure?.ToString(),
                modelCopy = model, date = DateTime.UtcNow.ToString("O"), rung = "fresh"
            }, Formatting.Indented, settings));
            TestContext.WriteLine($"Native fixture: {path}");
            return response;
        }
        try {
            TakeoffCarrierInitializationData? carrier;
            var count = 0;
            do {
                carrier = Capture<TakeoffCarrierInitializationData>("takeoffs.initialize-carrier", "InitializeTakeoffCarrierCore",
                    new TakeoffCarrierInitializationRequest());
                Assert.That(carrier, Is.Not.Null, "Carrier native path must answer; see retained error");
                Assert.That(++count, Is.LessThan(64));
            } while (carrier!.Remaining.Count > 0);

            ViewPlan view;
            FilledRegion zone;
            using (var tx = new Transaction(doc, "Seed native recording view and candidate")) {
                _ = tx.Start();
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(type => type.ViewFamily == ViewFamily.FloorPlan);
                view = ViewPlan.Create(doc, planType.Id, level.Id);
                view.Name = "Native fixture plan";
                var regionType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType)).FirstElementId();
                zone = FilledRegion.Create(doc, regionType, view.Id, Kernel.ToLoops(Square(-5, -5, 30), [], 0));
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var adopted = Capture<TakeoffAdoptResult>("takeoffs.adopt", "AdoptTakeoffRegionsCore",
                new TakeoffAdoptRequest(view.Name, [new TakeoffAdoptItem(zone.Id.Value(), "Fixture zone", "FIXTURE-1")]));
            Assert.That(adopted, Is.Not.Null, "Adopt native path must answer; see retained error");

            var a = Capture<RoomsDrawResult>("rooms.draw", "DrawRoomCore",
                new RoomsDrawRequest(view.Id.Value(), [Square(0, 0, 10)], "Office"));
            var b = Capture<RoomsDrawResult>("rooms.draw", "DrawRoomCore",
                new RoomsDrawRequest(view.Id.Value(), [Square(10, 0, 10)], "Lobby"));
            Assert.That(a, Is.Not.Null, "Draw native path must answer; see retained error");
            Assert.That(b, Is.Not.Null, "Draw native path must answer; see retained error");
            var written = Capture<RoomsWriteReceipt>("rooms.write", "WriteRoomsCore", new RoomsWriteRequest([
                new RoomsWriteRegion(a!.UniqueId, Name: "Office - recorded"),
                new RoomsWriteRegion(b!.UniqueId, Name: "Lobby - recorded")
            ]));
            Assert.That(written, Is.Not.Null, "Write native path must answer; see retained error");

            var linked = Capture<TakeoffRhvacLinksData>("takeoffs.rhvac-links", "LinkTakeoffRhvacCore",
                new TakeoffRhvacLinksRequest([new TakeoffRhvacLinkWrite(a.ElementId,
                    new TakeoffRhvacLink(101, "native-fixture.r10#recorded", DateTime.UtcNow.ToString("O"), 100))]));
            Assert.That(linked, Is.Not.Null, "Link native path must answer; see retained error");

            // Merge requires materialized members of one zone; Draw records a person's region
            // without a zone. Seed that real model precondition through the native materializer.
            var zoneUniqueId = adopted!.Adopted.Single().UniqueId;
            using (var tx = new Transaction(doc, "Seed native merge members in the adopted zone")) {
                _ = tx.Start();
                var record = RoomsRegionRecord.Stage(doc);
                ZoneMaterializer.Materialize(doc, view, record, 0, zoneUniqueId, "recorded-fixture", [
                    new RoomResult { Id = "R01", RawSqft = 100, LabelX = 5, LabelY = 5, Polygon = Square(0, 0, 10) },
                    new RoomResult { Id = "R02", RawSqft = 100, LabelX = 15, LabelY = 5, Polygon = Square(10, 0, 10) }
                ], [], _ => { });
                record.Save(doc);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var members = RoomsRegionRecord.Read(doc).OrThrow()!.Regions
                .Where(entry => entry.Value.Role == TakeoffCarriers.RoleRoomRegion && entry.Value.Provenance.Zone == zoneUniqueId)
                .Select(entry => entry.Key).ToList();
            Assert.That(members, Has.Count.EqualTo(2));
            _ = Capture<RoomsMergeResult>("rooms.merge", "MergeRoomsCore",
                new RoomsMergeRequest(view.Id.Value(), members, "Recorded combined room"));
            // A missing spatial recording is retained as an error, never fabricated into a DTO.
            _ = Capture<TakeoffPartitionResult>("takeoffs.partition", "PartitionTakeoffCore",
                new TakeoffPartitionRequest(zone.Id.Value(), view.Name, "Fixture zone", adopted!.Adopted.Single().UniqueId, "recorded-fixture"));
            var partitioned = Capture<RoomsPartitionResult>("rooms.partition", "PartitionRoomsCore", new RoomsPartitionRequest(view.Id.Value()));
            if (partitioned != null)
            {
                var trace = Invoke<RoomsTraceData>("GetRoomsTraceCore", doc, new RoomsTraceRequest(view.Id.Value()));
                Assert.That(trace.RunId, Is.EqualTo(partitioned.RunId));
                Assert.That(trace.Zones.Select(item => item.ZoneUniqueId), Does.Contain(zoneUniqueId));
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(doc);
        }
    }

    [Test]
    public void Rooms_record_commits_cells_and_rolls_back_a_refused_batch(UIApplication ui)
    {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        try
        {
            RoomsDrawResult room;
            long viewId;
            using (var transaction = new Transaction(doc, "Draw proof room"))
            {
                Assert.That(transaction.Start(), Is.EqualTo(TransactionStatus.Started));
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(type => type.ViewFamily == ViewFamily.FloorPlan);
                viewId = ViewPlan.Create(doc, planType.Id, level.Id).Id.Value();
                room = Rooms.Draw(doc, new(viewId, [Square(0, 0, 10)], "Office"));
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            using (var transaction = new Transaction(doc, "Archive proof solver original"))
            {
                Assert.That(transaction.Start(), Is.EqualTo(TransactionStatus.Started));
                var record = RoomsRegionRecord.Stage(doc);
                var roomRow = record[room.UniqueId]!;
                record.Regions[room.UniqueId] = roomRow with { Provenance = roomRow.Provenance with
                {
                    Partition = new Pe.Revit.Partition.Room(0, Pe.Revit.Partition.Disposition.Held, "proof-original",
                        [0, 0, 10, 0, 10, 10, 0, 10, 0, 0], 100, 5, 5, 1, null, null, []),
                } };
                record.Save(doc);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            var receipt = Rooms.Write(doc, new([new(room.UniqueId, Name: "Office", People: 3)]));
            var raw = OwnerBlobStore.Read(doc, RoomsRegionRecord.Owner);
            var row = raw.Data!["regions"]![room.UniqueId]!;
            Assert.That(raw.Status, Is.EqualTo(OwnerBlobStatus.Ok));
            Assert.That(row["role"]!.Value<string>(), Is.EqualTo("room-region"));
            Assert.That(receipt.Cells, Is.EqualTo(new RoomsWriteCell[]
            {
                new(room.UniqueId, RoomField.name, row["fields"]!["name"]!.Value<string>()),
                new(room.UniqueId, RoomField.people, row["fields"]!["people"]!.Value<double>()),
            }));
            Assert.That(row["provenance"]!["partition"], Is.Null);
            Assert.That(row["provenance"]!["geometryHash"]!.Value<string>(), Is.Not.Empty);
            Assert.That(row["provenance"]!["originalTrace"]!.Value<string>(), Is.Not.Empty);
            var readback = Rooms.Snapshot(doc, viewId).Regions.Single();
            Assert.That(readback.People, Is.EqualTo(3));
            Assert.That(readback.Reason, Is.EqualTo("proof-original"));

            Assert.Throws<InvalidOperationException>(() => Rooms.Write(doc, new([
                new(room.UniqueId, People: 8), new(Guid.NewGuid().ToString("D") + "-00000042", Name: "Missing"),
            ])));
            Assert.That(OwnerBlobStore.Read(doc, RoomsRegionRecord.Owner).Raw, Is.EqualTo(raw.Raw));
        }
        finally { RevitFamilyFixtureHarness.CloseDocument(doc); }
    }

    internal static T Invoke<T>(string entryPoint, Document document, object request)
    {
        var method = typeof(RevitDataRequestService).GetMethod(entryPoint, BindingFlags.Static | BindingFlags.NonPublic)!;
        var parameters = method.GetParameters();
        var wrapper = Activator.CreateInstance(parameters[1].ParameterType,
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, [document], null);
        var args = new List<object?> { request, wrapper };
        if (parameters.Length >= 3) args.Add(new ModelWrite(document));
        if (parameters.Length == 4) args.Add(CancellationToken.None);
        return (T)method.Invoke(null, args.ToArray())!;
    }

    private static List<double[]> Square(double x, double y, double size) =>
        [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
}
