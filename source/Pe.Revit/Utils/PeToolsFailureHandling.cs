using Autodesk.Revit.DB.Events;
using Pe.Revit.Tasks;

namespace Pe.Revit.Failures;

/// <summary>Pe.Tools policy for resolving Revit failures without modal dialogs.</summary>
public static class PeToolsFailureHandling {
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
    ) => RevitFailureScope.Execute(
        document,
        accessor => ResolveFailures(accessor, diagnostics),
        action,
        additionalDocuments
    );

    public static IFailuresPreprocessor CreatePreprocessor(
        ICollection<(bool IsError, string Message)> diagnostics
    ) => new DelegatingFailuresPreprocessor(accessor => ResolveFailures(accessor, diagnostics));

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
        return string.IsNullOrWhiteSpace(description)
            ? failureGuid.ToString()
            : $"{description} [{failureGuid}]";
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
        var current = failureMessage.GetCurrentResolutionType();
        return IsResolutionPermitted(failuresAccessor, failureMessage, current)
            ? current
            : NonModalResolutionPreference.FirstOrDefault(type =>
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
