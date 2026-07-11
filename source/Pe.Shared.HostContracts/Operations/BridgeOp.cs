using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Shared.HostContracts.Operations;

public interface IBridgeOperationContext {
    ISettingsBridgeService Settings { get; }
    IRevitDataService RevitData { get; }
    IScriptingBridgeService Scripting { get; }
}

public interface ISettingsBridgeService {
    Task<SchemaData> GetSchemaAsync(SchemaRequest request);
    Task<FieldOptionsData> GetFieldOptionsAsync(FieldOptionsRequest request, string? connectionId = null);
    Task<GetSettingsModuleCatalogBridgeResponse> GetSettingsModuleCatalogAsync();
    Task<ParameterCatalogData> GetParameterCatalogAsync(ParameterCatalogRequest request, string? connectionId = null);
    Task<FieldOptionsData> GetLoadedFamiliesFilterFieldOptionsAsync(
        LoadedFamiliesFilterFieldOptionsRequest request,
        string? connectionId = null
    );
    Task<FieldOptionsData> GetValueDomainOptionsAsync(ValueDomainOptionsRequest request, string? connectionId = null);
    Task<SchemaData> GetLoadedFamiliesFilterSchemaAsync();
}

public interface IRevitDataService {
    Task<ScheduleCatalogData> GetScheduleCatalogAsync(ScheduleCatalogRequest request);
    Task<ProjectBrowserData> GetProjectBrowserAsync(ProjectBrowserRequest request);
    Task<ProjectIndexData> GetProjectIndexAsync(ProjectIndexRequest request);
    Task<SheetDetailData> GetSheetDetailsAsync(SheetDetailRequest request);
    Task<ScheduleProfilesQueryData> GetScheduleProfilesQueryAsync(ScheduleProfilesQueryRequest request);
    Task<ScheduleQueryData> GetScheduleQueryAsync(ScheduleQueryRequest request);
    Task<LoadedFamiliesCatalogData> GetLoadedFamiliesCatalogAsync(LoadedFamiliesCatalogRequest request);
    Task<LoadedFamiliesMatrixData> GetLoadedFamiliesMatrixAsync(LoadedFamiliesMatrixRequest request);
    Task<FamilyEditorSnapshotData> GetFamilyEditorSnapshotAsync(FamilyEditorSnapshotRequest request);
    Task<FamilyEditorApplyData> ApplyFamilyEditorEditsAsync(FamilyEditorApplyRequest request);
    Task<ParameterValueApplyData> ApplyParameterValuesAsync(ParameterValueApplyRequest request);
    Task<ScheduleCoverageData> GetScheduleCoverageAsync(ScheduleCoverageRequest request);
    Task<ParameterCoverageData> GetParameterCoverageAsync(ParameterCoverageRequest request);
    Task<ConceptEvidenceData> GetConceptEvidenceAsync(ConceptEvidenceRequest request);
    Task<ParameterEvidenceData> GetParameterEvidenceAsync(ParameterEvidenceRequest request);
    Task<ProjectParameterBindingsData> GetProjectParameterBindingsAsync(ProjectParameterBindingsRequest request);
    Task<ElementContextQueryData> GetElementContextQueryAsync(ElementContextQueryRequest request);
    Task<ElectricalPanelsCatalogData> GetElectricalPanelsCatalogAsync(ElectricalPanelsCatalogRequest request);
    Task<ElectricalCircuitsCatalogData> GetElectricalCircuitsCatalogAsync(ElectricalCircuitsCatalogRequest request);
    Task<ElectricalPanelSchedulesQueryData> GetElectricalPanelSchedulesQueryAsync(
        ElectricalPanelSchedulesQueryRequest request
    );
    Task<ElectricalLoadClassificationsCatalogData> GetElectricalLoadClassificationsCatalogAsync(
        ElectricalLoadClassificationsCatalogRequest request
    );
    Task<RevitDocumentSessionContextData> GetRevitDocumentSessionContextAsync();
    Task<OpenRevitDocumentData> OpenRevitDocumentAsync(OpenRevitDocumentRequest request);
    Task<RevitAgentContextSummaryData> GetRevitAgentContextSummaryAsync();
    Task<RevitAgentContextResolveData> ResolveRevitAgentContextAsync(RevitAgentContextResolveRequest request);
    Task<RevitAgentVisibleContextData> GetRevitAgentVisibleContextAsync(RevitAgentVisibleContextRequest request);
    Task<RevitAgentViewRenderingStateData> GetRevitAgentViewRenderingStateAsync(
        RevitAgentViewRenderingStateRequest request
    );
    Task<RevitViewImageData> GetRevitViewImageAsync(RevitViewImageRequest request);
    Task<ParametersServiceCacheData> RefreshParametersServiceCacheAsync();
    Task<RibbonCommandExecuteData> ExecuteRibbonCommandAsync(RibbonCommandExecuteRequest request);
}

public interface IScriptingBridgeService {
    Task<ScriptWorkspaceBootstrapData> BootstrapWorkspaceAsync(
        ScriptWorkspaceBootstrapRequest request,
        CancellationToken cancellationToken
    );
    Task<ExecuteRevitScriptData> ExecuteAsync(ExecuteRevitScriptRequest request, CancellationToken cancellationToken);
    Task<ScriptCancelData> CancelAsync(ScriptCancelRequest request, CancellationToken cancellationToken);
    Task<ScriptPodImportData> ImportPodAsync(ScriptPodImportRequest request, CancellationToken cancellationToken);
    Task<ScriptPodExportData> ExportPodAsync(ScriptPodExportRequest request, CancellationToken cancellationToken);
    Task<ScriptPodListData> ListPodsAsync(ScriptPodListRequest request, CancellationToken cancellationToken);
}

public sealed class BridgeOp {
    private static readonly JsonSerializerSettings JsonSettings = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false,
                OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };
    private readonly Func<string, IBridgeOperationContext, CancellationToken, Task<object?>> _execute;

    private BridgeOp(
        HostOperationDefinition definition,
        Func<string, IBridgeOperationContext, CancellationToken, Task<object?>> execute
    ) {
        this.Definition = definition;
        this._execute = execute;
    }

    public HostOperationDefinition Definition { get; }
    public string Key => this.Definition.Key;

    public Task<object?> ExecuteAsync(string payloadJson, IBridgeOperationContext context, CancellationToken ct) =>
        this._execute(payloadJson, context, ct);

    public static BridgeOp FromDefinition<TRequest, TResponse>(
        HostOperationDefinition definition,
        Func<TRequest, IBridgeOperationContext, CancellationToken, Task<TResponse>> handler
    ) {
        async Task<object?> Execute(string payloadJson, IBridgeOperationContext context, CancellationToken ct) {
            var request = JsonConvert.DeserializeObject<TRequest>(payloadJson, JsonSettings)
                ?? throw new InvalidOperationException(
                    $"Bridge op '{definition.Key}': failed to deserialize {typeof(TRequest).Name}."
                );
            return await handler(request, context, ct).ConfigureAwait(false);
        }

        return new BridgeOp(definition, Execute);
    }

    public static BridgeOp Create<TRequest, TResponse>(
        string key,
        string? displayName,
        HostOperationAgentMetadata? metadata,
        Func<TRequest, IBridgeOperationContext, CancellationToken, Task<TResponse>> handler
    ) => FromDefinition(
        HostOperationDefinition.Create<TRequest, TResponse>(
            key,
            displayName,
            metadata
        ),
        handler
    );

    public static BridgeOp CreateInternal<TRequest, TResponse>(
        string key,
        string? displayName,
        HostOperationAgentMetadata? metadata,
        Func<TRequest, IBridgeOperationContext, CancellationToken, Task<TResponse>> handler
    ) => FromDefinition(
        HostOperationDefinition.CreateInternal<TRequest, TResponse>(
            key,
            displayName,
            metadata
        ),
        handler
    );
}
