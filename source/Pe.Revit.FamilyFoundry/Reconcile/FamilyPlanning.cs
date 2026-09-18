using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Reconcile;

/// <summary>
/// A nonexecutable preview for a family document. Formula interpretation uses rolled-back native transactions;
/// <see cref="Original"/> is the captured evidence. Apply recomputes from intent and verifies <see cref="PlanHash"/>.
/// </summary>
public sealed record FamilyPreview(
    FamilyModel Original,
    string PlanHash,
    IReadOnlyList<FamilyChange> Changes,
    IReadOnlyList<FamilyModelDiagnostic> Diagnostics,
    IReadOnlyList<string> RunEffects,
    string? ObservedParametersDigest,
    IReadOnlyList<string> ObservedResourceIds);

public static class FamilyPlanningExtensions {
    /// <summary>
    /// Previews a patch against a family document. Native formula interpretation is rollback-only, and the returned
    /// original capture is evidence. Apply with <see cref="ReconcileFamily"/> recomputes and checks the expected hash.
    /// </summary>
    public static FamilyPreview PreviewFamily(this Document familyDocument, FamilyPatch patch,
        ExecutionOptions? executionOptions = null, Func<Document, FamilySharedParameterSource>? sharedSource = null) {
        using var source = sharedSource?.Invoke(familyDocument) ?? new FamilySharedParameterSource(familyDocument);
        var prepared = FamilyPreparation.Prepare(familyDocument, patch, executionOptions ?? new ExecutionOptions(), source);
        return new FamilyPreview(prepared.Original, prepared.Plan?.PlanHash ?? string.Empty,
            prepared.Plan?.Changes ?? [], prepared.Diagnostics.Concat(prepared.Plan?.Refusals ?? []).ToList(), prepared.Plan?.RunEffects ?? [],
            source.ObservedParametersDigest, source.ObservedResourceIds.OrderBy(id => id, StringComparer.Ordinal).ToList());
    }
}

internal sealed record PreparedFamily(
    FamilyModel Original,
    FamilyPatch EffectivePatch,
    FamilyModel? Desired,
    FamilyPlan? Plan,
    IReadOnlyList<FamilyModelDiagnostic> Diagnostics);

internal static class FamilyPreparation {
    internal static PreparedFamily Prepare(Document document, FamilyPatch authoredPatch, ExecutionOptions executionOptions,
        FamilySharedParameterSource source, Func<Document, FamilyModel>? capture = null,
        IDictionary<(string Parameter, string Formula), string>? formulaCache = null) {
        var original = (capture ?? FamilyModelCaptureExtensions.CaptureFamilyModel)(document);
        return Prepare(document, authoredPatch, executionOptions, source, original, formulaCache);
    }

    internal static PreparedFamily Prepare(Document document, FamilyPatch authoredPatch, ExecutionOptions executionOptions,
        FamilySharedParameterSource source, FamilyModel original,
        IDictionary<(string Parameter, string Formula), string>? formulaCache = null) {
        var patch = new FamilyPatch { Select = authoredPatch.Select, Run = authoredPatch.Run, Patch = authoredPatch.ResolveParameterRules(original) };
        var parsed = FamilyReconciler.Desired(original, patch);
        if (parsed.Value is null || parsed.Diagnostics.Count > 0)
            return new PreparedFamily(original, patch, null, null, parsed.Diagnostics);

        var desired = ResolveNativeFormulas(source.Resolve(parsed.Value, patch.Patch), document, formulaCache);
        IReadOnlyList<FamilyModelDiagnostic> diagnostics = SharedTooltipDiagnostics(original, desired, authoredPatch.Patch)
            .Concat(GroupedIdentityDiagnostics(document, original, desired, authoredPatch.Patch)).ToList();
        if (diagnostics.Count == 0)
            diagnostics = FamilyModelUnitValidation.Validate(desired, patch.Patch, source.GetDefinition);
        if (diagnostics.Count > 0)
            return new PreparedFamily(original, patch, desired, null, diagnostics);

        var plan = FamilyReconciler.Reconcile(desired, original, UnitResolvers.Revit(document), authoredPatch.Run,
            source.GetDefinition, patch.Patch, source.ResolvedDefinitions, executionOptions);
        return new PreparedFamily(original, patch, desired, plan, []);
    }

    private static IReadOnlyList<FamilyModelDiagnostic> SharedTooltipDiagnostics(FamilyModel current, FamilyModel desired, JObject authored) {
        var diagnostics = new List<FamilyModelDiagnostic>();
        foreach (var parameter in (authored["parameters"] as JObject)?.Properties() ?? [])
            if (parameter.Value is JObject fields && fields["tooltip"] is { Type: not JTokenType.Null } tooltip &&
                current.Parameters.TryGetValue(parameter.Name, out var existing) && existing.Shared == true &&
                desired.Parameters.TryGetValue(parameter.Name, out var target) && target.Shared == true &&
                existing.SharedGuid == target.SharedGuid &&
                !string.Equals(existing.Tooltip, (string?)tooltip, StringComparison.Ordinal)) {
                var unreadable = current.Unmodeled.Any(fact => fact.Reason == UnmodeledReason.ParameterMetadataUnreadable &&
                    fact.Path == $"$.parameters.{parameter.Name}.tooltip");
                diagnostics.Add(new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.SharedTooltipUnsupported,
                    $"$.parameters.{parameter.Name}.tooltip", unreadable
                        ? $"Explicit tooltip for existing shared parameter '{parameter.Name}' cannot be verified because its native tooltip could not be read."
                        : $"Explicit tooltip for existing shared parameter '{parameter.Name}' is '{(string?)tooltip}', but its captured native tooltip is '{existing.Tooltip ?? ""}'. Shared tooltip replacement is unsupported."));
            }
        return diagnostics;
    }

    /// <summary>
    ///     A shared parameter changing identity (another GUID, or back to a family parameter) leaves through
    ///     <c>FamilyManager.ReplaceParameter(shared → family)</c> (NormalizeParameter.cs ReplaceDefinition). When the parameter drives a
    ///     grouped element (a nested member of an array) or labels an array, Revit refuses that edit at commit: "Changes to groups are allowed
    ///     only in group edit mode" (native, domains-guid hold 2026-09-18; the same hop converged once the array was removed). Refusing here
    ///     makes preview and apply agree instead of apply failing after a clean preview.
    /// </summary>
    private static IReadOnlyList<FamilyModelDiagnostic> GroupedIdentityDiagnostics(Document document, FamilyModel current, FamilyModel desired, JObject authored) {
        var diagnostics = new List<FamilyModelDiagnostic>();
        foreach (var name in (authored["parameters"] as JObject)?.Properties().Where(p => p.Value is JObject).Select(p => p.Name) ?? []) {
            if (!current.Parameters.TryGetValue(name, out var existing) || existing.Shared != true ||
                !desired.Parameters.TryGetValue(name, out var target) || target.Shared != false && target.SharedGuid == existing.SharedGuid) continue;
            if (document.FamilyManager.FindParameter(name) is not { } parameter) continue;
            var grouped = parameter.AssociatedParameters.Cast<Parameter>()
                .Where(slot => slot.Element?.GroupId is { } group && group != ElementId.InvalidElementId)
                .Select(slot => $"{slot.Element.Name}.{slot.Definition.Name}").Distinct(StringComparer.Ordinal).ToList();
            var arrays = parameter.AssociatedArrays(new FamilyDocument(document)).Count();
            if (grouped.Count == 0 && arrays == 0) continue;
            diagnostics.Add(new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.IdentityChangeThroughGroup,
                $"$.parameters.{name}.{(target.Shared == false ? "shared" : "sharedGuid")}",
                $"Shared parameter '{name}' cannot change identity natively while it drives grouped array members" +
                $"{(grouped.Count == 0 ? "" : $" ({string.Join(", ", grouped)})")}{(arrays == 0 ? "" : $" or labels {arrays} array(s)")}; Revit allows that edit only in group edit mode."));
        }
        return diagnostics;
    }

    /// <summary>Ask Revit to canonicalize formulas without retaining document mutation.</summary>
    internal static FamilyModel ResolveNativeFormulas(FamilyModel desired, Document document,
        IDictionary<(string Parameter, string Formula), string>? cache = null) {
        var fm = document.FamilyManager;
        var pending = desired.Parameters.Where(p => p.Value.Formula is not null)
            .Select(p => (p.Key, p.Value, Target: fm.FindParameter(p.Key)))
            .Where(p => p.Target is not null && p.Target.Formula != p.Value.Formula).ToList();
        if (pending.Count == 0) return desired;
        var json = JObject.Parse(FamilyModelJson.Serialize(desired));
        var reused = false;
        if (cache is not null) {
            foreach (var (name, parameter, _) in pending.ToList())
                if (cache.TryGetValue((name, parameter.Formula!), out var canonical)) {
                    json["parameters"]![name]!["formula"] = canonical;
                    pending.RemoveAll(p => p.Key == name);
                    reused = true;
                }
            if (pending.Count == 0) return reused ? FamilyModelJson.Parse(json.ToString()).Value! : desired;
        }
        Transaction? transaction = null;
        SubTransaction? subTransaction = null;
        var started = false;
        try {
            if (document.IsModifiable) { subTransaction = new SubTransaction(document); subTransaction.Start(); }
            else { transaction = new Transaction(document, "Interpret family formulas"); transaction.Start(); }
            started = true;
            foreach (var (name, parameter, target) in pending) {
                if (FamilyModelValidator.FormulaNames(parameter.Formula!).Any(reference => fm.FindParameter(reference) is null)) continue;
                fm.SetFormula(target!, parameter.Formula);
                document.Regenerate();
                var canonical = target!.Formula ?? throw new InvalidOperationException($"Revit did not retain formula for '{name}'.");
                json["parameters"]![name]!["formula"] = canonical;
                if (cache is not null) cache[(name, parameter.Formula!)] = canonical;
            }
        } finally {
            if (started) {
                if (subTransaction is not null) subTransaction.RollBack();
                else transaction!.RollBack();
            }
            subTransaction?.Dispose();
            transaction?.Dispose();
        }
        return FamilyModelJson.Parse(json.ToString()).Value!;
    }
}
