using Newtonsoft.Json;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using System.Linq.Expressions;
using System.Reflection;

namespace Pe.Shared.StorageRuntime.Json.SchemaDefinitions;

public interface ISettingsSchemaDefinition {
    Type SettingsType { get; }
    SettingsSchemaDefinitionDescriptor Build();
}

public interface ISettingsSchemaDefinition<TSettings> : ISettingsSchemaDefinition {
    void Configure(ISettingsSchemaBuilder<TSettings> builder);
}

public abstract class SettingsSchemaDefinition<TSettings> : ISettingsSchemaDefinition<TSettings> {
    public Type SettingsType => typeof(TSettings);

    public abstract void Configure(ISettingsSchemaBuilder<TSettings> builder);

    public SettingsSchemaDefinitionDescriptor Build() {
        var builder = new SettingsSchemaBuilder<TSettings>();
        this.Configure(builder);
        return builder.Build(this.SettingsType);
    }
}

public interface ISettingsSchemaBuilder<TSettings> {
    void Data(
        string id,
        Action<ISettingsDataBuilder> configure
    );

    void Property<TValue>(
        Expression<Func<TSettings, TValue>> propertyExpression,
        Action<ISettingsPropertyBuilder<TValue>> configure
    );
}

public interface ISettingsDataBuilder {
    void Provider(string provider);
    void Load(SettingsSchemaDatasetLoadMode loadMode);
    void StaleOn(params string[] staleOn);
    void SupportsProjection(params string[] projections);
}

public interface ISettingsPropertyBuilder<TValue> {
    void UseFieldOptions<TSource>() where TSource : IFieldOptionsSource, new();

    void UseDatasetOptions(
        string datasetRef,
        string projection,
        SettingsOptionsMode mode = SettingsOptionsMode.Suggestion,
        bool allowsCustomValue = true,
        string? key = null
    );

    void DependsOnContext(params string[] keys);
    void DependsOnSibling(params string[] keys);
    void UseStaticExamples(params string[] values);
    void WithDescription(string description);
    void WithDisplayName(string displayName);
    void Ui(Action<ISchemaUiBuilder> configure);
}

public interface ISchemaUiBuilder {
    void Renderer(string renderer);
    void Layout(Action<ISchemaUiLayoutBuilder> configure);
    void Behavior(Action<ISchemaUiBehaviorBuilder> configure);
}

public interface ISchemaUiLayoutBuilder {
    void Section(string section);
    void Advanced(bool advanced = true);
}

public interface ISchemaUiBehaviorBuilder {
    void FixedColumns(params string[] columns);
    void FixedColumns<TItem>(params Expression<Func<TItem, object?>>[] propertyExpressions);
    void DynamicColumnsFromAdditionalProperties(bool enabled = true);
    void MissingValue(string missingValue);
    void DynamicColumnOrder<TSource>() where TSource : ISchemaUiDynamicColumnOrderSource, new();
}

public enum SettingsSchemaDatasetLoadMode {
    Eager,
    Manual,
    Visible
}

public sealed class SettingsSchemaDefinitionDescriptor(
    Type settingsType,
    IReadOnlyDictionary<string, SettingsSchemaDatasetBinding> datasets,
    IReadOnlyDictionary<string, SettingsSchemaPropertyBinding> bindings
) {
    public Type SettingsType { get; } = settingsType;
    public IReadOnlyDictionary<string, SettingsSchemaDatasetBinding> Datasets { get; } = datasets;
    public IReadOnlyDictionary<string, SettingsSchemaPropertyBinding> Bindings { get; } = bindings;
}

public sealed class SettingsSchemaDatasetBinding {
    public string Id { get; init; } = string.Empty;
    public string Provider { get; init; } = string.Empty;
    public SettingsSchemaDatasetLoadMode LoadMode { get; init; } = SettingsSchemaDatasetLoadMode.Manual;
    public IReadOnlyList<string> StaleOn { get; init; } = [];
    public IReadOnlyList<string> SupportedProjections { get; init; } = [];
}

public sealed class SettingsSchemaDatasetOptionsBinding {
    public string Key { get; init; } = string.Empty;
    public string DatasetRef { get; init; } = string.Empty;
    public string Projection { get; init; } = string.Empty;
    public SettingsOptionsMode Mode { get; init; } = SettingsOptionsMode.Suggestion;
    public bool AllowsCustomValue { get; init; } = true;
    public IReadOnlyList<FieldOptionsDependency> DependsOn { get; init; } = [];
}

public sealed class SettingsSchemaPropertyBinding {
    public string JsonPropertyName { get; init; } = string.Empty;
    public IReadOnlyList<string> StaticExamples { get; init; } = [];
    public string? Description { get; init; }
    public string? DisplayName { get; init; }
    public IFieldOptionsSource? FieldOptionsSource { get; init; }
    public SettingsSchemaDatasetOptionsBinding? DatasetOptions { get; init; }
    public SchemaUiMetadata? Ui { get; init; }
    internal ISchemaUiDynamicColumnOrderSource? UiDynamicColumnOrderSource { get; init; }
}

internal sealed class SettingsSchemaBuilder<TSettings> : ISettingsSchemaBuilder<TSettings> {
    private readonly Dictionary<string, SettingsSchemaPropertyBinding> _bindings =
        new(StringComparer.OrdinalIgnoreCase);

    private readonly Dictionary<string, SettingsSchemaDatasetBinding> _datasets =
        new(StringComparer.OrdinalIgnoreCase);

    public void Data(string id, Action<ISettingsDataBuilder> configure) {
        if (string.IsNullOrWhiteSpace(id))
            throw new ArgumentException("Dataset id is required.", nameof(id));
        if (configure == null)
            throw new ArgumentNullException(nameof(configure));

        var builder = new SettingsSchemaDataBindingBuilder(id);
        configure(builder);
        this._datasets[id] = builder.Build();
    }

    public void Property<TValue>(
        Expression<Func<TSettings, TValue>> propertyExpression,
        Action<ISettingsPropertyBuilder<TValue>> configure
    ) {
        if (propertyExpression == null)
            throw new ArgumentNullException(nameof(propertyExpression));
        if (configure == null)
            throw new ArgumentNullException(nameof(configure));

        var propertyInfo = SettingsPropertyPathResolver.ResolveProperty(propertyExpression);
        var bindingBuilder = new SettingsPropertyBindingBuilder<TValue>(propertyInfo);
        configure(bindingBuilder);
        this._bindings[propertyInfo.Name] = bindingBuilder.Build();
    }

    public SettingsSchemaDefinitionDescriptor Build(Type settingsType) =>
        new(settingsType, this._datasets, this._bindings);
}

internal sealed class SettingsPropertyBindingBuilder<TValue>(PropertyInfo propertyInfo)
    : ISettingsPropertyBuilder<TValue> {
    private readonly List<FieldOptionsDependency> _dependsOn = [];
    private readonly List<string> _staticExamples = [];
    private SettingsSchemaDatasetOptionsBinding? _datasetOptions;
    private string? _description;
    private string? _displayName;
    private IFieldOptionsSource? _fieldOptionsSource;
    private ISchemaUiDynamicColumnOrderSource? _uiDynamicColumnOrderSource;
    private SchemaUiMetadata? _uiMetadata;

    public void UseFieldOptions<TSource>() where TSource : IFieldOptionsSource, new() {
        this.ThrowIfOptionsAlreadyConfigured();
        this._fieldOptionsSource = new TSource();
    }

    public void UseDatasetOptions(
        string datasetRef,
        string projection,
        SettingsOptionsMode mode = SettingsOptionsMode.Suggestion,
        bool allowsCustomValue = true,
        string? key = null
    ) {
        this.ThrowIfOptionsAlreadyConfigured();
        if (string.IsNullOrWhiteSpace(datasetRef))
            throw new ArgumentException("Dataset ref is required.", nameof(datasetRef));
        if (string.IsNullOrWhiteSpace(projection))
            throw new ArgumentException("Projection is required.", nameof(projection));

        this._datasetOptions = new SettingsSchemaDatasetOptionsBinding {
            Key = string.IsNullOrWhiteSpace(key) ? $"{datasetRef}.{projection}" : key,
            DatasetRef = datasetRef,
            Projection = projection,
            Mode = mode,
            AllowsCustomValue = allowsCustomValue,
            DependsOn = this._dependsOn.ToList()
        };
    }

    public void DependsOnContext(params string[] keys) =>
        this.AddDependencies(SettingsOptionsDependencyScope.Context, keys);

    public void DependsOnSibling(params string[] keys) =>
        this.AddDependencies(SettingsOptionsDependencyScope.Sibling, keys);

    public void UseStaticExamples(params string[] values) {
        if (values == null)
            return;

        foreach (var value in values.Where(value => !string.IsNullOrWhiteSpace(value)))
            this._staticExamples.Add(value);
    }

    public void WithDescription(string description) => this._description = description;

    public void WithDisplayName(string displayName) => this._displayName = displayName;

    public void Ui(Action<ISchemaUiBuilder> configure) {
        if (configure == null)
            throw new ArgumentNullException(nameof(configure));

        var builder = new SchemaUiBuilder();
        configure(builder);
        var result = builder.Build();
        this._uiMetadata = result.Metadata;
        this._uiDynamicColumnOrderSource = result.DynamicColumnOrderSource;
    }

    private void ThrowIfOptionsAlreadyConfigured() {
        if (this._fieldOptionsSource != null || this._datasetOptions != null) {
            throw new InvalidOperationException(
                $"Property '{propertyInfo.Name}' cannot configure both remote and dataset-backed field options."
            );
        }
    }

    private void AddDependencies(SettingsOptionsDependencyScope scope, params string[] keys) {
        if (keys == null)
            return;

        foreach (var key in keys.Where(value => !string.IsNullOrWhiteSpace(value))) {
            if (!this._dependsOn.Any(item =>
                    string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase) &&
                    item.Scope == scope))
                this._dependsOn.Add(new FieldOptionsDependency(key, scope));
        }
    }

    public SettingsSchemaPropertyBinding Build() => new() {
        JsonPropertyName = propertyInfo.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName ?? propertyInfo.Name,
        StaticExamples = this._staticExamples.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
        Description = this._description,
        DisplayName = this._displayName,
        FieldOptionsSource = this._fieldOptionsSource,
        DatasetOptions = this._datasetOptions == null
            ? null
            : new SettingsSchemaDatasetOptionsBinding {
                Key = this._datasetOptions.Key,
                DatasetRef = this._datasetOptions.DatasetRef,
                Projection = this._datasetOptions.Projection,
                Mode = this._datasetOptions.Mode,
                AllowsCustomValue = this._datasetOptions.AllowsCustomValue,
                DependsOn = this._dependsOn.ToList()
            },
        Ui = this._uiMetadata,
        UiDynamicColumnOrderSource = this._uiDynamicColumnOrderSource
    };
}

internal sealed class SettingsSchemaDataBindingBuilder(string id) : ISettingsDataBuilder {
    private readonly List<string> _staleOn = [];
    private readonly List<string> _supportedProjections = [];
    private SettingsSchemaDatasetLoadMode _loadMode = SettingsSchemaDatasetLoadMode.Manual;
    private string? _provider;

    public void Provider(string provider) => this._provider = string.IsNullOrWhiteSpace(provider) ? null : provider;

    public void Load(SettingsSchemaDatasetLoadMode loadMode) => this._loadMode = loadMode;

    public void StaleOn(params string[] staleOn) {
        if (staleOn == null)
            return;

        foreach (var value in staleOn.Where(value => !string.IsNullOrWhiteSpace(value))) {
            if (!this._staleOn.Contains(value, StringComparer.OrdinalIgnoreCase))
                this._staleOn.Add(value);
        }
    }

    public void SupportsProjection(params string[] projections) {
        if (projections == null)
            return;

        foreach (var projection in projections.Where(value => !string.IsNullOrWhiteSpace(value))) {
            if (!this._supportedProjections.Contains(projection, StringComparer.OrdinalIgnoreCase))
                this._supportedProjections.Add(projection);
        }
    }

    public SettingsSchemaDatasetBinding Build() => new() {
        Id = id,
        Provider = this._provider ?? throw new InvalidOperationException($"Dataset '{id}' must declare a provider."),
        LoadMode = this._loadMode,
        StaleOn = this._staleOn.ToList(),
        SupportedProjections = this._supportedProjections.ToList()
    };
}

internal sealed record SchemaUiBuildResult(
    SchemaUiMetadata? Metadata,
    ISchemaUiDynamicColumnOrderSource? DynamicColumnOrderSource
);

internal sealed class SchemaUiBuilder : ISchemaUiBuilder {
    private SchemaUiBehaviorMetadata? _behavior;
    private ISchemaUiDynamicColumnOrderSource? _dynamicColumnOrderSource;
    private SchemaUiLayoutMetadata? _layout;
    private string? _renderer;

    public void Renderer(string renderer) => this._renderer = string.IsNullOrWhiteSpace(renderer) ? null : renderer;

    public void Layout(Action<ISchemaUiLayoutBuilder> configure) {
        if (configure == null)
            throw new ArgumentNullException(nameof(configure));

        var builder = new SchemaUiLayoutBuilder();
        configure(builder);
        this._layout = builder.Build();
    }

    public void Behavior(Action<ISchemaUiBehaviorBuilder> configure) {
        if (configure == null)
            throw new ArgumentNullException(nameof(configure));

        var builder = new SchemaUiBehaviorBuilder();
        configure(builder);
        var result = builder.Build();
        this._behavior = result.Metadata;
        this._dynamicColumnOrderSource = result.DynamicColumnOrderSource;
    }

    public SchemaUiBuildResult Build() {
        if (string.IsNullOrWhiteSpace(this._renderer) &&
            this._layout == null &&
            this._behavior == null)
            return new SchemaUiBuildResult(null, null);

        return new SchemaUiBuildResult(
            new SchemaUiMetadata { Renderer = this._renderer, Layout = this._layout, Behavior = this._behavior },
            this._dynamicColumnOrderSource
        );
    }
}

internal sealed class SchemaUiLayoutBuilder : ISchemaUiLayoutBuilder {
    private bool? _advanced;
    private string? _section;

    public void Section(string section) => this._section = string.IsNullOrWhiteSpace(section) ? null : section;

    public void Advanced(bool advanced = true) => this._advanced = advanced;

    public SchemaUiLayoutMetadata? Build() {
        if (string.IsNullOrWhiteSpace(this._section) && this._advanced == null)
            return null;

        return new SchemaUiLayoutMetadata { Section = this._section, Advanced = this._advanced };
    }
}

internal sealed record SchemaUiBehaviorBuildResult(
    SchemaUiBehaviorMetadata? Metadata,
    ISchemaUiDynamicColumnOrderSource? DynamicColumnOrderSource
);

internal sealed class SchemaUiBehaviorBuilder : ISchemaUiBehaviorBuilder {
    private readonly List<string> _fixedColumns = [];
    private ISchemaUiDynamicColumnOrderSource? _dynamicColumnOrderSource;
    private bool? _dynamicColumnsFromAdditionalProperties;
    private string? _missingValue;

    public void FixedColumns(params string[] columns) {
        if (columns == null)
            return;

        foreach (var column in columns.Where(column => !string.IsNullOrWhiteSpace(column))) {
            if (!this._fixedColumns.Contains(column, StringComparer.Ordinal))
                this._fixedColumns.Add(column);
        }
    }

    public void FixedColumns<TItem>(params Expression<Func<TItem, object?>>[] propertyExpressions) {
        if (propertyExpressions == null)
            return;

        foreach (var propertyExpression in propertyExpressions) {
            var property = SettingsPropertyPathResolver.ResolveProperty(propertyExpression);
            var jsonPropertyName = property.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName ?? property.Name;
            if (!this._fixedColumns.Contains(jsonPropertyName, StringComparer.Ordinal))
                this._fixedColumns.Add(jsonPropertyName);
        }
    }

    public void DynamicColumnsFromAdditionalProperties(bool enabled = true) =>
        this._dynamicColumnsFromAdditionalProperties = enabled;

    public void MissingValue(string missingValue) => this._missingValue = missingValue;

    public void DynamicColumnOrder<TSource>() where TSource : ISchemaUiDynamicColumnOrderSource, new() =>
        this._dynamicColumnOrderSource = new TSource();

    public SchemaUiBehaviorBuildResult Build() {
        if (this._fixedColumns.Count == 0 &&
            this._dynamicColumnsFromAdditionalProperties == null &&
            this._missingValue == null &&
            this._dynamicColumnOrderSource == null)
            return new SchemaUiBehaviorBuildResult(null, null);

        return new SchemaUiBehaviorBuildResult(
            new SchemaUiBehaviorMetadata {
                FixedColumns = this._fixedColumns.ToList(),
                DynamicColumnsFromAdditionalProperties = this._dynamicColumnsFromAdditionalProperties,
                MissingValue = this._missingValue,
                DynamicColumnOrder = this._dynamicColumnOrderSource == null
                    ? null
                    : new SchemaUiDynamicColumnOrderMetadata { Source = this._dynamicColumnOrderSource.Key }
            },
            this._dynamicColumnOrderSource
        );
    }
}