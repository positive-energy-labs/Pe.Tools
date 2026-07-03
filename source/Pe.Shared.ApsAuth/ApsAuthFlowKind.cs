using Pe.Shared.Codegen;

namespace Pe.Shared.ApsAuth;

[ExportTsSchema]
public enum ApsAuthFlowKind {
    TwoLegged,
    ThreeLeggedConfidential
}

// PE_HOT_RELOAD_NUDGE
