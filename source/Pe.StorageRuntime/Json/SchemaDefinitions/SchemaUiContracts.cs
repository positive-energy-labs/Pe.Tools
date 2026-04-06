using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;
using TypeGen.Core.TypeAnnotations;

namespace Pe.StorageRuntime.Json.SchemaDefinitions;

public static class SchemaUiRendererKeys {
    public const string Table = "table";
}

[ExportTsInterface]
public sealed record SchemaUiMetadata {
    public string? Renderer { get; init; }
    public SchemaUiLayoutMetadata? Layout { get; init; }
    public SchemaUiBehaviorMetadata? Behavior { get; init; }
}

[ExportTsInterface]
public sealed record SchemaUiLayoutMetadata {
    public string? Section { get; init; }
    public bool? Advanced { get; init; }
}

[ExportTsInterface]
public sealed record SchemaUiBehaviorMetadata {
    public IReadOnlyList<string> FixedColumns { get; init; } = [];
    public bool? DynamicColumnsFromAdditionalProperties { get; init; }
    public string? MissingValue { get; init; }
    public SchemaUiDynamicColumnOrderMetadata? DynamicColumnOrder { get; init; }
}

[ExportTsInterface]
public sealed record SchemaUiDynamicColumnOrderMetadata {
    public string? Source { get; init; }
    public IReadOnlyList<string> Values { get; init; } = [];
}

public interface ISchemaUiDynamicColumnOrderSource {
    string Key { get; }
    SettingsRuntimeMode RequiredRuntimeMode { get; }

    ValueTask<IReadOnlyList<string>> GetValuesAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    );
}
