using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Reflection;

namespace Pe.Revit.SettingsRuntime.Json.FieldOptions;

public interface ISettingsFieldOptionsService {
    ValueTask<FieldOptionsResult> GetOptionsAsync(
        Type settingsType,
        string propertyPath,
        string sourceKey,
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    );
}

public sealed class SettingsFieldOptionsService : ISettingsFieldOptionsService {
    public static SettingsFieldOptionsService Shared { get; } = new();

    public async ValueTask<FieldOptionsResult> GetOptionsAsync(
        Type settingsType,
        string propertyPath,
        string sourceKey,
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        if (settingsType == null)
            throw new ArgumentNullException(nameof(settingsType));
        if (string.IsNullOrWhiteSpace(propertyPath))
            throw new ArgumentException("Property path is required.", nameof(propertyPath));
        if (string.IsNullOrWhiteSpace(sourceKey))
            throw new ArgumentException("Source key is required.", nameof(sourceKey));
        if (context == null)
            throw new ArgumentNullException(nameof(context));

        var property = SettingsPropertyPathResolver.ResolveProperty(settingsType, propertyPath);
        if (property == null) {
            return new FieldOptionsResult(FieldOptionsResultKind.Empty, "Property not found for field options.", null,
                []);
        }

        var descriptor = this.ResolveDescriptor(property);
        if (descriptor == null) {
            return new FieldOptionsResult(FieldOptionsResultKind.Empty, "No field options configured for property.",
                null, []);
        }

        if (!string.Equals(descriptor.Key, sourceKey, StringComparison.Ordinal)) {
            return new FieldOptionsResult(
                FieldOptionsResultKind.Empty,
                "Requested field options source does not match property binding.",
                descriptor,
                []
            );
        }

        if (!context.RuntimeMode.Supports(descriptor.RequiredRuntimeMode)) {
            return new FieldOptionsResult(
                FieldOptionsResultKind.Unsupported,
                "Field options source is not supported in the current runtime.",
                descriptor,
                []
            );
        }

        try {
            if (!FieldOptionsProviderRegistry.Shared.TryCreate(descriptor.Key, out var source)) {
                return new FieldOptionsResult(
                    FieldOptionsResultKind.Unsupported,
                    "Field options provider is not registered in the current runtime.",
                    descriptor,
                    []
                );
            }

            var items = await source.GetOptionsAsync(context, cancellationToken);
            return new FieldOptionsResult(
                FieldOptionsResultKind.Success,
                $"Retrieved {items.Count} field options.",
                descriptor,
                items
            );
        } catch (Exception ex) {
            return new FieldOptionsResult(
                FieldOptionsResultKind.Failure,
                ex.Message,
                descriptor,
                []
            );
        }
    }

    private FieldOptionsDescriptor? ResolveDescriptor(PropertyInfo property) {
        if (SettingsSchemaDefinitionRegistry.Shared.TryGet(property.DeclaringType!, out var definition) &&
            definition.Bindings.TryGetValue(property.Name, out var binding) &&
            binding.FieldOptions != null)
            return binding.FieldOptions;

        return JsonTypeSchemaBindingRegistry.Shared.TryResolveFieldOptionsSource(property, out var source)
            ? source.Describe()
            : null;
    }
}

