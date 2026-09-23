using Newtonsoft.Json;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json;
using System.Linq.Expressions;
using System.Reflection;

namespace Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;

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
    void Property<TValue>(
        Expression<Func<TSettings, TValue>> propertyExpression,
        Action<ISettingsPropertyBuilder<TValue>> configure
    );
}

public interface ISettingsPropertyBuilder<TValue> {
    void UseValueDomain(string domainKey);

    void DependsOnContext(params string[] keys);
    void DependsOnSibling(params string[] keys);
    void AllowIncludes(IncludableFragmentRoot fragmentRoot);
    void DisallowNull();
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

public sealed class SettingsSchemaDefinitionDescriptor(
    Type settingsType,
    IReadOnlyDictionary<string, SettingsSchemaPropertyBinding> bindings
) {
    public Type SettingsType { get; } = settingsType;
    public IReadOnlyDictionary<string, SettingsSchemaPropertyBinding> Bindings { get; } = bindings;
}

public sealed class SettingsSchemaPropertyBinding {
    public string JsonPropertyName { get; init; } = string.Empty;
    public IReadOnlyList<string> StaticExamples { get; init; } = [];
    public string? Description { get; init; }
    public string? DisplayName { get; init; }
    public SettingsValueDomainDescriptor? ValueDomain { get; init; }
    public string? IncludableFragmentRoot { get; init; }
    public bool DisallowNull { get; init; }
    public SchemaUiMetadata? Ui { get; init; }
    internal ISchemaUiDynamicColumnOrderSource? UiDynamicColumnOrderSource { get; init; }
}

internal sealed class SettingsSchemaBuilder<TSettings> : ISettingsSchemaBuilder<TSettings> {
    private readonly Dictionary<string, SettingsSchemaPropertyBinding> _bindings =
        new(StringComparer.OrdinalIgnoreCase);

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
        new(settingsType, this._bindings);
}

internal sealed class SettingsPropertyBindingBuilder<TValue>(PropertyInfo propertyInfo)
    : ISettingsPropertyBuilder<TValue> {
    private readonly List<SettingsOptionsDependency> _dependsOn = [];
    private readonly List<string> _staticExamples = [];
    private string? _description;
    private string? _displayName;
    private string? _includableFragmentRoot;
    private bool _disallowNull;
    private SettingsValueDomainDescriptor? _valueDomain;
    private ISchemaUiDynamicColumnOrderSource? _uiDynamicColumnOrderSource;
    private SchemaUiMetadata? _uiMetadata;

    public void UseValueDomain(string domainKey) {
        this.ThrowIfOptionsAlreadyConfigured();
        if (string.IsNullOrWhiteSpace(domainKey))
            throw new ArgumentException("Value domain key is required.", nameof(domainKey));
        if (!SettingsValueDomainRegistry.Shared.TryDescribe(domainKey, out var descriptor)) {
            throw new InvalidOperationException(
                $"Value domain '{domainKey}' is not registered. Register value domains before schema definitions."
            );
        }

        this._valueDomain = descriptor;
    }

    public void DependsOnContext(params string[] keys) =>
        this.AddDependencies(SettingsOptionsDependencyScope.Context, keys);

    public void DependsOnSibling(params string[] keys) =>
        this.AddDependencies(SettingsOptionsDependencyScope.Sibling, keys);

    public void AllowIncludes(IncludableFragmentRoot fragmentRoot) =>
        this._includableFragmentRoot = IncludableFragmentRoots.ToSchemaName(fragmentRoot);

    public void DisallowNull() => this._disallowNull = true;

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
        if (this._valueDomain != null) {
            throw new InvalidOperationException(
                $"Property '{propertyInfo.Name}' configures its value domain twice."
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
                this._dependsOn.Add(new SettingsOptionsDependency(key, scope));
        }
    }

    public SettingsSchemaPropertyBinding Build() => new() {
        JsonPropertyName = propertyInfo.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName ?? propertyInfo.Name,
        StaticExamples = this._staticExamples.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
        Description = this._description,
        DisplayName = this._displayName,
        ValueDomain = this._valueDomain == null
            ? null
            : this._valueDomain with { DependsOn = MergeDependencies(this._valueDomain.DependsOn, this._dependsOn) },
        IncludableFragmentRoot = this._includableFragmentRoot,
        DisallowNull = this._disallowNull,
        Ui = this._uiMetadata,
        UiDynamicColumnOrderSource = this._uiDynamicColumnOrderSource
    };

    private static IReadOnlyList<SettingsOptionsDependency> MergeDependencies(
        IReadOnlyList<SettingsOptionsDependency> descriptorDependencies,
        IReadOnlyList<SettingsOptionsDependency> builderDependencies
    ) =>
        descriptorDependencies
            .Concat(builderDependencies)
            .GroupBy(
                dependency => (dependency.Scope, dependency.Key),
                dependency => dependency,
                DependencyGroupKeyComparer.Instance
            )
            .Select(group => group.First())
            .ToList();

    private sealed class
        DependencyGroupKeyComparer : IEqualityComparer<(SettingsOptionsDependencyScope Scope, string Key)> {
        public static DependencyGroupKeyComparer Instance { get; } = new();

        public bool Equals(
            (SettingsOptionsDependencyScope Scope, string Key) x,
            (SettingsOptionsDependencyScope Scope, string Key) y
        ) =>
            x.Scope == y.Scope &&
            string.Equals(x.Key, y.Key, StringComparison.OrdinalIgnoreCase);

        public int GetHashCode((SettingsOptionsDependencyScope Scope, string Key) obj) {
            unchecked {
                return ((int)obj.Scope * 397) ^ StringComparer.OrdinalIgnoreCase.GetHashCode(obj.Key);
            }
        }
    }
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
