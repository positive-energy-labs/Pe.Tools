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
    Task<SchemaData> GetSchemaAsync(SchemaRequest request, CancellationToken cancellationToken);
    Task<FieldOptionsData> GetFieldOptionsAsync(FieldOptionsRequest request, string? connectionId, CancellationToken cancellationToken);
    Task<GetSettingsModuleCatalogBridgeResponse> GetSettingsModuleCatalogAsync(CancellationToken cancellationToken);
    Task<ParameterCatalogData> GetParameterCatalogAsync(ParameterCatalogRequest request, string? connectionId, CancellationToken cancellationToken);
    Task<FieldOptionsData> GetLoadedFamiliesFilterFieldOptionsAsync(
        LoadedFamiliesFilterFieldOptionsRequest request,
        string? connectionId,
        CancellationToken cancellationToken
    );
    Task<FieldOptionsData> GetValueDomainOptionsAsync(ValueDomainOptionsRequest request, string? connectionId, CancellationToken cancellationToken);
    Task<SchemaData> GetLoadedFamiliesFilterSchemaAsync(CancellationToken cancellationToken);
}

public interface IRevitDataService {
    Task<ScheduleCatalogData> GetScheduleCatalogAsync(ScheduleCatalogRequest request, CancellationToken cancellationToken);
    Task<ProjectBrowserData> GetProjectBrowserAsync(ProjectBrowserRequest request, CancellationToken cancellationToken);
    Task<ProjectIndexData> GetProjectIndexAsync(ProjectIndexRequest request, CancellationToken cancellationToken);
    Task<SheetDetailData> GetSheetDetailsAsync(SheetDetailRequest request, CancellationToken cancellationToken);
    Task<ScheduleProfilesQueryData> GetScheduleProfilesQueryAsync(ScheduleProfilesQueryRequest request, CancellationToken cancellationToken);
    Task<ScheduleQueryData> GetScheduleQueryAsync(ScheduleQueryRequest request, CancellationToken cancellationToken);
    Task<LoadedFamiliesCatalogData> GetLoadedFamiliesCatalogAsync(LoadedFamiliesCatalogRequest request, CancellationToken cancellationToken);
    Task<LoadedFamiliesMatrixData> GetLoadedFamiliesMatrixAsync(LoadedFamiliesMatrixRequest request, CancellationToken cancellationToken);
    Task<FamilyEditorSnapshotData> GetFamilyEditorSnapshotAsync(FamilyEditorSnapshotRequest request, CancellationToken cancellationToken);
    Task<FamilyEditorOpenData> OpenFamilyEditorAsync(FamilyEditorOpenRequest request, CancellationToken cancellationToken);
    Task<FamilyEditorApplyData> ApplyFamilyEditorEditsAsync(FamilyEditorApplyRequest request, CancellationToken cancellationToken);
    Task<ParameterValueApplyData> ApplyParameterValuesAsync(ParameterValueApplyRequest request, CancellationToken cancellationToken);
    Task<ParameterLinksData> GetParameterLinksAsync(ParameterLinksDetailRequest request, CancellationToken cancellationToken);
    Task<ParameterLinksData> ApplyParameterLinksAsync(ParameterLinksApplyRequest request, CancellationToken cancellationToken);
    Task<ScheduleCoverageData> GetScheduleCoverageAsync(ScheduleCoverageRequest request, CancellationToken cancellationToken);
    Task<ParameterCoverageData> GetParameterCoverageAsync(ParameterCoverageRequest request, CancellationToken cancellationToken);
    Task<ConceptEvidenceData> GetConceptEvidenceAsync(ConceptEvidenceRequest request, CancellationToken cancellationToken);
    Task<ParameterEvidenceData> GetParameterEvidenceAsync(ParameterEvidenceRequest request, CancellationToken cancellationToken);
    Task<ProjectParameterBindingsData> GetProjectParameterBindingsAsync(ProjectParameterBindingsRequest request, CancellationToken cancellationToken);
    Task<ElementContextQueryData> GetElementContextQueryAsync(ElementContextQueryRequest request, CancellationToken cancellationToken);
    Task<ElectricalPanelsCatalogData> GetElectricalPanelsCatalogAsync(ElectricalPanelsCatalogRequest request, CancellationToken cancellationToken);
    Task<ElectricalCircuitsCatalogData> GetElectricalCircuitsCatalogAsync(ElectricalCircuitsCatalogRequest request, CancellationToken cancellationToken);
    Task<ElectricalPanelSchedulesQueryData> GetElectricalPanelSchedulesQueryAsync(
        ElectricalPanelSchedulesQueryRequest request,
        CancellationToken cancellationToken
    );
    Task<ElectricalLoadClassificationsCatalogData> GetElectricalLoadClassificationsCatalogAsync(
        ElectricalLoadClassificationsCatalogRequest request,
        CancellationToken cancellationToken
    );
    Task<RevitDocumentSessionContextData> GetRevitDocumentSessionContextAsync(CancellationToken cancellationToken);
    Task<OpenRevitDocumentData> OpenRevitDocumentAsync(OpenRevitDocumentRequest request, CancellationToken cancellationToken);
    Task<RevitAgentContextSummaryData> GetRevitAgentContextSummaryAsync(CancellationToken cancellationToken);
    Task<RevitAgentContextResolveData> ResolveRevitAgentContextAsync(RevitAgentContextResolveRequest request, CancellationToken cancellationToken);
    Task<RevitAgentVisibleContextData> GetRevitAgentVisibleContextAsync(RevitAgentVisibleContextRequest request, CancellationToken cancellationToken);
    Task<RevitAgentViewRenderingStateData> GetRevitAgentViewRenderingStateAsync(
        RevitAgentViewRenderingStateRequest request,
        CancellationToken cancellationToken
    );
    Task<RevitViewImageData> GetRevitViewImageAsync(RevitViewImageRequest request, CancellationToken cancellationToken);
    Task<ParametersServiceCacheData> RefreshParametersServiceCacheAsync(CancellationToken cancellationToken);
    Task<RibbonCommandExecuteData> ExecuteRibbonCommandAsync(RibbonCommandExecuteRequest request, CancellationToken cancellationToken);
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
