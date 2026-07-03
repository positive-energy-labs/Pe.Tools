using Pe.Shared.Codegen;

namespace Pe.Shared.ApsAuth;

[ExportTsSchema]
public enum ApsScopeProfile {
    ParameterService,
    AutomationManagement,
    AutomationUserContext,
    AutomationArtifactStorage
}

// PE_HOT_RELOAD_NUDGE
