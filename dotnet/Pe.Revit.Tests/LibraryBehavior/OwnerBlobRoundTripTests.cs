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

    private static string? Raw(Element element) => element.get_Parameter(TakeoffCarriers.Provenance.Guid)?.AsString();

    private static FilledRegion SeedRegion(Document document) {
        var level = Level.Create(document, 0);
        var planType = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType))
            .Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
        var view = ViewPlan.Create(document, planType.Id, level.Id);
        while (TakeoffCarriers.Preflight(document, TakeoffCarrierStage.Materialization).MissingCarrierGuids.Count > 0)
            TakeoffCarriers.InitializeNext(document, TakeoffCarrierStage.Materialization);
        var type = new FilteredElementCollector(document).OfClass(typeof(FilledRegionType)).FirstElementId();
        List<double[]> square = [[0, 0], [30, 0], [30, 30], [0, 30]];
        return FilledRegion.Create(document, type, view.Id, Kernel.ToLoops(square, [], 0));
    }

    private static (Document Document, string Path) SaveCloseReopen(Application application, Document document) {
        var path = Path.Combine(Path.GetTempPath(), $"pe-owner-blob-{Guid.NewGuid():N}.rvt");
        document.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
        RevitFamilyFixtureHarness.CloseDocument(document);
        return (application.OpenDocumentFile(path), path);
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
            var zoneGuid = Guid.NewGuid();
            var pointer = ProjectHomePointer.Create("Projects/2026-014 Chadds Ford").Pointer!;
            long regionId;
            using (var transaction = new Transaction(document, "Write every owner blob")) {
                _ = transaction.Start();
                Assert.That(OwnerBlobStore.Write(document, DuctLossStore.Owner, new DuctLossStore { WorkRevision = 3 }.ToData()), Is.True);
                Assert.That(storage.Write(document, new ParameterLinkProfile { Definitions = [], Assignments = [] }), Is.True);
                var region = SeedRegion(document);
                regionId = region.Id.Value();
                TakeoffCarriers.WriteRegistry(document, registry);
                TakeoffCarriers.WriteProvenance(region, new RegionProvenance(zoneGuid, "run-1", "R01", 100).ToJson());
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
                    var region = (FilledRegion)doc.GetElement(regionId.ToElementId());
                    Assert.That(Raw(region), Does.StartWith("""{"owner":"takeoff-region","version":1,"data":{"""));
                    Assert.That(TakeoffCarriers.ReadRegion(region).Value!.ZoneGuid, Is.EqualTo(zoneGuid));
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
            long regionId;
            using (var transaction = new Transaction(document, "Plant old un-enveloped blobs")) {
                _ = transaction.Start();
                foreach (var owner in ProjectOwners)
                    _ = SharedParameterBinder.EnsureProjectBinding(document, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                var region = SeedRegion(document);
                regionId = region.Id.Value();
                document.Regenerate();
                foreach (var owner in ProjectOwners)
                    Assert.That(document.ProjectInformation.get_Parameter(owner.Guid).Set(old), Is.True, owner.Name);
                Assert.That(region.get_Parameter(RegionProvenance.Owner.Guid).Set(old), Is.True);
                _ = transaction.Commit();
            }

            (document, path) = SaveCloseReopen(uiApplication.Application, document);
            var planted = (FilledRegion)document.GetElement(regionId.ToElementId());
            var storage = new ParameterLinksProfileStorage();

            // Absent: every owner starts from its defaults, with no error.
            Assert.Multiple(() => {
                foreach (var owner in ProjectOwners)
                    Assert.That(OwnerBlobStore.Read(document, owner).Status, Is.EqualTo(OwnerBlobStatus.Absent), owner.Name);
                Assert.That(DuctApplier.ReadStore(document), Is.EqualTo(((DuctLossStore?)null, (string?)null)));
                Assert.That(storage.Read(document), Is.EqualTo(new ProfileReadResult(null, false, null)));
                Assert.That(TakeoffCarriers.ReadRegistry(document).Systems, Is.Empty);
                Assert.That(TakeoffCarriers.TryReadProvenance(planted), Is.EqualTo(new OwnerValue<string>(null, null)));
                Assert.That(TakeoffCarriers.ReadRegion(planted).Value!.RunId, Is.EqualTo(Rooms.RunDrawn), "no envelope reads as the drawn default");
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
                TakeoffCarriers.WriteProvenance(planted, new RegionProvenance(Guid.NewGuid(), "run-1", "R01", 100).ToJson());
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
                Assert.That(Raw(planted), Does.StartWith("""{"owner":"takeoff-region","version":1,"data":{"""));
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
            void Plant() {
                using var transaction = new Transaction(document, "Plant v2 numeric duct store");
                _ = transaction.Start();
                _ = SharedParameterBinder.EnsureProjectBinding(document, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                document.Regenerate();
                Assert.That(target.get_Parameter(owner.Guid).Set(raw), Is.True);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            Plant();

            var state = ProductRuntimeLayout.Current.State.RootPath;
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

            foreach (var retry in new[] { false, true }) {
                if (retry) Plant();
                var result = DuctApplier.Apply(document, request, false);
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
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    private static void RefusesAndKeeps(Application application, OwnerBlobStatus expected, Func<OwnerDescriptor, string> plant) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        string? path = null;
        try {
            Assert.That(document.IsWorkshared, Is.False, "Writes require a disposable non-workshared document");
            long regionId;
            using (var transaction = new Transaction(document, "Plant blobs this build cannot read")) {
                _ = transaction.Start();
                foreach (var owner in ProjectOwners)
                    _ = SharedParameterBinder.EnsureProjectBinding(document, OwnerBlobStore.Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
                var region = SeedRegion(document);
                regionId = region.Id.Value();
                document.Regenerate();
                foreach (var owner in ProjectOwners)
                    Assert.That(document.ProjectInformation.get_Parameter(owner.Guid).Set(plant(owner)), Is.True, owner.Name);
                Assert.That(region.get_Parameter(TakeoffCarriers.Provenance.Guid).Set(plant(TakeoffCarriers.Provenance)), Is.True);
                _ = transaction.Commit();
            }

            // "Opens": the planted model is saved, closed and opened again before anything reads it.
            (document, path) = SaveCloseReopen(application, document);
            var planted = (FilledRegion)document.GetElement(regionId.ToElementId());
            var storage = new ParameterLinksProfileStorage();

            Assert.Multiple(() => {
                foreach (var owner in ProjectOwners)
                    Assert.That(OwnerBlobStore.Read(document, owner).Status, Is.EqualTo(expected), owner.Name);
                Assert.That(OwnerBlobStore.Read(planted, TakeoffCarriers.Provenance).Status, Is.EqualTo(expected));
                Assert.That(DuctApplier.ReadStore(document).Error, Is.Not.Null);
                Assert.That(storage.Read(document).Error, Is.Not.Null);
                Assert.That(() => TakeoffCarriers.ReadRegistry(document), Throws.InvalidOperationException);
                Assert.That(() => TakeoffCarriers.ReadRegion(planted).OrThrow(), Throws.InvalidOperationException);
                Assert.That(EnclosureDeclaration.Read(document).Source, Does.StartWith("default:").And.Contain("refused and kept"));
                // The keep policy for reads (ADR 0039): the refusal is a value, so a listing goes on.
                Assert.That(TakeoffCarriers.TryReadRegistry(document).Refusal, Does.Contain("refused and kept"));
                Assert.That(TakeoffCarriers.TryReadProvenance(planted).Refusal, Does.Contain("refused and kept"));
                Assert.That(AutoTagService.Instance.GetStatus(document).StoredSettingsRefusal, Does.Contain("refused and kept"));
                Assert.That(() => TakeoffAtlas.Snapshot(document, new TakeoffReadRequest()).Unreadable!.Select(blob => blob.ElementId),
                    Is.EqualTo(new long?[] { null }), "the roster read reports the registry and does not throw");
            });

            Assert.Multiple(() => {
                foreach (var owner in ProjectOwners)
                    Assert.That(Raw(document, owner), Is.EqualTo(plant(owner)), $"{owner.Name} bytes are unchanged");
                Assert.That(Raw(planted), Is.EqualTo(plant(TakeoffCarriers.Provenance)), "the region blob's bytes are unchanged");
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (path != null) File.Delete(path);
        }
    }
}
