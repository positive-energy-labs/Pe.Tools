using System.Text;
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
    IReadOnlyList<PodEntrypoint> Entrypoints
);

public sealed record PodEntrypoint(
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
    public const int CurrentSchemaVersion = 2;
    public const string DiagnosticStage = "pod-manifest";

    private static readonly HashSet<string> TopLevelFields = new(StringComparer.Ordinal) {
        "schemaVersion",
        "id",
        "name",
        "version",
        "description",
        "entrypoints"
    };

    private static readonly HashSet<string> EntrypointFields = new(StringComparer.Ordinal) {
        "sourcePath",
        "name",
        "description"
    };

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>
    ///     The one text decoding of pod.json bytes: strict UTF-8, where a single leading UTF-8 BOM is framing
    ///     (as File.ReadAllText reads it); anything else, a second BOM included, reaches the JSON parser.
    ///     Callers keep the original bytes for hashes and receipts; nothing here rewrites them.
    /// </summary>
    public static PodManifestValidationResult ValidateUtf8(byte[] bytes) {
        if (bytes is null)
            throw new ArgumentNullException(nameof(bytes));
        var offset = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF ? 3 : 0;
        string json;
        try {
            json = StrictUtf8.GetString(bytes, offset, bytes.Length - offset);
        } catch (DecoderFallbackException ex) {
            return new PodManifestValidationResult(null, [ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json is not valid UTF-8: {ex.Message}")]);
        }
        return ValidateJson(json);
    }

    public static PodManifestValidationResult ValidateJson(string json) {
        if (json is null)
            throw new ArgumentNullException(nameof(json));

        var diagnostics = new List<ScriptDiagnostic>();

        JObject root;
        try {
            root = JObject.Parse(json, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
        } catch (JsonException ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json is not valid JSON: {ex.Message}"));
            return new PodManifestValidationResult(null, diagnostics);
        }

        AddUnknownFieldDiagnostics(root, TopLevelFields, diagnostics, "pod.json");

        var schemaVersion = ReadRequiredInteger(root, "schemaVersion", diagnostics);
        if (schemaVersion.HasValue && schemaVersion.Value != CurrentSchemaVersion)
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json schemaVersion must be {CurrentSchemaVersion}."));

        var id = ReadIdentityString(root, "id", diagnostics);
        if (id is not null && (!ScriptingWorkspaceLayout.IsWorkspaceSlug(id) || id is "pages" or "skills" or "product"))
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, "pod.json id must be a lowercase workspace slug."));

        var name = ReadRequiredString(root, "name", diagnostics);
        var version = ReadRequiredString(root, "version", diagnostics);
        var description = ReadOptionalString(root, "description", diagnostics);
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
                entrypoints
            ),
            diagnostics
        );
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
        var sourcePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < array.Count; index++) {
            if (array[index] is not JObject obj) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json entrypoints[{index}] must be an object."));
                continue;
            }

            AddUnknownFieldDiagnostics(obj, EntrypointFields, diagnostics, $"entrypoints[{index}]");
            var sourcePath = ReadIdentityString(obj, "sourcePath", diagnostics);
            if (sourcePath is not null) {
                try {
                    var normalized = ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath, "Pod entrypoint source path");
                    if (sourcePath.Length > 1024 || normalized != sourcePath || sourcePath.Normalize() != sourcePath || sourcePath.IndexOfAny(['%', '#', '\u007f']) >= 0 ||
                        sourcePath.Split('/').Any(segment => segment.Trim() != segment || segment.EndsWith(".", StringComparison.Ordinal) ||
                            System.Text.RegularExpressions.Regex.IsMatch(segment, @"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)))
                        throw new ArgumentException("Pod entrypoint source path must use its exact portable src/ path.");
                    if (!sourcePaths.Add(sourcePath))
                        diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"Duplicate pod entrypoint sourcePath '{sourcePath}'."));
                } catch (ArgumentException ex) {
                    diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, ex.Message));
                    sourcePath = null;
                }
            }

            var name = ReadOptionalString(obj, "name", diagnostics);
            var description = ReadOptionalString(obj, "description", diagnostics);
            if (sourcePath is not null)
                entrypoints.Add(new PodEntrypoint(sourcePath, name, description));
        }

        return entrypoints;
    }

    private static string? ReadIdentityString(JObject root, string fieldName, List<ScriptDiagnostic> diagnostics) {
        var value = ReadRequiredString(root, fieldName, diagnostics);
        if (value is not null && root[fieldName]!.Value<string>() != value)
            diagnostics.Add(ScriptDiagnosticFactory.Error(DiagnosticStage, $"pod.json field '{fieldName}' must use its exact spelling."));
        return value;
    }
}
