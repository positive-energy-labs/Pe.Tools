using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Reflection;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public interface ISettingsValueDomainService {
    ValueTask<ValueDomainResult> GetOptionsAsync(
        Type settingsType,
        string propertyPath,
        string sourceKey,
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    );
}

public sealed class SettingsValueDomainService : ISettingsValueDomainService {
    public static SettingsValueDomainService Shared { get; } = new();

    public async ValueTask<ValueDomainResult> GetOptionsAsync(
        Type settingsType,
        string propertyPath,
        string sourceKey,
        ValueDomainExecutionContext context,
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
            return new ValueDomainResult(ValueDomainResultKind.Empty, "Property not found for value domain.", null, []);
        }

        var descriptor = this.ResolveDescriptor(property);
        if (descriptor == null) {
            return new ValueDomainResult(ValueDomainResultKind.Empty, "No value domain configured for property.", null, []);
        }

        if (!string.Equals(descriptor.Key, sourceKey, StringComparison.Ordinal)) {
            return new ValueDomainResult(
                ValueDomainResultKind.Empty,
                "Requested value domain does not match property binding.",
                descriptor,
                []
            );
        }

        if (!context.RuntimeMode.Supports(descriptor.RequiredRuntimeMode)) {
            return new ValueDomainResult(
                ValueDomainResultKind.Unsupported,
                "Value domain is not supported in the current runtime.",
                descriptor,
                []
            );
        }

        try {
            if (!SettingsValueDomainRegistry.Shared.TryCreate(descriptor.Key, out var domain)) {
                return new ValueDomainResult(
                    ValueDomainResultKind.Unsupported,
                    "Value domain is not registered in the current runtime.",
                    descriptor,
                    []
                );
            }

            var items = await domain.GetOptionsAsync(context, cancellationToken);
            return new ValueDomainResult(
                ValueDomainResultKind.Success,
                $"Retrieved {items.Count} value-domain options.",
                descriptor,
                items
            );
        } catch (Exception ex) {
            return new ValueDomainResult(
                ValueDomainResultKind.Failure,
                ex.Message,
                descriptor,
                []
            );
        }
    }

    private SettingsValueDomainDescriptor? ResolveDescriptor(PropertyInfo property) {
        if (SettingsSchemaDefinitionRegistry.Shared.TryGet(property.DeclaringType!, out var definition) &&
            definition.Bindings.TryGetValue(property.Name, out var binding) &&
            binding.ValueDomain != null)
            return binding.ValueDomain;

        return null;
    }
}
