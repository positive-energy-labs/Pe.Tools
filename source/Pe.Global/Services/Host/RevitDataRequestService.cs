using Newtonsoft.Json;
using Pe.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Global.Revit.Lib.Schedules;
using Pe.Global.Services.Document;
using Pe.Host.Contracts.RevitData;
using Pe.Host.Contracts.Protocol;
using Pe.Host.Contracts.SettingsStorage;
using ricaun.Revit.UI.Tasks;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Global.Services.Host;

/// <summary>
///     Bridge-backed read-only Revit data requests for browser routes.
/// </summary>
internal sealed class RevitDataRequestService {
    private static readonly TimeSpan CatalogCacheWindow = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan BindingsCacheWindow = TimeSpan.FromSeconds(10);

    private readonly RevitDataCache _cache;
    private readonly Action<string>? _notificationSink;
    private readonly RevitTaskService _revitTaskService;

    public RevitDataRequestService(
        RevitTaskService revitTaskService,
        RevitDataCache cache,
        Action<string>? notificationSink = null
    ) {
        this._revitTaskService = revitTaskService;
        this._cache = cache;
        this._notificationSink = notificationSink;
    }

    public Task<LoadedFamiliesCatalogEnvelopeResponse> GetLoadedFamiliesCatalogEnvelopeAsync(
        LoadedFamiliesCatalogRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.LoadedFamiliesCatalog,
        BuildRequestKey("loaded-families-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetLoadedFamiliesCatalogCore(request))
    );

    public Task<ScheduleCatalogEnvelopeResponse> GetScheduleCatalogEnvelopeAsync(
        ScheduleCatalogRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ScheduleCatalog,
        BuildRequestKey("schedule-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetScheduleCatalogCore(request))
    );

    public Task<LoadedFamiliesMatrixEnvelopeResponse> GetLoadedFamiliesMatrixEnvelopeAsync(
        LoadedFamiliesMatrixRequest request
    ) => this._cache.CoalesceAsync(
        HostInvalidationDomain.LoadedFamiliesMatrix,
        BuildRequestKey("loaded-families-matrix", request),
        () => this.EnqueueAsync(() => this.GetLoadedFamiliesMatrixCore(request))
    );

    public Task<ProjectParameterBindingsEnvelopeResponse> GetProjectParameterBindingsEnvelopeAsync(
        ProjectParameterBindingsRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ProjectParameterBindings,
        BuildRequestKey("project-parameter-bindings", request),
        BindingsCacheWindow,
        () => this.EnqueueAsync(() => this.GetProjectParameterBindingsCore(request))
    );

    public void Invalidate(params HostInvalidationDomain[] domains) =>
        this._cache.Invalidate(domains);

    private LoadedFamiliesCatalogEnvelopeResponse GetLoadedFamiliesCatalogCore(LoadedFamiliesCatalogRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToCatalogFailureEnvelope();

        try {
            var data = LoadedFamiliesCatalogCollector.Collect(documentResult.Data!, request.Filter);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Families.Count} loaded families."
            ).ToLoadedFamiliesCatalogEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<LoadedFamiliesCatalogData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "LoadedFamiliesCatalogException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToLoadedFamiliesCatalogEnvelope();
        }
    }

    private ScheduleCatalogEnvelopeResponse GetScheduleCatalogCore(ScheduleCatalogRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToScheduleCatalogFailureEnvelope();

        try {
            var data = ScheduleCatalogCollector.Collect(documentResult.Data!, request);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} schedules."
            ).ToScheduleCatalogEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ScheduleCatalogData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ScheduleCatalogException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToScheduleCatalogEnvelope();
        }
    }

    private LoadedFamiliesMatrixEnvelopeResponse GetLoadedFamiliesMatrixCore(LoadedFamiliesMatrixRequest request) {
        var filterValidation = ValidateMatrixFilter(request);
        if (!filterValidation.Ok) {
            return HostEnvelopeResults.Failure<LoadedFamiliesMatrixData>(
                filterValidation.Code,
                filterValidation.Message,
                filterValidation.Issues
            ).ToLoadedFamiliesMatrixEnvelope();
        }

        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToMatrixFailureEnvelope();

        try {
            var data = LoadedFamiliesMatrixCollector.Collect(
                documentResult.Data!,
                filterValidation.Data,
                this.PublishLoadedFamilyMatrixProgress
            );
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Families.Count} loaded family matrix rows."
            ).ToLoadedFamiliesMatrixEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<LoadedFamiliesMatrixData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "LoadedFamiliesMatrixException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToLoadedFamiliesMatrixEnvelope();
        }
    }

    private ProjectParameterBindingsEnvelopeResponse GetProjectParameterBindingsCore(
        ProjectParameterBindingsRequest request
    ) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToProjectBindingsFailureEnvelope();

        try {
            var data = ProjectParameterBindingsCollector.Collect(documentResult.Data!, request.Filter);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} project parameter bindings."
            ).ToProjectParameterBindingsEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ProjectParameterBindingsData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ProjectParameterBindingsException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToProjectParameterBindingsEnvelope();
        }
    }

    private static HostEnvelopeResult<LoadedFamiliesFilter> ValidateMatrixFilter(LoadedFamiliesMatrixRequest request) {
        var categoryNames = request.Filter?.CategoryNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList() ?? [];
        if (categoryNames.Count == 0) {
            return HostEnvelopeResults.Failure<LoadedFamiliesFilter>(
                EnvelopeCode.Failed,
                "Loaded families matrix requires at least one category filter.",
                [
                    new ValidationIssue(
                        "$.filter.categoryNames",
                        null,
                        "CategoryFilterRequired",
                        "error",
                        "Loaded families matrix requires at least one category filter.",
                        "Provide one or more category names and retry."
                    )
                ]
            );
        }

        var filter = (request.Filter ?? new LoadedFamiliesFilter()) with { CategoryNames = categoryNames };
        return HostEnvelopeResults.Success(
            filter,
            EnvelopeCode.Ok,
            $"Loaded families matrix will collect {categoryNames.Count} categor{(categoryNames.Count == 1 ? "y" : "ies")}."
        );
    }

    private async Task<T> EnqueueAsync<T>(Func<T> action) {
        T? result = default;
        _ = await this._revitTaskService.Run(async () => {
            result = action();
            await Task.CompletedTask;
        });
        return result!;
    }

    private void PublishLoadedFamilyMatrixProgress(string message) =>
        this._notificationSink?.Invoke(message);

    private static HostEnvelopeResult<RevitDocument> GetActiveProjectDocument() {
        var document = DocumentManager.uiapp.ActiveUIDocument?.Document;
        if (document == null) {
            return HostEnvelopeResults.Failure<RevitDocument>(
                EnvelopeCode.NoDocument,
                "No active document.",
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "NoActiveDocument",
                        "error",
                        "No active document.",
                        "Open a Revit project document and retry."
                    )
                ]
            );
        }

        if (document.IsFamilyDocument) {
            return HostEnvelopeResults.Failure<RevitDocument>(
                EnvelopeCode.Failed,
                "Loaded families routes support project documents only.",
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "UnsupportedDocumentType",
                        "error",
                        "Loaded families routes support project documents only.",
                        "Activate a project document and retry."
                    )
                ]
            );
        }

        return HostEnvelopeResults.Success(document, EnvelopeCode.Ok, "Project document is available.");
    }

    private static string BuildRequestKey(string prefix, object request) =>
        $"{prefix}:{JsonConvert.SerializeObject(request)}";
}

internal static class RevitDataRequestResultExtensions {
    public static ScheduleCatalogEnvelopeResponse ToScheduleCatalogFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static LoadedFamiliesCatalogEnvelopeResponse ToCatalogFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static LoadedFamiliesMatrixEnvelopeResponse ToMatrixFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ProjectParameterBindingsEnvelopeResponse ToProjectBindingsFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);
}
