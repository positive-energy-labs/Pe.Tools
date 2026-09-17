using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.StorageRuntime.Modules;
using System.IO;

namespace Pe.App.Pods;

/// <summary>One JSON member of an installed pod, addressed by manifest id and pod-relative path.</summary>
internal sealed record PodMember(string PodId, string PodFolder, string Path, string? Schema) {
    public string FullPath => System.IO.Path.Combine(this.PodFolder, this.Path.Replace('/', System.IO.Path.DirectorySeparatorChar));

    /// <summary>Compose this member and read it as <typeparamref name="T" />; the source names the exact bytes read.</summary>
    public (T Spec, string Composed, PodMemberSource Source) Load<T>() where T : class {
        var pods = new ScriptPodPreparationService();
        var (raw, sha256) = pods.ReadMember(this.PodId, this.Path);
        var composition = pods.Compose(this.PodId, this.Path, raw);
        if (composition.Composed is null)
            throw new InvalidDataException($"{this.PodId}:{this.Path} did not compose: {string.Join("; ", composition.Diagnostics.Select(d => d.Message))}");
        var spec = ModuleSettingsStorage<T>.ReadPrepared(raw, composition.Composed, $"{this.PodId}:{this.Path}");
        return (spec, composition.Composed, new PodMemberSource(this.PodId, this.Path, sha256));
    }
}

/// <summary>Palette-side view of the pod library: members selected by `$schema`, and apply-source checks.</summary>
internal static class PodMembers {
    public static string SchemaUrl(ISettingsRootBinding library) =>
        HostEndpoint.ResolveHostBaseUrl().TrimEnd('/') + SettingsSchemaUrl.Path(library);

    /// <summary>Installed pods whose manifest passed preparation.</summary>
    public static IReadOnlyList<PodPreparation> Pods() =>
        new ScriptPodPreparationService().List().Where(pod => pod.Success).ToList();

    /// <summary>Members whose `$schema` names one of <paramref name="libraries" />.</summary>
    public static IReadOnlyList<PodMember> List(params ISettingsRootBinding[] libraries) {
        var suffixes = libraries.Select(SettingsSchemaUrl.Path).ToList();
        return Pods().SelectMany(pod => pod.Members
                .Where(member => member.Schema is { } schema && suffixes.Any(suffix => schema.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)))
                .Select(member => new PodMember(pod.Manifest!.Id, pod.Folder, member.Path, member.Schema)))
            .ToList();
    }

    /// <summary>The pod folder for an apply source, refusing a member whose saved bytes changed since it was read.</summary>
    public static string VerifiedFolder(PodMemberSource source) {
        var pods = new ScriptPodPreparationService();
        var (_, actual) = pods.ReadMember(source.Pod, source.Path);
        return string.Equals(actual, source.Sha256, StringComparison.OrdinalIgnoreCase)
            ? pods.ResolveFolder(source.Pod)
            : throw new InvalidDataException($"{source.Pod}:{source.Path} changed on disk ({actual}); save and compose it again.");
    }

    /// <summary>The member as JSON for list metadata; a malformed member lists empty and its preview reports why.</summary>
    public static JObject ReadOrEmpty(string file) {
        try { return JObject.Parse(File.ReadAllText(file)); }
        catch (Newtonsoft.Json.JsonException) { return new JObject(); }
    }
}
