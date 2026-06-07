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
    PodOrigin? Origin,
    IReadOnlyList<PodEntrypoint> Entrypoints
);

public sealed record PodOrigin(
    string Path
);

public sealed record PodEntrypoint(
    string Id,
    string SourcePath,
    string? Name,
    string? Description
);

public sealed record PodManifestValidationResult(
    PodManifest? Manifest,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
) {
    public bool Success => this.Manifest is not null && this.Diagnostics.All(diagnostic => diagnostic.Severity != ScriptDiagnosticSeverity.Error);
}

public static class PodManifestValidator {
    public const int CurrentSchemaVersion = 1;
    public const string DiagnosticStage = "pod-manifest";

    private static readonly HashSet<string> TopLevelFields = new(StringComparer.Ordinal) {
        "schemaVersion",
        "id",
        "name",
        "version",
        "description",
        "origin",
        "entrypoints"
    };

    private static readonly HashSet<string> OriginFields = new(StringComparer.Ordinal) {
        "path"
    };

    private static readonly HashSet<string> EntrypointFields = new(StringComparer.Ordinal) {
        "id",
        "sourcePath",
        "name",
        "description"
    };

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
        var origin = ReadOrigin(root, diagnostics);
        var entrypoints = ReadEntrypoints(root, diagnostics);

        if (diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error))
            return new PodManifestValidationResult(null, diagnostics);

        return new PodManifestValidationResult(
            new PodManifest(
                schemaVersion!.Value,
                id!,
                name!,
                version!,
                description,
                origin,
                entrypoints
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

    private static PodOrigin? ReadOrigin(JObject root, List<ScriptDiagnostic> diagnostics) {
        var token = root["origin"];
        if (token is null || token.Type == JTokenType.Null)
            return null;

        if (token is not JObject obj) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json field 'origin' must be an object."));
            return null;
        }

        AddUnknownFieldDiagnostics(obj, OriginFields, diagnostics, "origin");
        var path = ReadRequiredString(obj, "path", diagnostics);
        if (path is not null && !IsAbsoluteLocalPath(path))
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json origin.path must be an absolute local path."));

        return path is null ? null : new PodOrigin(path);
    }

    private static bool IsAbsoluteLocalPath(string path) {
        if (Uri.TryCreate(path, UriKind.Absolute, out var uri) && !uri.IsFile)
            return false;

        var root = Path.GetPathRoot(path);
        return !string.IsNullOrWhiteSpace(root)
               && !string.Equals(root, Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
               && path.Length > root.Length;
    }

    private static IReadOnlyList<PodEntrypoint> ReadEntrypoints(JObject root, List<ScriptDiagnostic> diagnostics) {
        var token = root["entrypoints"];
        if (token is null) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json is missing required field 'entrypoints'."));
            return [];
        }

        if (token is not JArray array) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json field 'entrypoints' must be an array."));
            return [];
        }

        if (array.Count == 0)
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json field 'entrypoints' must contain at least one entrypoint."));

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
}
