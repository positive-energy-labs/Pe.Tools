using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public static class SettingsValueDomainService {
    /// <summary>Reads one value domain by key alone; null when no domain is registered for the key.</summary>
    public static FieldOptionsData? Read(string key, ValueDomainExecutionContext context) {
        if (!SettingsValueDomainRegistry.Shared.TryCreate(key, out var domain))
            return null;

        var descriptor = domain.Describe();
        if (!context.RuntimeMode.Supports(descriptor.RequiredRuntimeMode))
            return new FieldOptionsData(descriptor, [], new FieldOptionsResult(
                FieldOptionsResultKind.Unsupported,
                $"'{key}' needs {descriptor.RequiredRuntimeMode}; this runtime is {context.RuntimeMode}."));

        try {
            var items = domain.GetOptionsAsync(context).AsTask().GetAwaiter().GetResult();
            return new FieldOptionsData(descriptor, items.ToList(), new FieldOptionsResult(
                FieldOptionsResultKind.Success,
                $"Retrieved {items.Count} options."));
        } catch (Exception ex) {
            return new FieldOptionsData(descriptor, [], new FieldOptionsResult(FieldOptionsResultKind.Failure, ex.Message));
        }
    }
}
