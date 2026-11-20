using System.IO;
using System.Reflection;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Operations;
using Pe.Revit.Takeoff;
using Pe.Shared.HostContracts.Operations;
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
        var traces = Directory.CreateTempSubdirectory("pe-rooms-native-traces-");
        var previousTraceRoot = RoomsRunTraces.RootOverride.Value;
        RoomsRunTraces.RootOverride.Value = traces.FullName;
        try {
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
            foreach (var owner in new[] { SystemRegistry.Owner, Pe.Revit.Partition.EnclosureDeclaration.Owner, RoomsRegionRecord.Owner })
                Assert.That(SharedParameterElement.Lookup(doc, owner.Guid), Is.Null, owner.Name);
            var replacements = Invoke<TakeoffRecordReplacements>("GetTakeoffRecordReplacements", doc, new NoRequest());
            Assert.That(replacements, Is.EqualTo(new TakeoffRecordReplacements(null, null)));

            var adopted = Capture<TakeoffAdoptResult>("takeoffs.adopt", "AdoptTakeoffRegionsCore",
                new TakeoffAdoptRequest(view.UniqueId, [new TakeoffAdoptItem(zone.Id.Value(), zone.UniqueId, "Fixture zone", "FIXTURE-1")]));
            Assert.That(adopted, Is.Not.Null, "Adopt native path must answer; see retained error");

            Assert.That(TakeoffRecords.ReadRegistry(doc).Systems.Single().Tag, Is.EqualTo("FIXTURE-1"));
            Assert.That(Pe.Revit.Partition.EnclosureDeclaration.Read(doc).Source, Does.StartWith("declared:"));
            Assert.That(RoomsRegionRecord.Read(doc).OrThrow()!.Regions[zone.UniqueId].Fields.Name, Is.EqualTo("Fixture zone"));

            var a = Capture<RoomsDrawResult>("rooms.draw", "DrawRoomCore",
                new RoomsDrawRequest(view.UniqueId, [Square(0, 0, 10)], "Office"));
            var b = Capture<RoomsDrawResult>("rooms.draw", "DrawRoomCore",
                new RoomsDrawRequest(view.UniqueId, [Square(10, 0, 10)], "Lobby"));
            Assert.That(a, Is.Not.Null, "Draw native path must answer; see retained error");
            Assert.That(b, Is.Not.Null, "Draw native path must answer; see retained error");
            var written = Capture<RoomsWriteReceipt>("rooms.write", "WriteRoomsCore", new RoomsWriteRequest([
                new RoomsWriteRegion(a!.UniqueId, Name: "Office - recorded"),
                new RoomsWriteRegion(b!.UniqueId, Name: "Lobby - recorded")
            ]));
            Assert.That(written, Is.Not.Null, "Write native path must answer; see retained error");

            var linked = Capture<TakeoffRhvacLinksData>("takeoffs.rhvac-links", "LinkTakeoffRhvacCore",
                new TakeoffRhvacLinksRequest([new TakeoffRhvacLinkWrite(a.ElementId, a.UniqueId,
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
                .Where(entry => entry.Value.Role == TakeoffRecords.RoleRoomRegion && entry.Value.Provenance.Zone == zoneUniqueId)
                .Select(entry => entry.Key).ToList();
            Assert.That(members, Has.Count.EqualTo(2));
            var merged = Capture<RoomsMergeResult>("rooms.merge", "MergeRoomsCore",
                new RoomsMergeRequest(view.UniqueId, members, "Recorded combined room"));
            Assert.That(merged, Is.Not.Null, "Merge native path must answer; see retained error");
            Assert.That(merged!.MergedFrom, Is.EquivalentTo(members));
            Assert.That(doc.GetElement(merged.UniqueId), Is.TypeOf<FilledRegion>());
            var takeoff = Capture<TakeoffPartitionResult>("takeoffs.partition", "PartitionTakeoffCore",
                new TakeoffPartitionRequest(zone.Id.Value(), view.UniqueId, "Fixture zone", zoneUniqueId, "recorded-fixture"));
            Assert.That(takeoff, Is.Not.Null, "Takeoff partition must answer; see retained error");
            Assert.That(takeoff!.Failures, Is.Empty);
            Assert.That(takeoff.Review!.Zone.Key, Is.EqualTo(zoneUniqueId));
            var partitioned = Capture<RoomsPartitionResult>("rooms.partition", "PartitionRoomsCore", new RoomsPartitionRequest(view.UniqueId));
            Assert.That(partitioned, Is.Not.Null, "Rooms partition must answer; see retained error");
            Assert.That(partitioned!.Failures, Is.Empty);
            var trace = Capture<RoomsTraceData>("rooms.trace", "GetRoomsTraceCore", new RoomsTraceRequest(view.UniqueId));
            Assert.That(trace, Is.Not.Null, "Rooms trace must answer; see retained error");
            Assert.That(trace!.RunId, Is.EqualTo(partitioned.RunId));
            Assert.That(trace.Zones.Select(item => item.ZoneUniqueId), Does.Contain(zoneUniqueId));
        } finally {
            RoomsRunTraces.RootOverride.Value = previousTraceRoot;
            RevitFamilyFixtureHarness.CloseDocument(doc);
            traces.Delete(true);
        }
    }

    [Test]
    public void Rooms_trace_survives_Save_As_and_deletion_of_its_first_zone(UIApplication ui)
    {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        var root = Directory.CreateTempSubdirectory("pe-rooms-save-as-traces-");
        var previousTraceRoot = RoomsRunTraces.RootOverride.Value;
        RoomsRunTraces.RootOverride.Value = root.FullName;
        try
        {
            string viewId;
            RoomsDrawResult zone;
            using (var tx = new Transaction(doc, "Draw a zoning region"))
            {
                _ = tx.Start();
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(type => type.ViewFamily == ViewFamily.FloorPlan);
                viewId = ViewPlan.Create(doc, planType.Id, level.Id).UniqueId;
                zone = Rooms.Draw(doc, new(viewId, [Square(0, 0, 30)], Role: "zone"));
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var before = RevitFamilyFixtureHarness.SaveDocumentCopy(doc, root.FullName, "before");
            var partition = Rooms.Partition(doc, new(viewId));
            var request = new RoomsTraceRequest(viewId, partition.RunId);
            Assert.That(Rooms.Trace(doc, request).Zones.Single().ZoneUniqueId, Is.EqualTo(zone.UniqueId));

            using (var tx = new Transaction(doc, "Remove and prune the first zone"))
            {
                _ = tx.Start();
                _ = doc.Delete(zone.ElementId.ToElementId());
                var room = Rooms.Draw(doc, new(viewId, [Square(50, 0, 10)], "New room"));
                var record = RoomsRegionRecord.Stage(doc);
                var row = record[room.UniqueId]!;
                record.Regions[room.UniqueId] = row with { Provenance = row.Provenance with
                    { RunId = partition.RunId, OriginalTrace = new string('a', 64) } };
                record.Save(doc);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            Assert.That(RoomsRegionRecord.Read(doc).OrThrow()!.Regions.ContainsKey(zone.UniqueId), Is.False);
            var after = RevitFamilyFixtureHarness.SaveDocumentCopy(doc, root.FullName, "after");
            Assert.That(after, Is.Not.EqualTo(before));
            RevitFamilyFixtureHarness.CloseDocument(doc);
            doc = ui.Application.OpenDocumentFile(after);

            var trace = Rooms.Trace(doc, request);
            Assert.That(trace.Zones.Single().ZoneUniqueId, Is.EqualTo(zone.UniqueId));
            Assert.That(trace.OriginalIssue, Is.EqualTo("original not on this machine"));
            Assert.That(trace.MissingOriginals, Has.Count.EqualTo(1));

            using (var tx = new Transaction(doc, "Read a legacy zero-zone run and remove the final regions"))
            {
                _ = tx.Start();
                var record = RoomsRegionRecord.Stage(doc);
                var viewUniqueId = viewId;
                record.Runs[viewUniqueId] = record.Runs[viewUniqueId] with { Zones = 0 };
                record.Save(doc);
                Assert.That(() => Rooms.Trace(doc, request),
                    Throws.TypeOf<RoomsTraceUnavailableException>().With.Message.Contains("No zone solved"));

                var ids = new FilteredElementCollector(doc).OfClass(typeof(FilledRegion))
                    .WherePasses(new ElementOwnerViewFilter(doc.GetElement(viewId).Id)).ToElementIds();
                _ = doc.Delete(ids);
                record.Save(doc);
                Assert.That(RoomsRegionRecord.Read(doc).OrThrow()!.Runs.ContainsKey(viewUniqueId), Is.False);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
        }
        finally
        {
            RoomsRunTraces.RootOverride.Value = previousTraceRoot;
            RevitFamilyFixtureHarness.CloseDocument(doc);
            root.Delete(true);
        }
    }

    [Test]
    public void Rooms_over_cap_Draw_Merge_and_Partition_leave_the_model_and_record_untouched(UIApplication ui)
    {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        var traces = Directory.CreateTempSubdirectory("pe-rooms-cap-");
        var previousTraceRoot = RoomsRunTraces.RootOverride.Value;
        RoomsRunTraces.RootOverride.Value = traces.FullName;
        try
        {
            string Raw() => OwnerBlobStore.Read(doc, RoomsRegionRecord.Owner).Raw!;
            int Bytes(string text) => System.Text.Encoding.UTF8.GetByteCount(text);
            string State() => string.Join("|", new FilteredElementCollector(doc).OfClass(typeof(FilledRegion))
                .Cast<FilledRegion>().OrderBy(fr => fr.Id.Value())
                .Select(fr => $"{fr.UniqueId}:{fr.GetTypeId().Value()}:{Rooms.GeometryHash(TakeoffAtlas.Boundaries(fr))}"));
            string viewId;
            RoomsDrawResult filler, a, b;
            using (var tx = new Transaction(doc, "Seed cap test zones and rooms"))
            {
                _ = tx.Start();
                var level = Level.Create(doc, 0);
                var type = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(candidate => candidate.ViewFamily == ViewFamily.FloorPlan);
                viewId = ViewPlan.Create(doc, type.Id, level.Id).UniqueId;
                var zone = Rooms.Draw(doc, new(viewId, [Square(-5, -5, 30)], "Zone", "zone"));
                a = Rooms.Draw(doc, new(viewId, [Square(0, 0, 10)], "A"));
                b = Rooms.Draw(doc, new(viewId, [Square(10, 0, 10)], "B"));
                filler = Rooms.Draw(doc, new(viewId, [Square(50, 0, 10)], "F"));
                var orphan = Rooms.Draw(doc, new(viewId, [Square(70, 0, 2)], "O"));
                var record = RoomsRegionRecord.Stage(doc);
                foreach (var room in new[] { a, b, orphan })
                {
                    var row = record[room.UniqueId]!;
                    record.Regions[room.UniqueId] = row with { Provenance = row.Provenance with {
                        Zone = room == orphan ? "deleted-zone" : zone.UniqueId,
                        RunId = room == orphan ? "previous-automatic-run" : row.Provenance.RunId,
                        Flags = room == orphan ? [] : row.Provenance.Flags,
                    } };
                }
                record.Save(doc);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            var partition = new RoomsPartitionRequest(viewId, "cap-transaction");
            var before = Bytes(Raw());
            var originalIds = RoomsRegionRecord.Read(doc).OrThrow()!.Regions.Keys.ToHashSet();
            int padding;
            using (var control = new TransactionGroup(doc, "Measure the successful plan"))
            {
                Assert.That(control.Start(), Is.EqualTo(TransactionStatus.Started));
                var result = Rooms.Partition(doc, partition);
                Assert.That(result.Deleted, Is.GreaterThan(0), "The pass must schedule a real deletion");
                Assert.That(result.Created + result.Held, Is.GreaterThan(0), "The pass must add rows");
                var after = Bytes(Raw());
                var staged = RoomsRegionRecord.Read(doc).OrThrow()!;
                staged.Prune(originalIds.Contains);
                var withoutPending = Bytes(OwnerBlob.Encode(RoomsRegionRecord.Owner, staged.ToData()));
                padding = OwnerBlob.MaxBytes - Math.Max(before, withoutPending) - 16;
                Assert.That(after + padding, Is.GreaterThan(OwnerBlob.MaxBytes),
                    "Only the new partition rows should overflow the record");
                Assert.That(control.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
            }

            using (var tx = new Transaction(doc, "Seed a nearly full Rooms record"))
            {
                _ = tx.Start();
                var record = RoomsRegionRecord.Stage(doc);
                var row = record[filler.UniqueId]!;
                record.Regions[filler.UniqueId] = row with { Fields = row.Fields with { Name = new string('x', padding + 1) } };
                record.Save(doc);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            var raw = Raw();
            var state = State();
            void RefusesWithoutMutation(TestDelegate perform)
            {
                Assert.That(perform, Throws.InvalidOperationException.With.Message.Contains("the cap is"));
                Assert.That(State(), Is.EqualTo(state));
                Assert.That(Raw(), Is.EqualTo(raw));
            }

            using (var tx = new Transaction(doc, "Observe any writes before refusal"))
            {
                _ = tx.Start();
                var oversized = new string('x', OwnerBlob.MaxBytes);
                RefusesWithoutMutation(() => Rooms.Draw(doc, new(viewId, [Square(90, 0, 10)], oversized)));
                RefusesWithoutMutation(() => Rooms.Merge(doc, new(viewId, [a.UniqueId, b.UniqueId], oversized)));
                // A late check would try to start the partition's native transaction inside this one.
                Assert.That(() => {
                    using var nested = Pe.Revit.Tasks.DocumentSandbox.BeginCommit(doc, "Transaction boundary control");
                }, Throws.Exception);
                RefusesWithoutMutation(() => Rooms.Partition(doc, partition));
                Assert.That(tx.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
            }
            RefusesWithoutMutation(() => Rooms.Partition(doc, partition));
        }
        finally
        {
            RoomsRunTraces.RootOverride.Value = previousTraceRoot;
            RevitFamilyFixtureHarness.CloseDocument(doc);
            traces.Delete(true);
        }
    }

    [Test]
    public void Rooms_record_commits_cells_and_rolls_back_a_refused_batch(UIApplication ui)
    {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        var traces = Directory.CreateTempSubdirectory("pe-rooms-record-proof-");
        try
        {
            RoomsDrawResult room;
            string viewId;
            using (var transaction = new Transaction(doc, "Draw proof room"))
            {
                Assert.That(transaction.Start(), Is.EqualTo(TransactionStatus.Started));
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(type => type.ViewFamily == ViewFamily.FloorPlan);
                viewId = ViewPlan.Create(doc, planType.Id, level.Id).UniqueId;
                room = Rooms.Draw(doc, new(viewId, [Square(0, 0, 10)], "Office"));
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            using (var transaction = new Transaction(doc, "Archive proof solver original"))
            {
                Assert.That(transaction.Start(), Is.EqualTo(TransactionStatus.Started));
                var record = RoomsRegionRecord.Stage(doc);
                var roomRow = record[room.UniqueId]!;
                var provenance = JObject.Parse(roomRow.Provenance.ToJson());
                provenance["partition"] = JObject.Parse("""
                    {"index":0,"disposition":1,"reason":"proof-original","loop":[0,0,10,0,10,10,0,10,0,0],
                     "areaSqft":100,"labelX":5,"labelY":5,"inkBacked":1,"shared":[]}
                    """);
                record.Regions[room.UniqueId] = roomRow with {
                    Provenance = RegionProvenance.FromJson(provenance.ToString(Formatting.None)),
                };
                record.Save(doc, traces.FullName);
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
            var readback = Rooms.Snapshot(doc, viewId, traces.FullName).Regions.Single();
            Assert.That(readback.People, Is.EqualTo(3));
            Assert.That(readback.Reason, Is.EqualTo("proof-original"));
            var missing = Rooms.Snapshot(doc, viewId, Path.Combine(traces.FullName, "other-machine")).Regions.Single();
            Assert.That((missing.Role, missing.Reason), Is.EqualTo(("room", "original not on this machine")));

            var role = Rooms.Write(doc, new([new(room.UniqueId, Role: "zone")]));
            Assert.That(role.Cells, Is.EqualTo(new[] { new RoomsWriteCell(room.UniqueId, RoomField.role, "zone") }));
            Assert.That(Rooms.Snapshot(doc, viewId, traces.FullName).Regions.Single().Role, Is.EqualTo("zone"));
            var beforeRollback = OwnerBlobStore.Read(doc, RoomsRegionRecord.Owner).Raw;

            Assert.Throws<InvalidOperationException>(() => Rooms.Write(doc, new([
                new(room.UniqueId, People: 8), new(Guid.NewGuid().ToString("D") + "-00000042", Name: "Missing"),
            ])));
            Assert.That(OwnerBlobStore.Read(doc, RoomsRegionRecord.Owner).Raw, Is.EqualTo(beforeRollback));

            var saved = RevitFamilyFixtureHarness.SaveDocumentCopy(doc, traces.FullName, "room-proof");
            RevitFamilyFixtureHarness.CloseDocument(doc);
            doc = ui.Application.OpenDocumentFile(saved);
            Assert.That(Rooms.Snapshot(doc, viewId, traces.FullName).Regions.Single().Reason, Is.EqualTo("proof-original"));
        }
        finally
        {
            RevitFamilyFixtureHarness.CloseDocument(doc);
            traces.Delete(true);
        }
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
