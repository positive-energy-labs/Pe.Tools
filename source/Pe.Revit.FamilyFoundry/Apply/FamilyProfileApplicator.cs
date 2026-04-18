using Autodesk.Revit.DB;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.FamilyFoundry.Apply;

public static class FamilyProfileApplicator {
    public static FamilyProfileApplyResult ApplyProfile(
        Document doc,
        OperationQueue queue,
        object profilePayload,
        string profileName,
        SnapshotCapturePipeline? capturePipeline,
        LoadAndSaveOptions finishSettings,
        OutputStorage? runOutput,
        ExecutionOptions executionOptions
    ) {
        if (doc == null)
            return new FamilyProfileApplyResult(false, "No document provided.", [], 0, null);

        try {
            var resultBuilder = runOutput == null
                ? null
                : new ProcessingResultBuilder(runOutput)
                    .WithCustomProfile(profilePayload, profileName)
                    .WithOperationMetadata(queue);
            using var processor = new OperationProcessor(doc, executionOptions);
            if (resultBuilder != null)
                _ = processor.WithArtifactWriter(resultBuilder, finishSettings.OpenOutputFilesOnCommandFinish);
            var logs = processor
                .SelectFamilies(() => null)
                .ProcessQueue(queue, capturePipeline, runOutput?.DirectoryPath, finishSettings);

            if (resultBuilder != null)
                resultBuilder.WriteMultiFamilySummary(logs.totalMs, finishSettings.OpenOutputFilesOnCommandFinish);

            var errors = logs.contexts
                .Select(context => context.OperationLogs.AsTuple().error)
                .Where(error => error != null)
                .ToList();

            return new FamilyProfileApplyResult(
                errors.Count == 0,
                errors.FirstOrDefault()?.Message,
                logs.contexts,
                logs.totalMs,
                runOutput?.DirectoryPath
            );
        } catch (Exception ex) {
            return new FamilyProfileApplyResult(false, ex.Message, [], 0, runOutput?.DirectoryPath);
        }
    }

    public static FamilyMigrationApplyResult ApplyMigrationProfile(
        Document doc,
        OperationQueue queue,
        object profilePayload,
        string profileName,
        Func<List<Family>> familySelector,
        SnapshotCapturePipeline? capturePipeline,
        LoadAndSaveOptions finishSettings,
        OutputStorage? runOutput,
        ExecutionOptions executionOptions
    ) {
        if (doc == null)
            return new FamilyMigrationApplyResult(false, "No document.", null, [], 0, 0);

        try {
            var resultBuilder = runOutput == null
                ? null
                : new ProcessingResultBuilder(runOutput)
                    .WithCustomProfile(profilePayload, profileName)
                    .WithOperationMetadata(queue);

            using var processor = new OperationProcessor(doc, executionOptions);
            if (resultBuilder != null)
                _ = processor.WithArtifactWriter(resultBuilder, finishSettings.OpenOutputFilesOnCommandFinish);
            var logs = processor
                .SelectFamilies(familySelector)
                .ProcessQueue(queue, capturePipeline, resultBuilder?.RunOutputPath, finishSettings);

            if (resultBuilder != null) {
                resultBuilder.WriteMultiFamilySummary(logs.totalMs, finishSettings.OpenOutputFilesOnCommandFinish);
            }

            var processedFamilyNames = logs.contexts
                .Select(context => context.FamilyName)
                .Where(name => !string.IsNullOrWhiteSpace(name) &&
                               !string.Equals(name, "ERROR", StringComparison.OrdinalIgnoreCase))
                .ToList();
            var errors = logs.contexts
                .Select(context => context.OperationLogs.AsTuple().error)
                .Where(error => error != null)
                .ToList();
            var hasErrors = errors.Count > 0;

            return new FamilyMigrationApplyResult(
                !hasErrors,
                hasErrors ? errors.FirstOrDefault()?.Message ?? "Processing completed with errors." : null,
                resultBuilder?.RunOutputPath,
                processedFamilyNames,
                logs.totalMs,
                logs.contexts.Count
            );
        } catch (Exception ex) {
            return new FamilyMigrationApplyResult(false, ex.Message, runOutput?.DirectoryPath, [], 0, 0);
        }
    }
}

public sealed record FamilyProfileApplyResult(
    bool Success,
    string? Error,
    List<FamilyProcessingContext> Contexts,
    double TotalMs,
    string? OutputFolderPath
);

public sealed record FamilyMigrationApplyResult(
    bool Success,
    string? Error,
    string? OutputFolderPath,
    List<string> ProcessedFamilyNames,
    double TotalMs,
    int FamilyCount
);
