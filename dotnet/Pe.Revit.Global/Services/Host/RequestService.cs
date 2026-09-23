using Pe.Revit.Global.Services.Document;
using Pe.Revit.Operations;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Revit.Tasks;
using Serilog;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Revit-aware host operations served through the bridge.
/// </summary>
public class RequestService {
    private static readonly TimeSpan FieldOptionsThrottleWindow = TimeSpan.FromMilliseconds(350);

    private readonly SettingsRuntimeRegistry _moduleRegistry;
    private readonly RevitTaskQueue _revitTaskQueue;
    private readonly ThrottleGate _throttleGate;

    public RequestService(
        RevitTaskQueue revitTaskQueue,
        SettingsRuntimeRegistry moduleRegistry,
        ThrottleGate throttleGate
    ) {
        this._revitTaskQueue = revitTaskQueue;
        this._moduleRegistry = moduleRegistry;
        this._throttleGate = throttleGate;
    }

    [Op("revit.catalog.field-options", Does = "Read the options of one value domain by key (an x-options.key on a settings or request schema, e.g. category-names), with the context values its dependsOn names. Serves the field-options Reading.", Title = "Get Field Options", Finds = ["field-options", "value-domain", "options", "categories", "families", "suggestions"], Tier = OpTier.Expert, Example = "{ \"key\": \"category-names\" }")]
    public async Task<FieldOptionsData> GetFieldOptionsAsync(
        FieldOptionsRequest request,
        RevitDocument document,
        CancellationToken cancellationToken
    ) {
        var context = request.Context ?? [];
        var throttleKey = $"field-options:{request.Key}:" + string.Join(
            "&",
            context.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => $"{pair.Key}={pair.Value}")
        );
        var (response, decision) = await this._throttleGate.ExecuteAsync(
            throttleKey,
            FieldOptionsThrottleWindow,
            () => this.EnqueueAsync(
                () => SettingsValueDomainService.Read(
                          request.Key,
                          new ValueDomainExecutionContext(SettingsRuntimeMode.LiveDocument, context, document.Value)
                      )
                      ?? throw BridgeOperationExceptions.BadRequest(
                          $"Unknown value domain key '{request.Key}'.",
                          [
                              BridgeOperationExceptions.Issue(
                                  "$.key",
                                  "UnknownValueDomain",
                                  $"No value domain is registered for '{request.Key}'.",
                                  "Use a key from a schema x-options annotation."
                              )
                          ]
                      ),
                cancellationToken
            )
        );
        if (decision != ThrottleDecision.Executed)
            Log.Debug("Field options throttled: Key={Key}, Decision={Decision}", request.Key, decision);
        return response;
    }

    [Op("settings.schema", Does = "Read the live editor schema of the settings library a `$schema` URL names.", Title = "Get Schema", Finds = ["schema", "settings", "profile", "profiles", "module", "family-foundry"])]
    public Task<SchemaData> GetSchemaAsync(SchemaRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        this.EnqueueAsync(() => {
            try {
                var binding = this._moduleRegistry.ResolveSchemaUrl(request.SchemaUrl);
                var schema = RevitJsonSchemaFactory.CreateEditorSchemaData(
                    binding.SettingsType,
                    SettingsRuntimeMode.LiveDocument,
                    document.Value
                );

                return new SchemaData(schema.SchemaJson, schema.FragmentSchemaJson);
            } catch (Exception ex) {
                throw BridgeOperationExceptions.Unexpected(
                    "SchemaGenerationException",
                    ex,
                    "Check root binding registration and shared authored schema definitions."
                );
            }
        }, cancellationToken);

    [Op("settings.validate", Does = "Run the typed semantic validator of the settings library a `$schema` URL names, after host-owned structural validation.", Title = "Validate Settings", Finds = ["settings", "validation", "semantic", "spec"], IsPublic = false)]
    public Task<SettingsValidateData> ValidateSettingsAsync(
        SettingsValidateRequest request,
        CancellationToken cancellationToken
    ) {
        var binding = this._moduleRegistry.ResolveSchemaUrl(request.SchemaUrl);
        var configured = SettingsDocumentValidatorRegistry.Shared.TryValidate(
            binding.SettingsType,
            new SettingsDocumentValidationContext(request.RawContent, request.ComposedContent),
            out var issues);
        return Task.FromResult(new SettingsValidateData(
            configured,
            issues.Select(issue => new ValidationIssue(
                issue.Path,
                null,
                issue.Code,
                issue.Severity,
                issue.Message,
                issue.Suggestion)).ToList()));
    }

    private async Task<T> EnqueueAsync<T>(Func<T> action, CancellationToken cancellationToken) {
        var queueStopwatch = Stopwatch.StartNew();
        Log.Information("Host request queue starting: ResultType={ResultType}", typeof(T).Name);
        var result = await this._revitTaskQueue.Run(context => {
            context.Cancellation.ThrowIfCancellationRequested();
            Log.Information(
                "Host request queue running on Revit thread after {ElapsedMs} ms: ResultType={ResultType}",
                queueStopwatch.ElapsedMilliseconds,
                typeof(T).Name
            );
            var value = action();
            return value;
        }, new RevitRunOptions { Label = typeof(T).Name, Timeout = TimeSpan.FromMinutes(2) }, cancellationToken);

        Log.Information(
            "Host request queue completed in {ElapsedMs} ms: ResultType={ResultType}",
            queueStopwatch.ElapsedMilliseconds,
            typeof(T).Name
        );
        return result;
    }
}
