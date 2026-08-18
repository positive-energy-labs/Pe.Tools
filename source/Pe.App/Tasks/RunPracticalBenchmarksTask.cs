using Autodesk.Revit.UI;
using Pe.App.Benchmarks;
using Pe.App.Commands.Palette.TaskPalette;

namespace Pe.App.Tasks;

/// <summary>
///     Runbook: install the matching <c>Pe.Tools</c> MSI, open Revit, run <c>Task Palette</c>, and execute
///     <c>Run Practical Benchmarks</c>. Output lands in the <c>CmdPltTasks</c> StorageClient module's output
///     dir under a <c>RunPracticalBenchmarksTask</c> subdir (see <c>TaskOutputExtensions.GetOutput</c>) —
///     one <c>practical-benchmarks_*</c> folder per run holding the per-benchmark JSON files and <c>run-summary.txt</c>.
/// </summary>
public sealed class RunPracticalBenchmarksTask : ITask {
    public string Name => "Run Practical Benchmarks";

    public string? Description =>
        "Runs the practical Family Foundry benchmark loops and writes durable JSON and text artifacts into the task output folder.";

    public string? Category => "Testing";

    public void Execute(UIApplication uiApp) {
        try {
            var taskOutput = this.GetOutput();
            Console.WriteLine("Starting practical benchmarks...");
            Console.WriteLine($"Task output root: {taskOutput.DirectoryPath}");

            var runResult = PracticalBenchmarks.RunAll(uiApp, taskOutput, Console.WriteLine);
            foreach (var benchmark in runResult.Benchmarks)
                Console.WriteLine($"{benchmark.BenchmarkId}: {benchmark.Status} ({benchmark.ArtifactPath})");

            Console.WriteLine(
                runResult.HasFailures
                    ? $"Practical benchmarks completed with failures. Inspect: {runResult.OutputDirectory}"
                    : $"Practical benchmarks completed successfully. Inspect: {runResult.OutputDirectory}");
        } catch (Exception ex) {
            Console.WriteLine($"Practical benchmarks failed: {ex.Message}");
            Console.WriteLine(ex);
        }

    }
}
