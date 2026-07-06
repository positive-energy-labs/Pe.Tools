using Autodesk.Revit.DB.Events;

namespace Pe.Revit.Utils;

/// <summary>
///     Non-modal Revit failure resolution: warnings are deleted and captured as diagnostics, errors are
///     resolved through a non-modal resolution ladder. Use <see cref="DialogSuppressingFailuresPreprocessor" />
///     for transaction-scoped handling or <see cref="ExecuteWithFailureHandling{T}" /> for doc-scoped
///     operations that raise failures outside a caller-owned transaction (e.g. family load).
/// </summary>
public static class RevitFailureHandling {
    private static readonly FailureResolutionType[] NonModalResolutionPreference = [
        FailureResolutionType.UnlockConstraints,
        FailureResolutionType.DetachElements,
        FailureResolutionType.FixElements,
        FailureResolutionType.DeleteElements,
        FailureResolutionType.SkipElements
    ];

    public static T ExecuteWithFailureHandling<T>(
        Document document,
        Func<T> action,
        ICollection<(bool IsError, string Message)> diagnostics,
        params Document[] additionalDocuments
    ) {
        var documents = new[] { document }
            .Concat(additionalDocuments)
            .Where(candidate => candidate != null)
            .ToList();

        void OnFailuresProcessing(object? _, FailuresProcessingEventArgs args) {
            var accessor = args.GetFailuresAccessor();
            var failureDocument = accessor?.GetDocument();
            if (failureDocument == null || !documents.Any(candidate => candidate.Equals(failureDocument)))
                return;

            args.SetProcessingResult(ResolveFailures(accessor!, diagnostics));
        }

        document.Application.FailuresProcessing += OnFailuresProcessing;
        try {
            return action();
        } finally {
            document.Application.FailuresProcessing -= OnFailuresProcessing;
        }
    }

    public static FailureProcessingResult ResolveFailures(
        FailuresAccessor failuresAccessor,
        ICollection<(bool IsError, string Message)> diagnostics
    ) {
        var resolvedFailure = false;

        foreach (var failureMessage in failuresAccessor.GetFailureMessages()) {
            if (failureMessage.GetSeverity() == FailureSeverity.Warning) {
                resolvedFailure = true;
                diagnostics.Add((false, $"Suppressed warning: {DescribeFailure(failureMessage)}"));
                failuresAccessor.DeleteWarning(failureMessage);
                continue;
            }

            if (TryResolveFailure(failuresAccessor, failureMessage, out var resolutionType)) {
                resolvedFailure = true;
                diagnostics.Add((false,
                    $"Resolved failure with {resolutionType}: {DescribeFailure(failureMessage)}"));
            }
        }

        return resolvedFailure
            ? FailureProcessingResult.ProceedWithCommit
            : FailureProcessingResult.Continue;
    }

    private static string DescribeFailure(FailureMessageAccessor failureMessage) {
        var description = failureMessage.GetDescriptionText();
        var failureGuid = failureMessage.GetFailureDefinitionId().Guid;
        if (string.IsNullOrWhiteSpace(description))
            return failureGuid.ToString();

        return $"{description} [{failureGuid}]";
    }

    private static bool TryResolveFailure(
        FailuresAccessor failuresAccessor,
        FailureMessageAccessor failureMessage,
        out FailureResolutionType resolutionType
    ) {
        resolutionType = ResolvePermittedResolutionType(failuresAccessor, failureMessage);
        if (resolutionType == FailureResolutionType.Invalid)
            return false;

        failureMessage.SetCurrentResolutionType(resolutionType);
        failuresAccessor.ResolveFailure(failureMessage);
        return true;
    }

    private static FailureResolutionType ResolvePermittedResolutionType(
        FailuresAccessor failuresAccessor,
        FailureMessageAccessor failureMessage
    ) {
        var currentResolutionType = failureMessage.GetCurrentResolutionType();
        if (IsResolutionPermitted(failuresAccessor, failureMessage, currentResolutionType))
            return currentResolutionType;

        return NonModalResolutionPreference.FirstOrDefault(type =>
            IsResolutionPermitted(failuresAccessor, failureMessage, type));
    }

    private static bool IsResolutionPermitted(
        FailuresAccessor failuresAccessor,
        FailureMessageAccessor failureMessage,
        FailureResolutionType resolutionType
    ) =>
        resolutionType != FailureResolutionType.Invalid &&
        failureMessage.HasResolutionOfType(resolutionType) &&
        failuresAccessor.IsFailureResolutionPermitted(failureMessage, resolutionType) &&
        !failuresAccessor.GetAttemptedResolutionTypes(failureMessage).Contains(resolutionType);
}

/// <summary>
///     <see cref="IFailuresPreprocessor" /> over <see cref="RevitFailureHandling.ResolveFailures" />. Set it on a
///     transaction's <see cref="FailureHandlingOptions" /> to keep warning/error commits from raising modal dialogs.
/// </summary>
public sealed class DialogSuppressingFailuresPreprocessor(
    ICollection<(bool IsError, string Message)> diagnostics
) : IFailuresPreprocessor {
    public FailureProcessingResult PreprocessFailures(FailuresAccessor failuresAccessor) =>
        RevitFailureHandling.ResolveFailures(failuresAccessor, diagnostics);
}
