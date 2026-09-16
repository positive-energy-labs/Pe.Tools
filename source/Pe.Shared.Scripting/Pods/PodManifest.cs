using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Execution;

namespace Pe.Shared.Scripting.Pods;

public sealed record PodManifest(
    int SchemaVersion,
    string Id,
    string Name,
    string Version,
    string? Description,
    IReadOnlyList<PodEntrypoint> Entrypoints,
    IReadOnlyList<PodRequirement> Requires,
    PodReleaseReference? Parent,
    PodOrigin? Origin,
    IReadOnlyList<PodExternalRequirement> ExternalRequirements
);

public sealed record PodEntrypoint(
    string Id,
    string SourcePath,
    string? Name,
    string? Description
);

public sealed record PodRequirement(string Id, string ReleaseHash, string? Version);

public sealed record PodReleaseReference(string Id, string ReleaseHash, string? Version);

/// <summary>A transport locator. It is not release ancestry or content identity.</summary>
public sealed record PodOrigin(string Locator);

/// <summary>An execution-time dependency. Portable releases never carry a cached fallback.</summary>
public sealed record PodExternalRequirement(string Code, string ResourceId, string? CollectionId);

public sealed record PodManifestValidationResult(
    PodManifest? Manifest,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
) {
    public bool Success => this.Manifest is not null && this.Diagnostics.All(diagnostic => diagnostic.Severity != ScriptDiagnosticSeverity.Error);
}

public static class PodManifestValidator {
    public const int CurrentSchemaVersion = 2;
    public const string DiagnosticStage = "pod-manifest";

    private static readonly HashSet<string> TopLevelFields = new(StringComparer.Ordinal) {
        "schemaVersion",
        "id",
        "name",
        "version",
        "description",
        "entrypoints",
        "requires",
        "parent",
        "origin",
        "externalRequirements"
    };

    private static readonly HashSet<string> EntrypointFields = new(StringComparer.Ordinal) {
        "id",
        "sourcePath",
        "name",
        "description"
    };

    private static readonly HashSet<string> RequirementFields = new(StringComparer.Ordinal) { "id", "releaseHash", "version" };
    private static readonly HashSet<string> ReleaseReferenceFields = new(StringComparer.Ordinal) { "id", "releaseHash", "version" };
    private static readonly HashSet<string> OriginFields = new(StringComparer.Ordinal) { "locator" };
    private static readonly HashSet<string> ExternalRequirementFields = new(StringComparer.Ordinal) { "code", "resourceId", "collectionId" };

    public static PodManifestValidationResult ValidateJson(string json) =>
        ValidateJson(json, null, false);

    public static PodManifestValidationResult ValidateJson(string json, string workspaceKey) =>
        ValidateJson(json, workspaceKey, true);

    private static PodManifestValidationResult ValidateJson(string json, string? workspaceKey, bool requireWorkspaceMatch) {
        if (json is null)
            throw new ArgumentNullException(nameof(json));

        var diagnostics = new List<ScriptDiagnostic>();
        var normalizedWorkspaceKey = requireWorkspaceMatch
            ? NormalizeWorkspaceKey(workspaceKey, diagnostics)
            : null;

        JObject root;
        try {
            root = JObject.Parse(json);
        } catch (JsonException ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json is not valid JSON: {ex.Message}"));
            return new PodManifestValidationResult(null, diagnostics);
        }

        AddUnknownFieldDiagnostics(root, TopLevelFields, diagnostics, "pod.json");

        var schemaVersion = ReadRequiredInteger(root, "schemaVersion", diagnostics);
        if (schemaVersion.HasValue && schemaVersion.Value != CurrentSchemaVersion)
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json schemaVersion must be {CurrentSchemaVersion}."));

        var id = ReadRequiredString(root, "id", diagnostics);
        if (id is not null && !ScriptingWorkspaceLayout.IsWorkspaceSlug(id))
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json id must be a lowercase workspace slug."));

        if (id is not null && normalizedWorkspaceKey is not null && !string.Equals(id, normalizedWorkspaceKey, StringComparison.Ordinal))
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json id '{id}' must match workspace key '{normalizedWorkspaceKey}'."));

        var name = ReadRequiredString(root, "name", diagnostics);
        var version = ReadRequiredString(root, "version", diagnostics);
        var description = ReadOptionalString(root, "description", diagnostics);
        var entrypoints = ReadEntrypoints(root, diagnostics);
        var requires = ReadRequirements(root, diagnostics);
        var parent = ReadReleaseReference(root, "parent", diagnostics);
        var origin = ReadOrigin(root, diagnostics);
        var externalRequirements = ReadExternalRequirements(root, diagnostics);

        if (diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error))
            return new PodManifestValidationResult(null, diagnostics);

        return new PodManifestValidationResult(
            new PodManifest(
                schemaVersion!.Value,
                id!,
                name!,
                version!,
                description,
                entrypoints,
                requires,
                parent,
                origin,
                externalRequirements
            ),
            diagnostics
        );
    }

    private static string? NormalizeWorkspaceKey(string? workspaceKey, List<ScriptDiagnostic> diagnostics) {
        try {
            return ScriptingWorkspaceLayout.NormalizeWorkspaceKey(workspaceKey);
        } catch (ArgumentException ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, ex.Message));
            return null;
        }
    }

    private static void AddUnknownFieldDiagnostics(JObject obj, HashSet<string> knownFields, List<ScriptDiagnostic> diagnostics, string owner) {
        foreach (var property in obj.Properties()) {
            if (!knownFields.Contains(property.Name))
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"Unknown field '{property.Name}' in {owner}."));
        }
    }

    private static int? ReadRequiredInteger(JObject root, string fieldName, List<ScriptDiagnostic> diagnostics) {
        var token = root[fieldName];
        if (token is null) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json is missing required field '{fieldName}'."));
            return null;
        }

        if (token.Type == JTokenType.Integer)
            return token.Value<int>();

        diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json field '{fieldName}' must be an integer."));
        return null;
    }

    private static string? ReadRequiredString(JObject root, string fieldName, List<ScriptDiagnostic> diagnostics) {
        var value = ReadOptionalString(root, fieldName, diagnostics);
        if (string.IsNullOrWhiteSpace(value))
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json is missing required field '{fieldName}'."));
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string? ReadOptionalString(JObject root, string fieldName, List<ScriptDiagnostic> diagnostics) {
        var token = root[fieldName];
        if (token is null || token.Type == JTokenType.Null)
            return null;

        if (token.Type == JTokenType.String) {
            var value = token.Value<string>()?.Trim();
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json field '{fieldName}' must be a string."));
        return null;
    }

    private static IReadOnlyList<PodEntrypoint> ReadEntrypoints(JObject root, List<ScriptDiagnostic> diagnostics) {
        var token = root["entrypoints"];
        if (token is null || token.Type == JTokenType.Null)
            return [];

        if (token is not JArray array) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json field 'entrypoints' must be an array."));
            return [];
        }

        var entrypoints = new List<PodEntrypoint>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var sourcePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < array.Count; index++) {
            if (array[index] is not JObject obj) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json entrypoints[{index}] must be an object."));
                continue;
            }

            AddUnknownFieldDiagnostics(obj, EntrypointFields, diagnostics, $"entrypoints[{index}]");
            var id = ReadRequiredString(obj, "id", diagnostics);
            if (id is not null && !ScriptingWorkspaceLayout.IsWorkspaceSlug(id))
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json entrypoints[{index}].id must be a lowercase slug."));
            if (id is not null && !ids.Add(id))
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"Duplicate pod entrypoint id '{id}'."));

            var sourcePath = ReadRequiredString(obj, "sourcePath", diagnostics);
            if (sourcePath is not null) {
                try {
                    sourcePath = ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath, "Pod entrypoint source path");
                    if (!sourcePaths.Add(sourcePath))
                        diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"Duplicate pod entrypoint sourcePath '{sourcePath}'."));
                } catch (ArgumentException ex) {
                    diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, ex.Message));
                    sourcePath = null;
                }
            }

            var name = ReadOptionalString(obj, "name", diagnostics);
            var description = ReadOptionalString(obj, "description", diagnostics);
            if (id is not null && sourcePath is not null)
                entrypoints.Add(new PodEntrypoint(id, sourcePath, name, description));
        }

        return entrypoints;
    }

    private static IReadOnlyList<PodRequirement> ReadRequirements(JObject root, List<ScriptDiagnostic> diagnostics) {
        var token = root["requires"];
        if (token is null || token.Type == JTokenType.Null)
            return [];
        if (token is not JArray array) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json field 'requires' must be an array."));
            return [];
        }

        var requirements = new List<PodRequirement>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < array.Count; index++) {
            if (array[index] is not JObject obj) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json requires[{index}] must be an object."));
                continue;
            }
            AddUnknownFieldDiagnostics(obj, RequirementFields, diagnostics, $"requires[{index}]");
            var id = ReadRequiredString(obj, "id", diagnostics);
            var releaseHash = ReadRequiredString(obj, "releaseHash", diagnostics);
            var version = ReadOptionalString(obj, "version", diagnostics);
            if (id is not null && !ScriptingWorkspaceLayout.IsWorkspaceSlug(id))
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json requires[{index}].id must be a lowercase workspace slug."));
            if (id is not null && !ids.Add(id))
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"Duplicate pod requirement id '{id}'."));
            if (releaseHash is not null && !IsSha256(releaseHash))
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json requires[{index}].releaseHash must be a lowercase SHA-256 digest."));
            if (id is not null && releaseHash is not null && IsSha256(releaseHash))
                requirements.Add(new PodRequirement(id, releaseHash, version));
        }
        return requirements;
    }

    private static PodReleaseReference? ReadReleaseReference(JObject root, string fieldName, List<ScriptDiagnostic> diagnostics) {
        var token = root[fieldName];
        if (token is null || token.Type == JTokenType.Null)
            return null;
        if (token is not JObject obj) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json field '{fieldName}' must be an object."));
            return null;
        }
        AddUnknownFieldDiagnostics(obj, ReleaseReferenceFields, diagnostics, fieldName);
        var id = ReadRequiredString(obj, "id", diagnostics);
        var releaseHash = ReadRequiredString(obj, "releaseHash", diagnostics);
        var version = ReadOptionalString(obj, "version", diagnostics);
        if (id is not null && !ScriptingWorkspaceLayout.IsWorkspaceSlug(id))
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json {fieldName}.id must be a lowercase workspace slug."));
        if (releaseHash is not null && !IsSha256(releaseHash))
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json {fieldName}.releaseHash must be a lowercase SHA-256 digest."));
        return id is not null && releaseHash is not null && IsSha256(releaseHash)
            ? new PodReleaseReference(id, releaseHash, version)
            : null;
    }

    private static PodOrigin? ReadOrigin(JObject root, List<ScriptDiagnostic> diagnostics) {
        var token = root["origin"];
        if (token is null || token.Type == JTokenType.Null)
            return null;
        if (token is not JObject obj) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json field 'origin' must be an object."));
            return null;
        }
        AddUnknownFieldDiagnostics(obj, OriginFields, diagnostics, "origin");
        var locator = ReadRequiredString(obj, "locator", diagnostics);
        return locator is null ? null : new PodOrigin(locator);
    }

    private static IReadOnlyList<PodExternalRequirement> ReadExternalRequirements(JObject root, List<ScriptDiagnostic> diagnostics) {
        var token = root["externalRequirements"];
        if (token is null || token.Type == JTokenType.Null)
            return [];
        if (token is not JArray array) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json field 'externalRequirements' must be an array."));
            return [];
        }
        var requirements = new List<PodExternalRequirement>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < array.Count; index++) {
            if (array[index] is not JObject obj) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json externalRequirements[{index}] must be an object."));
                continue;
            }
            AddUnknownFieldDiagnostics(obj, ExternalRequirementFields, diagnostics, $"externalRequirements[{index}]");
            var code = ReadRequiredString(obj, "code", diagnostics);
            var resourceId = ReadRequiredString(obj, "resourceId", diagnostics);
            var collectionId = ReadOptionalString(obj, "collectionId", diagnostics);
            if (code is not null && resourceId is not null) {
                var key = $"{code}\0{collectionId}\0{resourceId}";
                if (!keys.Add(key))
                    diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"Duplicate external requirement '{code}:{resourceId}'."));
                else
                    requirements.Add(new PodExternalRequirement(code, resourceId, collectionId));
            }
        }
        return requirements;
    }

    private static bool IsSha256(string value) =>
        value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
}
