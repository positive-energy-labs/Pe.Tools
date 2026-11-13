using Autodesk.Revit.DB.Events;
using Newtonsoft.Json;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Operations;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

/// <summary>
///     Effect is the scope (ADR 0042, routes map slice 3), on real Revit. Three falsifiers:
///     a handler with no scope that commits fails with <c>touched: unauthorized</c>; each synchronous TransactRead op
///     run once leaves no change the runner calls unauthorized; and when "PE restore crop" fails the answer names the
///     view left cropped. Every call goes through <see cref="OpRunner" />, the one the bridge uses.
/// </summary>
[TestFixture]
public sealed class OpScopeProofTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) {
        this._ui = ui;
        OperationMonitor.Attach(ui.Application);
        _ = OpRegistry.RegisterFromLoadedPeAssemblies();
        _ = OpRegistry.RegisterFrom(typeof(OpScopeProofTests).Assembly, typeof(Pe.App.Host.FamilyVerifyBridgeOps).Assembly);
        _ = OpRegistry.Bind(new RevitDataRequestService());
    }

    public sealed record Committed(long LevelId);

    private static Committed CommitLevel(Document document) {
        using var transaction = new Transaction(document, "Mutant commits a level");
        _ = transaction.Start();
        var level = Level.Create(document, 42);
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return new Committed(level.Id.Value());
    }

    // The mutant: no scope in the signature, so the catalog calls it a Read, and it commits anyway.
    [Op("test.scope.mutant-read", OpSubject.None, OpTouches.Metadata, Does = "Commit a level with no scope.", IsPublic = false, Thread = OpThread.Revit)]
    private static Committed MutantRead(NoRequest _, ProjectDocument document) => CommitLevel(document.Value);

    // The control: the same commit under a ModelWrite scope.
    [Op("test.scope.control-write", OpSubject.None, OpTouches.Metadata, Does = "Commit a level under a ModelWrite scope.", Actor = OpActor.Any, IsPublic = false, Thread = OpThread.Revit)]
    private static Committed ControlWrite(NoRequest _, ProjectDocument document, ModelWrite scope) => CommitLevel(document.Value);

    private static OpRun Run(string key, object request, Document document) {
        Assert.That(OpRegistry.TryGet(key, out var op), Is.True, $"{key} is registered");
        var ran = OpRunner.RunAsync(op, JsonConvert.SerializeObject(request, SdkOperations.Json),
            SdkOperations.Wrap(op.Definition.Needs, document), CancellationToken.None).GetAwaiter().GetResult();
        Console.WriteLine($"[PE_OP_SCOPE] {key} effect={op.Definition.Effect} touched={JsonConvert.SerializeObject(ran.Touched)} error={ran.Error?.Message}");
        return ran;
    }

    [Test]
    public void A_handler_with_no_scope_that_commits_fails_unauthorized_and_the_same_commit_under_a_scope_is_a_write() {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(this._ui.Application);
        try {
            var mutant = Run("test.scope.mutant-read", new NoRequest(), doc);
            Assert.Multiple(() => {
                Assert.That(mutant.Touched, Is.InstanceOf<Touched.Unauthorized>());
                Assert.That(mutant.Error, Is.InstanceOf<BridgeOperationException>(), "the call fails");
                Assert.That(mutant.Response, Is.Null, "a failed call returns no payload");
                Assert.That((mutant.Touched as Touched.Unauthorized)?.Transactions, Does.Contain("Mutant commits a level"));
                Assert.That((mutant.Touched as Touched.Unauthorized)?.Added, Is.GreaterThan(0));
            });

            var control = Run("test.scope.control-write", new NoRequest(), doc);
            Assert.Multiple(() => {
                Assert.That(control.Error, Is.Null);
                Assert.That(control.Touched, Is.InstanceOf<Touched.Wrote>());
                Assert.That((control.Touched as Touched.Wrote)?.Transactions, Does.Contain("Mutant commits a level"));
            });
        } finally { doc.Close(false); }
    }

    /// <summary>
    ///     The synchronous TransactRead ops. <c>family.plan</c> and <c>families.plan</c> hop through the palette's
    ///     external event and cannot be awaited from this thread; they are driver rows through the bridge.
    ///     A refusal is a fine outcome here: the claim is only that nothing the runner calls unauthorized was committed.
    /// </summary>
    [Test, Timeout(600000)]
    public void Each_synchronous_transact_read_op_leaves_nothing_unauthorized() {
        var app = this._ui.Application;
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(OpScopeProofTests));
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        var family = RevitFamilyFixtureHarness.CreateFamilyDocument(app, BuiltInCategory.OST_GenericModel, "OpScopeProof");
        try {
            using (var transaction = new Transaction(family, "Seed family type")) {
                _ = transaction.Start();
                _ = family.FamilyManager.NewType("A");
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            var runs = new (string Key, OpRun Ran)[] {
                ("family.look", Run("family.look", new { outDir = Path.Combine(output, "look") }, family)),
                ("family.loadTest", Run("family.loadTest", new { outDir = Path.Combine(output, "load") }, family)),
                ("ducts.heal.preview", Run("ducts.heal.preview", new { groups = Array.Empty<object>() }, project)),
                ("ducts.assign-fan.preview", Run("ducts.assign-fan.preview", new { systemId = 1, unitId = 2 }, project)),
                ("revit.matrix.loaded-families", Run("revit.matrix.loaded-families", new { budget = new { maxEntries = 2 } }, project))
            };
            Assert.Multiple(() => {
                foreach (var (key, ran) in runs)
                    Assert.That(ran.Touched, Is.Not.InstanceOf<Touched.Unauthorized>(), key);
                // The two that are known to commit inside what they discard must say so, not `none`.
                Assert.That(runs[0].Ran.Touched, Is.InstanceOf<Touched.RolledBack>(), "family.look commits inside its rollback group");
                Assert.That(runs[0].Ran.Error, Is.Null, "family.look still answers under the scope's outer group");
                Assert.That(runs[1].Ran.Touched, Is.InstanceOf<Touched.RolledBack>(), "family.loadTest commits only in its scratch project");
                Assert.That(runs[1].Ran.Error, Is.Null, "family.loadTest still answers");
            });
        } finally {
            family.Close(false);
            project.Close(false);
        }
    }

    /// <summary>
    ///     The capture's undo is forced to roll back by a FailuresProcessing handler that acts only on the transaction
    ///     named "PE restore crop". The image must still come back, and both the answer and <c>touched</c> must name
    ///     the view and the crop it was left with. Mutant: restore the throw in SessionWrite.Temporarily and this fails
    ///     with an exception instead of an image.
    /// </summary>
    [Test]
    public void When_the_crop_restore_fails_the_answer_names_the_view_left_cropped() {
        var app = this._ui.Application;
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        var forced = 0;
        void Fail(object? sender, FailuresProcessingEventArgs args) {
            var accessor = args.GetFailuresAccessor();
            if (accessor.GetTransactionName() != "PE restore crop") return;
            forced++;
            accessor.SetFailureHandlingOptions(accessor.GetFailureHandlingOptions().SetClearAfterRollback(true));
            args.SetProcessingResult(FailureProcessingResult.ProceedWithRollBack);
        }
        try {
            var center = new XYZ(1000, 1000, 0);
            ViewPlan view;
            using (var transaction = new Transaction(doc, "Seed plan")) {
                _ = transaction.Start();
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
                view = ViewPlan.Create(doc, planType.Id, level.Id);
                view.ViewTemplateId = ElementId.InvalidElementId;
                foreach (var arm in new[] { new XYZ(3, 0, 0), new XYZ(0, 3, 0) })
                    _ = doc.Create.NewDetailCurve(view, Line.CreateBound(center - arm, center + arm));
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var activeBefore = view.CropBoxActive;
            var box = new BoundingBoxXYZ { Min = center - new XYZ(4, 4, 0), Max = center + new XYZ(4, 4, 1) };
            var scope = new SessionWrite(doc);

            using var suspended = RevitTestFailureGuard.Suspend();
            app.FailuresProcessing += Fail;
            Pe.Shared.RevitData.RevitViewImageData image;
            using var window = OperationMonitor.Watch(scope);
            try { image = RevitViewImageExporter.ExportFocused(doc, view, box, 8, 600, scope); }
            finally { app.FailuresProcessing -= Fail; }

            var touched = OpRunner.Touch(OpEffect.SessionWrite, scope.Facts(), window.Changes, window.Overlapped);
            Console.WriteLine($"[PE_OP_SCOPE] restore-failure forced={forced} restore={JsonConvert.SerializeObject(image.Restore)} touched={JsonConvert.SerializeObject(touched)} changes={JsonConvert.SerializeObject(window.Changes)}");
            Assert.Multiple(() => {
                Assert.That(forced, Is.GreaterThan(0), "the handler reached 'PE restore crop'");
                Assert.That(File.Exists(image.FilePath), Is.True, "the image survives the failed restore");
                Assert.That(image.Restore, Is.Not.Null);
                Assert.That(image.Restore!.Held, Is.False);
                Assert.That(image.Restore.Left, Does.Contain("crop"));
                Assert.That(view.CropBoxActive, Is.Not.EqualTo(activeBefore), "the view really is left cropped");
                Assert.That(touched, Is.InstanceOf<Touched.RestoreFailed>());
                var left = (touched as Touched.RestoreFailed)?.Views.Single();
                Assert.That(left?.View.UniqueId, Is.EqualTo(view.UniqueId));
                Assert.That(left?.View.Id, Is.EqualTo(view.Id.Value()));
                Assert.That(left?.Left, Does.Contain(ViewLeftover.Crop));
            });
        } finally { doc.Close(false); }
    }
}
