using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     Portable authored truth for one family — the ONE portable profile schema (`family.json`).
///     This contract intentionally contains no ElementIds, Revit API objects, or Family Foundry
///     recovery metadata; capture must reconstruct it from the document.
/// </summary>
/// <remarks>
///     <para>
///         Locked shape decisions (2026-08-17, folded from docs/features/family/family-model-spec.md,
///         deleted — git history). These are schema law, not style; each was paid for by a proof.
///     </para>
///     <para>
///         <b>Name-keyed maps, never arrays, and NAMES ARE IDENTITY.</b> Every named section is a
///         dictionary. There are no raw Revit IDs anywhere in this contract, which is what gives
///         FFMigrator merge-by-name for free and makes structural dedupe possible.
///         <see cref="FamilyParameters" />, <see cref="SharedParameters" />, and <see cref="Types" />
///         are keyed by their EXACT Revit names — never invent a second slug identity for a
///         parameter like `_conn size` or for a family type. Model constituents
///         (<see cref="Planes" />, <see cref="Frames" />, <see cref="Solids" />,
///         <see cref="NestedFamilies" />, <see cref="Connectors" />, <see cref="Arrays" />) use
///         logical slugs plus an optional Revit/display `label`.
///     </para>
///     <para>
///         <b>value XOR formula</b> per parameter (<see cref="FamilyModelParameter.Value" /> /
///         <see cref="FamilyModelParameter.Formula" />), schema-enforced. A formula-driven parameter
///         may not also appear in a per-type value under <see cref="Types" /> — that is an
///         authoring-time error, deliberately not an apply-time one. Renames ride on the parameter
///         entry via <see cref="FamilyModelParameter.MappedFrom" />, never a parallel migration block.
///     </para>
///     <para>
///         <b>One reference micro-DSL:</b> `param:`, `plane:`, `frame:`, `face:`, `nested:`,
///         `dependency:`. Parameter and type references carry exact Revit names; other targets carry
///         logical slugs. Face refs are `face:&lt;solid&gt;.&lt;FaceName&gt;`. <b>Portable literals</b>
///         (unit-carrying scalars such as `"1/2in"`, `"0deg"`, and closed axis tokens such as `"-Y"`)
///         are canonical truth — one grammar, shared by the C# and TypeScript consumers, non-negotiable
///         because a human has to be able to hand-author this file with only schema/LSP help.
///     </para>
///     <para>
///         <b>Closed v1 geometry vocabulary.</b> Solid kinds are exactly <see cref="FamilySolidKind" />
///         and their void variants, each enumerating its named faces; reference planes are axis plus
///         param-driven offset only. New kinds arrive as enum members, never as an open geometry
///         language. `ExtrudedPolygon` is the vocabulary ceiling for shape: a closed ring of
///         param-drivable points in the frame's XY plane, extruded along its local +Z. Sweeps, blends,
///         revolves and freeform geometry stay `unmodeled` forever. <see cref="FamilyModelFrame" /> is the universal spatial primitive shared by
///         solids, connectors, nested instances and Revit apply. A solid or a nested family sits on
///         `frame:family` or on any declared frame, centered left/right and front/back in that frame,
///         starting at its bottom plane and extending toward its local +Z. A frame takes its position
///         from the planes and solid faces it references — including faces of solids in other frames —
///         so frames form a tree; a cycle is a hard error, never a guess. Orientation is the frame's
///         `normal`/`up` axis pair plus at most one <see cref="FamilyModelFrameRotation" /> clause,
///         which is the permanent orientation ceiling: oblique compound orientation stays unmodeled.
///         Type-conditional constituent existence is unsupported, not inferred. The resolution order
///         and axis signs are executable in <see cref="FamilyModelEvaluatorConventions" /> — read them
///         there, not from prose.
///     </para>
///     <para>
///         <b>Honesty over completeness.</b> <see cref="Unmodeled" /> is where captured state the
///         schema cannot express lands, as raw facts plus a reason code. It is a ledger, not an
///         executable escape hatch: the compiler refuses to apply it, and behavioural roundtrip
///         equivalence may be claimed only when it is empty for the tested contract. Nothing may be
///         persisted in extensible storage, hidden parameters, or `DataStorage` to make capture or a
///         test succeed. Symmetrically, no resolved value, provenance, confidence, generated array
///         member, or Revit identifier belongs in this contract — those live in the evidence
///         projection beside it, which is never accepted as build input.
///     </para>
///     <para>
///         <b>Minimal surface.</b> <see cref="RoomCalculationPoint" />'s entire authored surface is
///         `{ "enabled": true }` (the PE one-foot convention resolves direction per placement type);
///         <see cref="Types" /> stay metadata-free, the first in document order being the preview
///         type; <see cref="FamilyModelParameter.PropertiesGroup" /> is the one parameter grouping
///         contract and no UI may add a second. Add a knob only when a checked-in family cannot be
///         expressed without it.
///     </para>
/// </remarks>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModel {
    [JsonProperty("family", Required = Required.Always)]
    public FamilyModelHeader Family { get; init; } = new();

    [JsonProperty("familyParameters")]
    public Dictionary<string, FamilyModelFamilyParameter> FamilyParameters { get; init; } =
        new(StringComparer.Ordinal);

    [JsonProperty("sharedParameters")]
    public Dictionary<string, FamilyModelSharedParameter> SharedParameters { get; init; } =
        new(StringComparer.Ordinal);

    /// <summary>
    ///     Family type name → (exact parameter name → per-type value). Per-type OBJECTS, deliberately
    ///     not the old parameter-row-plus-dynamic-type-columns shape: empty and uniform types stay
    ///     visible and are preserved rather than collapsing away. A canonical `family.json` carries no
    ///     deletion tombstones — patch semantics (omission = unchanged, `null` = delete) belong to the
    ///     FFMigrator patch, never to this document.
    /// </summary>
    [JsonProperty("types")]
    public Dictionary<string, Dictionary<string, string>> Types { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("planes")]
    public Dictionary<string, FamilyModelPlane> Planes { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("frames")]
    public Dictionary<string, FamilyModelFrame> Frames { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("solids")]
    public Dictionary<string, FamilyModelSolid> Solids { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("nestedFamilies")]
    public Dictionary<string, FamilyModelNestedFamily> NestedFamilies { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("connectors")]
    public Dictionary<string, FamilyModelConnector> Connectors { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("arrays")]
    public Dictionary<string, FamilyModelArray> Arrays { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("settings", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyModelSettings? Settings { get; init; }

    /// <summary>
    ///     Embedded Revit size tables, keyed by their exact table name. The value carries the Revit CSV
    ///     itself; see <see cref="FamilyModelLookupTable" />.
    /// </summary>
    [JsonProperty("lookupTables")]
    public Dictionary<string, FamilyModelLookupTable> LookupTables { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("roomCalculationPoint", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyModelRoomCalculationPoint? RoomCalculationPoint { get; init; }

    [JsonProperty("unmodeled")]
    public List<FamilyModelUnmodeledFact> Unmodeled { get; init; } = [];
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelRoomCalculationPoint {
    [JsonProperty("enabled", Required = Required.Always)]
    public bool Enabled { get; init; }

    /// <summary>
    ///     How far the calculation point sits from the family origin, along the direction the placement type
    ///     implies (up for `Unhosted`, out of the host face otherwise). Omitted means the PE convention, one
    ///     foot. This is not a Revit parameter: the point is a `SpatialElementCalculationPoint` element and
    ///     the offset is its position, which is why the offset lives beside `enabled` rather than in
    ///     <see cref="FamilyModelSettings" />, where every key is one named Revit parameter.
    /// </summary>
    [JsonProperty("offset", NullValueHandling = NullValueHandling.Ignore)]
    public string? Offset { get; init; }
}

/// <summary>
///     The closed set of family-GLOBAL Revit switches. Each key maps to exactly one Revit parameter on the
///     family element, named in its own doc-comment; there is no open bag, and an unknown key is a hard
///     parse failure. Omission means "leave whatever the template produced": the authored document speaks
///     only about what it wants to change.
/// </summary>
/// <remarks>
///     Capture emits <see cref="Shared" />, <see cref="CutWithVoidsWhenLoaded" /> and
///     <see cref="OmniClass" /> only when they differ from the stated portable default, the rule
///     <see cref="FamilyModelRoomCalculationPoint" /> already follows. <see cref="AlwaysVertical" /> and
///     <see cref="PartType" /> have NO stated default: their template value varies by category and by Revit
///     year, and this contract will not guess one, so capture emits the observed value whenever the
///     parameter exists at all. The asymmetry is deliberate and is queued for review, not hidden.
/// </remarks>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelSettings {
    /// <summary>
    ///     Revit `BuiltInParameter.FAMILY_ALWAYS_VERTICAL` (the "Always vertical" checkbox), an integer 0/1
    ///     on the family element. No portable default: templates disagree.
    /// </summary>
    [JsonProperty("alwaysVertical", NullValueHandling = NullValueHandling.Ignore)]
    public bool? AlwaysVertical { get; init; }

    /// <summary>
    ///     Revit `BuiltInParameter.FAMILY_SHARED` (the "Shared" checkbox), an integer 0/1. Portable default
    ///     `false`: a family created from a stock template is not shared.
    /// </summary>
    [JsonProperty("shared", NullValueHandling = NullValueHandling.Ignore)]
    public bool? Shared { get; init; }

    /// <summary>
    ///     Revit `BuiltInParameter.FAMILY_ALLOW_CUT_WITH_VOIDS` (the "Cut with Voids When Loaded" checkbox),
    ///     an integer 0/1. Portable default `false`.
    /// </summary>
    [JsonProperty("cutWithVoidsWhenLoaded", NullValueHandling = NullValueHandling.Ignore)]
    public bool? CutWithVoidsWhenLoaded { get; init; }

    /// <summary>
    ///     Revit `BuiltInParameter.FAMILY_CONTENT_PART_TYPE`, an integer whose values are the
    ///     `Autodesk.Revit.DB.PartType` enum. <see cref="FamilyPartType" /> mirrors that enum by NAME; the
    ///     number is not portable and never appears here. Many categories do not carry the parameter at all,
    ///     and then this key is absent rather than `Undefined`.
    /// </summary>
    [JsonProperty("partType", NullValueHandling = NullValueHandling.Ignore)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilyPartType? PartType { get; init; }

    /// <summary>
    ///     Revit `BuiltInParameter.OMNICLASS_CODE` ("OmniClass Number"), a string such as `23.80.20.11.14`.
    ///     Revit derives the sibling `OMNICLASS_DESCRIPTION` from the code, so only the code is authored.
    ///     Portable default: unset.
    /// </summary>
    [JsonProperty("omniClass", NullValueHandling = NullValueHandling.Ignore)]
    public string? OmniClass { get; init; }
}

/// <summary>
///     One embedded Revit size table. The value is the Revit CSV verbatim, because that CSV — including its
///     `Name##type##unit` header row — is exactly what `FamilySizeTableManager` imports and exports.
///     Remodelling the columns here would be a second grammar for the same bytes and a second place to get
///     the header wrong; `LookupTableCsvCodec` stays the one codec, and this contract carries what it reads
///     and writes. The codec and `LookupTableValidator` run at lowering time, where the Revit-side types
///     live.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelLookupTable {
    [JsonProperty("csv", Required = Required.Always)]
    public string Csv { get; init; } = string.Empty;
}

/// <summary>
///     Mirrors `Autodesk.Revit.DB.PartType` by name, verified member-for-member against the Revit 2023 and
///     2026 API assemblies. Mapping is by name in both directions, so a member Revit renames fails loudly at
///     capture or apply instead of silently changing meaning.
/// </summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyPartType {
    Normal,
    DuctMounted,
    JunctionBox,
    AttachesTo,
    BreaksInto,
    Elbow,
    Tee,
    Transition,
    Cross,
    Cap,
    TapPerpendicular,
    TapAdjustable,
    Offset,
    Union,
    PanelBoard,
    Transformer,
    SwitchBoard,
    OtherPanel,
    EquipmentSwitch,
    Switch,
    ValveBreaksInto,
    SpudPerpendicular,
    SpudAdjustable,
    Damper,
    Wye,
    LateralTee,
    LateralCross,
    Pants,
    MultiPort,
    ValveNormal,
    JunctionBoxTee,
    JunctionBoxCross,
    PipeFlange,
    JunctionBoxElbow,
    ChannelCableTrayElbow,
    ChannelCableTrayVerticalElbow,
    ChannelCableTrayCross,
    ChannelCableTrayTee,
    ChannelCableTrayTransition,
    ChannelCableTrayUnion,
    ChannelCableTrayOffset,
    ChannelCableTrayMultiPort,
    LadderCableTrayElbow,
    LadderCableTrayVerticalElbow,
    LadderCableTrayCross,
    LadderCableTrayTee,
    LadderCableTrayTransition,
    LadderCableTrayUnion,
    LadderCableTrayOffset,
    LadderCableTrayMultiPort,
    InlineSensor,
    Sensor,
    EndCap,
    HandrailBracketHardware,
    PanelBracketHardware,
    TerminationHardware,
    Rails,
    Handrails,
    TopRails,
    PipeMechanicalCoupling,
    Undefined
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelPlane {
    [JsonProperty("label")]
    public string? Label { get; init; }

    [JsonProperty("from", Required = Required.Always)]
    public string From { get; init; } = string.Empty;

    [JsonProperty("by", Required = Required.Always)]
    public string By { get; init; } = string.Empty;

    [JsonProperty("direction", Required = Required.Always)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilyModelOffsetDirection Direction { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyModelOffsetDirection {
    Out,
    In
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelFrame {
    [JsonProperty("label")]
    public string? Label { get; init; }

    [JsonProperty("origin", Required = Required.Always)]
    public List<string> Origin { get; init; } = [];

    [JsonProperty("normal", Required = Required.Always)]
    public string Normal { get; init; } = string.Empty;

    [JsonProperty("up", Required = Required.Always)]
    public string Up { get; init; } = string.Empty;

    [JsonProperty("rotation", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyModelFrameRotation? Rotation { get; init; }
}

/// <summary>
///     The one orientation delta a frame may carry: a turn about a single named axis through the frame
///     origin. Two turns, or a turn about an axis this clause cannot name, are `unmodeled` forever —
///     that ceiling is deliberate, because a symbolic clause stays param-drivable and capturable where a
///     numeric basis does not.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelFrameRotation {
    /// <summary>
    ///     The axis to turn about: a family axis token (`+X` … `-Z`), or `normal`/`up` for the frame's own
    ///     local axes. Exactly one axis; the right-hand rule gives the sign of the turn.
    /// </summary>
    [JsonProperty("about", Required = Required.Always)]
    public string About { get; init; } = string.Empty;

    /// <summary>A `param:` reference to a declared parameter, or a portable angle literal such as `45deg`.</summary>
    [JsonProperty("by", Required = Required.Always)]
    public string By { get; init; } = string.Empty;
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelUnmodeledFact {
    [JsonProperty("reason", Required = Required.Always)]
    public string Reason { get; init; } = string.Empty;

    [JsonProperty("path", Required = Required.Always)]
    public string Path { get; init; } = string.Empty;

    [JsonProperty("facts")]
    public Dictionary<string, string> Facts { get; init; } = new(StringComparer.Ordinal);
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelHeader {
    [JsonProperty("name", Required = Required.Always)]
    public string Name { get; init; } = string.Empty;

    [JsonProperty("category", Required = Required.Always)]
    public string Category { get; init; } = string.Empty;

    [JsonProperty("template", Required = Required.Always)]
    public string Template { get; init; } = string.Empty;

    [JsonProperty("placement", Required = Required.Always)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilyModelPlacement Placement { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyModelPlacement {
    Unhosted,
    FaceHosted,
    WallHosted
}

[JsonObject(MemberSerialization.OptIn)]
public abstract class FamilyModelParameter {
    [JsonProperty("propertiesGroup")]
    public string? PropertiesGroup { get; init; }

    [JsonProperty("isInstance")]
    public bool? IsInstance { get; init; }

    [JsonProperty("value")]
    public string? Value { get; init; }

    [JsonProperty("formula")]
    public string? Formula { get; init; }

    [JsonProperty("mappedFrom")]
    public List<string> MappedFrom { get; init; } = [];
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelFamilyParameter : FamilyModelParameter {
    [JsonProperty("dataType")]
    public string? DataType { get; init; }

    [JsonProperty("tooltip")]
    public string? Tooltip { get; init; }
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelSharedParameter : FamilyModelParameter;

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelSolid {
    [JsonProperty("kind", Required = Required.Always)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilySolidKind Kind { get; init; }

    [JsonProperty("label")]
    public string? Label { get; init; }

    [JsonProperty("frame", Required = Required.Always)]
    public string Frame { get; init; } = string.Empty;

    [JsonProperty("width")]
    public string? Width { get; init; }

    [JsonProperty("depth")]
    public string? Depth { get; init; }

    [JsonProperty("height")]
    public string? Height { get; init; }

    [JsonProperty("diameter")]
    public string? Diameter { get; init; }

    /// <summary>
    ///     The closed profile of an `ExtrudedPolygon`, as an ordered ring of points in the frame's XY
    ///     plane. The ring closes implicitly: the last point joins the first, and repeating it is an
    ///     authoring error rather than a second edge.
    /// </summary>
    [JsonProperty("profile")]
    public List<FamilyModelProfilePoint> Profile { get; init; } = [];
}

/// <summary>
///     One profile vertex, in the frame's own XY plane. Each coordinate is a portable length — a literal
///     or a `param:` reference — so the profile stays param-drivable like every other dimension.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelProfilePoint {
    [JsonProperty("x", Required = Required.Always)]
    public string X { get; init; } = string.Empty;

    [JsonProperty("y", Required = Required.Always)]
    public string Y { get; init; } = string.Empty;
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilySolidKind {
    Prism,
    Cylinder,
    ExtrudedPolygon,
    VoidPrism,
    VoidCylinder,
    VoidExtrudedPolygon
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelNestedFamily {
    [JsonProperty("label")]
    public string? Label { get; init; }

    [JsonProperty("family", Required = Required.Always)]
    public string Family { get; init; } = string.Empty;

    [JsonProperty("type", Required = Required.Always)]
    public string Type { get; init; } = string.Empty;

    [JsonProperty("frame", Required = Required.Always)]
    public string Frame { get; init; } = string.Empty;

    [JsonProperty("parameterBindings")]
    public Dictionary<string, string> ParameterBindings { get; init; } = new(StringComparer.Ordinal);
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelArray {
    [JsonProperty("label")]
    public string? Label { get; init; }

    [JsonProperty("kind", Required = Required.Always)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilyModelArrayKind Kind { get; init; }

    [JsonProperty("member", Required = Required.Always)]
    public string Member { get; init; } = string.Empty;

    [JsonProperty("axis", Required = Required.Always)]
    public string Axis { get; init; } = string.Empty;

    [JsonProperty("halfCount", Required = Required.Always)]
    public string HalfCount { get; init; } = string.Empty;

    [JsonProperty("limits", Required = Required.Always)]
    public FamilyModelArrayLimits Limits { get; init; } = new();
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyModelArrayKind {
    CenteredLinear
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelArrayLimits {
    [JsonProperty("start", Required = Required.Always)]
    public string Start { get; init; } = string.Empty;

    [JsonProperty("end", Required = Required.Always)]
    public string End { get; init; } = string.Empty;
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelConnector {
    [JsonProperty("label")]
    public string? Label { get; init; }

    [JsonProperty("domain", Required = Required.Always)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilyConnectorDomain Domain { get; init; }

    [JsonProperty("frame", Required = Required.Always)]
    public string Frame { get; init; } = string.Empty;

    [JsonProperty("shape", Required = Required.Always)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilyConnectorShape Shape { get; init; }

    [JsonProperty("diameter")]
    public string? Diameter { get; init; }

    [JsonProperty("width")]
    public string? Width { get; init; }

    [JsonProperty("height")]
    public string? Height { get; init; }

    [JsonProperty("stub", Required = Required.Always)]
    public FamilyConnectorStub Stub { get; init; } = new();

    [JsonProperty("systemType", Required = Required.Always)]
    public string SystemType { get; init; } = string.Empty;

    [JsonProperty("flowDirection")]
    public string? FlowDirection { get; init; }

    [JsonProperty("flowConfiguration")]
    public string? FlowConfiguration { get; init; }

    [JsonProperty("lossMethod")]
    public string? LossMethod { get; init; }

    [JsonProperty("parameterBindings")]
    public Dictionary<string, string> ParameterBindings { get; init; } = new(StringComparer.Ordinal);
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyConnectorStub {
    [JsonProperty("depth", Required = Required.Always)]
    public string Depth { get; init; } = string.Empty;

    [JsonProperty("direction", Required = Required.Always)]
    [JsonConverter(typeof(StringEnumConverter))]
    public FamilyModelOffsetDirection Direction { get; init; }

    [JsonProperty("isSolid")]
    public bool? IsSolid { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyConnectorDomain {
    Duct,
    Pipe,
    Electrical
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyConnectorShape {
    Round,
    Rectangular
}

public static class FamilyModelDiagnosticCodes {
    public const string InvalidJson = "invalid-json";
    public const string Required = "required";
    public const string NameCollision = "name-collision";
    public const string ValueFormulaConflict = "value-formula-conflict";
    public const string UnknownParameter = "unknown-parameter";
    public const string FormulaTypeOverride = "formula-type-override";
    public const string InvalidReference = "invalid-reference";
    public const string UnsupportedFrame = "unsupported-frame";
    public const string InvalidSolid = "invalid-solid";
    public const string InvalidDriver = "invalid-driver";
    public const string UnmodeledState = "unmodeled-state";
    public const string InvalidRoomCalculationPoint = "invalid-room-calculation-point";
    public const string InvalidPlane = "invalid-plane";
    public const string InvalidFrame = "invalid-frame";
    public const string InvalidConnector = "invalid-connector";
    public const string InvalidNestedFamily = "invalid-nested-family";
    public const string InvalidArray = "invalid-array";
    public const string ReferenceCycle = "reference-cycle";
    public const string UnsupportedSolidKind = "unsupported-solid-kind";
    public const string InvalidSettings = "invalid-settings";
    public const string InvalidLookupTable = "invalid-lookup-table";
    public const string UnsupportedPlacementGeometry = "unsupported-placement-geometry";
}

public sealed record FamilyModelDiagnostic(string Code, string Path, string Message);

public sealed record FamilyModelParseResult(
    FamilyModel? Value,
    IReadOnlyList<FamilyModelDiagnostic> Diagnostics
);

public static class FamilyModelJson {
    public static FamilyModelParseResult Parse(string json) {
        try {
            // Duplicate keys are otherwise silently last-write-wins in Newtonsoft. For a name-keyed authored
            // language that would make the file look different from the family it creates.
            var token = JToken.Parse(json, new JsonLoadSettings {
                DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error
            });
            if (token is JObject document)
                document.Remove("$schema");
            var serializer = JsonSerializer.Create(new JsonSerializerSettings {
                MissingMemberHandling = MissingMemberHandling.Error
            });
            var model = token.ToObject<FamilyModel>(serializer)
                        ?? throw new JsonSerializationException("Family model deserialized to null.");
            return new FamilyModelParseResult(model, FamilyModelValidator.Validate(model));
        } catch (JsonException ex) {
            return new FamilyModelParseResult(null, [
                new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.InvalidJson, "$", ex.Message)
            ]);
        }
    }
}

public static class FamilyModelValidator {
    private const string BuiltInFamilyFrame = "frame:family";

    private static readonly Regex OmniClassCode = new(
        @"^\d+(\.\d+)*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static IReadOnlyList<FamilyModelDiagnostic> Validate(FamilyModel model) {
        var diagnostics = new List<FamilyModelDiagnostic>();
        Require(model.Family.Name, "$.family.name", "Family name", diagnostics);
        Require(model.Family.Category, "$.family.category", "Family category", diagnostics);
        Require(model.Family.Template, "$.family.template", "Family template", diagnostics);

        ValidateParameterMap(model.FamilyParameters, "$.familyParameters", diagnostics);
        ValidateParameterMap(model.SharedParameters, "$.sharedParameters", diagnostics);

        foreach (var collision in model.FamilyParameters.Keys.Intersect(model.SharedParameters.Keys,
                     StringComparer.Ordinal)) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.NameCollision,
                "$.familyParameters",
                $"Parameter '{collision}' is declared as both a family parameter and a shared parameter."));
        }

        var parameters = model.FamilyParameters
            .Select(pair => new KeyValuePair<string, FamilyModelParameter>(pair.Key, pair.Value))
            .Concat(model.SharedParameters.Select(pair =>
                new KeyValuePair<string, FamilyModelParameter>(pair.Key, pair.Value)))
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);

        ValidateTypes(model.Types, parameters, diagnostics);
        ValidatePlanes(model.Planes, model.Solids, new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
        ValidateFrames(model.Frames, model.Planes, model.Solids,
            new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
        ValidateSolids(model.Solids, model.Frames,
            new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
        ValidateNestedFamilies(model.NestedFamilies, model.Frames,
            new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
        ValidateReferenceGraph(model, diagnostics);
        ValidateConnectors(model.Connectors, model.Frames, new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
        ValidateArrays(model.Arrays, model.NestedFamilies, model.Planes, model.FamilyParameters, diagnostics);
        ValidateSettings(model.Settings, diagnostics);
        ValidateLookupTables(model.LookupTables, diagnostics);
        ValidateRoomCalculationPointOffset(model.RoomCalculationPoint?.Offset, diagnostics);
        if (model.RoomCalculationPoint is { Enabled: false }) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidRoomCalculationPoint,
                "$.roomCalculationPoint.enabled",
                "roomCalculationPoint only exposes the PE enabled convention; omit the section to disable it."));
        }
        foreach (var fact in model.Unmodeled) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.UnmodeledState,
                fact.Path,
                $"Family state '{fact.Reason}' is observable but not executable by this Family Model version."));
        }
        return diagnostics;
    }

    private static void ValidatePlanes(
        IReadOnlyDictionary<string, FamilyModelPlane> planes,
        IReadOnlyDictionary<string, FamilyModelSolid> solids,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in planes) {
            var path = $"$.planes.{pair.Key}";
            Require(pair.Key, path, "Plane slug", diagnostics);
            ValidatePlaneOrFaceReference(pair.Value.From, $"{path}.from", planes.Keys, solids, diagnostics);
            ValidateLengthDriver(pair.Value.By, $"{path}.by", parameterNames, diagnostics);
        }
    }

    private static void ValidateFrames(
        IReadOnlyDictionary<string, FamilyModelFrame> frames,
        IReadOnlyDictionary<string, FamilyModelPlane> planes,
        IReadOnlyDictionary<string, FamilyModelSolid> solids,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in frames) {
            var frame = pair.Value;
            var path = $"$.frames.{pair.Key}";
            Require(pair.Key, path, "Frame slug", diagnostics);
            if (frame.Origin.Count != 3) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidFrame,
                    $"{path}.origin",
                    "Frame origin must be the intersection of exactly three observable plane/face references."));
            }

            foreach (var (reference, index) in frame.Origin.Select((value, index) => (value, index)))
                ValidatePlaneOrFaceReference(reference, $"{path}.origin[{index}]", planes.Keys, solids, diagnostics);

            ValidateAxis(frame.Normal, $"{path}.normal", diagnostics);
            ValidateAxis(frame.Up, $"{path}.up", diagnostics);
            if (string.Equals(frame.Normal, frame.Up, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(frame.Normal, NegateAxis(frame.Up), StringComparison.OrdinalIgnoreCase)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidFrame,
                    path,
                    "Frame normal and up axes must be perpendicular."));
            }

            if (frame.Rotation != null)
                ValidateRotation(frame.Rotation, $"{path}.rotation", parameterNames, diagnostics);
        }
    }

    /// <summary>
    ///     One axis, one driver. The axis vocabulary is closed so that capture can name what it reads back,
    ///     and the driver stays symbolic so the turn keeps following its parameter.
    /// </summary>
    private static void ValidateRotation(
        FamilyModelFrameRotation rotation,
        string path,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (rotation.About is not ("normal" or "up" or "+X" or "-X" or "+Y" or "-Y" or "+Z" or "-Z")) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidFrame,
                $"{path}.about",
                $"Rotation axis '{rotation.About}' must be one axis token (+X … -Z) or 'normal' or 'up'."));
        }

        if (PortableFamilyReference.TryParse(rotation.By, out var driver)) {
            if (driver.Kind != PortableFamilyReferenceKind.Parameter || !parameterNames.Contains(driver.Target)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidDriver,
                    $"{path}.by",
                    $"Rotation driver '{rotation.By}' must reference a declared parameter."));
            }

            return;
        }

        if (PortableScalar.TryParse(rotation.By, out var scalar) && scalar.Kind == PortableScalarKind.Angle)
            return;

        diagnostics.Add(new FamilyModelDiagnostic(
            FamilyModelDiagnosticCodes.InvalidDriver,
            $"{path}.by",
            $"Rotation driver '{rotation.By}' must be a param: reference or a portable angle literal such as '45deg'."));
    }

    /// <summary>
    ///     Frames position themselves off planes and off faces of solids, and those solids sit on frames, so
    ///     the three sections form one reference graph. A cycle in it has no geometry at all; the diagnostic
    ///     names the whole loop, because a single node tells the author nothing about where to cut it.
    /// </summary>
    private static void ValidateReferenceGraph(
        FamilyModel model,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        var edges = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var pair in model.Frames)
            edges[$"frame:{pair.Key}"] = pair.Value.Origin.Select(ResolveGraphNode).ToList();
        foreach (var pair in model.Planes)
            edges[$"plane:{pair.Key}"] = [ResolveGraphNode(pair.Value.From)];
        foreach (var pair in model.Solids)
            edges[$"solid:{pair.Key}"] = [ResolveGraphNode(pair.Value.Frame)];
        foreach (var pair in model.NestedFamilies)
            edges[$"nested:{pair.Key}"] = [ResolveGraphNode(pair.Value.Frame)];

        var settled = new HashSet<string>(StringComparer.Ordinal);
        var reported = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in edges.Keys)
            WalkForCycle(node, edges, settled, [], reported, diagnostics);
    }

    private static void WalkForCycle(
        string node,
        IReadOnlyDictionary<string, List<string>> edges,
        ISet<string> settled,
        List<string> stack,
        ISet<string> reported,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        var onStack = stack.IndexOf(node);
        if (onStack >= 0) {
            var cycle = stack.Skip(onStack).Append(node).ToList();
            var signature = string.Join("|", cycle.OrderBy(item => item, StringComparer.Ordinal).Distinct());
            if (reported.Add(signature)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.ReferenceCycle,
                    $"$.{cycle[0].Replace(':', '.')}",
                    $"Reference cycle: {string.Join(" → ", cycle)}."));
            }

            return;
        }

        if (!settled.Add(node) || !edges.TryGetValue(node, out var next))
            return;

        stack.Add(node);
        foreach (var target in next)
            WalkForCycle(target, edges, settled, stack, reported, diagnostics);
        stack.RemoveAt(stack.Count - 1);
    }

    /// <summary>Maps one authored reference to the graph node it depends on; a face depends on its solid.</summary>
    private static string ResolveGraphNode(string reference) {
        if (!PortableFamilyReference.TryParse(reference, out var parsed))
            return reference;

        return parsed.Kind switch {
            PortableFamilyReferenceKind.Face => $"solid:{parsed.Target}",
            PortableFamilyReferenceKind.Plane => $"plane:{parsed.Target}",
            PortableFamilyReferenceKind.Frame => $"frame:{parsed.Target}",
            _ => reference
        };
    }

    private static void ValidateConnectors(
        IReadOnlyDictionary<string, FamilyModelConnector> connectors,
        IReadOnlyDictionary<string, FamilyModelFrame> frames,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        var bindingTargets = new HashSet<string>(StringComparer.Ordinal) {
            "Voltage", "NumberOfPoles", "ApparentPower", "MinimumCircuitAmpacity"
        };
        foreach (var pair in connectors) {
            var connector = pair.Value;
            var path = $"$.connectors.{pair.Key}";
            Require(pair.Key, path, "Connector slug", diagnostics);
            if (!PortableFamilyReference.TryParse(connector.Frame, out var frameReference) ||
                frameReference.Kind != PortableFamilyReferenceKind.Frame ||
                !frames.ContainsKey(frameReference.Target)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidConnector,
                    $"{path}.frame",
                    $"Connector frame '{connector.Frame}' must reference a declared frame."));
            } else {
                ValidateConnectorFrameDirection(
                    connector,
                    frames[frameReference.Target],
                    path,
                    diagnostics);
            }

            Require(connector.SystemType, $"{path}.systemType", "Connector system type", diagnostics);
            ValidateLengthDriver(connector.Stub.Depth, $"{path}.stub.depth", parameterNames, diagnostics);
            if (connector.Shape == FamilyConnectorShape.Round) {
                ValidateRequiredDriver(connector.Diameter, "diameter", path, parameterNames, diagnostics);
                RejectDriver(connector.Width, "width", path, diagnostics);
                RejectDriver(connector.Height, "height", path, diagnostics);
            } else {
                ValidateRequiredDriver(connector.Width, "width", path, parameterNames, diagnostics);
                ValidateRequiredDriver(connector.Height, "height", path, parameterNames, diagnostics);
                RejectDriver(connector.Diameter, "diameter", path, diagnostics);
                if (connector.Domain == FamilyConnectorDomain.Pipe) {
                    diagnostics.Add(new FamilyModelDiagnostic(
                        FamilyModelDiagnosticCodes.InvalidConnector,
                        $"{path}.shape",
                        "Pipe Connectors must be Round."));
                }
            }

            foreach (var binding in connector.ParameterBindings) {
                if (!bindingTargets.Contains(binding.Key)) {
                    diagnostics.Add(new FamilyModelDiagnostic(
                        FamilyModelDiagnosticCodes.InvalidConnector,
                        $"{path}.parameterBindings.{binding.Key}",
                        $"Connector parameter binding target '{binding.Key}' is not supported."));
                }

                if (!PortableFamilyReference.TryParse(binding.Value, out var source) ||
                    source.Kind != PortableFamilyReferenceKind.Parameter ||
                    !parameterNames.Contains(source.Target)) {
                    diagnostics.Add(new FamilyModelDiagnostic(
                        FamilyModelDiagnosticCodes.InvalidConnector,
                        $"{path}.parameterBindings.{binding.Key}",
                        $"Binding source '{binding.Value}' must reference a declared parameter."));
                }
            }
        }
    }

    private static void ValidateNestedFamilies(
        IReadOnlyDictionary<string, FamilyModelNestedFamily> nestedFamilies,
        IReadOnlyDictionary<string, FamilyModelFrame> frames,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in nestedFamilies) {
            var path = $"$.nestedFamilies.{pair.Key}";
            var nested = pair.Value;
            Require(pair.Key, path, "Nested family slug", diagnostics);
            Require(nested.Type, $"{path}.type", "Nested family type", diagnostics);

            if (!PortableFamilyReference.TryParse(nested.Family, out var dependency) ||
                dependency.Kind != PortableFamilyReferenceKind.Dependency ||
                !string.Equals(dependency.Target, pair.Key, StringComparison.Ordinal)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidNestedFamily,
                    $"{path}.family",
                    $"Nested family '{pair.Key}' must use the observable dependency identity 'dependency:{pair.Key}'."));
            }

            ValidateFrameReference(nested.Frame, $"{path}.frame", frames, diagnostics);

            foreach (var binding in nested.ParameterBindings) {
                if (!PortableFamilyReference.TryParse(binding.Value, out var source) ||
                    source.Kind != PortableFamilyReferenceKind.Parameter ||
                    !parameterNames.Contains(source.Target)) {
                    diagnostics.Add(new FamilyModelDiagnostic(
                        FamilyModelDiagnosticCodes.InvalidNestedFamily,
                        $"{path}.parameterBindings.{binding.Key}",
                        $"Binding source '{binding.Value}' must reference a declared host parameter."));
                }
            }
        }
    }

    private static void ValidateArrays(
        IReadOnlyDictionary<string, FamilyModelArray> arrays,
        IReadOnlyDictionary<string, FamilyModelNestedFamily> nestedFamilies,
        IReadOnlyDictionary<string, FamilyModelPlane> planes,
        IReadOnlyDictionary<string, FamilyModelFamilyParameter> familyParameters,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in arrays) {
            var path = $"$.arrays.{pair.Key}";
            var array = pair.Value;
            Require(pair.Key, path, "Array slug", diagnostics);
            if (!PortableFamilyReference.TryParse(array.Member, out var member) ||
                member.Kind != PortableFamilyReferenceKind.NestedFamily ||
                !nestedFamilies.ContainsKey(member.Target) ||
                !string.Equals(member.Target, pair.Key, StringComparison.Ordinal)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidArray,
                    $"{path}.member",
                    $"CenteredLinear array '{pair.Key}' must repeat nested:{pair.Key}."));
            }

            ValidateAxis(array.Axis, $"{path}.axis", diagnostics);
            if (array.Axis is not ("+X" or "-X" or "+Y" or "-Y")) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidArray,
                    $"{path}.axis",
                    "CenteredLinear currently supports the proven family-plan axes +X, -X, +Y, and -Y."));
            }
            if (!PortableFamilyReference.TryParse(array.HalfCount, out var halfCount) ||
                halfCount.Kind != PortableFamilyReferenceKind.Parameter ||
                !familyParameters.TryGetValue(halfCount.Target, out var halfCountParameter) ||
                !string.Equals(halfCountParameter.DataType, "Integer", StringComparison.OrdinalIgnoreCase)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidArray,
                    $"{path}.halfCount",
                    $"Half count '{array.HalfCount}' must reference a declared Integer family parameter."));
            }

            ValidateArrayLimit(array.Limits.Start, $"{path}.limits.start", planes, diagnostics);
            ValidateArrayLimit(array.Limits.End, $"{path}.limits.end", planes, diagnostics);
            if (string.Equals(array.Limits.Start, array.Limits.End, StringComparison.Ordinal)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidArray,
                    $"{path}.limits",
                    "CenteredLinear start and end limits must be different planes."));
            }
        }
    }

    private static void ValidateArrayLimit(
        string text,
        string path,
        IReadOnlyDictionary<string, FamilyModelPlane> planes,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (PortableFamilyReference.TryParse(text, out var reference) &&
            reference.Kind == PortableFamilyReferenceKind.Plane &&
            planes.ContainsKey(reference.Target))
            return;

        diagnostics.Add(new FamilyModelDiagnostic(
            FamilyModelDiagnosticCodes.InvalidArray,
            path,
            $"Array limit '{text}' must reference a declared plane."));
    }

    private static void ValidateConnectorFrameDirection(
        FamilyModelConnector connector,
        FamilyModelFrame frame,
        string path,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (frame.Origin.Count == 0 ||
            !PortableFamilyReference.TryParse(frame.Origin[0], out var faceReference) ||
            faceReference.Kind != PortableFamilyReferenceKind.Face)
            return;

        var separator = faceReference.Target.LastIndexOf('.');
        var faceName = separator < 0 ? faceReference.Target : faceReference.Target[(separator + 1)..];
        var outward = faceName.ToUpperInvariant() switch {
            "FRONT" => "+Y",
            "BACK" => "-Y",
            "LEFT" => "-X",
            "RIGHT" => "+X",
            "TOP" => "+Z",
            "BOTTOM" => "-Z",
            _ => null
        };
        if (outward == null)
            return;

        var expected = connector.Stub.Direction == FamilyModelOffsetDirection.Out
            ? outward
            : NegateAxis(outward);
        if (string.Equals(frame.Normal, expected, StringComparison.OrdinalIgnoreCase))
            return;

        diagnostics.Add(new FamilyModelDiagnostic(
            FamilyModelDiagnosticCodes.InvalidConnector,
            $"{path}.frame",
            $"Connector frame normal '{frame.Normal}' conflicts with {connector.Stub.Direction} from '{frame.Origin[0]}'; expected '{expected}'."));
    }

    private static void ValidateRequiredDriver(
        string? value,
        string name,
        string path,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (string.IsNullOrWhiteSpace(value)) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidConnector,
                $"{path}.{name}",
                $"Connector requires {name}."));
            return;
        }

        ValidateLengthDriver(value!, $"{path}.{name}", parameterNames, diagnostics);
    }

    private static void RejectDriver(
        string? value,
        string name,
        string path,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (!string.IsNullOrWhiteSpace(value)) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidConnector,
                $"{path}.{name}",
                $"Connector shape cannot define {name}."));
        }
    }

    /// <summary>
    ///     A solid or a nested family sits on the built-in family frame or on any declared frame. The frame
    ///     tree that this allows is closed by <see cref="ValidateReferenceGraph" />, which rejects cycles.
    /// </summary>
    private static void ValidateFrameReference(
        string reference,
        string path,
        IReadOnlyDictionary<string, FamilyModelFrame> frames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (!PortableFamilyReference.TryParse(reference, out var frame) ||
            frame.Kind != PortableFamilyReferenceKind.Frame) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidReference,
                path,
                $"Frame '{reference}' must be a frame: reference."));
            return;
        }

        if (string.Equals(reference, BuiltInFamilyFrame, StringComparison.Ordinal) ||
            frames.ContainsKey(frame.Target))
            return;

        diagnostics.Add(new FamilyModelDiagnostic(
            FamilyModelDiagnosticCodes.UnsupportedFrame,
            path,
            $"Frame '{reference}' must be frame:family or a declared frame."));
    }

    private static void ValidatePlaneOrFaceReference(
        string value,
        string path,
        IEnumerable<string> planeSlugs,
        IReadOnlyDictionary<string, FamilyModelSolid> solids,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (!PortableFamilyReference.TryParse(value, out var reference)) {
            diagnostics.Add(new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.InvalidReference, path,
                $"'{value}' is not a plane or face reference."));
            return;
        }

        if (reference.Kind == PortableFamilyReferenceKind.Plane &&
            (reference.Target.StartsWith("family.", StringComparison.Ordinal) ||
             planeSlugs.Contains(reference.Target, StringComparer.Ordinal)))
            return;

        if (reference.Kind == PortableFamilyReferenceKind.Face &&
            solids.TryGetValue(reference.Target, out var solid) &&
            IsReferenceableFace(solid, reference.Member))
            return;

        diagnostics.Add(new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.InvalidReference, path,
            $"Reference '{value}' does not resolve to a declared plane/solid face."));
    }

    /// <summary>
    ///     The named faces of one solid. A prism has six, a cylinder has two ends plus its curved `Side`,
    ///     and an extruded polygon has two ends plus one `Edge&lt;N&gt;` per profile segment — edge N joins
    ///     profile point N to point N+1, and the last edge closes the ring back to point 0.
    /// </summary>
    /// <remarks>
    ///     Enumerating a face is not the same as being able to REFERENCE it:
    ///     <see cref="IsReferenceableFace" /> is the narrower rule.
    /// </remarks>
    private static IReadOnlyList<string> GetSolidFaces(FamilyModelSolid solid) {
        if (solid.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism)
            return ["Front", "Back", "Left", "Right", "Top", "Bottom"];

        if (solid.Kind is FamilySolidKind.Cylinder or FamilySolidKind.VoidCylinder)
            return ["Top", "Bottom", "Side"];

        return ["Top", "Bottom", .. Enumerable.Range(0, solid.Profile.Count).Select(index => $"Edge{index}")];
    }

    /// <summary>
    ///     Which faces a plane, a frame, or a connector may stand on. A cylinder's `Side` is curved, so it
    ///     is not a plane at all. An `Edge&lt;N&gt;` IS planar, but its identity is the authored ordinal
    ///     and nothing else: Revit gives a sketch-derived face no stable name, so capture would have to
    ///     guess which planar face is edge 3, and inserting one profile point renumbers every edge after
    ///     it. A reference that survives neither capture nor an ordinary profile edit is not portable, so
    ///     v1 refuses it. Top and Bottom stay referenceable because there are exactly two of them,
    ///     whatever the profile does.
    /// </summary>
    private static bool IsReferenceableFace(FamilyModelSolid solid, string? face) =>
        GetSolidFaces(solid).Contains(face, StringComparer.Ordinal) &&
        !string.Equals(face, "Side", StringComparison.Ordinal) &&
        !(face ?? string.Empty).StartsWith("Edge", StringComparison.Ordinal);

    /// <summary>
    ///     A closed ring of at least three points. Self-intersection is NOT checked here: whether a profile
    ///     makes a valid sketch is Revit's judgement, reported when the family is built, and a geometry
    ///     checker in this contract would be a second opinion that can disagree with the only one that
    ///     matters.
    /// </summary>
    private static void ValidateProfile(
        IReadOnlyList<FamilyModelProfilePoint> profile,
        string path,
        FamilySolidKind kind,
        string slug,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (profile.Count < 3) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidSolid,
                $"{path}.profile",
                $"{kind} solid '{slug}' requires a profile of at least three points; it has {profile.Count}."));
            return;
        }

        for (var index = 0; index < profile.Count; index++) {
            ValidateLengthDriver(profile[index].X, $"{path}.profile[{index}].x", parameterNames, diagnostics);
            ValidateLengthDriver(profile[index].Y, $"{path}.profile[{index}].y", parameterNames, diagnostics);
        }

        var first = profile[0];
        var last = profile[profile.Count - 1];
        if (string.Equals(first.X, last.X, StringComparison.Ordinal) &&
            string.Equals(first.Y, last.Y, StringComparison.Ordinal)) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidSolid,
                $"{path}.profile[{profile.Count - 1}]",
                $"{kind} solid '{slug}' closes implicitly; the last point must not repeat the first."));
        }
    }

    private static void ValidateAxis(
        string axis,
        string path,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (axis is "+X" or "-X" or "+Y" or "-Y" or "+Z" or "-Z")
            return;

        diagnostics.Add(new FamilyModelDiagnostic(
            FamilyModelDiagnosticCodes.InvalidFrame,
            path,
            $"Axis '{axis}' must be one of +X, -X, +Y, -Y, +Z, -Z."));
    }

    private static string NegateAxis(string axis) => axis.StartsWith("-", StringComparison.Ordinal)
        ? $"+{axis[1..]}"
        : axis.StartsWith("+", StringComparison.Ordinal)
            ? $"-{axis[1..]}"
            : axis;

    private static void ValidateParameterMap<TParameter>(
        IReadOnlyDictionary<string, TParameter> parameters,
        string path,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) where TParameter : FamilyModelParameter {
        foreach (var pair in parameters) {
            var name = pair.Key;
            var parameter = pair.Value;
            Require(name, $"{path}.{name}", "Parameter name", diagnostics);
            if (!string.IsNullOrWhiteSpace(parameter.Value) && !string.IsNullOrWhiteSpace(parameter.Formula)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.ValueFormulaConflict,
                    $"{path}.{name}",
                    $"Parameter '{name}' cannot define both value and formula."));
            }
        }
    }

    private static void ValidateTypes(
        IReadOnlyDictionary<string, Dictionary<string, string>> types,
        IReadOnlyDictionary<string, FamilyModelParameter> parameters,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in types) {
            var typeName = pair.Key;
            var values = pair.Value;
            Require(typeName, $"$.types.{typeName}", "Family type name", diagnostics);
            foreach (var parameterName in values.Keys) {
                if (!parameters.TryGetValue(parameterName, out var parameter)) {
                    diagnostics.Add(new FamilyModelDiagnostic(
                        FamilyModelDiagnosticCodes.UnknownParameter,
                        $"$.types.{typeName}.{parameterName}",
                        $"Family type '{typeName}' assigns undeclared parameter '{parameterName}'."));
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(parameter.Formula)) {
                    diagnostics.Add(new FamilyModelDiagnostic(
                        FamilyModelDiagnosticCodes.FormulaTypeOverride,
                        $"$.types.{typeName}.{parameterName}",
                        $"Formula-driven parameter '{parameterName}' cannot have a per-type value."));
                }
            }
        }
    }

    private static void ValidateSolids(
        IReadOnlyDictionary<string, FamilyModelSolid> solids,
        IReadOnlyDictionary<string, FamilyModelFrame> frames,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in solids) {
            var slug = pair.Key;
            var solid = pair.Value;
            Require(slug, $"$.solids.{slug}", "Solid slug", diagnostics);
            ValidateFrameReference(solid.Frame, $"$.solids.{slug}.frame", frames, diagnostics);

            var prism = solid.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism;
            var polygon = solid.Kind is FamilySolidKind.ExtrudedPolygon or FamilySolidKind.VoidExtrudedPolygon;
            var requiredDrivers = polygon
                ? new[] { ("height", solid.Height) }
                : prism
                    ? new[] { ("width", solid.Width), ("depth", solid.Depth), ("height", solid.Height) }
                    : new[] { ("diameter", solid.Diameter), ("height", solid.Height) };
            var forbiddenDrivers = polygon
                ? new[] { ("width", solid.Width), ("depth", solid.Depth), ("diameter", solid.Diameter) }
                : prism
                    ? new[] { ("diameter", solid.Diameter) }
                    : new[] { ("width", solid.Width), ("depth", solid.Depth) };
            if (polygon)
                ValidateProfile(solid.Profile, $"$.solids.{slug}", solid.Kind, slug, parameterNames, diagnostics);
            else if (solid.Profile.Count > 0) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidSolid,
                    $"$.solids.{slug}.profile",
                    $"{solid.Kind} solid '{slug}' cannot define profile."));
            }

            foreach (var (name, value) in requiredDrivers) {
                if (string.IsNullOrWhiteSpace(value)) {
                    diagnostics.Add(new FamilyModelDiagnostic(
                        FamilyModelDiagnosticCodes.InvalidSolid,
                        $"$.solids.{slug}.{name}",
                        $"{solid.Kind} solid '{slug}' requires {name}."));
                    continue;
                }

                ValidateLengthDriver(value!, $"$.solids.{slug}.{name}", parameterNames, diagnostics);
            }

            foreach (var (name, value) in forbiddenDrivers.Where(item => !string.IsNullOrWhiteSpace(item.Item2))) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidSolid,
                    $"$.solids.{slug}.{name}",
                    $"{solid.Kind} solid '{slug}' cannot define {name}."));
            }
        }
    }

    /// <summary>
    ///     The settings key set is closed by the schema itself — an unknown key cannot deserialize — so the
    ///     only semantic rule left is that a key carries a value Revit can accept. An OmniClass code is a
    ///     dotted number sequence; Revit rejects anything else when the code is set, and rejecting it here
    ///     keeps that failure at authoring time.
    /// </summary>
    private static void ValidateSettings(
        FamilyModelSettings? settings,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (settings?.OmniClass == null)
            return;

        if (!OmniClassCode.IsMatch(settings.OmniClass)) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidSettings,
                "$.settings.omniClass",
                $"OmniClass number '{settings.OmniClass}' must be a dotted number sequence such as '23.80.20.11.14'."));
        }
    }

    /// <summary>
    ///     The offset is a portable length LITERAL, never a `param:` reference. Apply moves a
    ///     `SpatialElementCalculationPoint` element to that position; an element position does not follow a
    ///     parameter, so a param-driven offset would look live and be frozen.
    /// </summary>
    private static void ValidateRoomCalculationPointOffset(
        string? offset,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (offset == null)
            return;

        if (!PortableScalar.TryParse(offset, out var scalar) || scalar.Kind != PortableScalarKind.Length) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidRoomCalculationPoint,
                "$.roomCalculationPoint.offset",
                $"Room calculation point offset '{offset}' must be a portable length literal such as '1ft'."));
        }
    }

    /// <summary>
    ///     Structural checks only: the table name is its identity, and the CSV must carry a header row plus
    ///     at least one data row. Whether the CSV is a VALID Revit size table is decided by
    ///     `LookupTableCsvCodec` and `LookupTableValidator` when the model is lowered — this contract stays
    ///     year-neutral and does not carry a second CSV parser.
    /// </summary>
    private static void ValidateLookupTables(
        IReadOnlyDictionary<string, FamilyModelLookupTable> lookupTables,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in lookupTables) {
            var path = $"$.lookupTables.{pair.Key}";
            Require(pair.Key, path, "Lookup table name", diagnostics);
            if (string.IsNullOrWhiteSpace(pair.Value.Csv)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidLookupTable,
                    $"{path}.csv",
                    $"Lookup table '{pair.Key}' carries no CSV content."));
                continue;
            }

            var lines = pair.Value.Csv
                .Split('\n')
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .ToList();
            if (lines.Count < 2) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidLookupTable,
                    $"{path}.csv",
                    $"Lookup table '{pair.Key}' needs a header row and at least one data row."));
            }
        }
    }

    private static void ValidateLengthDriver(
        string text,
        string path,
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (PortableFamilyReference.TryParse(text, out var reference)) {
            if (reference.Kind == PortableFamilyReferenceKind.Parameter && parameterNames.Contains(reference.Target))
                return;

            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.InvalidDriver,
                path,
                $"Length driver '{text}' must reference a declared parameter."));
            return;
        }

        if (PortableScalar.TryParse(text, out var scalar) && scalar.Kind == PortableScalarKind.Length)
            return;

        diagnostics.Add(new FamilyModelDiagnostic(
            FamilyModelDiagnosticCodes.InvalidDriver,
            path,
            $"Length driver '{text}' must be a param: reference or a portable length literal."));
    }

    private static void Require(
        string value,
        string path,
        string label,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        if (string.IsNullOrWhiteSpace(value)) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.Required,
                path,
                $"{label} is required."));
        }
    }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum PortableFamilyReferenceKind {
    Parameter,
    Plane,
    Frame,
    Face,
    NestedFamily,
    Dependency
}

public readonly record struct PortableFamilyReference(
    PortableFamilyReferenceKind Kind,
    string Target,
    string? Member = null
) {
    public static bool TryParse(string? text, out PortableFamilyReference reference) {
        reference = default;
        if (string.IsNullOrWhiteSpace(text))
            return false;

        var source = text!;
        var separator = source.IndexOf(':');
        if (separator <= 0 || separator == source.Length - 1)
            return false;

        var kind = source[..separator] switch {
            "param" => PortableFamilyReferenceKind.Parameter,
            "plane" => PortableFamilyReferenceKind.Plane,
            "frame" => PortableFamilyReferenceKind.Frame,
            "face" => PortableFamilyReferenceKind.Face,
            "nested" => PortableFamilyReferenceKind.NestedFamily,
            "dependency" => PortableFamilyReferenceKind.Dependency,
            _ => (PortableFamilyReferenceKind?)null
        };
        if (kind == null)
            return false;

        var target = source[(separator + 1)..];
        if (kind != PortableFamilyReferenceKind.Face) {
            reference = new PortableFamilyReference(kind.Value, target);
            return true;
        }

        var memberSeparator = target.LastIndexOf('.');
        if (memberSeparator <= 0 || memberSeparator == target.Length - 1)
            return false;

        reference = new PortableFamilyReference(
            PortableFamilyReferenceKind.Face,
            target[..memberSeparator],
            target[(memberSeparator + 1)..]);
        return true;
    }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum PortableScalarKind {
    Length,
    Angle
}

public readonly record struct PortableScalar(
    PortableScalarKind Kind,
    double Value,
    string Unit
) {
    private static readonly Regex Pattern = new(
        @"^\s*(?<number>[+-]?(?:\d+(?:\.\d+)?|\d+\s+\d+/\d+|\d+/\d+))\s*(?<unit>mm|cm|in|ft|m|deg)\s*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static bool TryParse(string? text, out PortableScalar scalar) {
        scalar = default;
        if (string.IsNullOrWhiteSpace(text))
            return false;

        var match = Pattern.Match(text!);
        if (!match.Success || !TryParseNumber(match.Groups["number"].Value, out var value))
            return false;

        var unit = match.Groups["unit"].Value;
        var kind = string.Equals(unit, "deg", StringComparison.Ordinal)
            ? PortableScalarKind.Angle
            : PortableScalarKind.Length;
        scalar = new PortableScalar(kind, value, unit);
        return true;
    }

    private static bool TryParseNumber(string text, out double value) {
        var sign = 1.0;
        var unsigned = text.Trim();
        if (unsigned.StartsWith("-", StringComparison.Ordinal)) {
            sign = -1.0;
            unsigned = unsigned[1..];
        } else if (unsigned.StartsWith("+", StringComparison.Ordinal)) {
            unsigned = unsigned[1..];
        }

        var parts = unsigned.Split([' '], StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 2 &&
            double.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var whole) &&
            TryParseFraction(parts[1], out var fraction)) {
            value = sign * (whole + fraction);
            return true;
        }

        if (parts.Length == 1 && TryParseFraction(parts[0], out var onlyFraction)) {
            value = sign * onlyFraction;
            return true;
        }

        if (parts.Length == 1 &&
            double.TryParse(parts[0], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number)) {
            value = sign * number;
            return true;
        }

        value = default;
        return false;
    }

    private static bool TryParseFraction(string text, out double value) {
        var parts = text.Split('/');
        if (parts.Length == 2 &&
            double.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var numerator) &&
            double.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var denominator) &&
            denominator != 0) {
            value = numerator / denominator;
            return true;
        }

        value = default;
        return false;
    }
}
