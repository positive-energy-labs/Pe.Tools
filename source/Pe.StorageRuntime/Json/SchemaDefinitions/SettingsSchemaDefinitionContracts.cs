using System.Linq.Expressions;
using System.Reflection;
using Newtonsoft.Json;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Json.SchemaDefinitions;

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
        return new SettingsSchemaDefinitionDescriptor(this.SettingsType, builder.Build());
    }
}

public interface ISettingsSchemaBuilder<TSettings> {
    void Property<TValue>(
        Expression<Func<TSettings, TValue>> propertyExpression,
        Action<ISettingsPropertyBuilder<TValue>> configure
    );
}

public interface ISettingsPropertyBuilder<TValue> {
    void UseFieldOptions<TSource>() where TSource : IFieldOptionsSource, new();
    void UseStaticExamples(params string[] values);
    void WithDescription(string description);
    void WithDisplayName(string displayName);
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
    public IFieldOptionsSource? FieldOptionsSource { get; init; }
}

internal sealed class SettingsSchemaBuilder<TSettings> : ISettingsSchemaBuilder<TSettings> {
    private readonly Dictionary<string, SettingsSchemaPropertyBinding> _bindings =
        new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyDictionary<string, SettingsSchemaPropertyBinding> Build() => this._bindings;

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
}

internal sealed class SettingsPropertyBindingBuilder<TValue>(PropertyInfo propertyInfo)
    : ISettingsPropertyBuilder<TValue> {
    private readonly List<string> _staticExamples = [];
    private string? _description;
    private string? _displayName;
    private IFieldOptionsSource? _fieldOptionsSource;

    public void UseFieldOptions<TSource>() where TSource : IFieldOptionsSource, new() =>
        this._fieldOptionsSource = new TSource();

    public void UseStaticExamples(params string[] values) {
        if (values == null)
            return;

        foreach (var value in values.Where(value => !string.IsNullOrWhiteSpace(value)))
            this._staticExamples.Add(value);
    }

    public void WithDescription(string description) => this._description = description;

    public void WithDisplayName(string displayName) => this._displayName = displayName;

    public SettingsSchemaPropertyBinding Build() => new() {
        JsonPropertyName = propertyInfo.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName ?? propertyInfo.Name,
        StaticExamples = this._staticExamples.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
        Description = this._description,
        DisplayName = this._displayName,
        FieldOptionsSource = this._fieldOptionsSource
    };
}
