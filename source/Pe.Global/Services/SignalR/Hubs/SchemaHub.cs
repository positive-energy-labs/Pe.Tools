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
        try {
            var type = this._typeRegistry.ResolveType(request.SettingsTypeName);
            var property = ResolveProperty(type, request.PropertyPath);

            if (property == null) {
                Serilog.Log.Debug("GetExamples: Property '{PropertyPath}' not found on type '{TypeName}'",
                    request.PropertyPath, request.SettingsTypeName);
                return new ExamplesResponse([]);
            }

            var providerAttr = property.GetCustomAttribute<SchemaExamplesAttribute>();
            if (providerAttr == null) {
                Serilog.Log.Debug("GetExamples: No SchemaExamples attribute on property '{PropertyPath}'",
                    request.PropertyPath);
                return new ExamplesResponse([]);
            }

            var provider = Activator.CreateInstance(providerAttr.ProviderType) as IOptionsProvider;
            if (provider == null) {
                Serilog.Log.Warning("GetExamples: Failed to create provider '{ProviderType}'",
                    providerAttr.ProviderType.Name);
                return new ExamplesResponse([]);
            }

            Serilog.Log.Debug("GetExamples: Using provider '{ProviderType}' for property '{PropertyPath}'",
                providerAttr.ProviderType.Name, request.PropertyPath);

            // Handle dependent filtering
            if (provider is IDependentOptionsProvider dependentProvider && request.SiblingValues is { Count: > 0 }) {
                var examples = dependentProvider.GetExamples(request.SiblingValues).ToList();
                Serilog.Log.Debug("GetExamples: Provider returned {Count} examples (dependent)", examples.Count);
                return new ExamplesResponse(examples);
            }

            var result = provider.GetExamples().ToList();
            Serilog.Log.Debug("GetExamples: Provider returned {Count} examples", result.Count);
            return new ExamplesResponse(result);
        } catch (Exception ex) {
            Serilog.Log.Error(ex, "GetExamples failed for property '{PropertyPath}'", request.PropertyPath);
            return new ExamplesResponse([]);
        }
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

        Serilog.Log.Debug("ResolveProperty: Starting resolution for path '{Path}' on type '{Type}'", propertyPath, type.Name);

        foreach (var part in parts) {
            Serilog.Log.Debug("ResolveProperty: Processing part '{Part}', currentType = '{CurrentType}', isGeneric = {IsGeneric}", 
                part, currentType.Name, currentType.IsGenericType);

            // Handle array item notation (e.g., "items" means get the element type)
            // Skip if we've already been unwrapped by the List<T> handler below
            if (part == "items") {
                if (currentType.IsGenericType) {
                    currentType = currentType.GetGenericArguments()[0];
                    Serilog.Log.Debug("ResolveProperty: Unwrapped 'items' to generic type '{GenericType}'", currentType.Name);
                } else {
                    Serilog.Log.Debug("ResolveProperty: Skipping 'items' - type already unwrapped");
                }
                continue;
            }

            property = currentType.GetProperty(part, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property == null) {
                Serilog.Log.Warning("ResolveProperty: Property '{Part}' not found on type '{CurrentType}'", part, currentType.Name);
                return null;
            }

            Serilog.Log.Debug("ResolveProperty: Found property '{PropertyName}' of type '{PropertyType}'", property.Name, property.PropertyType.Name);
            currentType = property.PropertyType;

            // Handle List<T> types - auto-unwrap to element type
            if (currentType.IsGenericType && currentType.GetGenericTypeDefinition() == typeof(List<>)) {
                var elementType = currentType.GetGenericArguments()[0];
                Serilog.Log.Debug("ResolveProperty: Auto-unwrapped List<{ElementType}> to {ElementType}", elementType.Name, elementType.Name);
                currentType = elementType;
            }
        }

        Serilog.Log.Debug("ResolveProperty: Resolution complete, final property = '{PropertyName}'", property?.Name ?? "null");
        return property;
    }
}
