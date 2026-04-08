using Autodesk.Revit.DB;
using Pe.Shared.StorageRuntime;
using System.Diagnostics;
using System.IO;
using System.Runtime.ExceptionServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Tools.Benchmarks;

internal sealed record BenchmarkDefinition(
    string Id,
    string DisplayName,
    string JsonFileName
);

internal static class PracticalBenchmarkDefinitions {
    public static BenchmarkDefinition FamilyFoundryRoundtrip { get; } = new(
        "ff-manager-roundtrip",
        "FF manager roundtrip",
        "ff-manager-roundtrip.json");

    public static BenchmarkDefinition LoadedFamiliesMatrix { get; } = new(
        "loaded-families-matrix",
        "Loaded families matrix",
        "loaded-families-matrix.json");

    public static BenchmarkDefinition FamilyFoundryMigratorQueue { get; } = new(
        "ff-migrator-queue",
        "FF migrator queue",
        "ff-migrator-queue.json");

    public static BenchmarkDefinition ParameterAssignmentPaths { get; } = new(
        "parameter-assignment-paths",
        "Parameter assignment paths",
        "parameter-assignment-paths.json");
}

internal static class BenchmarkHarness {
    public static BenchmarkLoopResult<TResult> RunDocumentLoop<TResult>(
        Autodesk.Revit.ApplicationServices.Application application,
        string benchmarkName,
        int iterations,
        string documentPath,
        Func<int, Document, TResult> performAction,
        Action<string>? log = null
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
            (_, document) => {
                if (document.IsValidObject)
                    document.Close(false);
            },
            log);
    }

    public static BenchmarkLoopResult<TResult> RunLoop<TResource, TResult>(
        string benchmarkName,
        int iterations,
        Func<int, TResource> openResource,
        Func<int, TResource, TResult> performAction,
        Action<int, TResource> closeResource,
        Action<string>? log = null
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

            log?.Invoke(
                $"[{benchmarkName}] Iteration {iteration}/{iterations}: OpenMs={openMs:F0}, ActionMs={actionMs:F0}, CloseMs={closeMs:F0}, TotalMs={totalStopwatch.Elapsed.TotalMilliseconds:F0}");
        }

        var loopResult = new BenchmarkLoopResult<TResult>(benchmarkName, iterationResults);
        log?.Invoke(loopResult.FormatSummary());
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
    public int IterationCount => this.Iterations.Count;
    public double AverageOpenMs => this.Iterations.Average(iteration => iteration.OpenMs);
    public double AverageActionMs => this.Iterations.Average(iteration => iteration.ActionMs);
    public double AverageCloseMs => this.Iterations.Average(iteration => iteration.CloseMs);
    public double AverageTotalMs => this.Iterations.Average(iteration => iteration.TotalMs);

    public BenchmarkIterationResult<TResult> FastestActionIteration =>
        this.Iterations.OrderBy(iteration => iteration.ActionMs).First();

    public BenchmarkIterationResult<TResult> SlowestActionIteration =>
        this.Iterations.OrderByDescending(iteration => iteration.ActionMs).First();

    public string FormatSummary() =>
        $"[{this.Name}] Summary: Iterations={this.IterationCount}, AvgActionMs={this.AverageActionMs:F0}, AvgTotalMs={this.AverageTotalMs:F0}, FastestActionMs={this.FastestActionIteration.ActionMs:F0}, SlowestActionMs={this.SlowestActionIteration.ActionMs:F0}";
}

internal sealed record BenchmarkResultArtifact<TResult>(
    string BenchmarkId,
    string DisplayName,
    string BenchmarkName,
    string RunId,
    string AppVersion,
    string RevitYear,
    string Status,
    DateTimeOffset GeneratedAtUtc,
    string? Error,
    BenchmarkSummaryArtifact? Summary,
    IReadOnlyList<BenchmarkIterationArtifact<TResult>> Iterations
);

internal sealed record BenchmarkSummaryArtifact(
    int IterationCount,
    double AverageOpenMs,
    double AverageActionMs,
    double AverageCloseMs,
    double AverageTotalMs,
    double FastestActionMs,
    double SlowestActionMs
) {
    public static BenchmarkSummaryArtifact Create<TResult>(BenchmarkLoopResult<TResult> summary) =>
        new(
            summary.IterationCount,
            summary.AverageOpenMs,
            summary.AverageActionMs,
            summary.AverageCloseMs,
            summary.AverageTotalMs,
            summary.FastestActionIteration.ActionMs,
            summary.SlowestActionIteration.ActionMs);
}

internal sealed record BenchmarkIterationArtifact<TResult>(
    int Iteration,
    double OpenMs,
    double ActionMs,
    double CloseMs,
    double TotalMs,
    TResult Result
);

internal sealed record BenchmarkRunMetadataArtifact(
    string RunId,
    DateTimeOffset GeneratedAtUtc,
    string OutputDirectory,
    string EntryPoint,
    string AppVersion,
    string RevitYear,
    string MachineName,
    string OperatingSystem,
    string SetupExpectation,
    IReadOnlyList<string> Benchmarks
);

internal sealed record BenchmarkRunSummaryEntry(
    string BenchmarkId,
    string DisplayName,
    string Status,
    string ArtifactPath,
    double? AverageActionMs,
    double? AverageTotalMs,
    string? Error
);

internal sealed record PracticalBenchmarkRunResult(
    string OutputDirectory,
    IReadOnlyList<BenchmarkRunSummaryEntry> Benchmarks
) {
    public bool HasFailures => this.Benchmarks.Any(benchmark =>
        string.Equals(benchmark.Status, "Failed", StringComparison.OrdinalIgnoreCase));
}

internal static class BenchmarkArtifactWriter {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };

    public static void WriteReadme(OutputStorage taskOutput) {
        if (taskOutput == null)
            throw new ArgumentNullException(nameof(taskOutput));

        var readmePath = Path.Combine(taskOutput.DirectoryPath, "README.txt");
        var content = string.Join(Environment.NewLine, [
            "Practical benchmark task",
            string.Empty,
            "1. Install the matching Pe.Tools MSI.",
            "2. Open Revit.",
            "3. Run Task Palette.",
            "4. Execute 'Run Practical Benchmarks'.",
            "5. Inspect the newest practical-benchmarks_* run folder for JSON artifacts and run-summary.txt.",
            string.Empty
        ]);
        File.WriteAllText(readmePath, content);
    }

    public static string WriteRunMetadata(OutputStorage runOutput, BenchmarkRunMetadataArtifact metadata) {
        if (runOutput == null)
            throw new ArgumentNullException(nameof(runOutput));
        if (metadata == null)
            throw new ArgumentNullException(nameof(metadata));

        var metadataPath = Path.Combine(runOutput.DirectoryPath, "run-metadata.json");
        WriteJson(metadataPath, metadata);
        return metadataPath;
    }

    public static BenchmarkRunSummaryEntry WriteBenchmarkResult<TResult>(
        OutputStorage runOutput,
        BenchmarkDefinition definition,
        string benchmarkName,
        BenchmarkRunMetadataArtifact metadata,
        BenchmarkLoopResult<TResult> summary
    ) {
        if (runOutput == null)
            throw new ArgumentNullException(nameof(runOutput));
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));
        if (metadata == null)
            throw new ArgumentNullException(nameof(metadata));
        if (summary == null)
            throw new ArgumentNullException(nameof(summary));

        var artifact = new BenchmarkResultArtifact<TResult>(
            definition.Id,
            definition.DisplayName,
            benchmarkName,
            metadata.RunId,
            metadata.AppVersion,
            metadata.RevitYear,
            "Passed",
            DateTimeOffset.UtcNow,
            null,
            BenchmarkSummaryArtifact.Create(summary),
            summary.Iterations
                .Select(iteration => new BenchmarkIterationArtifact<TResult>(
                    iteration.Iteration,
                    iteration.OpenMs,
                    iteration.ActionMs,
                    iteration.CloseMs,
                    iteration.TotalMs,
                    iteration.Result))
                .ToArray());

        var artifactPath = Path.Combine(runOutput.DirectoryPath, definition.JsonFileName);
        WriteJson(artifactPath, artifact);

        return new BenchmarkRunSummaryEntry(
            definition.Id,
            definition.DisplayName,
            "Passed",
            artifactPath,
            summary.AverageActionMs,
            summary.AverageTotalMs,
            null);
    }

    public static BenchmarkRunSummaryEntry WriteBenchmarkFailure(
        OutputStorage runOutput,
        BenchmarkDefinition definition,
        string benchmarkName,
        BenchmarkRunMetadataArtifact metadata,
        Exception exception
    ) {
        if (runOutput == null)
            throw new ArgumentNullException(nameof(runOutput));
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));
        if (metadata == null)
            throw new ArgumentNullException(nameof(metadata));
        if (exception == null)
            throw new ArgumentNullException(nameof(exception));

        var artifact = new BenchmarkResultArtifact<object>(
            definition.Id,
            definition.DisplayName,
            benchmarkName,
            metadata.RunId,
            metadata.AppVersion,
            metadata.RevitYear,
            "Failed",
            DateTimeOffset.UtcNow,
            exception.ToString(),
            null,
            []);

        var artifactPath = Path.Combine(runOutput.DirectoryPath, definition.JsonFileName);
        WriteJson(artifactPath, artifact);

        return new BenchmarkRunSummaryEntry(
            definition.Id,
            definition.DisplayName,
            "Failed",
            artifactPath,
            null,
            null,
            exception.Message);
    }

    public static string WriteRunSummary(
        OutputStorage runOutput,
        BenchmarkRunMetadataArtifact metadata,
        IReadOnlyList<BenchmarkRunSummaryEntry> entries
    ) {
        if (runOutput == null)
            throw new ArgumentNullException(nameof(runOutput));
        if (metadata == null)
            throw new ArgumentNullException(nameof(metadata));
        if (entries == null)
            throw new ArgumentNullException(nameof(entries));

        var summaryPath = Path.Combine(runOutput.DirectoryPath, "run-summary.txt");
        var builder = new StringBuilder()
            .AppendLine("Practical benchmark run summary")
            .AppendLine($"RunId: {metadata.RunId}")
            .AppendLine($"GeneratedAtUtc: {metadata.GeneratedAtUtc:O}")
            .AppendLine($"RevitYear: {metadata.RevitYear}")
            .AppendLine($"AppVersion: {metadata.AppVersion}")
            .AppendLine($"OutputDirectory: {metadata.OutputDirectory}")
            .AppendLine();

        foreach (var entry in entries) {
            var metrics = entry.AverageActionMs.HasValue && entry.AverageTotalMs.HasValue
                ? $"avgActionMs={entry.AverageActionMs.Value:F1}, avgTotalMs={entry.AverageTotalMs.Value:F1}"
                : $"error={entry.Error}";
            _ = builder.AppendLine($"{entry.BenchmarkId}: {entry.Status} | {metrics}");
        }

        File.WriteAllText(summaryPath, builder.ToString());
        return summaryPath;
    }

    private static void WriteJson<T>(string path, T value) =>
        File.WriteAllText(path, JsonSerializer.Serialize(value, JsonOptions) + Environment.NewLine);
}
