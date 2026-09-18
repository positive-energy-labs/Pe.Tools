using Pe.Revit.Scripting.Pods;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.StorageRuntime.Modules;
using System.IO;

namespace Pe.App.Pods;

/// <summary>Palette-side view of the pod library: members selected by `$schema`, loading, and apply-source checks.</summary>
internal static class PodMembers {
    public static string SchemaUrl(ISettingsRootBinding library) =>
        HostEndpoint.ResolveHostBaseUrl().TrimEnd('/') + SettingsSchemaUrl.Path(library);

    /// <summary>Installed pods whose manifest and entrypoints passed preparation.</summary>
    public static IReadOnlyList<PreparedPod> Pods() =>
        new ScriptPodPreparationService().List().OfType<PreparedPod>().ToList();

    /// <summary>Members whose `$schema` names one of <paramref name="libraries" />. The library parsed each one as a JSON object.</summary>
    public static IReadOnlyList<(PreparedPod Pod, PodMember Member)> List(params ISettingsRootBinding[] libraries) {
        var suffixes = libraries.Select(SettingsSchemaUrl.Path).ToList();
        return Pods().SelectMany(pod => pod.Members
                .Where(member => member.Schema is { } schema && suffixes.Any(suffix => schema.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)))
                .Select(member => (pod, member)))
            .ToList();
    }

    public static string FullPath(this PodMember member, PreparedPod pod) =>
        ScriptPodPreparationService.FullPath(pod.Folder, member.Path);

    /// <summary>Compose the member and read it as <typeparamref name="T" />; the source names the exact bytes read.</summary>
    public static (T Spec, string Composed, PodMemberSource Source) Load<T>(this PodMember member, PreparedPod pod) where T : class {
        var pods = new ScriptPodPreparationService();
        var id = pod.Manifest.Id;
        var (raw, sha256) = pods.ReadMember(id, member.Path);
        var composition = pods.Compose(id, member.Path, raw);
        if (composition.Composed is null)
            throw new InvalidDataException($"{id}:{member.Path} did not compose: {string.Join("; ", composition.Diagnostics.Select(d => d.Message))}");
        var spec = ModuleSettingsStorage<T>.ReadPrepared(raw, composition.Composed, $"{id}:{member.Path}");
        return (spec, composition.Composed, new PodMemberSource(id, member.Path, sha256));
    }

    /// <summary>The pod folder for an apply source, refusing a member whose saved bytes changed since it was read.</summary>
    public static string VerifiedFolder(PodMemberSource source) {
        var pods = new ScriptPodPreparationService();
        var (_, actual) = pods.ReadMember(source.Pod, source.Path);
        return string.Equals(actual, source.Sha256, StringComparison.OrdinalIgnoreCase)
            ? pods.ResolveFolder(source.Pod)
            : throw new InvalidDataException($"{source.Pod}:{source.Path} changed on disk ({actual}); save and compose it again.");
    }
}
