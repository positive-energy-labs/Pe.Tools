using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.Storage;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Transport;
using System.IO;
using System.Security.Cryptography;

namespace Pe.App.Pods;

/// <summary>One JSON member of an installed pod, addressed by manifest id and pod-relative path.</summary>
internal sealed record PodMember(string PodId, string PodFolder, string Path, string? Schema) {
    public string FullPath => System.IO.Path.Combine(this.PodFolder, this.Path.Replace('/', System.IO.Path.DirectorySeparatorChar));

    /// <summary>Compose this member and read it as <typeparamref name="T" />; the source names the exact bytes read.</summary>
    public (T Spec, string Composed, PodMemberSource Source) Load<T>() where T : class {
        var bytes = File.ReadAllBytes(this.FullPath);
        var composition = new ScriptPodPreparationService().Compose(this.PodId, this.Path, null);
        if (composition.Composed is null)
            throw new InvalidDataException($"{this.PodId}:{this.Path} did not compose: {string.Join("; ", composition.Diagnostics)}");
        var raw = System.Text.Encoding.UTF8.GetString(bytes);
        var spec = ModuleSettingsStorage<T>.ReadPrepared(raw, composition.Composed, $"{this.PodId}:{this.Path}");
        return (spec, composition.Composed, new PodMemberSource(this.PodId, this.Path, PodMembers.Sha256(bytes)));
    }
}

/// <summary>Palette-side listing of pod members by `$schema`. Every pod is read; one bad member hides nothing else.</summary>
internal static class PodMembers {
    public static string SchemaUrl(string moduleKey, string rootKey) =>
        $"{HostEndpoint.ResolveHostBaseUrl().TrimEnd('/')}/schemas/settings/{moduleKey}/{rootKey}.json";

    public static IReadOnlyList<(string Id, string Name, string Folder)> Pods() =>
        Directory.Exists(RevitScriptingStorageLocations.GetDefaultBasePath())
            ? Directory.EnumerateDirectories(RevitScriptingStorageLocations.GetDefaultBasePath())
                .Where(folder => File.Exists(Path.Combine(folder, "pod.json")))
                .Select(folder => (Manifest: ReadManifest(folder), Folder: folder))
                .Where(pod => pod.Manifest?["id"] is JValue { Type: JTokenType.String })
                .Select(pod => ((string)pod.Manifest!["id"]!, (string?)pod.Manifest["name"] ?? (string)pod.Manifest["id"]!, pod.Folder))
                .OrderBy(pod => pod.Item2, StringComparer.OrdinalIgnoreCase)
                .ToList()
            : [];

    public static string Folder(string podId) {
        var matches = Pods().Where(pod => pod.Id == podId).ToList();
        return matches.Count switch {
            1 => matches[0].Folder,
            0 => throw new DirectoryNotFoundException($"No installed pod has id '{podId}'."),
            _ => throw new InvalidDataException($"Pod id '{podId}' is claimed by {string.Join(" and ", matches.Select(m => m.Folder))}.")
        };
    }

    /// <summary>Members whose `$schema` path is `/schemas/settings/{module}/{root}.json` for one of <paramref name="schemas" />.</summary>
    public static IReadOnlyList<PodMember> List(params (string ModuleKey, string RootKey)[] schemas) {
        var suffixes = schemas.Select(s => $"/schemas/settings/{s.ModuleKey}/{s.RootKey}.json").ToList();
        return Pods().SelectMany(pod => {
            var settings = Path.Combine(pod.Folder, "settings");
            return Directory.Exists(settings)
                ? Directory.EnumerateFiles(settings, "*.json", SearchOption.AllDirectories)
                    .Select(file => new PodMember(pod.Id, pod.Folder, "settings/" + file[(settings.Length + 1)..].Replace(Path.DirectorySeparatorChar, '/'), ReadSchema(file)))
                : [];
        }).Where(member => member.Schema is { } schema && suffixes.Any(suffix => schema.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)))
          .ToList();
    }

    /// <summary>Refuses an existing path; returns the new member's SHA-256.</summary>
    public static string Write(string podId, string path, string content) {
        var full = Path.Combine(Folder(podId), path.Replace('/', Path.DirectorySeparatorChar));
        _ = Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        using (var stream = new FileStream(full, FileMode.CreateNew)) stream.Write(bytes, 0, bytes.Length);
        return Sha256(bytes);
    }

    /// <summary>The pod folder for an apply source, refusing a member whose saved bytes changed since it was read.</summary>
    public static string VerifiedFolder(PodMemberSource source) {
        var folder = Folder(source.Pod);
        var actual = Sha256(File.ReadAllBytes(Path.Combine(folder, source.Path.Replace('/', Path.DirectorySeparatorChar))));
        return string.Equals(actual, source.Sha256, StringComparison.OrdinalIgnoreCase)
            ? folder
            : throw new InvalidDataException($"{source.Pod}:{source.Path} changed on disk ({actual}); save and compose it again.");
    }

    public static string Sha256(byte[] bytes) {
        using var sha = SHA256.Create();
        return string.Concat(sha.ComputeHash(bytes).Select(b => b.ToString("x2")));
    }

    /// <summary>The member as JSON for list metadata; a malformed member lists empty and its preview reports why.</summary>
    public static JObject ReadOrEmpty(string file) {
        try { return JObject.Parse(File.ReadAllText(file)); }
        catch (Newtonsoft.Json.JsonException) { return new JObject(); }
    }

    private static JObject? ReadManifest(string folder) {
        // Pod preparation reports a malformed manifest; a palette skips that pod and keeps the others.
        try { return JObject.Parse(File.ReadAllText(Path.Combine(folder, "pod.json"))); }
        catch (Newtonsoft.Json.JsonException ex) {
            Serilog.Log.Warning(ex, "Pod manifest unreadable: {Folder}", folder);
            return null;
        }
    }

    // A member that does not parse lists as plain data; the route that opens it reports the parse error.
    private static string? ReadSchema(string file) =>
        ReadOrEmpty(file)["$schema"] is JValue { Type: JTokenType.String } schema ? (string)schema! : null;
}
