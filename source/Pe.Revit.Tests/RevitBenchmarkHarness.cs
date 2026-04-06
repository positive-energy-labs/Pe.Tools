using System.Diagnostics;
using System.Runtime.ExceptionServices;

namespace Pe.Revit.Tests;

internal static class RevitBenchmarkHarness {
    public static BenchmarkLoopResult<TResult> RunDocumentLoop<TResult>(
        Autodesk.Revit.ApplicationServices.Application application,
        string benchmarkName,
        int iterations,
        string documentPath,
        Func<int, Document, TResult> performAction
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (string.IsNullOrWhiteSpace(documentPath))
            throw new ArgumentException("Document path is required.", nameof(documentPath));

        return RunLoop(
            benchmarkName,
            iterations,
            _ => application.OpenDocumentFile(documentPath)
                 ?? throw new InvalidOperationException($"Failed to open document '{documentPath}'."),
            performAction,
            (_, document) => RevitFamilyFixtureHarness.CloseDocument(document));
    }

    public static BenchmarkLoopResult<TResult> RunLoop<TResource, TResult>(
        string benchmarkName,
        int iterations,
        Func<int, TResource> openResource,
        Func<int, TResource, TResult> performAction,
        Action<int, TResource> closeResource
    ) {
        if (string.IsNullOrWhiteSpace(benchmarkName))
            throw new ArgumentException("Benchmark name is required.", nameof(benchmarkName));
        if (iterations <= 0)
            throw new ArgumentOutOfRangeException(nameof(iterations), iterations, "Iterations must be greater than zero.");
        if (openResource == null)
            throw new ArgumentNullException(nameof(openResource));
        if (performAction == null)
            throw new ArgumentNullException(nameof(performAction));
        if (closeResource == null)
            throw new ArgumentNullException(nameof(closeResource));

        var iterationResults = new List<BenchmarkIterationResult<TResult>>(iterations);

        for (var iteration = 1; iteration <= iterations; iteration++) {
            TResource? resource = default;
            var hasResource = false;
            var openMs = 0d;
            var actionMs = 0d;
            var closeMs = 0d;
            TResult? actionResult = default;
            Exception? failure = null;
            var totalStopwatch = Stopwatch.StartNew();

            try {
                var openStopwatch = Stopwatch.StartNew();
                resource = openResource(iteration);
                openStopwatch.Stop();
                openMs = openStopwatch.Elapsed.TotalMilliseconds;
                hasResource = true;

                var actionStopwatch = Stopwatch.StartNew();
                actionResult = performAction(iteration, resource);
                actionStopwatch.Stop();
                actionMs = actionStopwatch.Elapsed.TotalMilliseconds;
            } catch (Exception ex) {
                failure = ex;
            } finally {
                if (hasResource) {
                    try {
                        var closeStopwatch = Stopwatch.StartNew();
                        closeResource(iteration, resource!);
                        closeStopwatch.Stop();
                        closeMs = closeStopwatch.Elapsed.TotalMilliseconds;
                    } catch (Exception closeEx) {
                        failure ??= closeEx;
                    }
                }

                totalStopwatch.Stop();
            }

            if (failure != null)
                ExceptionDispatchInfo.Capture(failure).Throw();

            var iterationResult = new BenchmarkIterationResult<TResult>(
                iteration,
                openMs,
                actionMs,
                closeMs,
                totalStopwatch.Elapsed.TotalMilliseconds,
                actionResult!);
            iterationResults.Add(iterationResult);

            TestContext.Progress.WriteLine(
                $"[{benchmarkName}] Iteration {iteration}/{iterations}: OpenMs={openMs:F0}, ActionMs={actionMs:F0}, CloseMs={closeMs:F0}, TotalMs={totalStopwatch.Elapsed.TotalMilliseconds:F0}");
        }

        var loopResult = new BenchmarkLoopResult<TResult>(benchmarkName, iterationResults);
        TestContext.Progress.WriteLine(loopResult.FormatSummary());
        return loopResult;
    }
}

internal sealed record BenchmarkIterationResult<TResult>(
    int Iteration,
    double OpenMs,
    double ActionMs,
    double CloseMs,
    double TotalMs,
    TResult Result
);

internal sealed record BenchmarkLoopResult<TResult>(
    string Name,
    IReadOnlyList<BenchmarkIterationResult<TResult>> Iterations
) {
    public BenchmarkIterationResult<TResult> FastestActionIteration =>
        this.Iterations.OrderBy(iteration => iteration.ActionMs).First();

    public BenchmarkIterationResult<TResult> SlowestActionIteration =>
        this.Iterations.OrderByDescending(iteration => iteration.ActionMs).First();

    public double AverageActionMs => this.Iterations.Average(iteration => iteration.ActionMs);
    public double AverageTotalMs => this.Iterations.Average(iteration => iteration.TotalMs);

    public string FormatSummary() =>
        $"[{this.Name}] Summary: Iterations={this.Iterations.Count}, AvgActionMs={this.AverageActionMs:F0}, AvgTotalMs={this.AverageTotalMs:F0}, FastestActionMs={this.FastestActionIteration.ActionMs:F0}, SlowestActionMs={this.SlowestActionIteration.ActionMs:F0}";
}
