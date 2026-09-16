using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>Verdict 8: `requires` names the pods a pod may reference. Presence check, not a solver.</summary>
public sealed record PodRequirement(PodId Id, PodVersion Version);

/// <summary>
///     Spike manifest, schemaVersion 2. Differences from
///     <see cref="Pe.Shared.Scripting.Pods.PodManifest" />: `entrypoints` is optional (verdict 1,
///     a pod with no scripts is a pod), `requires` and `apsCollection` exist (verdict 8), and
///     `origin` is present exactly when the pod is installed (verdict 3).
/// </summary>
public sealed record PodHeader(
    PodId Id,
    string Name,
    PodVersion Version,
    string? Description,
    IReadOnlyList<PodEntrypoint> Entrypoints,
    IReadOnlyList<PodRequirement> Requires,
    string? ApsCollection,
    PodOwnership Ownership
) {
    public const int SchemaVersion = 2;
}

public sealed record PodHeaderRead(PodHeader? Header, IReadOnlyList<PodGateFinding> Findings) {
    public bool Success => this.Header is not null && this.Findings.All(f => f.Severity != PodGateSeverity.Error);
}

/// <summary>
///     The one parse. Every downstream gate takes a <see cref="PodHeader" />, so no gate re-parses
///     JSON and no gate can see a half-valid manifest.
/// </summary>
public static class PodHeaderReader {
    private const string GateId = "pod.manifest";

    private static readonly HashSet<string> TopLevelFields = new(StringComparer.Ordinal) {
        "schemaVersion", "id", "name", "version", "description", "entrypoints", "requires", "apsCollection", "origin"
    };

    public static PodHeaderRead Read(string json) {
        var findings = new List<PodGateFinding>();

        JObject root;
        try {
            root = JObject.Parse(json);
        } catch (JsonException ex) {
            return new PodHeaderRead(null, [Error("pod.json", $"pod.json is not valid JSON: {ex.Message}")]);
        }

        foreach (var property in root.Properties()) {
            if (!TopLevelFields.Contains(property.Name))
                findings.Add(Error($"pod.json#{property.Name}", $"Unknown field '{property.Name}'. Allowed: {string.Join(", ", TopLevelFields.Order(StringComparer.Ordinal))}."));
        }

        if (root["schemaVersion"]?.Value<int?>() != PodHeader.SchemaVersion)
            findings.Add(Error("pod.json#schemaVersion", $"schemaVersion must be {PodHeader.SchemaVersion}."));

        PodId id = default;
        var rawId = root["id"]?.Value<string>();
        if (!PodId.TryParse(rawId, out id, out var idReason))
            findings.Add(Error("pod.json#id", idReason!));
        else if (PodReference.ReservedIds.Contains(id.Value))
            findings.Add(Error("pod.json#id", $"Pod id '{id}' is reserved by the reference grammar; '@{id}/' already has a meaning."));

        var name = root["name"]?.Value<string>();
        if (string.IsNullOrWhiteSpace(name))
            findings.Add(Error("pod.json#name", "name is required."));

        PodVersion version = default;
        if (!PodVersion.TryParse(root["version"]?.Value<string>(), out version, out var versionReason))
            findings.Add(Error("pod.json#version", versionReason!));

        var entrypoints = ReadEntrypoints(root, findings);
        var requires = ReadRequires(root, findings);
        var ownership = ReadOwnership(root, findings);

        if (findings.Any(f => f.Severity == PodGateSeverity.Error))
            return new PodHeaderRead(null, findings);

        return new PodHeaderRead(
            new PodHeader(id, name!.Trim(), version, root["description"]?.Value<string>(), entrypoints, requires, root["apsCollection"]?.Value<string>(), ownership),
            findings
        );
    }

    private static IReadOnlyList<PodEntrypoint> ReadEntrypoints(JObject root, List<PodGateFinding> findings) {
        // Verdict 1: `src/` is optional, so an absent or empty entrypoint list is legal.
        if (root["entrypoints"] is not { } token || token.Type == JTokenType.Null)
            return [];
        if (token is not JArray array) {
            findings.Add(Error("pod.json#entrypoints", "entrypoints must be an array."));
            return [];
        }

        var entrypoints = new List<PodEntrypoint>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < array.Count; i++) {
            var subject = $"pod.json#entrypoints[{i}]";
            if (array[i] is not JObject obj) {
                findings.Add(Error(subject, "Each entrypoint must be an object."));
                continue;
            }

            var epId = obj["id"]?.Value<string>();
            var sourcePath = obj["sourcePath"]?.Value<string>();
            if (string.IsNullOrWhiteSpace(epId) || string.IsNullOrWhiteSpace(sourcePath)) {
                findings.Add(Error(subject, "Each entrypoint requires 'id' and 'sourcePath'."));
                continue;
            }

            if (!ids.Add(epId))
                findings.Add(Error(subject, $"Duplicate entrypoint id '{epId}'."));
            if (!PodPath.TryParse(sourcePath, out var path, out var pathReason))
                findings.Add(Error(subject, pathReason!));
            else if (!path.Value.StartsWith("src/", StringComparison.OrdinalIgnoreCase) || !path.Value.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
                findings.Add(Error(subject, $"sourcePath '{path}' must be a 'src/**/*.cs' file."));
            else
                entrypoints.Add(new PodEntrypoint(epId, path.Value, obj["name"]?.Value<string>(), obj["description"]?.Value<string>()));
        }

        return entrypoints;
    }

    private static IReadOnlyList<PodRequirement> ReadRequires(JObject root, List<PodGateFinding> findings) {
        if (root["requires"] is not { } token || token.Type == JTokenType.Null)
            return [];
        if (token is not JArray array) {
            findings.Add(Error("pod.json#requires", "requires must be an array of { id, version }."));
            return [];
        }

        var requires = new List<PodRequirement>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < array.Count; i++) {
            var subject = $"pod.json#requires[{i}]";
            if (array[i] is not JObject obj
                || !PodId.TryParse(obj["id"]?.Value<string>(), out var reqId, out var reqIdReason)) {
                findings.Add(Error(subject, "Each requirement must be an object with a slug 'id'."));
                continue;
            }

            if (!PodVersion.TryParse(obj["version"]?.Value<string>(), out var reqVersion, out var reqVersionReason)) {
                findings.Add(Error(subject, reqVersionReason!));
                continue;
            }

            // Verdict 3: one version per id. Two entries for one id is unsatisfiable by construction.
            if (!seen.Add(reqId.Value)) {
                findings.Add(Error(subject, $"Pod '{reqId}' is required twice. One version per id: a machine can hold only one copy of a pod."));
                continue;
            }

            requires.Add(new PodRequirement(reqId, reqVersion));
        }

        return requires;
    }

    private static PodOwnership ReadOwnership(JObject root, List<PodGateFinding> findings) {
        if (root["origin"] is not { } token || token.Type == JTokenType.Null)
            return PodOwnership.Owned.Instance;

        var remote = token["remote"]?.Value<string>();
        var commit = token["commit"]?.Value<string>();
        if (string.IsNullOrWhiteSpace(remote) || string.IsNullOrWhiteSpace(commit)) {
            findings.Add(Error("pod.json#origin", "origin must carry both 'remote' and 'commit'. Install writes it; authors never do."));
            return PodOwnership.Owned.Instance;
        }

        return new PodOwnership.Installed(new PodOrigin(remote, commit));
    }

    private static PodGateFinding Error(string subject, string reason) =>
        new(GateId, PodGateLane.Deterministic, PodGateSeverity.Error, subject, reason);
}
