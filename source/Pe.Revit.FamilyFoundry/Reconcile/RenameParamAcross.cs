using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Reconcile;

/// <summary>One family's before/after parameter names plus the reconciler receipt that produced them.</summary>
public sealed record RenameOutcome(
    string Family,
    IReadOnlyList<string> Before,
    IReadOnlyList<string> After,
    FamilyReceipt? Receipt,
    string? Error
) {
    public bool Renamed(string from, string to) => this.Error is null && this.Receipt?.Converged == true && this.After.Contains(to) && !this.After.Contains(from);
}

/// <summary>
///     Verdict-2 acceptance path, as one function: rename one parameter across the families a caller names,
///     in a project document, through <see cref="FamilyVisit" /> + <see cref="ReconcileFamily" /> (patch mode)
///     + native source normalization. The rename pod and the Revit-backed test both call <see cref="Run" />; the pod
///     is a thin argument reader over it. No new Revit knowledge lives here — the processor owns the visit,
///     the reconciler owns the plan, and the ops library owns the mutation.
/// </summary>
public static class RenameParamAcross {
    /// <summary>Reuse ranked normalization; native replacement moves values and references before recapture.
    /// Existing destinations win; conflicting sources remain instead of being deleted.</summary>
    public static FamilyPatch Patch(IEnumerable<string> familyNames, string from, string to, DataType dataType) => new() {
        Select = new PatchSelect { Names = familyNames.ToList() },
        Patch = new JObject {
            ["parameters"] = new JObject {
                [to] = new JObject { ["wasNamed"] = new JArray(from), ["dataType"] = dataType.ToString() }
            }
        }
    };

    /// <summary>
    ///     One outcome per name the caller asked for, in that order; a family the project does not carry gets
    ///     an outcome with <see cref="RenameOutcome.Error" /> set rather than a silent omission.
    /// </summary>
    /// <param name="transaction">
    ///     <c>Owned</c> for desktop commands and tests; <c>Sandbox</c> for a pod or script, which may not
    ///     create a <c>Transaction</c>. A modifiable project refuses with <c>ProjectIsModifiable</c> (gotcha
    ///     25) unless the caller parked its host transaction on another document first.
    /// </param>
    public static IReadOnlyList<RenameOutcome> Run(
        Document project,
        IReadOnlyList<string> familyNames,
        string from,
        string to,
        DataType dataType,
        FamilyVisitTransaction transaction = FamilyVisitTransaction.Owned
    ) {
        if (project.IsFamilyDocument)
            throw new InvalidOperationException("RenameParamAcross runs against a project document; the family-document lane is FamilyModelBuild.Reconcile.");

        var patch = Patch(familyNames, from, to, dataType);
        var families = project.FamiliesMatching(patch.Select);
        var found = families.ToDictionary(f => f.Name, StringComparer.Ordinal);
        var op = new ReconcileFamily(patch);
        var byFamily = new Dictionary<string, RenameOutcome>(StringComparer.Ordinal);

        if (families.Count > 0) {
            using var processor = new OperationProcessor(project, new ExecutionOptions {
                SuppressWarnings = true,
                Visit = new FamilyVisitOptions { Transaction = transaction, SuppressWarnings = true }
            });
            _ = processor
                .SelectFamilies(() => families)
                .WithPerFamilyCallback(ctx => byFamily[ctx.FamilyName] = new RenameOutcome(
                    ctx.FamilyName, Names(ctx.PreProcessSnapshot), Names(ctx.PostProcessSnapshot), op.LastReceipt, ErrorOf(ctx)))
                .ProcessQueue(
                    new OperationQueue().Add(op),
                    new SnapshotCapturePipeline().Add(new ParameterSnapshotCollector()),
                    null,
                    new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false, LoadFamily = true });
        }

        return familyNames
            .Select(name => byFamily.TryGetValue(name, out var outcome)
                ? outcome
                : new RenameOutcome(name, [], [], null, found.ContainsKey(name) ? "the processor returned no context for this family" : "not loaded in this project, or not editable"))
            .ToList();
    }

    private static IReadOnlyList<string> Names(FamilySnapshot? snapshot) =>
        snapshot?.Parameters?.Data?.Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToList() ?? [];

    private static string? ErrorOf(FamilyProcessingContext ctx) {
        var (logs, error) = ctx.OperationLogs;
        if (error is not null) return error.Message;
        var failed = logs?.SelectMany(l => l.Entries).Where(e => e.Status == LogStatus.Error).Select(e => $"{e.Name}: {e.Message}").ToList();
        return failed is { Count: > 0 } ? string.Join("; ", failed) : null;
    }
}
