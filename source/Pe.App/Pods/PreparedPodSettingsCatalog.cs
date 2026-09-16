using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.Storage;
using Pe.Revit.Global.Services.Aps;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;
using Pe.Shared.StorageRuntime;
using Serilog;
using System.IO;

namespace Pe.App.Pods;

internal sealed record PreparedPodSetting(
    string PodId,
    string Version,
    string SnapshotHash,
    string? ReleaseHash,
    string SourcePath,
    string ComposedPath,
    string RawContent,
    string ComposedContent,
    string FullSourcePath,
    IReadOnlyList<PodExternalRequirement> ExternalRequirements,
    PreparedPod Snapshot,
    string WorkspaceRoot
) {
    public PreparedPodSetting Refresh() => PreparedPodSettingsCatalog.Get(this.PodId, this.SourcePath);

    public OutputStorage Output() => OutputStorage.ExactDir(Path.Combine(this.WorkspaceRoot, "output"));

    public PreparedPodSetting Member(string sourcePath) =>
        PreparedPodSettingsCatalog.Project(this.Snapshot, this.WorkspaceRoot, [])
            .SingleOrDefault(setting => string.Equals(setting.SourcePath, sourcePath, StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidDataException($"Pod '{this.PodId}' snapshot '{this.SnapshotHash}' has no member '{sourcePath}'.");

    public string WriteReceipt(OutputStorage output, string operation, string outcome,
        IEnumerable<ScriptOutputReferenceData>? outputs = null,
        IEnumerable<ObservedExternalRevisionData>? observedExternalRevisions = null,
        string? reason = null) {
        var runId = Guid.NewGuid().ToString("N");
        return output.Json($"pod-receipt-{runId}.json").Write(new PodExecutionAttributionData(
            this.PodId,
            this.Version,
            this.SnapshotHash,
            this.ReleaseHash,
            this.SourcePath,
            operation,
            runId,
            outcome,
            outputs?.ToList() ?? [],
            observedExternalRevisions?.ToList() ?? [], reason));
    }

    public IReadOnlyList<ObservedExternalRevisionData> ResolveExternalRequirements() =>
        PreparedPodSettingsCatalog.ResolveExternalRequirements(this.ExternalRequirements);
}

internal static class PreparedPodSettingsCatalog {
    public static IReadOnlyList<PreparedPodSetting> List(params string[] suffixes) {
        var result = new List<PreparedPodSetting>();
        var root = RevitScriptingStorageLocations.GetDefaultBasePath();
        if (!Directory.Exists(root))
            return result;

        foreach (var workspaceRoot in Directory.EnumerateDirectories(root).OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
            var podId = Path.GetFileName(workspaceRoot);
            try {
                var prepared = new ScriptPodPreparationService().Prepare(podId);
                if (!prepared.Success) {
                    Log.Warning("Portable pod settings skipped: PodId={PodId}, Diagnostics={Diagnostics}", podId,
                        prepared.Outcomes.Where(outcome => outcome.Severity == Pe.Shared.HostContracts.Scripting.ScriptDiagnosticSeverity.Error)
                            .Select(outcome => $"{outcome.Code}:{outcome.Location}:{outcome.Reason}"));
                    continue;
                }
                result.AddRange(Project(prepared, workspaceRoot, suffixes));
            } catch (Exception ex) {
                Log.Warning(ex, "Portable pod settings preparation failed: PodId={PodId}", podId);
            }
        }
        return result;
    }

    internal static PreparedPodSetting Get(string podId, string sourcePath) {
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(podId);
        var prepared = new ScriptPodPreparationService().Prepare(podId);
        if (!prepared.Success)
            throw new InvalidDataException(string.Join("; ", prepared.Outcomes
                .Where(outcome => outcome.Severity == Pe.Shared.HostContracts.Scripting.ScriptDiagnosticSeverity.Error)
                .Select(outcome => $"{outcome.Code} at {outcome.Location}: {outcome.Reason}")));
        return Project(prepared, workspaceRoot, []).Single(setting =>
            string.Equals(setting.SourcePath, sourcePath, StringComparison.OrdinalIgnoreCase));
    }

    internal static IEnumerable<PreparedPodSetting> Project(PreparedPod prepared, string workspaceRoot, string[] suffixes) {
        foreach (var document in prepared.ComposedSettings.Values.Where(document => suffixes.Length == 0 ||
                     suffixes.Any(suffix => document.Path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)))) {
            var sourcePath = "settings/" + document.Path["composed/".Length..];
            var source = prepared.Files[sourcePath];
            yield return new PreparedPodSetting(
                prepared.Manifest.Id,
                prepared.Manifest.Version,
                prepared.ContentHash,
                prepared.Manifest.Parent is not null && prepared.Manifest.Parent.ReleaseHash == prepared.ContentHash ? prepared.ContentHash : null,
                sourcePath,
                document.Path,
                System.Text.Encoding.UTF8.GetString(source.Bytes),
                document.Content,
                Path.Combine(workspaceRoot, sourcePath.Replace('/', Path.DirectorySeparatorChar)),
                prepared.Manifest.ExternalRequirements,
                prepared,
                workspaceRoot
            );
        }
    }

    internal static IReadOnlyList<ObservedExternalRevisionData> ResolveExternalRequirements(
        IReadOnlyList<PodExternalRequirement> requirements
    ) {
        var observed = new List<ObservedExternalRevisionData>();
        foreach (var collection in requirements.GroupBy(requirement => requirement.CollectionId, StringComparer.Ordinal)) {
            if (collection.Any(requirement => requirement.Code != "aps.parameters"))
                throw new InvalidDataException($"Unsupported external authority '{collection.First(requirement => requirement.Code != "aps.parameters").Code}'.");
            var current = ParametersServiceCache.ResolveCurrentAsync(collection.Key).GetAwaiter().GetResult();
            foreach (var requirement in collection) {
                if (!current.ResourceIds.Contains(requirement.ResourceId))
                    throw new InvalidDataException($"Current Parameters Service collection '{current.CollectionId}' has no resource '{requirement.ResourceId}'.");
                observed.Add(new ObservedExternalRevisionData(requirement.Code, requirement.ResourceId, current.Digest));
                Log.Information(
                    "Portable pod external authority resolved: Code={Code}, ResourceId={ResourceId}, CollectionId={CollectionId}, Digest={Digest}",
                    requirement.Code, requirement.ResourceId, current.CollectionId, current.Digest);
            }
        }
        return observed;
    }
}
