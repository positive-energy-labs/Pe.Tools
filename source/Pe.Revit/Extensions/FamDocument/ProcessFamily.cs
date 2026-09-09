using Autodesk.Revit.DB.Events;
using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using UIFrameworkServices;

namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentProcessFamily {
    /// <summary>
    ///     Opens an independent family copy for a read, handles only failures raised by EditFamily on the
    ///     source document, and always closes the copy. Only the known non-destructive family-constraint warning
    ///     is acknowledged; every other warning or error rolls back and refuses the read.
    /// </summary>
    public static T ReadFamilyCopy<T>(this Document source, Family family, Func<FamilyDocument, T> read,
        ICollection<(bool IsError, string Message)> diagnostics) {
        if (source == null) throw new ArgumentNullException(nameof(source));
        if (family == null) throw new ArgumentNullException(nameof(family));
        if (read == null) throw new ArgumentNullException(nameof(read));
        if (diagnostics == null) throw new ArgumentNullException(nameof(diagnostics));
        if (source.IsFamilyDocument && source.OwnerFamily?.Id == family.Id)
            return read(new FamilyDocument(source));

        Document? copy = null;
        var firstDiagnostic = diagnostics.Count;
        try {
            try {
                copy = RevitFailureScope.Execute(source,
                    accessor => PeToolsFailureHandling.RejectUnsafeFamilyCopyFailures(accessor, diagnostics),
                    () => source.EditFamily(family));
            } catch (Exception exception) when (diagnostics.Skip(firstDiagnostic).Any(diagnostic => diagnostic.IsError)) {
                throw new InvalidOperationException(
                    $"EditFamily refused '{family.Name}': {string.Join("; ", diagnostics.Skip(firstDiagnostic).Where(diagnostic => diagnostic.IsError).Select(error => error.Message))}",
                    exception);
            }
            var errors = diagnostics.Skip(firstDiagnostic).Where(diagnostic => diagnostic.IsError).ToList();
            if (errors.Count > 0)
                throw new InvalidOperationException(
                    $"EditFamily refused '{family.Name}': {string.Join("; ", errors.Select(error => error.Message))}");
            return read(new FamilyDocument(copy));
        } finally {
            if (copy != null) _ = copy.Close(false);
        }
    }

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
                failureOptions.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(commitDiagnostics));
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
