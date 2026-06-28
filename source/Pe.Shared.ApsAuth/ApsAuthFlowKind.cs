using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.ApsAuth;

[ExportTsEnum]
public enum ApsAuthFlowKind {
    TwoLegged,
    ThreeLeggedConfidential
}

// PE_HOT_RELOAD_NUDGE
