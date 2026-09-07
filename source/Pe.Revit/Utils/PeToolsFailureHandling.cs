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

    /// <summary>Report every failure, dismiss warnings when requested, and roll back errors without changing content.</summary>
    public static FailureProcessingResult RejectErrors(FailuresAccessor accessor,
        ICollection<(bool IsError, string Message)> diagnostics, bool suppressWarnings = true) {
        var error = false;
        foreach (var failure in accessor.GetFailureMessages()) {
            var isError = failure.GetSeverity() != FailureSeverity.Warning;
            error |= isError;
            var action = isError ? "Rejected error" : suppressWarnings ? "Acknowledged warning" : "Observed warning";
            diagnostics.Add((isError, $"{action}: {DescribeFailure(failure)}"));
            if (!isError && suppressWarnings) accessor.DeleteWarning(failure);
        }
        // Normalization must never resolve a failure by deleting or detaching unmentioned content.
        return error ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
    }

    /// <summary>Permit only the non-destructive warning proven for EditFamily; refuse every other failure.</summary>
    public static FailureProcessingResult RejectUnsafeFamilyCopyFailures(FailuresAccessor accessor,
        ICollection<(bool IsError, string Message)> diagnostics) {
        var reject = false;
        foreach (var failure in accessor.GetFailureMessages()) {
            var acknowledged = failure.GetSeverity() == FailureSeverity.Warning &&
                               failure.GetFailureDefinitionId() == BuiltInFailures.DimensionFailures.UnstableConstraintInFamily;
            reject |= !acknowledged;
            diagnostics.Add((!acknowledged,
                $"{(acknowledged ? "Acknowledged warning" : failure.GetSeverity() == FailureSeverity.Warning ? "Rejected warning" : "Rejected error")}: {DescribeFailure(failure)}"));
            if (acknowledged) accessor.DeleteWarning(failure);
        }
        return reject ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
    }

    /// <summary>Reject the native join-loss warning without broadening warning policy or changing geometry.</summary>
    public static FailureProcessingResult RejectJoinLoss(FailuresAccessor accessor,
        ICollection<(bool IsError, string Message)> diagnostics, bool suppressWarnings = true) {
        var reject = false;
        foreach (var failure in accessor.GetFailureMessages()) {
            var joinLoss = failure.GetFailureDefinitionId() == BuiltInFailures.JoinElementsFailures.CannotKeepJoined;
            var isError = failure.GetSeverity() != FailureSeverity.Warning || joinLoss;
            reject |= isError;
            diagnostics.Add((isError, DescribeFailure(failure)));
            if (!isError && suppressWarnings) accessor.DeleteWarning(failure);
        }
        return reject ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
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
        string elements;
        try {
            elements = string.Join(", ", failureMessage.GetFailingElementIds()
                .Select(id => id.ToString()).OrderBy(id => id, StringComparer.Ordinal));
        } catch {
            elements = string.Empty;
        }
        var identity = elements.Length == 0 ? failureGuid.ToString() : $"{failureGuid}; elements: {elements}";
        return string.IsNullOrWhiteSpace(description)
            ? identity
            : $"{description} [{identity}]";
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
        FailureResolutionType current;
        try {
            current = failureMessage.GetCurrentResolutionType();
        } catch (Autodesk.Revit.Exceptions.InvalidOperationException) {
            // Some hard errors expose no resolution at all. They still need to flow through the
            // normal rollback path; inspecting CurrentResolution must not crash the preprocessor
            // and strand the transaction in Pending failure mode.
            current = FailureResolutionType.Invalid;
        }
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
