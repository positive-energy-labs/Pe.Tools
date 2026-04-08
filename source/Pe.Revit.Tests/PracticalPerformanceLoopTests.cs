using Pe.Tools.Benchmarks;

namespace Pe.Revit.Tests;

[TestFixture]
[Category("Performance")]
[Explicit("Practical Revit performance loops. Runs repeated open/action/close benchmarks against generic staged documents.")]
public sealed class PracticalPerformanceLoopTests {
    private Autodesk.Revit.ApplicationServices.Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) {
        _dbApplication = uiApplication?.Application
            ?? throw new InvalidOperationException("ricaun.RevitTest did not provide a UIApplication.");
    }

    [Test]
    public void FF_manager_roundtrip_can_repeat_on_staged_generic_family_document() {
        var summary = PracticalBenchmarks.RunFamilyFoundryRoundtrip(_dbApplication, log: TestContext.Progress.WriteLine);
        Assert.That(summary.IterationCount, Is.EqualTo(PracticalBenchmarks.DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.PostProcessParameterCount > 0), Is.True);
    }

    [Test]
    public void Loaded_families_matrix_can_repeat_on_staged_project_document() {
        var summary = PracticalBenchmarks.RunLoadedFamiliesMatrix(_dbApplication, log: TestContext.Progress.WriteLine);
        Assert.That(summary.IterationCount, Is.EqualTo(PracticalBenchmarks.DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.FamilyCount > 0), Is.True);
        Assert.That(summary.Iterations.All(iteration => iteration.Result.VisibleParameterCount > 0), Is.True);
    }

    [Test]
    public void FF_migrator_style_queue_can_repeat_on_staged_project_document() {
        var summary = PracticalBenchmarks.RunFamilyFoundryMigratorQueue(_dbApplication, log: TestContext.Progress.WriteLine);
        Assert.That(summary.IterationCount, Is.EqualTo(PracticalBenchmarks.DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.ContextCount > 0), Is.True);
        Assert.That(summary.Iterations.All(iteration => iteration.Result.OutputFamilyCount > 0), Is.True);
    }

    [Test]
    public void Parameter_assignment_paths_can_repeat_on_staged_family_document() {
        var summary = PracticalBenchmarks.RunParameterAssignmentPaths(_dbApplication, log: TestContext.Progress.WriteLine);
        Assert.That(summary.IterationCount, Is.EqualTo(PracticalBenchmarks.DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.GlobalValueFastPath.HasValue), Is.True);
        Assert.That(summary.Iterations.All(iteration => iteration.Result.PerTypeCoercionPath.HasValue), Is.True);
        TestContext.Progress.WriteLine(ParameterAssignmentBenchmarkResult.FormatSummary(summary));
    }
}
