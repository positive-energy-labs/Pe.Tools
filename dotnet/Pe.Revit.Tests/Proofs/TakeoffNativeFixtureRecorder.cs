using System.IO;
using System.Reflection;
using Newtonsoft.Json;
using Pe.Revit.Global.Services.Host;
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
                var method = typeof(RevitDataRequestService).GetMethod(entryPoint, BindingFlags.Static | BindingFlags.NonPublic)!;
                var wrapper = Activator.CreateInstance(method.GetParameters()[1].ParameterType,
                    BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, [doc], null);
                response = (T)method.Invoke(null, [request, wrapper])!;
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
                    new TakeoffCarrierInitializationRequest(TakeoffCarrierStage.Rooms));
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
                new RoomsDrawRequest(view.Name, [Square(0, 0, 10)], "Office"));
            var b = Capture<RoomsDrawResult>("rooms.draw", "DrawRoomCore",
                new RoomsDrawRequest(view.Name, [Square(10, 0, 10)], "Lobby"));
            Assert.That(a, Is.Not.Null, "Draw native path must answer; see retained error");
            Assert.That(b, Is.Not.Null, "Draw native path must answer; see retained error");
            var written = Capture<RoomsWriteResult>("rooms.write", "WriteRoomsCore", new RoomsWriteRequest([
                new RoomsWriteRegion(a!.Guid, Name: "Office - recorded"),
                new RoomsWriteRegion(b!.Guid, Name: "Lobby - recorded")
            ]));
            Assert.That(written, Is.Not.Null, "Write native path must answer; see retained error");

            var linked = Capture<TakeoffRhvacLinksData>("takeoffs.rhvac-links", "LinkTakeoffRhvacCore",
                new TakeoffRhvacLinksRequest([new TakeoffRhvacLinkWrite(a.ElementId,
                    new TakeoffRhvacLink(101, "native-fixture.r10#recorded", DateTime.UtcNow.ToString("O"), 100))]));
            Assert.That(linked, Is.Not.Null, "Link native path must answer; see retained error");

            // Merge requires materialized members of one zone; Draw records a person's region
            // without a zone. Seed that real model precondition through the native materializer.
            var zoneGuid = adopted!.Adopted.Single().Guid;
            using (var tx = new Transaction(doc, "Seed native merge members in the adopted zone")) {
                _ = tx.Start();
                ZoneMaterializer.Materialize(doc, view, 0, zoneGuid, "recorded-fixture", [
                    new RoomResult { Id = "R01", RawSqft = 100, LabelX = 5, LabelY = 5, Polygon = Square(0, 0, 10) },
                    new RoomResult { Id = "R02", RawSqft = 100, LabelX = 15, LabelY = 5, Polygon = Square(10, 0, 10) }
                ], [], _ => { });
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var members = new FilteredElementCollector(doc, view.Id).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
                .Where(region => TakeoffCarriers.ReadIdentity(region).Role == TakeoffCarriers.RoleRoomRegion)
                .Where(region => RegionProvenance.FromJson(TakeoffCarriers.ReadProvenance(region)!).ZoneGuid == zoneGuid)
                .Select(region => TakeoffCarriers.ReadIdentity(region).Guid!.Value).ToList();
            Assert.That(members, Has.Count.EqualTo(2));
            _ = Capture<RoomsMergeResult>("rooms.merge", "MergeRoomsCore",
                new RoomsMergeRequest(view.Name, members, "Recorded combined room"));
            // A missing spatial recording is retained as an error, never fabricated into a DTO.
            _ = Capture<TakeoffPartitionResult>("takeoffs.partition", "PartitionTakeoffCore",
                new TakeoffPartitionRequest(zone.Id.Value(), view.Name, "Fixture zone", adopted!.Adopted.Single().Guid, "recorded-fixture"));
            _ = Capture<RoomsPartitionResult>("rooms.partition", "PartitionRoomsCore", new RoomsPartitionRequest(view.Name));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(doc);
        }
    }

    private static List<double[]> Square(double x, double y, double size) =>
        [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
}
