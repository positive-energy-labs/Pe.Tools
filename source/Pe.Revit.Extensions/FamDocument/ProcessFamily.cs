using Autodesk.Revit.DB.Events;
using UIFrameworkServices;

namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentProcessFamily {
    public static FamilyDocument GetFamilyDocument(this Document doc) {
        if (doc.IsFamilyDocument) return new FamilyDocument(doc);
        throw new InvalidOperationException("Document is not a family document");
    }

    public static FamilyDocument GetFamilyDocument(this Document doc, Family family) {
        if (doc.IsFamilyDocument) return new FamilyDocument(doc);
        if (family == null) throw new ArgumentNullException(nameof(family));
        var famDoc = doc.EditFamily(family);
        return new FamilyDocument(famDoc);
    }

    /// <summary>
    ///     Ensures the family has at least one type. If no types exist, creates a default type.
    /// </summary>
    public static FamilyDocument EnsureDefaultType(this FamilyDocument famDoc) {
        var fm = famDoc.FamilyManager;

        var emptyNameFamilyType =
            fm.Types.Cast<FamilyType>().FirstOrDefault(type => string.IsNullOrWhiteSpace(type.Name));

        var hasOnlyOneEmptyName = fm.Types.Size == 1 && emptyNameFamilyType != null;
        if (fm.Types.Size != 0 && !hasOnlyOneEmptyName) return famDoc;

        using var trans = new Transaction(famDoc, "Create Default Family Type");
        _ = trans.Start();
        var defaultType = fm.NewType("Default");
        fm.CurrentType = defaultType;
        _ = trans.Commit();

        return famDoc;
    }

    /// <summary>
    ///     Executes callbacks with one transaction per callback, passing optional context and aggregating results.
    ///     This is the core transaction management method - all other processing methods should use this.
    /// </summary>
    public static FamilyDocument Process<TContext, TOutput>(
        this FamilyDocument famDoc,
        TContext context,
        Func<FamilyDocument, TContext, List<TOutput>>[] callbacks,
        out List<TOutput> results,
        IReadOnlyList<string>? transactionNames = null,
        Action<string, IReadOnlyList<(bool IsError, string Message)>>? onCommitDiagnostics = null,
        bool suppressWarnings = false
    ) {
        results = new List<TOutput>();
        for (var callbackIndex = 0; callbackIndex < callbacks.Length; callbackIndex++) {
            var callback = callbacks[callbackIndex];
            var transactionName = callbackIndex < (transactionNames?.Count ?? 0)
                ? transactionNames![callbackIndex]
                : "Execute Operations";
            using var trans = new Transaction(famDoc, transactionName);
            _ = trans.Start();
            var commitDiagnostics = new List<(bool IsError, string Message)>();

            if (suppressWarnings) {
                var failureOptions = trans.GetFailureHandlingOptions();
                failureOptions.SetFailuresPreprocessor(new WarningSuppressingFailuresPreprocessor(commitDiagnostics));
                failureOptions.SetForcedModalHandling(false);
                trans.SetFailureHandlingOptions(failureOptions);
            }

            void OnFailuresProcessing(object? _, FailuresProcessingEventArgs args) {
                var accessor = args.GetFailuresAccessor();
                if (accessor == null || accessor.GetDocument()?.Equals(famDoc.Document) != true)
                    return;

                foreach (var failureMessage in accessor.GetFailureMessages()) {
                    var severity = failureMessage.GetSeverity();
                    if (suppressWarnings && severity == FailureSeverity.Warning)
                        continue;

                    var description = DescribeFailure(failureMessage);
                    commitDiagnostics.Add((severity != FailureSeverity.Warning, description));
                }
            }

            famDoc.Document.Application.FailuresProcessing += OnFailuresProcessing;
            try {
                results.AddRange(callback(famDoc, context));
                _ = trans.Commit();
            } finally {
                famDoc.Document.Application.FailuresProcessing -= OnFailuresProcessing;
            }

            if (commitDiagnostics.Count == 0)
                continue;

            onCommitDiagnostics?.Invoke(
                transactionName,
                commitDiagnostics);
        }

        return famDoc;
    }

    private static string DescribeFailure(FailureMessageAccessor failureMessage) {
        var description = failureMessage.GetDescriptionText();
        var failureGuid = failureMessage.GetFailureDefinitionId().Guid;
        if (string.IsNullOrWhiteSpace(description))
            return failureGuid.ToString();

        return $"{description} [{failureGuid}]";
    }

    private sealed class WarningSuppressingFailuresPreprocessor(
        ICollection<(bool IsError, string Message)> diagnostics
    ) : IFailuresPreprocessor {
        public FailureProcessingResult PreprocessFailures(FailuresAccessor failuresAccessor) {
            foreach (var failureMessage in failuresAccessor.GetFailureMessages()) {
                if (failureMessage.GetSeverity() != FailureSeverity.Warning)
                    continue;

                diagnostics.Add((false, $"Suppressed warning: {DescribeFailure(failureMessage)}"));
                failuresAccessor.DeleteWarning(failureMessage);
            }

            return FailureProcessingResult.Continue;
        }
    }

    /// <summary>
    ///     Executes a function against the family document and captures the result via out parameter.
    ///     Does NOT wrap in a transaction - caller controls transaction scope.
    ///     Useful for snapshot collection, read-only operations, or any code that needs result capture.
    /// </summary>
    public static FamilyDocument Tap<T>(
        this FamilyDocument famDoc,
        Func<FamilyDocument, T> func,
        out T result
    ) {
        result = func(famDoc);
        return famDoc;
    }

    /// <summary>
    ///     Saves a variant of the family document to a given path with result capture.
    /// </summary>
    public static FamilyDocument ProcessAndSaveVariant<TOutput>(
        this FamilyDocument famDoc,
        string outputDirectory,
        string suffix,
        Func<FamilyDocument, List<TOutput>> callback,
        out List<TOutput> result
    ) {
        var originalFamPath = famDoc.PathName;
        var originalFamilyName = Path.GetFileNameWithoutExtension(famDoc.Document.Title);
        var createdFamPath = Path.Combine(outputDirectory, $"{originalFamilyName}{suffix}.rfa");

        // First Assimilate the transaction group to "close" transaction-related stuff
        using var tGroup = new TransactionGroup(famDoc, "Process And Save Variant");
        _ = tGroup.Start();
        result = callback.Invoke(famDoc);
        _ = tGroup.Assimilate();

        // Then save the new document, this turns the current document into the new document
        famDoc.SaveAs(createdFamPath,
            new SaveAsOptions { OverwriteExistingFile = true, Compact = true, MaximumBackups = 1 });

        // Undo the transaction group to revert to old file state
        QuickAccessToolBarService.performMultipleUndoRedoOperations(true, 1);

        // Restore the original document path only when the family started from a real file.
        if (!string.IsNullOrWhiteSpace(originalFamPath))
            famDoc.SaveAs(originalFamPath, new SaveAsOptions { OverwriteExistingFile = true, Compact = true });

        return famDoc;
    }


    public static FamilyDocument SaveToPaths(
        this FamilyDocument famDoc,
        Func<FamilyDocument, List<string>> getSavePaths
    ) {
        var savePaths = getSavePaths(famDoc)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (savePaths.Count == 0) return famDoc;

        foreach (var fullSavePath in savePaths) {
            var saveDirectory = Path.GetDirectoryName(fullSavePath);
            if (string.IsNullOrWhiteSpace(saveDirectory))
                throw new InvalidOperationException($"Save path '{fullSavePath}' does not contain a valid directory.");

            if (!Directory.Exists(saveDirectory))
                _ = Directory.CreateDirectory(saveDirectory);

            var saveOptions = new SaveAsOptions { OverwriteExistingFile = true, Compact = true, MaximumBackups = 1 };
            famDoc.SaveAs(fullSavePath, saveOptions);
        }

        return famDoc;
    }

    public static Family LoadAndClose(this FamilyDocument famDoc, Document doc, IFamilyLoadOptions? options = null) {
        if (options == null) options = new DefaultFamilyLoadOptions();
        var family = famDoc.LoadFamily(doc, options);
        var closed = famDoc.Close(false);
        return closed
            ? family
            : throw new InvalidOperationException("Failed to close family document after load error.");
    }
}

public class DefaultFamilyLoadOptions : IFamilyLoadOptions {
    public bool OnFamilyFound(
        bool familyInUse,
        out bool overwriteParameterValues) {
        overwriteParameterValues = true;
        return true;
    }

    public bool OnSharedFamilyFound(
        Family sharedFamily,
        bool familyInUse,
        out FamilySource source,
        out bool overwriteParameterValues) {
        source = FamilySource.Project;
        overwriteParameterValues = true;
        return true;
    }
}
