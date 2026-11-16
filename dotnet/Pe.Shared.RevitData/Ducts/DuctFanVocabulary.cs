using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.Runtime.Serialization;

namespace Pe.Shared.RevitData.Ducts;

[JsonConverter(typeof(StringEnumConverter))]
public enum DuctUnitKind {
    [EnumMember(Value = "fan-coil")] FanCoil,
    [EnumMember(Value = "air-handler")] AirHandler,
    [EnumMember(Value = "erv")] Erv,
    [EnumMember(Value = "muas")] Muas,
    [EnumMember(Value = "dehumidifier")] Dehumidifier,
    [EnumMember(Value = "other")] Other
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FanBlockerKind {
    [EnumMember(Value = "open-end")] OpenEnd,
    [EnumMember(Value = "inferred-join")] InferredJoin,
    [EnumMember(Value = "unknown-drop")] UnknownDrop,
    [EnumMember(Value = "no-flow")] NoFlow,
    [EnumMember(Value = "flow-mismatch")] FlowMismatch,
    [EnumMember(Value = "shared-leg")] SharedLeg,
    [EnumMember(Value = "class-change")] ClassChange,
    [EnumMember(Value = "not-priced")] NotPriced,
    [EnumMember(Value = "implausible-loss")] ImplausibleLoss,
    [EnumMember(Value = "equipment-pairing")] EquipmentPairing,
    [EnumMember(Value = "backflow")] Backflow
}

/// <summary>Native words published in the snapshot catalog, projected by host-typegen.</summary>
public sealed record DuctFanVocabulary(IReadOnlyList<DuctUnitKind> UnitKinds, IReadOnlyList<FanBlockerKind> BlockerKinds) {
    public static DuctFanVocabulary All { get; } = new(
        (DuctUnitKind[])Enum.GetValues(typeof(DuctUnitKind)),
        (FanBlockerKind[])Enum.GetValues(typeof(FanBlockerKind)));
}
