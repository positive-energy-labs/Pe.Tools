using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.Tools.Benchmarks;

namespace Pe.App.Tasks;

public sealed class RunPracticalBenchmarksTask : ITask {
    public string Name => "Run Practical Benchmarks";

    public string? Description =>
        "Runs the practical Family Foundry benchmark loops and writes durable JSON and text artifacts into the task output folder.";

    public string? Category => "Testing";

    public async Task ExecuteAsync(UIApplication uiApp) {
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

        await Task.CompletedTask;
    }
}
