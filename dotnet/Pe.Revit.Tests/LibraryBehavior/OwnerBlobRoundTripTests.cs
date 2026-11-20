using Pe.Revit.Extensions.ProjDocument;
using Newtonsoft.Json.Linq;
using Pe.App.Services.AutoTag;
using Pe.Revit.Global.Lib.Mep;
using Pe.Revit.Global.Services.ParameterLinks;
using Pe.Revit.Partition;
using Pe.Revit.SettingsRuntime.Modules.AutoTag;
using Pe.Revit.Takeoff;
using Pe.Shared.Product;
using System.Text;
using Pe.Shared.RevitData.Ducts;
using Pe.Shared.RevitData.Serialization;
using Pe.Shared.RevitData.Takeoffs;

namespace Pe.Revit.Tests;

/// <summary>
///     The homes slice 2 falsifier (docs/features/homes/MAP.md): on a real model every owner's blob round-trips
///     through the one envelope, and a model that carries an enveloped blob this build cannot read opens, refuses the
///     blob until an apply preserves its bytes and posts a notice (ADR 0057). An old un-enveloped blob reads as
///     absent and the first write replaces it. The codec itself is proven in Pe.Shared.Tests' OwnerBlobTests.
///     Not covered here: the duct per-fitting results entity needs a fitting on the Pe loss server; its text is the
///     same codec, and the duct apply proofs write and read it.
/// </summary>
[TestFixture]
public sealed class OwnerBlobRoundTripTests {
    private static readonly OwnerDescriptor[] ProjectOwners = [
        AutoTagSettings.Owner, ParameterLinkProfile.Owner, DuctLossStore.Owner, SystemRegistry.Owner,
        EnclosureDeclaration.Owner, ProjectHomePointer.Owner
    ];

    private static string? Raw(Document document, OwnerDescriptor owner) =>
        document.ProjectInformation.get_Parameter(owner.Guid)?.AsString();

    private static (Document Document, string Path) SaveCloseReopen(Application application, Document document) {
        var path = Path.Combine(Path.GetTempPath(), $"pe-owner-blob-{Guid.NewGuid():N}.rvt");
        document.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
        RevitFamilyFixtureHarness.CloseDocument(document);
        return (application.OpenDocumentFile(path), path);
    }

    [Test]
    public void Rooms_record_round_trips_on_Project_Information_after_save_and_reopen(UIApplication ui) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        string? path = null;
        try {
            RoomsDrawResult room;
            long viewId;
            using (var tx = new Transaction(document, "Draw Rooms round trip")) {
                Assert.That(tx.Start(), Is.EqualTo(TransactionStatus.Started));
                var view = CreateRoomsView(document);
                viewId = view.Id.Value();
                room = Rooms.Draw(document, new(viewId, [[[0, 0], [10, 0], [10, 10], [0, 10]]], "Office"));
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var raw = Raw(document, RoomsRegionRecord.Owner);
            var traceId = RoomsRegionRecord.Read(document).OrThrow()!.TraceId;

            (document, path) = SaveCloseReopen(ui.Application, document);

            Assert.That(Raw(document, RoomsRegionRecord.Owner), Is.EqualTo(raw).And.Not.Empty);
            Assert.That(RoomsRegionRecord.Read(document).OrThrow()!.TraceId, Is.EqualTo(traceId));
            var actual = Rooms.Snapshot(document, viewId).Regions.Single();
            Assert.That(actual.UniqueId, Is.EqualTo(room.UniqueId));
            Assert.That(actual.Name, Is.EqualTo("Office"));
            var region = (FilledRegion)document.GetElement(actual.UniqueId);
            Assert.That(region.get_Parameter(RoomsRegionRecord.Owner.Guid), Is.Null);
            using (var tx = new Transaction(document, "Delete the first room by hand")) {
                Assert.That(tx.Start(), Is.EqualTo(TransactionStatus.Started));
                document.Delete(region.Id);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            using (var tx = new Transaction(document, "Draw after native deletion")) {
                Assert.That(tx.Start(), Is.EqualTo(TransactionStatus.Started));
                _ = Rooms.Draw(document, new(viewId, [[[0, 0], [10, 0], [10, 10], [0, 10]]], "Replacement"));
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            Assert.That(RoomsRegionRecord.Read(document).OrThrow()!.Regions.ContainsKey(room.UniqueId), Is.False);
            Assert.That(Rooms.Snapshot(document, viewId).Regions.Single().Name, Is.EqualTo("Replacement"));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (path != null) File.Delete(path);
        }
    }

    [Test]
    public void Rooms_reports_a_future_envelope_and_preserves_its_bytes(UIApplication ui) =>
        RoomsReportsUnreadable(ui, newerEnvelope: true);

    [Test]
    public void Rooms_reports_malformed_owner_data_and_preserves_its_bytes(UIApplication ui) =>
        RoomsReportsUnreadable(ui, newerEnvelope: false);

    private static void RoomsReportsUnreadable(UIApplication ui, bool newerEnvelope) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        string? path = null;
        var owner = RoomsRegionRecord.Owner;
        var planted = newerEnvelope
            ? $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version + 1}}},"data":{}}"""
            : OwnerBlob.Encode(owner, new JObject { ["traceId"] = Guid.NewGuid().ToString("N"), ["regions"] = new JArray() });
        try {
            long viewId;
            using (var tx = new Transaction(document, "Plant unreadable Rooms record")) {
                Assert.That(tx.Start(), Is.EqualTo(TransactionStatus.Started));
                viewId = CreateRoomsView(document).Id.Value();
                _ = SharedParameterBinder.EnsureProjectBinding(document, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                document.Regenerate();
                Assert.That(document.ProjectInformation.get_Parameter(owner.Guid).Set(planted), Is.True);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            (document, path) = SaveCloseReopen(ui.Application, document);

            var snapshot = Rooms.Snapshot(document, viewId);
            Assert.That(snapshot.Regions, Is.Empty);
            Assert.That(snapshot.Unreadable!.Single().Reason, Does.Contain(newerEnvelope ? "version" : "regions map"));
            Assert.That(Raw(document, owner), Is.EqualTo(planted));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (path != null) File.Delete(path);
        }
    }

    private static ViewPlan CreateRoomsView(Document document) {
        var level = Level.Create(document, 0);
        var planType = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType))
            .Cast<ViewFamilyType>().First(type => type.ViewFamily == ViewFamily.FloorPlan);
        return ViewPlan.Create(document, planType.Id, level.Id);
    }

    [Test]
    public void Every_owner_blob_round_trips_through_the_envelope_and_survives_save_and_reopen(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        string? path = null;
        try {
            Assert.That(document.IsWorkshared, Is.False, "Writes require a disposable non-workshared document");
            var storage = new ParameterLinksProfileStorage();
            var registry = new SystemRegistry();
            var system = registry.Register("FC-8");
            var pointer = ProjectHomePointer.Create("Projects/2026-014 Chadds Ford").Pointer!;
            using (var transaction = new Transaction(document, "Write every owner blob")) {
                _ = transaction.Start();
                Assert.That(OwnerBlobStore.Write(document, DuctLossStore.Owner, new DuctLossStore { WorkRevision = 3 }.ToData()), Is.True);
                Assert.That(storage.Write(document, new ParameterLinkProfile { Definitions = [], Assignments = [] }), Is.True);
                TakeoffCarriers.WriteRegistry(document, registry);
                EnclosureDeclaration.Write(document, Enclosure.Default);
                Assert.That(OwnerBlobStore.Write(document, ProjectHomePointer.Owner, pointer.ToData()), Is.True);
                Assert.That(OwnerBlobStore.Write(document, ProjectHomePointer.Owner, pointer.ToData()), Is.False, "an unchanged value is a no-op");
                _ = transaction.Commit();
            }
            AutoTagService.Instance.SaveSettingsForDocument(document, new AutoTagSettings { Enabled = false, Configurations = [] });

            void Check(Document doc) {
                Assert.Multiple(() => {
                    foreach (var owner in ProjectOwners) {
                        Assert.That(Raw(doc, owner), Does.StartWith($$"""{"owner":"{{owner.Owner}}","version":{{owner.Version}},"data":{"""), owner.Name);
                        Assert.That(OwnerBlobStore.Read(doc, owner).Status, Is.EqualTo(OwnerBlobStatus.Ok), owner.Name);
                    }
                    var (store, storeError) = DuctApplier.ReadStore(doc);
                    Assert.That(storeError, Is.Null);
                    Assert.That(store!.WorkRevision, Is.EqualTo(3));
                    var profile = storage.Read(doc);
                    Assert.That(profile.Error, Is.Null);
                    Assert.That(profile.Profile!.FormatVersion, Is.EqualTo(ParameterLinkProfile.CurrentFormatVersion));
                    Assert.That(TakeoffCarriers.ReadRegistry(doc).Systems.Single().Guid, Is.EqualTo(system.Guid));
                    Assert.That(EnclosureDeclaration.Read(doc).Source, Does.StartWith("declared"));
                    Assert.That(ProjectHomePointer.FromData(OwnerBlobStore.Read(doc, ProjectHomePointer.Owner).Data!).Pointer!.Path, Is.EqualTo(pointer.Path));
                    Assert.That(AutoTagService.Instance.HasSettingsInDocument(doc), Is.True);
                });
            }

            Check(document);
            var before = ProjectOwners.ToDictionary(owner => owner.Name, owner => Raw(document, owner));
            (document, path) = SaveCloseReopen(uiApplication.Application, document);
            Check(document);
            Assert.That(ProjectOwners.ToDictionary(owner => owner.Name, owner => Raw(document, owner)), Is.EqualTo(before),
                "the stored bytes are the same after save, close and reopen");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (path != null) File.Delete(path);
        }
    }

    [Test]
    public void A_future_version_blob_opens_and_its_read_keeps_the_bytes(UIApplication uiApplication) =>
        RefusesAndKeeps(uiApplication.Application, OwnerBlobStatus.UnknownVersion,
            owner => $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version + 998}}},"data":{"fromTheFuture":true}}""");

    [Test]
    public void A_broken_envelope_opens_and_its_read_keeps_the_bytes(UIApplication uiApplication) =>
        RefusesAndKeeps(uiApplication.Application, OwnerBlobStatus.Invalid,
            owner => $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version}}},"data":[]}""");

    [Test]
    public void An_old_unenveloped_blob_opens_reads_as_absent_and_the_first_write_overwrites_it(UIApplication uiApplication) {
        const string old = """{"version":1,"enabled":true,"workRevision":2,"Systems":[]}""";
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        string? path = null;
        try {
            Assert.That(document.IsWorkshared, Is.False, "Writes require a disposable non-workshared document");
            using (var transaction = new Transaction(document, "Plant old un-enveloped blobs")) {
                _ = transaction.Start();
                foreach (var owner in ProjectOwners)
                    _ = SharedParameterBinder.EnsureProjectBinding(document, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                document.Regenerate();
                foreach (var owner in ProjectOwners)
                    Assert.That(document.ProjectInformation.get_Parameter(owner.Guid).Set(old), Is.True, owner.Name);
                _ = transaction.Commit();
            }

            (document, path) = SaveCloseReopen(uiApplication.Application, document);
            var storage = new ParameterLinksProfileStorage();

            // Absent: every owner starts from its defaults, with no error.
            Assert.Multiple(() => {
                foreach (var owner in ProjectOwners)
                    Assert.That(OwnerBlobStore.Read(document, owner).Status, Is.EqualTo(OwnerBlobStatus.Absent), owner.Name);
                Assert.That(DuctApplier.ReadStore(document), Is.EqualTo(((DuctLossStore?)null, (string?)null)));
                Assert.That(storage.Read(document), Is.EqualTo(new ProfileReadResult(null, false, null)));
                Assert.That(TakeoffCarriers.ReadRegistry(document).Systems, Is.Empty);
                Assert.That(TakeoffAtlas.Snapshot(document, new TakeoffReadRequest()).Unreadable, Is.Empty, "an old shape is not listed as unreadable");
                Assert.That(EnclosureDeclaration.Read(document).Source, Does.StartWith("default:"));
                Assert.That(AutoTagService.Instance.HasSettingsInDocument(document), Is.False);
                Assert.That(AutoTagService.Instance.GetStatus(document).StoredSettingsRefusal, Is.Null);
            });

            // The first write through each owner's own door replaces the old bytes with an envelope.
            var registry = new SystemRegistry();
            _ = registry.Register("FC-8");
            using (var transaction = new Transaction(document, "First write over the old blobs")) {
                _ = transaction.Start();
                Assert.That(OwnerBlobStore.Write(document, DuctLossStore.Owner, new DuctLossStore { WorkRevision = 1 }.ToData()), Is.True);
                Assert.That(storage.Write(document, new ParameterLinkProfile { Definitions = [], Assignments = [] }), Is.True);
                TakeoffCarriers.WriteRegistry(document, registry);
                EnclosureDeclaration.Write(document, Enclosure.Default);
                Assert.That(OwnerBlobStore.Write(document, ProjectHomePointer.Owner, ProjectHomePointer.Create("Projects/Chadds").Pointer!.ToData()), Is.True);
                _ = transaction.Commit();
            }
            AutoTagService.Instance.SaveSettingsForDocument(document, new AutoTagSettings { Enabled = false, Configurations = [] });

            Assert.Multiple(() => {
                foreach (var owner in ProjectOwners) {
                    Assert.That(Raw(document, owner), Does.StartWith($$"""{"owner":"{{owner.Owner}}","version":{{owner.Version}},"data":{"""), owner.Name);
                    Assert.That(OwnerBlobStore.Read(document, owner).Status, Is.EqualTo(OwnerBlobStatus.Ok), owner.Name);
                }
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (path != null) File.Delete(path);
        }
    }

    [Test]
    public void A_v2_duct_record_previews_without_writing_and_apply_keeps_one_copy_and_notice(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var owner = DuctLossStore.Owner;
            var target = document.ProjectInformation;
            var raw = $$$"""{"owner":"duct-losses","version":2,"data":{"roles":{"42":{"role":"fan"}},"test":"{{{Guid.NewGuid():N}}}"}}""";
            void Plant(Document model, string text) {
                using var transaction = new Transaction(model, "Plant v2 numeric duct store");
                _ = transaction.Start();
                _ = SharedParameterBinder.EnsureProjectBinding(model, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                model.Regenerate();
                Assert.That(model.ProjectInformation.get_Parameter(owner.Guid).Set(text), Is.True);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            Plant(document, raw);

            using var isolated = new OwnerBlobRecoveryFixture();
            var state = isolated.Root;
            var notices = Path.Combine(state, ProductPathNames.StoredNoticesFileName);
            var replacement = OwnerBlob.Decode(owner, raw).Replacement!;
            var recovery = Path.Combine(state, "model-recovery", "owner-duct-losses");
            var backup = Path.Combine(recovery, replacement.RawUtf8Sha256 + ".txt");
            int NoticeCount() => File.Exists(notices) ? File.ReadLines(notices).Count(line =>
                line.Contains(replacement.RawUtf8Sha256, StringComparison.Ordinal)) : 0;
            var request = new DuctApplyRequest(null, [], [], [], [], [], [], new DuctLossStore {
                Roles = new() { [target.UniqueId] = new DuctRoleRecord("passive", DateTimeOffset.UnixEpoch) }
            });

            var preview = DuctApplier.Apply(document, request, true);
            Assert.Multiple(() => {
                Assert.That(preview.Replacement, Is.EqualTo(replacement));
                Assert.That(DuctApplier.ReadStore(document).Store, Is.Null);
                Assert.That(preview.Writes.Single(w => w.Kind == "store").Outcome, Is.EqualTo("planned"));
                Assert.That(Raw(document, owner), Is.EqualTo(raw));
                Assert.That(File.Exists(backup), Is.False);
                Assert.That(NoticeCount(), Is.Zero);
            });

            Assert.That(DuctApplier.Apply(document, request, false).Writes.Single(w => w.Kind == "store").Reason,
                Does.Contain("Preview before"));
            var changed = raw.Replace("\"fan\"", "\"passive\"");
            Plant(document, changed);
            var sealedRequest = request with { Replacement = preview.Replacement };
            Assert.That(DuctApplier.Apply(document, sealedRequest, false).Writes.Single(w => w.Kind == "store").Outcome, Is.EqualTo("refused"));
            Assert.That(Raw(document, owner), Is.EqualTo(changed));
            Assert.That(Directory.GetFileSystemEntries(state), Is.Empty);
            Plant(document, raw);
            Directory.CreateDirectory(notices);
            using (var transaction = new Transaction(document, "Force a recovery notice failure")) {
                _ = transaction.Start();
                Assert.That(() => OwnerBlobStore.Write(document, owner, request.Store.ToData(), replacement), Throws.Exception);
                Assert.That(Raw(document, owner), Is.EqualTo(raw));
                _ = transaction.RollBack();
            }
            Directory.Delete(notices);
            Assert.That(File.ReadAllBytes(backup), Is.EqualTo(Encoding.UTF8.GetBytes(raw)));

            foreach (var retry in new[] { false, true }) {
                if (retry) Plant(document, raw);
                var result = DuctApplier.Apply(document, sealedRequest, false);
                Assert.Multiple(() => {
                    Assert.That(result.Writes.Single(w => w.Kind == "store").Outcome, Is.EqualTo("written"));
                    var role = result.Writes.Single(w => w.Kind == "role");
                    Assert.That((role.Id, role.UniqueId), Is.EqualTo(((long?)target.Id.Value(), target.UniqueId)));
                    Assert.That(DuctApplier.ReadStore(document).Store!.Roles.Keys, Is.EqualTo(new[] { target.UniqueId }));
                    Assert.That(File.ReadAllBytes(backup), Is.EqualTo(Encoding.UTF8.GetBytes(raw)));
                    Assert.That(Directory.GetFiles(recovery, replacement.RawUtf8Sha256 + "*"), Is.EqualTo(new[] { backup }));
                    Assert.That(NoticeCount(), Is.EqualTo(1));
                });
            }
            var other = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
            try {
                Plant(other, raw);
                var otherRequest = request with { Store = new DuctLossStore() };
                var otherPreview = DuctApplier.Apply(other, otherRequest, true);
                var applied = DuctApplier.Apply(other, otherRequest with { Replacement = otherPreview.Replacement }, false);
                Assert.That(applied.Writes.Single(w => w.Kind == "store").Outcome, Is.EqualTo("written"));
                Assert.That(NoticeCount(), Is.EqualTo(2));
                var places = File.ReadLines(notices).Select(line => (string?)JObject.Parse(line)["place"]).ToList();
                Assert.That(places, Is.EquivalentTo(new[] { $"{document.GetDocumentKey()} / {owner.Owner}", $"{other.GetDocumentKey()} / {owner.Owner}" }));
                Assert.That(Directory.GetFiles(recovery), Is.EqualTo(new[] { backup }));
            } finally {
                RevitFamilyFixtureHarness.CloseDocument(other);
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [Test]
    public void AutoTag_save_recovers_once_and_element_writes_enforce_the_seal(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        using var isolated = new OwnerBlobRecoveryFixture();
        try {
            var owner = AutoTagSettings.Owner;
            var anchor = document.ProjectInformation;
            const string raw = """{"owner":"autotag","version":1,"data":{"unknownAutoTagField":true}}""";
            var settings = new AutoTagSettings { Enabled = false };
            OwnerBlobReplacement evidence;
            using (var transaction = new Transaction(document, "Plant unreadable AutoTag settings")) {
                _ = transaction.Start();
                _ = SharedParameterBinder.EnsureProjectBinding(document, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                document.Regenerate();
                Assert.That(anchor.get_Parameter(owner.Guid).Set(raw), Is.True);
                evidence = OwnerBlobStore.Read(anchor, owner).Replacement!;
                Assert.That(evidence, Is.Not.Null);
                Assert.That(() => OwnerBlobStore.Write(anchor, owner, settings.ToData()),
                    Throws.InvalidOperationException.With.Message.Contains("Preview before"));
                Assert.That(Raw(document, owner), Is.EqualTo(raw));
                Assert.That(Directory.GetFileSystemEntries(isolated.Root), Is.Empty);
                _ = transaction.Commit();
            }

            AutoTagService.Instance.SaveSettingsForDocument(document, settings);
            AutoTagService.Instance.SaveSettingsForDocument(document, settings);
            var recovery = Path.Combine(isolated.Root, "model-recovery", "owner-autotag");
            Assert.That(File.ReadAllBytes(Directory.GetFiles(recovery).Single()), Is.EqualTo(Encoding.UTF8.GetBytes(raw)));
            var notices = Path.Combine(isolated.Root, ProductPathNames.StoredNoticesFileName);
            Assert.That(File.ReadAllLines(notices), Has.Length.EqualTo(1));
            var readable = OwnerBlobStore.Read(anchor, owner);
            Assert.That(readable.Status, Is.EqualTo(OwnerBlobStatus.Ok));
            Assert.That(AutoTagSettings.Read(readable).Value?.Enabled, Is.False);

            using var edit = new Transaction(document, "Check the sealed element writer");
            _ = edit.Start();
            Assert.That(() => OwnerBlobStore.Write(anchor, owner, settings.ToData(), readable.DataRefused("claimed unreadable")),
                Throws.InvalidOperationException.With.Message.Contains("is readable"));
            Assert.That(anchor.get_Parameter(owner.Guid).Set(raw), Is.True);
            Assert.That(OwnerBlobStore.Write(anchor, owner, settings.ToData(), evidence), Is.True);
            Assert.That(File.ReadAllLines(notices), Has.Length.EqualTo(1));
            _ = edit.RollBack();
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    private static void RefusesAndKeeps(Application application, OwnerBlobStatus expected, Func<OwnerDescriptor, string> plant) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        string? path = null;
        try {
            Assert.That(document.IsWorkshared, Is.False, "Writes require a disposable non-workshared document");
            using (var transaction = new Transaction(document, "Plant blobs this build cannot read")) {
                _ = transaction.Start();
                foreach (var owner in ProjectOwners)
                    _ = SharedParameterBinder.EnsureProjectBinding(document, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                document.Regenerate();
                foreach (var owner in ProjectOwners)
                    Assert.That(document.ProjectInformation.get_Parameter(owner.Guid).Set(plant(owner)), Is.True, owner.Name);
                _ = transaction.Commit();
            }

            // "Opens": the planted model is saved, closed and opened again before anything reads it.
            (document, path) = SaveCloseReopen(application, document);
            var storage = new ParameterLinksProfileStorage();

            Assert.Multiple(() => {
                foreach (var owner in ProjectOwners)
                    Assert.That(OwnerBlobStore.Read(document, owner).Status, Is.EqualTo(expected), owner.Name);
                Assert.That(DuctApplier.ReadStore(document).Error, Is.Not.Null);
                Assert.That(storage.Read(document).Error, Is.Not.Null);
                Assert.That(() => TakeoffCarriers.ReadRegistry(document), Throws.InvalidOperationException);
                Assert.That(EnclosureDeclaration.Read(document).Source, Does.StartWith("default:").And.Contain("unreadable"));
                // The keep policy for reads (ADR 0039): the refusal is a value, so a listing goes on.
                Assert.That(TakeoffCarriers.TryReadRegistry(document).Refusal, Does.Contain("unreadable"));
                Assert.That(AutoTagService.Instance.GetStatus(document).StoredSettingsRefusal, Does.Contain("unreadable"));
                Assert.That(() => TakeoffAtlas.Snapshot(document, new TakeoffReadRequest()).Unreadable!.Select(blob => blob.ElementId),
                    Is.EqualTo(new long?[] { null }), "the roster read reports the registry and does not throw");
            });

            Assert.Multiple(() => {
                foreach (var owner in ProjectOwners)
                    Assert.That(Raw(document, owner), Is.EqualTo(plant(owner)), $"{owner.Name} bytes are unchanged");
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (path != null) File.Delete(path);
        }
    }
}

internal sealed class OwnerBlobRecoveryFixture : IDisposable {
    private readonly string? _previous = OwnerBlobStore.RecoveryStateOverride.Value;
    public string Root { get; } = Directory.CreateTempSubdirectory("pe-revit-owner-recovery-").FullName;

    public OwnerBlobRecoveryFixture() => OwnerBlobStore.RecoveryStateOverride.Value = this.Root;

    public void Dispose() {
        OwnerBlobStore.RecoveryStateOverride.Value = this._previous;
        Directory.Delete(this.Root, recursive: true);
    }
}
