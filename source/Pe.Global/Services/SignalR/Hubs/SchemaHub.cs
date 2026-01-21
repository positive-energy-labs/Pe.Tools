using Microsoft.AspNetCore.SignalR;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.Global.Services.SignalR.Hubs;

/// <summary>
///     SignalR hub for JSON schema generation and dynamic examples.
/// </summary>
public class SchemaHub : Hub {
    private readonly RevitTaskQueue _taskQueue;
    private readonly SettingsTypeRegistry _typeRegistry;

    public SchemaHub(RevitTaskQueue taskQueue, SettingsTypeRegistry typeRegistry) {
        this._taskQueue = taskQueue;
        this._typeRegistry = typeRegistry;
    }

    /// <summary>
    ///     Get JSON schema for a settings type.
    /// </summary>
    public async Task<SchemaResponse> GetSchema(SchemaRequest request) => await this._taskQueue.EnqueueAsync(uiApp => {
        var type = this._typeRegistry.ResolveType(request.SettingsTypeName);

        var (full, extends) = JsonSchemaFactory.CreateSchemas(type, out var examplesProcessor);
        var targetSchema = request.IsExtends ? extends : full;
        examplesProcessor.Finalize(targetSchema);

        // Try to get fragment schema if the type supports $include
        string? fragmentSchemaJson = null;
        try {
            var fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(type, out var fragProcessor);
            if (fragmentSchema != null) {
                fragProcessor.Finalize(fragmentSchema);
                fragmentSchemaJson = fragmentSchema.ToJson();
            }
        } catch {
            // Type doesn't support fragments, that's fine
        }

        return new SchemaResponse(targetSchema.ToJson(), fragmentSchemaJson);
    });

    /// <summary>
    ///     Get dynamic examples for a property, with optional filtering based on sibling values.
    /// </summary>
    public async Task<ExamplesResponse> GetExamples(ExamplesRequest request) => await this._taskQueue.EnqueueAsync(uiApp => {
        var type = this._typeRegistry.ResolveType(request.SettingsTypeName);
        var property = ResolveProperty(type, request.PropertyPath);

        if (property == null)
            return new ExamplesResponse([]);

        var providerAttr = property.GetCustomAttribute<SchemaExamplesAttribute>();
        if (providerAttr == null)
            return new ExamplesResponse([]);

        var provider = Activator.CreateInstance(providerAttr.ProviderType) as IOptionsProvider;
        if (provider == null)
            return new ExamplesResponse([]);

        // Handle dependent filtering
        if (provider is IDependentOptionsProvider dependentProvider && request.SiblingValues is { Count: > 0 }) {
            return new ExamplesResponse(
                dependentProvider.GetExamples(request.SiblingValues).ToList()
            );
        }

        return new ExamplesResponse(provider.GetExamples().ToList());
    });

    /// <summary>
    ///     Get the current document info.
    /// </summary>
    public async Task<DocumentInfo?> GetDocumentInfo() => await this._taskQueue.EnqueueAsync(uiApp => {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null) return null;

        return new DocumentInfo(doc.Title, doc.PathName, doc.IsModified);
    });

    /// <summary>
    ///     Resolves a property from a dotted path like "Configurations.CategoryName".
    /// </summary>
    private static PropertyInfo? ResolveProperty(Type type, string propertyPath) {
        var parts = propertyPath.Split('.');
        PropertyInfo? property = null;
        var currentType = type;

        foreach (var part in parts) {
            // Handle array item notation (e.g., "items" means get the element type)
            if (part == "items" && currentType.IsGenericType) {
                currentType = currentType.GetGenericArguments()[0];
                continue;
            }

            property = currentType.GetProperty(part, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property == null) return null;

            currentType = property.PropertyType;

            // Handle List<T> types
            if (currentType.IsGenericType && currentType.GetGenericTypeDefinition() == typeof(List<>)) {
                currentType = currentType.GetGenericArguments()[0];
            }
        }

        return property;
    }
}
