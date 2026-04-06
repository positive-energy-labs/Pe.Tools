using Newtonsoft.Json.Linq;

namespace Pe.Shared.StorageRuntime.Json;

/// <summary>
///     Expands object-level $preset directives by resolving preset JSON objects.
///     Preset composition is strict: '$preset' cannot be combined with sibling properties.
/// </summary>
public static class JsonPresetComposer {
    public static JObject ExpandPresets(
        JObject root,
        string localPresetsRootDirectory,
        IEnumerable<string>? allowedRoots = null,
        Action<string, string>? onPresetResolved = null,
        string? globalPresetsDirectory = null
    ) {
        var normalizedLocalRoot = Path.GetFullPath(localPresetsRootDirectory);
        var normalizedGlobalRoot = string.IsNullOrWhiteSpace(globalPresetsDirectory)
            ? null
            : Path.GetFullPath(globalPresetsDirectory);
        var normalizedAllowedRoots = SettingsPathing.NormalizeAllowedRoots(allowedRoots);
        var visitedPresets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        JToken ExpandToken(JToken token) {
            switch (token) {
            case JObject obj:
                return ExpandObject(obj);
            case JArray arr:
                for (var i = 0; i < arr.Count; i++)
                    arr[i] = ExpandToken(arr[i]!);
                return arr;
            default:
                return token;
            }
        }

        JObject ExpandObject(JObject obj) {
            if (obj.TryGetValue("$preset", out var presetToken)) {
                var hasSiblingOverrides = obj.Properties()
                    .Any(p => !string.Equals(p.Name, "$preset", StringComparison.Ordinal));
                if (hasSiblingOverrides)
                    throw JsonCompositionException.PresetOverridesNotSupported();

                var (originalPath, resolvedDirective) = ResolvePresetPath(presetToken);
                var resolvedPresetPath = ResolvePresetFilePath(resolvedDirective);

                if (visitedPresets.Contains(resolvedPresetPath)) {
                    throw JsonCompositionException.CircularPresetInclude(
                        resolvedPresetPath,
                        [.. visitedPresets, resolvedPresetPath]
                    );
                }

                return LoadExpandedPresetObject(resolvedPresetPath, originalPath);
            }

            foreach (var property in obj.Properties().ToList())
                property.Value = ExpandToken(property.Value);

            return obj;
        }

        (string originalPath, SettingsPathing.ResolvedDirective resolvedDirective)
            ResolvePresetPath(JToken presetToken) {
            if (presetToken.Type != JTokenType.String || string.IsNullOrWhiteSpace(presetToken.Value<string>()))
                throw JsonCompositionException.InvalidPresetValue(presetToken.Type.ToString());

            var originalPath = presetToken.Value<string>()!;
            try {
                var resolvedDirective = SettingsPathing.ResolveDirectivePath(
                    originalPath,
                    normalizedLocalRoot,
                    normalizedGlobalRoot,
                    normalizedAllowedRoots,
                    nameof(presetToken),
                    false
                );
                return (originalPath, resolvedDirective);
            } catch (ArgumentException) {
                throw JsonCompositionException.InvalidPresetPath(originalPath, normalizedAllowedRoots);
            }
        }

        JObject LoadExpandedPresetObject(string presetPath, string includePath) {
            try {
                _ = visitedPresets.Add(presetPath);
                var content = File.ReadAllText(presetPath);
                var parsed = JToken.Parse(content);
                if (parsed is not JObject presetObject)
                    throw JsonCompositionException.InvalidPresetFormat(presetPath, parsed.Type.ToString());

                onPresetResolved?.Invoke(presetPath, includePath);
                var expandedPreset = ExpandObject((JObject)presetObject.DeepClone());
                _ = expandedPreset.Remove("$schema");
                return expandedPreset;
            } catch (JsonCompositionException) {
                throw;
            } catch (Exception ex) {
                throw JsonCompositionException.PresetLoadFailed(presetPath, ex);
            } finally {
                _ = visitedPresets.Remove(presetPath);
            }
        }

        root = (JObject)ExpandToken(root);
        return root;
    }

    private static string ResolvePresetFilePath(SettingsPathing.ResolvedDirective directive) {
        var candidates = SettingsPathing.ResolveDirectiveFileCandidates(directive, false);
        if (File.Exists(candidates.JsonPath))
            return candidates.JsonPath;

        throw JsonCompositionException.PresetNotFound(candidates.JsonPath);
    }
}