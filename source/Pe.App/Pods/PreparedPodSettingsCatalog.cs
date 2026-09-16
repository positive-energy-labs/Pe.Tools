using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.Storage;
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
    public PreparedPodSetting Refresh() => PreparedPodSettingsCatalog.Get(Path.GetFileName(this.WorkspaceRoot), this.SourcePath);

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
                prepared.ReleaseHash,
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

}
