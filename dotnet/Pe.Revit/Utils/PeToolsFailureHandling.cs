using Autodesk.Revit.DB.Events;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData.Families;

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
        ICollection<(bool IsError, string Message)> diagnostics, bool suppressWarnings = true) =>
        FamilyFailurePolicy.Reject.Apply(accessor, diagnostics, suppressWarnings);

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

    internal static string DescribeFailure(FailureMessageAccessor failureMessage) {
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

    internal static bool TryResolveFailure(
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

/// <summary>
///     What a family visit lets Revit do with each named failure (patch <c>run.failures</c>, kaitpw 2026-09-08). Default: warnings
///     are deleted and recorded, join loss and every error roll the edit back with Revit's text. A <see cref="FailureAction.Resolve"/>
///     entry lets Revit take its first permitted non-modal resolution and records it as <c>Resolved &lt;name&gt; with &lt;type&gt;: ...</c>,
///     which <c>ReconcileFamily</c> lifts onto the receipt as a RunEffect.
/// </summary>
public sealed class FamilyFailurePolicy {
    public const string ResolvedPrefix = "Resolved ";

    /// <summary>Patch-facing names for the Revit failure definitions FF has met. GUIDs are Revit's stable failure ids.</summary>
    public static readonly IReadOnlyDictionary<string, Guid> KnownFailures = new Dictionary<string, Guid>(StringComparer.Ordinal) {
        ["cantKeepJoined"] = BuiltInFailures.JoinElementsFailures.CannotKeepJoined.Guid,
        // "Constraints are not satisfied" (Old_Template Mitsubishi_PVFY-NAMU-E1: a one-way angular rig, 2026-09-08)
        ["constraintsNotSatisfied"] = new Guid("74441dd6-e6dd-41ea-a57c-04f4a4957f19"),
        // "Constraints defined by highlighted Lines and Dimensions cannot be satisfied" (Old_Template Panasonic FV-0511VK2, flaky)
        ["sketchConstraintsNotSatisfied"] = new Guid("3012554f-816b-4e6a-9b74-6b3914c87737"),
        // "The family is connected in a network and can no longer keep the connectivity. Disconnect the family from the network?" (Chadds Round Elbow reload, 2026-10-08)
        ["cantKeepConnectivity"] = new Guid("dd0a16ea-9d2c-467d-b02c-5d86474a5041")
    };

    public static readonly FamilyFailurePolicy Reject = new(null);

    private readonly Dictionary<Guid, (string Name, FailureAction Action)> _actions = new();

    public FamilyFailurePolicy(IReadOnlyDictionary<string, FailureAction>? actions) {
        foreach (var (name, action) in actions ?? new Dictionary<string, FailureAction>()) {
            if (!KnownFailures.TryGetValue(name, out var guid))
                throw new ArgumentException($"run.failures names unknown failure '{name}'. Known: {string.Join(", ", KnownFailures.Keys)}.");
            this._actions[guid] = (name, action);
        }
    }

    public IReadOnlyDictionary<string, FailureAction> Actions => this._actions.Values.ToDictionary(a => a.Name, a => a.Action, StringComparer.Ordinal);

    /// <summary>One policy for a queue of operations; the same failure named twice with different actions is a conflict.</summary>
    public static FamilyFailurePolicy Merge(IEnumerable<FamilyFailurePolicy> policies) {
        var merged = new Dictionary<string, FailureAction>(StringComparer.Ordinal);
        foreach (var (name, action) in policies.SelectMany(p => p.Actions)) {
            if (merged.TryGetValue(name, out var existing) && existing != action)
                throw new InvalidOperationException($"run.failures conflict on '{name}': {existing} and {action}.");
            merged[name] = action;
        }
        return merged.Count == 0 ? Reject : new FamilyFailurePolicy(merged);
    }

    public FailureProcessingResult Apply(FailuresAccessor accessor, ICollection<(bool IsError, string Message)> diagnostics, bool suppressWarnings = true) {
        var reject = false;
        var resolved = false;
        foreach (var failure in accessor.GetFailureMessages()) {
            var guid = failure.GetFailureDefinitionId().Guid;
            var isWarning = failure.GetSeverity() == FailureSeverity.Warning;
            var text = PeToolsFailureHandling.DescribeFailure(failure);
            if (this._actions.TryGetValue(guid, out var named) && named.Action != FailureAction.Reject) {
                if (named.Action == FailureAction.Resolve && PeToolsFailureHandling.TryResolveFailure(accessor, failure, out var type)) {
                    resolved = true;
                    diagnostics.Add((false, $"{ResolvedPrefix}{named.Name} with {type}: {text}"));
                } else if (named.Action == FailureAction.Delete && isWarning) {
                    accessor.DeleteWarning(failure);
                    diagnostics.Add((false, $"Deleted {named.Name}: {text}"));
                } else {
                    reject = true;
                    diagnostics.Add((true, named.Action == FailureAction.Delete
                        ? $"{named.Name} is an error and cannot be deleted: {text}"
                        : $"{named.Name} offers no permitted resolution: {text}"));
                }
                continue;
            }
            // Default: join loss counts as an error because resolving it changes geometry.
            var isError = !isWarning || guid == KnownFailures["cantKeepJoined"];
            reject |= isError;
            diagnostics.Add((isError, text));
            if (!isError && suppressWarnings) accessor.DeleteWarning(failure);
        }
        return reject ? FailureProcessingResult.ProceedWithRollBack
            : resolved ? FailureProcessingResult.ProceedWithCommit
            : FailureProcessingResult.Continue;
    }
}
