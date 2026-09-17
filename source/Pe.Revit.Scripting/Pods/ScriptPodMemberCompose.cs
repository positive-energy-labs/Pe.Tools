// SHIM: w1-pod-core owns this file
namespace Pe.Revit.Scripting.Pods;

public sealed record PodMemberComposition(string? Composed, IReadOnlyList<string> Diagnostics);

public static class ScriptPodMemberCompose {
    public static PodMemberComposition Compose(this ScriptPodPreparationService service, string podId, string path, string? draftContent) {
        if (draftContent is not null) throw new NotSupportedException("SHIM: draft composition belongs to w1-pod-core.");
        var workspaceKey = Directory.EnumerateDirectories(Pe.Revit.Scripting.Storage.RevitScriptingStorageLocations.GetDefaultBasePath())
            .Where(folder => File.Exists(Path.Combine(folder, "pod.json"))).Select(Path.GetFileName).Single(folder => (string?)Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(
                Pe.Revit.Scripting.Storage.RevitScriptingStorageLocations.ResolvePodManifestPath(folder!)))["id"] == podId)!;
        var prepared = service.Prepare(workspaceKey);
        if (prepared is not PreparedPod pod)
            return new(null, prepared.Outcomes.Select(o => $"{o.Code} at {o.Location}: {o.Reason}").ToList());
        var composedPath = "composed/" + path.Substring("settings/".Length);
        return pod.ComposedSettings.TryGetValue(composedPath, out var document)
            ? new(document.Content, [])
            : new(null, [$"{path} was not composed by preparation."]);
    }
}
