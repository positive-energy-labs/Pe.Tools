using Newtonsoft.Json.Linq;
using Pe.Shared.Scripting.Analysis;

namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>
///     The gate table as data. `pea pod gates` can print this; an agent can read lane and rule
///     without running a build. Adding a check is one list entry.
/// </summary>
public static class PodGateCatalog {
    public static IReadOnlyList<IPodGate> All { get; } = [
        new PodIdMatchesDirectoryGate(),
        new PodOwnedToBuildGate(),
        new PodSuffixSchemaGate(),
        new PodComposeSucceedsGate(),
        new PodClosureGate(),
        new PodComposedIsClosedGate(),
        new PodNoMachineLocalPathGate(),
        new PodComposedIsFreshGate(),
        new PodFileIndexGate(),
        new PodEntrypointGate(),
        new PodApsCollectionGate()
    ];
}

/// <summary>
///     `PodManifest.cs:83-87` today. Kept as a gate, not an invariant of <see cref="PodId" />,
///     because the directory name is ambient and a pod's bytes are identical wherever they sit.
/// </summary>
public sealed class PodIdMatchesDirectoryGate : PodGate {
    public override string Id => "pod.id-matches-directory";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "pod.json id equals the directory name.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        if (!string.Equals(subject.Header.Id.Value, subject.Snapshot.DirectoryName, StringComparison.Ordinal))
            yield return this.Error(
                PodLayout.ManifestFile,
                $"Pod id '{subject.Header.Id}' does not match directory '{subject.Snapshot.DirectoryName}'. Rename the directory to '{subject.Header.Id}'."
            );
    }
}

/// <summary>Verdicts 3 and 7: installed pods are read-only, and the consumer never builds.</summary>
public sealed class PodOwnedToBuildGate : PodGate {
    public override string Id => "pod.owned-to-build";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "Only an owned pod can be built; an installed copy is read-only.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        if (subject.Header.Ownership is PodOwnership.Installed installed)
            yield return this.Error(
                PodLayout.ManifestFile,
                $"Pod '{subject.Header.Id}' is installed from {installed.Origin.Remote}@{installed.Origin.Commit} and is read-only. Run `pea pod fork {subject.Header.Id}` to own a copy, then build that."
            );
    }
}

/// <summary>Verdict 10: schema by suffix.</summary>
public sealed class PodSuffixSchemaGate : PodGate {
    public override string Id => "pod.suffix-schema";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "Every settings document carries a suffix that names its schema.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        foreach (var path in subject.Snapshot.Under(PodLayout.SettingsRoot).Concat(subject.Snapshot.Under(PodLayout.ComposedRoot))) {
            if (PodLayout.SuffixOf(path) is null)
                yield return this.Error(
                    path.Value,
                    $"'{path}' has no schema suffix. Rename it to end in one of {string.Join(", ", PodLayout.DocumentSuffixes.Keys)}."
                );
        }
    }
}

/// <summary>Compose is the build (verdict 5); a compose error is a build failure, not a warning.</summary>
public sealed class PodComposeSucceedsGate : PodGate {
    public override string Id => "pod.compose";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "Every settings document composes.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) =>
        subject.ComposeErrors.Select(error => this.Error(PodLayout.SettingsRoot, error));
}

/// <summary>
///     Verdict 8, the closure rule. Split in two reasons on purpose: "not in requires" and
///     "not in that pod's manifest" are different repairs.
/// </summary>
public sealed class PodClosureGate : PodGate {
    public override string Id => "pod.closure";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "Every @x/ reference names a pod in requires and a file in that pod's manifest.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        var required = subject.Header.Requires.ToDictionary(r => r.Id, r => r.Version);

        foreach (var path in subject.Snapshot.Under(PodLayout.SettingsRoot)) {
            var content = subject.Snapshot.Read(path)!;
            JToken parsed;
            try {
                parsed = JToken.Parse(content);
            } catch (Newtonsoft.Json.JsonException) {
                continue; // pod.compose already reported it.
            }

            foreach (var raw in PodComposer.RawReferences(parsed).Distinct(StringComparer.Ordinal)) {
                if (!PodReference.TryParse(raw, out var reference, out var reason)) {
                    yield return this.Error(path.Value, reason!);
                    continue;
                }

                if (reference is PodReference.Local local) {
                    var target = ResolveLocal(subject, local);
                    if (target is null)
                        yield return this.Error(path.Value, $"'{local}' names no file in this pod. Expected '{PodLayout.SettingsRoot}/{local.Path}' with a known suffix.");
                    continue;
                }

                var foreign = (PodReference.Foreign)reference;
                if (!required.TryGetValue(foreign.PodId, out var version)) {
                    yield return this.Error(path.Value, $"'{foreign}' reaches pod '{foreign.PodId}', which is not in requires. Add {{ \"id\": \"{foreign.PodId}\", \"version\": \"x.y.z\" }} to pod.json requires.");
                    continue;
                }

                if (!subject.World.Pods.TryGetValue(foreign.PodId, out var entry)) {
                    yield return this.Error(path.Value, $"Pod '{foreign.PodId}' {version} is required but not installed. Run `pea pod install` for it, then build again.");
                    continue;
                }

                if (entry.Version != version) {
                    yield return this.Error(PodLayout.ManifestFile, $"requires '{foreign.PodId}' {version} but {entry.Version} is installed. One version per id: change requires or upgrade the pod.");
                    continue;
                }

                if (!MatchesAnyFile(entry.FileNames, foreign.Path))
                    yield return this.Error(path.Value, $"'{foreign}' names no file in the manifest of '{foreign.PodId}' {entry.Version}.");
            }
        }
    }

    private static PodPath? ResolveLocal(PodBuildSubject subject, PodReference.Local local) =>
        Candidates(PodLayout.SettingsRoot, local.Path).FirstOrDefault(subject.Snapshot.Contains);

    private static bool MatchesAnyFile(IReadOnlySet<string> files, PodPath path) =>
        Candidates(PodLayout.ComposedRoot, path).Any(candidate => files.Contains(candidate.Value));

    /// <summary>
    ///     A reference may omit the schema suffix, so one reference names several possible files.
    ///     That ambiguity is the closure rule's soft spot and is why the reason names the expansion.
    /// </summary>
    private static IEnumerable<PodPath> Candidates(string root, PodPath path) {
        yield return PodPath.Parse($"{root}/{path}");
        foreach (var suffix in PodLayout.DocumentSuffixes.Keys)
            yield return PodPath.Parse($"{root}/{path}{suffix}");
    }
}

public sealed class PodComposedIsClosedGate : PodGate {
    public override string Id => "pod.composed-closed";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "No $include or $preset survives in composed/.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        foreach (var path in subject.Snapshot.Under(PodLayout.ComposedRoot)) {
            JToken parsed;
            try {
                parsed = JToken.Parse(subject.Snapshot.Read(path)!);
            } catch (Newtonsoft.Json.JsonException ex) {
                yield return this.Error(path.Value, $"'{path}' is not valid JSON: {ex.Message}");
                continue;
            }

            if (!ComposedDocument.TryAdopt(path, parsed, out _, out var reason))
                yield return this.Error(path.Value, reason!);
        }
    }
}

/// <summary>
///     Gate table row 4. Only the path half is decidable. "Machine-local content" in general is
///     not: a server share name, a license key, or a company-internal id is indistinguishable from
///     authored intent, so the gate refuses to claim it and the reason says which half ran.
/// </summary>
public sealed class PodNoMachineLocalPathGate : PodGate {
    public override string Id => "pod.no-machine-local-path";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "No rooted, UNC, or environment-variable path in an authored string. Other machine-local content is not detectable.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        foreach (var path in subject.Snapshot.Under(PodLayout.SettingsRoot)) {
            JToken parsed;
            try {
                parsed = JToken.Parse(subject.Snapshot.Read(path)!);
            } catch (Newtonsoft.Json.JsonException) {
                continue;
            }

            foreach (var value in parsed.DescendantsAndSelf().OfType<JValue>().Where(v => v.Type == JTokenType.String)) {
                var text = v_Text(value);
                if (Offence(text) is not { } offence)
                    continue;

                yield return this.Error(
                    $"{path}#{value.Path}",
                    $"'{Trim(text)}' is {offence}. Authored files must not name a location on one machine; reference a pod file with '@local/' or '@<podId>/' instead."
                );
            }
        }
    }

    private static string v_Text(JValue value) => value.Value<string>() ?? string.Empty;

    private static string? Offence(string text) {
        if (text.Length >= 3 && char.IsLetter(text[0]) && text[1] == ':' && (text[2] == '\\' || text[2] == '/'))
            return "a rooted drive path";
        if (text.StartsWith("\\\\", StringComparison.Ordinal))
            return "a UNC share path";
        if (text.Contains('%') && text.Count(c => c == '%') >= 2)
            return "an environment-variable path";
        if (text.StartsWith("/Users/", StringComparison.OrdinalIgnoreCase) || text.StartsWith("/home/", StringComparison.OrdinalIgnoreCase))
            return "a rooted home path";
        return null;
    }

    private static string Trim(string text) => text.Length <= 60 ? text : text[..57] + "...";
}

/// <summary>Verdict 6, the drift rule: composed/ is a cache of settings/ and the build refuses to publish a stale one.</summary>
public sealed class PodComposedIsFreshGate : PodGate {
    public override string Id => "pod.composed-fresh";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "composed/ equals a fresh compose of settings/.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        var onDisk = subject.Snapshot.Under(PodLayout.ComposedRoot).ToDictionary(p => p.Value, p => subject.Snapshot.Read(p)!, StringComparer.OrdinalIgnoreCase);

        foreach (var (path, document) in subject.FreshCompose) {
            if (!onDisk.TryGetValue(path, out var actual)) {
                yield return this.Error(path, $"'{path}' is missing. Run `pea pod build` to write it from settings/.");
                continue;
            }

            if (!string.Equals(Normalize(actual), Normalize(document.Serialize()), StringComparison.Ordinal))
                yield return this.Error(path, $"'{path}' drifted from settings/. Run `pea pod build` to refresh it; do not hand-edit composed/.");
        }

        foreach (var orphan in onDisk.Keys.Where(k => !subject.FreshCompose.ContainsKey(k)))
            yield return this.Error(orphan, $"'{orphan}' has no source under settings/. Delete it or add the source document.");
    }

    private static string Normalize(string json) {
        try {
            return JToken.Parse(json).ToString(Newtonsoft.Json.Formatting.Indented);
        } catch (Newtonsoft.Json.JsonException) {
            return json;
        }
    }
}

/// <summary>Verdict 6: manifest.json holds a sha256 per file in settings/ and composed/.</summary>
public sealed class PodFileIndexGate : PodGate {
    public override string Id => "pod.file-index";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "manifest.json lists exactly the files under settings/ and composed/, with matching sha256.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        var indexJson = subject.Snapshot.Read(PodPath.Parse(PodLayout.FileIndexFile));
        if (indexJson is null) {
            yield return this.Error(PodLayout.FileIndexFile, "manifest.json is missing. Run `pea pod build` to write it.");
            yield break;
        }

        JObject index;
        try {
            index = JObject.Parse(indexJson);
        } catch (Newtonsoft.Json.JsonException ex) {
            yield return this.Error(PodLayout.FileIndexFile, $"manifest.json is not valid JSON: {ex.Message}");
            yield break;
        }

        var files = index["files"] as JObject;
        if (files is null) {
            yield return this.Error(PodLayout.FileIndexFile, "manifest.json requires a 'files' object of path to sha256.");
            yield break;
        }

        var expected = subject.Snapshot.Under(PodLayout.SettingsRoot).Concat(subject.Snapshot.Under(PodLayout.ComposedRoot)).ToList();
        foreach (var path in expected) {
            var claimed = files[path.Value]?.Value<string>();
            if (claimed is null) {
                yield return this.Error(path.Value, $"'{path}' is not listed in manifest.json.");
                continue;
            }

            var actual = PodSnapshot.Sha256(subject.Snapshot.Read(path)!);
            if (!string.Equals(claimed, actual, StringComparison.OrdinalIgnoreCase))
                yield return this.Error(path.Value, $"'{path}' hash {actual[..12]} does not match manifest.json {claimed[..Math.Min(12, claimed.Length)]}.");
        }

        var expectedKeys = expected.Select(p => p.Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var listed in files.Properties().Select(p => p.Name).Where(name => !expectedKeys.Contains(name)))
            yield return this.Error(listed, $"manifest.json lists '{listed}', which is not a file under settings/ or composed/.");
    }
}

/// <summary>
///     Gate table row 6. The "exactly one non-abstract PeScriptContainer" half is not provable
///     here: <see cref="ScriptEntryPointResolver" /> exposes only a boolean
///     (`ScriptEntryPointResolver.cs:25`) and a name list keyed to a
///     `ScriptSourceSet.EntryPointSourceName` this build does not have.
/// </summary>
public sealed class PodEntrypointGate : PodGate {
    private const string ContainerBaseType = "PeScriptContainer";

    public override string Id => "pod.entrypoint";
    public override PodGateLane Lane => PodGateLane.Deterministic;
    public override string Rule => "Every entrypoint file exists and declares a non-abstract PeScriptContainer.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) {
        var resolver = new ScriptEntryPointResolver(ContainerBaseType);
        foreach (var entrypoint in subject.Header.Entrypoints) {
            var path = PodPath.Parse(entrypoint.SourcePath);
            var source = subject.Snapshot.Read(path);
            if (source is null) {
                yield return this.Error(path.Value, $"Entrypoint '{entrypoint.Id}' names '{path}', which does not exist in the pod.");
                continue;
            }

            if (!resolver.ContainsContainerDeclaration(source))
                yield return this.Error(path.Value, $"Entrypoint '{entrypoint.Id}' declares no non-abstract {ContainerBaseType}. Add one class deriving from {ContainerBaseType}.");
        }
    }
}

/// <summary>Gate table row 7: warning at build, hard fail at run.</summary>
public sealed class PodApsCollectionGate : PodGate {
    public override string Id => "pod.aps-collection";
    public override PodGateLane Lane => PodGateLane.Online;
    public override string Rule => "The APS collection named by pod.json resolves.";

    public override IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject) => [];
}
