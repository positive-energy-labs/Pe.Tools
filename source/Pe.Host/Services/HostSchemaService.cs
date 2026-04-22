using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host.Services;

public sealed class HostSchemaService(IHostSettingsModuleCatalog moduleCatalog) {
    private const string StructuralHostSchemaUnavailableMessage =
        "Revit-authored schema generation is unavailable in host structural mode during the settings runtime split.";

    private readonly IHostSettingsModuleCatalog _moduleCatalog = moduleCatalog;

    public async Task<SchemaEnvelopeResponse> GetSchemaEnvelopeAsync(
        SchemaRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (await this._moduleCatalog.TryGetModuleAsync(request.ModuleKey, request.Target, cancellationToken) == null) {
            return new SchemaEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                $"Schema module '{request.ModuleKey}' is not registered.",
                [],
                null
            );
        }

        return CreateUnavailableResponse();
    }

    public SchemaEnvelopeResponse GetLoadedFamiliesFilterSchemaEnvelope() => CreateUnavailableResponse();

    private static SchemaEnvelopeResponse CreateUnavailableResponse() => new(
        false,
        EnvelopeCode.Failed,
        StructuralHostSchemaUnavailableMessage,
        [
            new ValidationIssue(
                "$",
                null,
                "SchemaUnavailable",
                "error",
                StructuralHostSchemaUnavailableMessage,
                "Generate schemas from the Revit-side runtime while the structural host mode is active."
            )
        ],
        null
    );
}