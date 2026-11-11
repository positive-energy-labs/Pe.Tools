using Newtonsoft.Json.Linq;
using Pe.App.Services.AutoTag;
using Pe.Revit.Global.Lib.Mep;
using Pe.Revit.Global.Services.ParameterLinks;
using Pe.Revit.Partition;
using Pe.Revit.SettingsRuntime.Modules.AutoTag;
using Pe.Revit.Takeoff;
using Pe.Shared.RevitData.Ducts;
using Pe.Shared.RevitData.Serialization;
using Pe.Shared.RevitData.Takeoffs;

namespace Pe.Revit.Tests;

/// <summary>
///     The homes slice 2 falsifier (docs/features/homes/MAP.md): on a real model every owner's blob round-trips
///     through the one envelope, and a model that carries a blob this build cannot read opens, refuses the blob and
///     never overwrites its bytes (ADR 0026 D4). The codec itself is proven in Pe.Shared.Tests' OwnerBlobTests.
///     Not covered here: the duct per-fitting results entity needs a fitting on the Pe loss server; its text is the
///     same codec, and the duct apply proofs write and read it.
/// </summary>
[TestFixture]
public sealed class OwnerBlobRoundTripTests {
    private static readonly OwnerDescriptor[] ProjectOwners = [
        AutoTagService.Owner, ParameterLinkProfile.Owner, DuctLossStore.Owner, SystemRegistry.Owner,
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
                TakeoffCarriers.WriteProvenance(region, new RegionProvenance(1, zoneGuid, "run-1", "R01", 100).ToJson());
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
                    Assert.That(RegionProvenance.FromJson(TakeoffCarriers.ReadProvenance(region)!).ZoneGuid, Is.EqualTo(zoneGuid));
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
    public void A_future_version_blob_opens_is_refused_and_is_never_overwritten(UIApplication uiApplication) =>
        RefusesAndKeeps(uiApplication.Application, OwnerBlobStatus.UnknownVersion,
            owner => $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version + 998}}},"data":{"fromTheFuture":true}}""");

    [Test]
    public void An_old_unenveloped_blob_opens_is_refused_and_is_never_overwritten(UIApplication uiApplication) =>
        RefusesAndKeeps(uiApplication.Application, OwnerBlobStatus.Invalid,
            _ => """{"version":1,"enabled":true,"workRevision":2,"Systems":[]}""");

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
                Assert.That(() => TakeoffCarriers.ReadProvenance(planted), Throws.InvalidOperationException);
                Assert.That(EnclosureDeclaration.Read(document).Source, Does.StartWith("default:").And.Contain("refused and kept"));
            });

            // Every owner's own write door, and the store under all of them, refuses.
            using (var transaction = new Transaction(document, "Try to overwrite")) {
                _ = transaction.Start();
                Assert.Multiple(() => {
                    foreach (var owner in ProjectOwners)
                        Assert.That(() => OwnerBlobStore.Write(document, owner, new JObject { ["overwritten"] = true }),
                            Throws.InvalidOperationException.With.Message.Contains("Refusing to overwrite"), owner.Name);
                    Assert.That(() => storage.Write(document, new ParameterLinkProfile { Definitions = [], Assignments = [] }), Throws.InvalidOperationException);
                    Assert.That(() => TakeoffCarriers.WriteRegistry(document, new SystemRegistry()), Throws.InvalidOperationException);
                    Assert.That(() => TakeoffCarriers.WriteProvenance(planted, new RegionProvenance(1, Guid.NewGuid(), "run", "R01", 1).ToJson()),
                        Throws.InvalidOperationException);
                    Assert.That(() => EnclosureDeclaration.Write(document, Enclosure.Default), Throws.InvalidOperationException);
                });
                _ = transaction.Commit();
            }
            Assert.That(() => AutoTagService.Instance.SaveSettingsForDocument(document, new AutoTagSettings()), Throws.InvalidOperationException);
            var apply = DuctApplier.Apply(document,
                new DuctApplyRequest(new DuctParameterSlotOverrides(), [], [], [], [], [], [], new DuctLossStore()), false);
            Assert.That(apply.Writes.Single(write => write.Kind == "store").Outcome, Is.EqualTo("refused"));

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
