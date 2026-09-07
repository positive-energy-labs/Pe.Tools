using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     Portable authored truth for one family — the ONE portable profile schema (`family.json`).
///     No ElementIds, no Revit API objects, no recovery metadata; capture reconstructs it from the document
///     by NAME. Every section is a Revit element class or a Revit element property.
/// </summary>
/// <remarks>
///     <para>
///         Locked shape decisions (2026-09-06, family rewrite rounds 1–2; evidence in
///         `docs/features/family/LEDGER.md` "Family rewrite" and the round reports). These are schema law,
///         not style; each was paid for by a proof.
///     </para>
///     <para>
///         <b>Name-keyed maps, never arrays; NAMES ARE IDENTITY.</b> <see cref="Parameters" /> and
///         <see cref="Types" /> are keyed by EXACT Revit names. <see cref="Datums" />, <see cref="RefPlanes" />
///         and <see cref="RefLines" /> are keyed by the element's Revit `Name`, the only user-editable name
///         Revit gives geometry. <see cref="Dimensions" />, <see cref="Forms" />, <see cref="FamilyModelNested" />,
///         <see cref="Arrays" />, <see cref="Connectors" /> and <see cref="Details" /> are keyed by an author
///         slug; capture recovers their identity structurally (a dimension by its label, a form by the planes
///         its sketch is locked to, a nested instance by family+type+host+alignments, an array by
///         member+label+direction, a connector by domain+`on`+`at`). Two structurally identical entries are
///         one <see cref="UnmodeledReason.IdentityNotUnique" />. No raw Revit id appears anywhere.
///     </para>
///     <para>
///         <b>Two maps of planes (critic F2, PROVEN live).</b> `Ref. Level` is a Level, not a
///         `ReferencePlane`; Revit's default plane is literally named `Reference Plane`; template names vary
///         by year and locale. So <see cref="Datums" /> holds levels and template-shipped planes, declared
///         explicitly by name and normal (no seed), and <see cref="RefPlanes" /> holds author planes
///         (`DATUM_PLANE_DEFINES_ORIGIN == 0`). <b>No reference resolves by assumption (F3):</b> every plane
///         name in the document must resolve against a declared datum, ref plane, or macro plane. Until the
///         generated per-template alias table exists, the author declares the template planes they use.
///     </para>
///     <para>
///         <b>Two reference forms only.</b> `param:&lt;Exact Name&gt;` names a declared parameter. Every
///         other reference is a bare declared name (datum, ref plane, ref line). The one compound form is
///         `line:&lt;Name&gt;.start|end`, the end work plane of a reference line, position-only (VERDICTS-R2 §3).
///         Typed reference objects, `plane:`, `frame:`, `face:`, `nested:` and `dependency:` prefixes do
///         not exist.
///     </para>
///     <para>
///         <b>One unit grammar on EVERY length and angle.</b> <see cref="PortableLength" /> and
///         <see cref="PortableAngle" /> parse `param:` or a literal at deserialize time, so a bad literal is
///         a parse error at its JSON path in every slot. The literal grammar is <see cref="PortableScalar" />:
///         `6in`, `1/2in`, `1 1/2in`, `150mm`, `2ft`, `0.5m`, `45deg`, AND Revit's own feet-inches display
///         form `1' - 0 1/2"`, `2"`, `3'` (critic F17: 550 of 561 corpus per-type cells are written that way).
///         Parameter <see cref="FamilyModelParameter.Value" /> and per-type cells are <see cref="PortableValue" />: the
///         same grammar yields a kind, and the validator matches the kind to the parameter's
///         <see cref="DataType" /> one hop later, because the data type is a sibling a converter cannot see.
///     </para>
///     <para>
///         <b>Value XOR formula</b> per parameter, schema-enforced. Formulas are Revit formula text; the
///         validator resolves every name token against <see cref="Parameters" /> (GROUNDING gotcha 17
///         tokenizer: string literals stripped first, built-in functions excluded).
///     </para>
///     <para>
///         <b>Macros are parse-time sugar (VERDICTS-R2 §1).</b> <see cref="FormKind.Prism" /> and
///         <see cref="FormKind.Cylinder" /> exist only in the text an author writes. <see cref="FamilyModelJson.Parse" />
///         expands them into named planes, EQ and labeled dimensions and one <see cref="FormKind.Extrusion" />
///         BEFORE validation; a parsed <see cref="FamilyModel" /> never contains a macro, capture never folds
///         one back, and both sides of a diff are expanded. See <see cref="FamilyModelMacros" />.
///     </para>
///     <para>
///         <b>Honesty over completeness.</b> <see cref="Unmodeled" /> is the ledger of the INEXPRESSIBLE with
///         a closed reason enum; the compiler refuses to apply it. <see cref="Coverage" /> is a different
///         fact: whether capture READ a section at all (critic F6/F9). A change in a section capture did not
///         fully read is Unverifiable by construction. Nothing may be persisted in extensible storage,
///         hidden parameters, or `DataStorage` to make capture or a test succeed.
///     </para>
///     <para>
///         <b>Strict parse.</b> Newtonsoft, <see cref="MemberSerialization.OptIn" />,
///         <see cref="MissingMemberHandling.Error" />, duplicate keys rejected, every closed set an enum so a
///         wrong token is `invalid-json` at its path before any rule runs.
///     </para>
/// </remarks>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModel {
    [JsonProperty("family", Required = Required.Always)]
    public FamilyModelHeader Family { get; init; } = new();

    /// <summary>Exact Revit parameter name → declaration. Family and shared parameters share this map (`shared: true`).</summary>
    [JsonProperty("parameters")]
    public Dictionary<string, FamilyModelParameter> Parameters { get; init; } = new(StringComparer.Ordinal);

    /// <summary>
    ///     Family type name → (exact parameter name → per-type value). Per-type OBJECTS: empty and uniform
    ///     types stay visible. The first in document order is the preview type. A canonical `family.json`
    ///     carries no deletion tombstones; patch semantics belong to <see cref="FamilyPatch" />.
    /// </summary>
    [JsonProperty("types")]
    public Dictionary<string, Dictionary<string, PortableValue>> Types { get; init; } = new(StringComparer.Ordinal);

    /// <summary>Levels and template-shipped planes the document references, declared by name and normal.</summary>
    [JsonProperty("datums")]
    public Dictionary<string, FamilyModelDatum> Datums { get; init; } = new(StringComparer.Ordinal);

    /// <summary>Author-created `ReferencePlane`s keyed by Name.</summary>
    [JsonProperty("refPlanes")]
    public Dictionary<string, FamilyModelRefPlane> RefPlanes { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("refLines")]
    public Dictionary<string, FamilyModelRefLine> RefLines { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("dimensions")]
    public Dictionary<string, FamilyModelDim> Dimensions { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("forms")]
    public Dictionary<string, FamilyModelForm> Forms { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("nested")]
    public Dictionary<string, FamilyModelNested> Nested { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("arrays")]
    public Dictionary<string, FamilyModelArray> Arrays { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("connectors")]
    public Dictionary<string, FamilyModelConnector> Connectors { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("details")]
    public Dictionary<string, FamilyModelDetail> Details { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("settings", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyModelSettings? Settings { get; init; }

    /// <summary>Embedded Revit size tables keyed by exact table name; the value is the Revit CSV verbatim.</summary>
    [JsonProperty("lookupTables")]
    public Dictionary<string, FamilyModelLookupTable> LookupTables { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("roomCalculationPoint", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyModelRoomCalculationPoint? RoomCalculationPoint { get; init; }

    /// <summary>
    ///     Section JSON name → how much of it capture read. Emitted by capture only; an authored document
    ///     leaves it empty, which means "authored, fully stated". A section absent here after capture is
    ///     <see cref="CoverageState.NotRead" />.
    /// </summary>
    [JsonProperty("coverage")]
    public Dictionary<string, CoverageState> Coverage { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("unmodeled")]
    public List<FamilyModelUnmodeledFact> Unmodeled { get; init; } = [];

    /// <summary>The section names <see cref="Coverage" /> may key on.</summary>
    public static readonly string[] SectionNames = [
        "parameters", "types", "datums", "refPlanes", "refLines", "dimensions", "forms", "nested", "arrays",
        "connectors", "details", "settings", "lookupTables", "roomCalculationPoint"
    ];
}

[JsonConverter(typeof(StringEnumConverter))]
public enum CoverageState { Read, Partial, NotRead }

// ───────────────────────────── header ─────────────────────────────

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelHeader {
    [JsonProperty("name", Required = Required.Always)]
    public string Name { get; init; } = string.Empty;

    /// <summary>The family category as a closed token; the English Revit label (`Generic Models`) is accepted on input.</summary>
    [JsonProperty("category", Required = Required.Always)]
    public FamilyCategory Category { get; init; }

    /// <summary>Stock template display name, e.g. `Generic Model`, `Plumbing Fixture wall based`. Resolved against the installed template table at lowering.</summary>
    [JsonProperty("template", Required = Required.Always)]
    public string Template { get; init; } = string.Empty;

    /// <summary>Mirrors `Autodesk.Revit.DB.FamilyPlacementType` by name. Never collapsed (c-revit §3 flagged the loss).</summary>
    [JsonProperty("placement", Required = Required.Always)]
    public FamilyModelPlacement Placement { get; init; }
}

/// <summary>Mirrors `Autodesk.Revit.DB.FamilyPlacementType` by name, verified against the Revit 2025 API.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyModelPlacement {
    OneLevelBased, OneLevelBasedHosted, TwoLevelsBased, ViewBased, WorkPlaneBased, CurveBased,
    CurveBasedDetail, CurveDrivenStructural, Adaptive
}

/// <summary>
///     Family categories the templates in the corpus carry, as tokens. Adding a member is the only way to
///     admit a category. Input accepts the token or the English Revit label (spaces and punctuation ignored).
/// </summary>
[JsonConverter(typeof(LenientEnumConverter<FamilyCategory>))]
public enum FamilyCategory {
    GenericModels, AirTerminals, MechanicalEquipment, ElectricalEquipment, ElectricalFixtures, LightingFixtures,
    PlumbingFixtures, PipeAccessories, PipeFittings, DuctAccessories, DuctFittings, Sprinklers, Furniture, Casework,
    SpecialtyEquipment, DataDevices, FireAlarmDevices, CommunicationDevices, SecurityDevices, NurseCallDevices,
    TelephoneDevices, DetailItems, GenericAnnotations
}

// ───────────────────────────── parameters ─────────────────────────────

/// <summary>
///     One family-scoped parameter. <see cref="Shared" /> = true means a shared parameter: its name resolves
///     to a shared-parameter definition that owns data type and tooltip, so those two slots are FORBIDDEN on
///     it (`shared-owns-datatype`). A family parameter MUST carry <see cref="DataType" /> (critic F18: the
///     corpus has 35 nulls, and every type-dependent rule rests on it). Value XOR formula.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelParameter {
    [JsonProperty("shared", NullValueHandling = NullValueHandling.Ignore)]
    public bool? Shared { get; init; }

    [JsonProperty("sharedGuid", NullValueHandling = NullValueHandling.Ignore)]
    public Guid? SharedGuid { get; init; }

    /// <summary>Exact native shared spec id. Together with sharedGuid this embeds an offline definition.</summary>
    [JsonProperty("sharedSpecId", NullValueHandling = NullValueHandling.Ignore)]
    public string? SharedSpecId { get; init; }

    [JsonProperty("sharedVisible", NullValueHandling = NullValueHandling.Ignore)]
    public bool? SharedVisible { get; init; }

    [JsonProperty("sharedUserModifiable", NullValueHandling = NullValueHandling.Ignore)]
    public bool? SharedUserModifiable { get; init; }

    [JsonProperty("dataType", NullValueHandling = NullValueHandling.Ignore)]
    public DataType? DataType { get; init; }

    /// <summary>The one parameter grouping contract; no UI may add a second.</summary>
    [JsonProperty("propertiesGroup", NullValueHandling = NullValueHandling.Ignore)]
    public string? PropertiesGroup { get; init; }

    [JsonProperty("isInstance", NullValueHandling = NullValueHandling.Ignore)]
    public bool? IsInstance { get; init; }

    [JsonProperty("tooltip", NullValueHandling = NullValueHandling.Ignore)]
    public string? Tooltip { get; init; }

    /// <summary>Uniform value across types. A literal in the unit grammar, a number, `Yes`/`No`, or text; never `param:`.</summary>
    [JsonProperty("value", NullValueHandling = NullValueHandling.Ignore)]
    public PortableValue? Value { get; init; }

    /// <summary>Revit formula text. Name tokens are resolved against <see cref="FamilyModel.Parameters" />.</summary>
    [JsonProperty("formula", NullValueHandling = NullValueHandling.Ignore)]
    public string? Formula { get; init; }

    /// <summary>
    ///     Explicit source candidates, ranked by populated type count with authored-order ties. Existing
    ///     destination wins. Transfer references before removing user-defined sources, even when source values differ.
    /// </summary>
    [JsonProperty("wasNamed", NullValueHandling = NullValueHandling.Ignore)]
    public List<string>? WasNamed { get; init; }

    /// <summary>For an existing destination only, fill blank cells from ranked wasNamed sources. Explicit values always win.</summary>
    [JsonProperty("fillBlanksFromSources", NullValueHandling = NullValueHandling.Ignore)]
    public bool? FillBlanksFromSources { get; init; }

    /// <summary>Existing SetValue coercion strategy name; omitted means CoerceByStorageType.</summary>
    [JsonProperty("mappingStrategy", NullValueHandling = NullValueHandling.Ignore)]
    public string? MappingStrategy { get; init; }

    /// <summary>Exact source string values treated as missing for this mapping; other mappings retain normal coercion.</summary>
    [JsonProperty("sourceValuesTreatedAsMissing", NullValueHandling = NullValueHandling.Ignore)]
    public List<string>? SourceValuesTreatedAsMissing { get; init; }
}

/// <summary>
///     Closed data-type token set, one member per `SpecTypeId` family (critic F17/F18, VERDICTS-R2). The
///     document carries the TOKEN. On input <see cref="DataTypeConverter" /> also accepts the Revit UI label
///     (`Length (Common)`, `Yes/No`) and the forge id (`autodesk.spec.aec:length-2.0.1`) and normalizes
///     them; capture emits the token. The forge-id stems are LORE until the per-year alias table is
///     generated from `RevitLabelCatalog`; an unknown spelling is a parse error naming the legal tokens.
/// </summary>
[JsonConverter(typeof(DataTypeConverter))]
public enum DataType {
    Length, Area, Volume, Angle, Integer, Number, YesNo, Text, Url, Material, MultilineText,
    ElectricalPotential, Current, ApparentPower, Wattage, NumberOfPoles, AirFlow, Pressure, Temperature,
    PipingFlow, PipeSize, DuctSize, HvacVelocity, Slope, Currency, LoadClassification
}

// ───────────────────────────── datums and planes ─────────────────────────────

/// <summary>
///     One level or template-shipped plane the document refers to, e.g. `Ref. Level` (a Level),
///     `Center (Left/Right)`, `Center (Front/Back)`, `Back` on wall templates. Declared, never assumed.
///     Carries no seed: the template owns its position.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelDatum {
    /// <summary>
    ///     RULING (kaitpw, 2026-09-06): a datum normal is an UNSIGNED axis token, `X`, `Y`, or `Z`.
    ///     Revit stores a signed normal for a template plane, and the stored sign varies. The
    ///     `Center (Front/Back)` plane reads `MinusY` in both real families, and the fixtures declared it
    ///     `PlusY`. Neither spelling is more true than the other.
    ///     A datum carries no seed, so the sign of a datum normal drives nothing. The sign records which
    ///     template built the family, and the diff then reports a difference that is not a change.
    ///     Capture folds the stored sign away and emits the unsigned axis token. The author writes the same
    ///     token. The validator refuses a signed token here, and names the unsigned token it wanted.
    ///     A refPlane keeps a SIGNED normal, because the author's seed runs along it. See
    ///     <see cref="FamilyModelRefPlane.Normal" />.
    /// </summary>
    [JsonProperty("normal", Required = Required.Always)]
    public Axis Normal { get; init; }

    /// <summary>True for a `Level` (`Ref. Level`, `Lower Ref. Level`); false or absent for a template `ReferencePlane`.</summary>
    [JsonProperty("isLevel", NullValueHandling = NullValueHandling.Ignore)]
    public bool? IsLevel { get; init; }
}

/// <summary>
///     One author `ReferencePlane`, keyed by its Name. <see cref="At" /> is a numeric SEED along
///     <see cref="Normal" /> from the family origin: Revit moves the plane to satisfy its labeled dimension on
///     regen, so the seed is never truth, only the initial placement and the only slot where a negative
///     length is legal. It is a literal, never `param:` (`seed-is-literal`).
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelRefPlane {
    /// <summary>
    ///     RULING (kaitpw, 2026-09-06): a refPlane normal stays SIGNED, `PlusX` through `MinusZ`.
    ///     The author owns a refPlane, and the author's <see cref="At" /> seed runs along this normal. A
    ///     flipped normal therefore flips the seed, and puts the refPlane on the other side of the family
    ///     origin. The sign here is authored truth, and capture emits the sign as read.
    ///     The validator refuses an unsigned token in a refPlane normal, and names a signed token it
    ///     wanted. A datum normal is unsigned, because a datum carries no seed. See
    ///     <see cref="FamilyModelDatum.Normal" />.
    /// </summary>
    [JsonProperty("normal", Required = Required.Always)]
    public Axis Normal { get; init; }

    [JsonProperty("at", Required = Required.Always)]
    public PortableLength At { get; init; }

    /// <summary>Revit "Is Reference" (`ELEM_REFERENCE_NAME`). Default `NotAReference`.</summary>
    [JsonProperty("isReference", NullValueHandling = NullValueHandling.Ignore)]
    public RefStrength? IsReference { get; init; }

    [JsonProperty("subcategory", NullValueHandling = NullValueHandling.Ignore)]
    public string? Subcategory { get; init; }
}

/// <summary>
///     Family axis tokens. The SIGNED tokens address a refPlane normal and an array direction, where the
///     sign is authored truth. The UNSIGNED tokens address a datum normal, where Revit's stored sign varies
///     and drives nothing (kaitpw ruling 2026-09-06).
/// </summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum Axis { PlusX, MinusX, PlusY, MinusY, PlusZ, MinusZ, X, Y, Z }

/// <summary>Signed and unsigned <see cref="Axis" /> tokens, and the fold between them.</summary>
public static class AxisTokens {
    public static bool IsSigned(this Axis a) => a <= Axis.MinusZ;

    /// <summary>The unsigned token on the same axis: `MinusY` and `PlusY` both fold to `Y`.</summary>
    public static Axis Unsigned(this Axis a) => a.IsSigned() ? (Axis)(((int)a / 2) + (int)Axis.X) : a;
}

/// <summary>Mirrors the `ELEM_REFERENCE_NAME` value set by name.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum RefStrength {
    NotAReference, WeakReference, StrongReference, Left, CenterLeftRight, Right, Front, CenterFrontBack, Back,
    Bottom, CenterElevation, Top
}

/// <summary>
///     One reference line (`ModelCurve` with `IsReferenceLine`), keyed `line-&lt;n&gt;` in document order
///     (RULING kaitpw 2026-09-06; Revit gives a reference line no user name, so the key is positional and
///     the scheme is a placeholder — see `FamilyModelCapturer.RefLines`), drawn on work plane
///     <see cref="On" /> from the intersection of two crossing planes. With <see cref="Angle" /> it is the
///     rotation hinge: a labeled angular dimension from <see cref="AngleFrom" /> (`MakeRefLines`, live-proven).
///     A capture noun first: puck-style families roundtrip honestly. Its end work plane is addressable as
///     `line:&lt;Name&gt;.end` for POSITION only; the compiler refuses a form sketched on a line or its
///     endpoint (`SketchPlane.Create` rejects both, live-proven; GROUNDING gotcha 27) with
///     <see cref="UnmodeledReason.FormSketchPlaneOnReferenceLine" />.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelRefLine {
    [JsonProperty("on", Required = Required.Always)]
    public string On { get; init; } = string.Empty;

    [JsonProperty("from", Required = Required.Always)]
    public List<string> From { get; init; } = [];

    [JsonProperty("length", Required = Required.Always)]
    public PortableLength Length { get; init; }

    [JsonProperty("angleFrom", NullValueHandling = NullValueHandling.Ignore)]
    public string? AngleFrom { get; init; }

    [JsonProperty("angle", NullValueHandling = NullValueHandling.Ignore)]
    public PortableAngle? Angle { get; init; }
}

/// <summary>
///     One Revit `Dimension`. Two or more references in <see cref="Between" />; <see cref="Label" /> is the
///     exact parameter name (`FamilyLabel`); <see cref="Equality" /> is the EQ toggle and needs three or more
///     references. Capture emits only dimensions that are labeled, locked, or EQ: an unlabeled unlocked
///     dimension drives nothing and is annotation, not authored truth.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelDim {
    [JsonProperty("between", Required = Required.Always)]
    public List<string> Between { get; init; } = [];

    [JsonProperty("label", NullValueHandling = NullValueHandling.Ignore)]
    public string? Label { get; init; }

    [JsonProperty("equality", NullValueHandling = NullValueHandling.Ignore)]
    public bool? Equality { get; init; }

    /// <summary>Locked literal distance. Label XOR locked; a locked labeled dimension is a Revit error.</summary>
    [JsonProperty("locked", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Locked { get; init; }

    /// <summary>Stock view the dimension lives in; default is the plan for Z-normal references, Front otherwise.</summary>
    [JsonProperty("view", NullValueHandling = NullValueHandling.Ignore)]
    public StockView? View { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum StockView { RefLevel, Front, Back, Left, Right, PlacementSide, Backside }

// ───────────────────────────── forms ─────────────────────────────

/// <summary>
///     One `Extrusion` (the only <see cref="GenericForm" /> kind in the vocabulary), or, in AUTHORED TEXT
///     ONLY, one macro. <see cref="Kind" /> selects the slot set; slots from another kind are
///     `slot-not-legal-for-kind`.
///     <para><b>Extrusion</b>: <see cref="Profile" /> loops sketched on <see cref="SketchPlane" />, each line
///     locked `on` a plane (`NewAlignment`, LAW); the extrusion spans <see cref="Start" /> (default the sketch
///     plane) to <see cref="End" />.</para>
///     <para><b>Prism macro</b>: <see cref="Width" />, <see cref="Depth" />, <see cref="Height" /> centred on
///     <see cref="Center" /> rising from <see cref="Bottom" />. <b>Cylinder macro</b>: <see cref="Diameter" />,
///     <see cref="Height" />. Both expand at parse time (<see cref="FamilyModelMacros" />); a parsed model
///     holds only extrusions.</para>
///     Sweeps, blends, revolves stay closed until a checked-in family forces one.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelForm {
    [JsonProperty("kind", Required = Required.Always)]
    public FormKind Kind { get; init; }

    [JsonProperty("void", NullValueHandling = NullValueHandling.Ignore)]
    public bool? Void { get; init; }

    [JsonProperty("subcategory", NullValueHandling = NullValueHandling.Ignore)]
    public string? Subcategory { get; init; }

    /// <summary>`param:` of a Material parameter, or a material name.</summary>
    [JsonProperty("material", NullValueHandling = NullValueHandling.Ignore)]
    public string? Material { get; init; }

    /// <summary>`param:` of a Yes/No parameter, associated to `IS_VISIBLE_PARAM` (live-proven both directions).</summary>
    [JsonProperty("visible", NullValueHandling = NullValueHandling.Ignore)]
    public string? Visible { get; init; }

    [JsonProperty("visibility", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyModelVisibilityViews? Visibility { get; init; }

    // Extrusion
    [JsonProperty("sketchPlane", NullValueHandling = NullValueHandling.Ignore)]
    public string? SketchPlane { get; init; }

    [JsonProperty("profile", NullValueHandling = NullValueHandling.Ignore)]
    public List<FamilyModelLoop>? Profile { get; init; }

    [JsonProperty("start", NullValueHandling = NullValueHandling.Ignore)]
    public string? Start { get; init; }

    [JsonProperty("end", NullValueHandling = NullValueHandling.Ignore)]
    public string? End { get; init; }

    // Prism / Cylinder macros (authored text only)
    /// <summary>Two crossing planes the macro is centred on. Required: no reference resolves by assumption.</summary>
    [JsonProperty("center", NullValueHandling = NullValueHandling.Ignore)]
    public List<string>? Center { get; init; }

    /// <summary>The plane the macro rises from. Required for a macro.</summary>
    [JsonProperty("bottom", NullValueHandling = NullValueHandling.Ignore)]
    public string? Bottom { get; init; }

    [JsonProperty("width", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Width { get; init; }

    [JsonProperty("depth", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Depth { get; init; }

    [JsonProperty("height", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Height { get; init; }

    [JsonProperty("diameter", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Diameter { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FormKind { Extrusion, Prism, Cylinder }

/// <summary>One closed loop of sketch curves. Consecutive lines must lie on crossing planes.</summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelLoop {
    [JsonProperty("curves", Required = Required.Always)]
    public List<FamilyModelSketchCurve> Curves { get; init; } = [];
}

/// <summary>
///     One sketch curve. A `Line` is locked to the plane it lies <see cref="On" />; its endpoints are the
///     intersections with its neighbours. A `Circle` sits on the intersection of two planes with a labeled
///     (or locked) diameter dimension.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelSketchCurve {
    [JsonProperty("kind", Required = Required.Always)]
    public CurveKind Kind { get; init; }

    [JsonProperty("on", NullValueHandling = NullValueHandling.Ignore)]
    public string? On { get; init; }

    [JsonProperty("center", NullValueHandling = NullValueHandling.Ignore)]
    public List<string>? Center { get; init; }

    [JsonProperty("diameter", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Diameter { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum CurveKind { Line, Circle }

/// <summary>Mirrors `FamilyElementVisibilitySettings` booleans by name (LAW for GenericForm).</summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelVisibilityViews {
    [JsonProperty("planRcp", NullValueHandling = NullValueHandling.Ignore)] public bool? PlanRcp { get; init; }
    [JsonProperty("frontBack", NullValueHandling = NullValueHandling.Ignore)] public bool? FrontBack { get; init; }
    [JsonProperty("leftRight", NullValueHandling = NullValueHandling.Ignore)] public bool? LeftRight { get; init; }
    [JsonProperty("onlyWhenCut", NullValueHandling = NullValueHandling.Ignore)] public bool? OnlyWhenCut { get; init; }
    [JsonProperty("coarse", NullValueHandling = NullValueHandling.Ignore)] public bool? Coarse { get; init; }
    [JsonProperty("medium", NullValueHandling = NullValueHandling.Ignore)] public bool? Medium { get; init; }
    [JsonProperty("fine", NullValueHandling = NullValueHandling.Ignore)] public bool? Fine { get; init; }
}

// ───────────────────────────── nested, arrays, connectors, details ─────────────────────────────

/// <summary>
///     One nested `FamilyInstance`. <see cref="Family" /> names a sibling `&lt;Family&gt;.family.json` built
///     first, or in the bulk lane a family already loaded by that name, else refuse (VERDICTS-R1 §5).
///     <see cref="Host" /> is the work plane (a datum, a ref plane, or `line:&lt;Name&gt;.end`, position only);
///     <see cref="FamilyModelAlign" /> locks the instance's own named reference planes to host planes (the puck method,
///     live-proven; `FamilyInstance.GetReferences(FamilyInstanceReferenceType)` resolves them by name, no
///     `EditFamily` needed); <see cref="Associate" /> maps instance parameter → `param:` host parameter,
///     including `Elevation from Level`. <see cref="Visible" /> is the `IS_VISIBLE_PARAM` binding. Rotation
///     is a binding into the nested family (`_conn angle` → puck `_angle`, live-proven), never a slot here.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelNested {
    [JsonProperty("family", Required = Required.Always)]
    public string Family { get; init; } = string.Empty;

    [JsonProperty("type", Required = Required.Always)]
    public string Type { get; init; } = string.Empty;

    [JsonProperty("host", Required = Required.Always)]
    public string Host { get; init; } = string.Empty;

    [JsonProperty("align", NullValueHandling = NullValueHandling.Ignore)]
    public List<FamilyModelAlign>? Align { get; init; }

    [JsonProperty("associate", NullValueHandling = NullValueHandling.Ignore)]
    public Dictionary<string, string>? Associate { get; init; }

    [JsonProperty("visible", NullValueHandling = NullValueHandling.Ignore)]
    public string? Visible { get; init; }
}

/// <summary>Lock the nested instance's reference plane <see cref="Instance" /> to host plane <see cref="To" />.</summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelAlign {
    [JsonProperty("instance", Required = Required.Always)]
    public string Instance { get; init; } = string.Empty;

    [JsonProperty("to", Required = Required.Always)]
    public string To { get; init; } = string.Empty;
}

/// <summary>
///     One `LinearArray`. Exactly Revit's fields: a member, a direction, a labeled Integer count, and whether
///     the count is measured to the second or the last member (`ArrayAnchorMember`). `MoveTo: Last` locks the
///     last member to <see cref="SpacingPlane" />; `MoveTo: Second` sets the pitch to <see cref="Spacing" />.
///     A centred array is two arrays, as in `PE GRD Exhaust.rfa` (LAW). Radial arrays stay out of scope.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelArray {
    [JsonProperty("member", Required = Required.Always)]
    public string Member { get; init; } = string.Empty;

    [JsonProperty("direction", Required = Required.Always)]
    public Axis Direction { get; init; }

    /// <summary>`param:` of an Integer parameter; Revit's array label. No literal: a count that cannot vary is not an array.</summary>
    [JsonProperty("label", Required = Required.Always)]
    public string Label { get; init; } = string.Empty;

    [JsonProperty("moveTo", Required = Required.Always)]
    public ArrayAnchor MoveTo { get; init; }

    [JsonProperty("spacing", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Spacing { get; init; }

    [JsonProperty("spacingPlane", NullValueHandling = NullValueHandling.Ignore)]
    public string? SpacingPlane { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ArrayAnchor { Second, Last }

/// <summary>
///     One `ConnectorElement`, addressed by the plane its own FACE lies on, <see cref="On" /> (any declared
///     plane, tangent planes included: the Grinder Pump Basin discharge sits on a plane tangent to a
///     cylinder) plus the two in-plane positioning planes <see cref="At" /> (four Zehnder duct connectors
///     share one top plane and differ only in `at`). Critic F10/F11, both PROVEN on the corpus. The connector normal is
///     the plane normal; there is no direction slot to get wrong. Identity and diff key: (domain, on, at).
///     Size slots are lengths; <see cref="Associate" /> maps connector parameter → `param:` host parameter
///     (gotcha 7 skip-list applies at lowering).
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelConnector {
    [JsonProperty("domain", Required = Required.Always)]
    public ConnectorDomain Domain { get; init; }

    [JsonProperty("systemType", Required = Required.Always)]
    public ConnectorSystemType SystemType { get; init; }

    /// <summary>
    ///     RULING (kaitpw, 2026-09-06): <see cref="On" /> is the plane the connector FACE lies on. It is not
    ///     the plane the connector's stub starts from.
    ///     `MakeConnectors` sketches the stub on <see cref="On" />, starts the stub one stub depth inward,
    ///     and ends the stub on <see cref="On" />, so the terminal face of the stub is coplanar with the
    ///     plane. Capture reads the connector face, finds the named plane the face lies on, and emits that
    ///     plane here. Capture therefore reads back exactly the name the author wrote.
    ///     A connector whose face lies on no named plane is `unmodeled` with reason
    ///     <see cref="UnmodeledReason.ConnectorFaceNotOnPlane" />. The author declares the missing plane and
    ///     the connector becomes addressable.
    /// </summary>
    [JsonProperty("on", Required = Required.Always)]
    public string On { get; init; } = string.Empty;

    [JsonProperty("at", Required = Required.Always)]
    public List<string> At { get; init; } = [];

    [JsonProperty("shape", NullValueHandling = NullValueHandling.Ignore)]
    public ConnectorShape? Shape { get; init; }

    [JsonProperty("diameter", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Diameter { get; init; }

    [JsonProperty("width", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Width { get; init; }

    [JsonProperty("height", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Height { get; init; }

    [JsonProperty("flowDirection", NullValueHandling = NullValueHandling.Ignore)]
    public FlowDirection? FlowDirection { get; init; }

    [JsonProperty("flowConfiguration", NullValueHandling = NullValueHandling.Ignore)]
    public FlowConfiguration? FlowConfiguration { get; init; }

    [JsonProperty("lossMethod", NullValueHandling = NullValueHandling.Ignore)]
    public LossMethod? LossMethod { get; init; }

    /// <summary>Rotation of the connector about its own normal.</summary>
    [JsonProperty("angle", NullValueHandling = NullValueHandling.Ignore)]
    public PortableAngle? Angle { get; init; }

    [JsonProperty("associate", NullValueHandling = NullValueHandling.Ignore)]
    public Dictionary<string, string>? Associate { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ConnectorDomain { Duct, Pipe, Electrical, CableTray, Conduit }

/// <summary>Union of `DuctSystemType`, `PipeSystemType`, `ElectricalSystemType` by name; the validator scopes it by domain.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum ConnectorSystemType {
    SupplyAir, ReturnAir, ExhaustAir, OtherAir, Global,
    DomesticColdWater, DomesticHotWater, Sanitary, HydronicSupply, HydronicReturn, FireProtectionWet, FireProtectionDry,
    FireProtectionPreAction, FireProtectionOther, Vent, OtherPipe, Fitting,
    PowerCircuit, PowerBalanced, PowerUnBalanced, Data, Telephone, Security, FireAlarm, NurseCall, Controls, Communication
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ConnectorShape { Round, Rectangular, Oval }

[JsonConverter(typeof(StringEnumConverter))]
public enum FlowDirection { In, Out, Bidirectional }

[JsonConverter(typeof(StringEnumConverter))]
public enum FlowConfiguration { Preset, Calculated, System, Demand }

[JsonConverter(typeof(StringEnumConverter))]
public enum LossMethod { NotDefined, Coefficient, SpecificLoss, Table }

/// <summary>
///     One detail element in one stock view: a nested Detail Item family instance (<see cref="Family" /> set)
///     or a loop of symbolic lines locked to planes (<see cref="Curves" /> set). Exactly one of the two.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelDetail {
    [JsonProperty("view", Required = Required.Always)]
    public StockView View { get; init; }

    [JsonProperty("family", NullValueHandling = NullValueHandling.Ignore)]
    public string? Family { get; init; }

    [JsonProperty("type", NullValueHandling = NullValueHandling.Ignore)]
    public string? Type { get; init; }

    [JsonProperty("curves", NullValueHandling = NullValueHandling.Ignore)]
    public List<FamilyModelLoop>? Curves { get; init; }

    [JsonProperty("align", NullValueHandling = NullValueHandling.Ignore)]
    public List<FamilyModelAlign>? Align { get; init; }

    [JsonProperty("visible", NullValueHandling = NullValueHandling.Ignore)]
    public string? Visible { get; init; }
}

// ───────────────────────────── settings, tables, room point, unmodeled ─────────────────────────────

/// <summary>
///     The closed set of family-GLOBAL Revit switches. Each key maps to exactly one Revit parameter on the
///     family element, named in its own doc-comment; there is no open bag, and an unknown key is a hard
///     parse failure. Omission means "leave whatever the template produced".
/// </summary>
/// <remarks>
///     Capture emits <see cref="Shared" />, <see cref="CutWithVoidsWhenLoaded" /> and <see cref="OmniClass" />
///     only when they differ from the stated portable default. <see cref="AlwaysVertical" /> and
///     <see cref="PartType" /> have NO stated default: their template value varies by category and by Revit
///     year, so capture emits the observed value whenever the parameter exists at all.
/// </remarks>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelSettings {
    /// <summary>`BuiltInParameter.FAMILY_ALWAYS_VERTICAL`, integer 0/1. No portable default: templates disagree.</summary>
    [JsonProperty("alwaysVertical", NullValueHandling = NullValueHandling.Ignore)]
    public bool? AlwaysVertical { get; init; }

    /// <summary>`BuiltInParameter.FAMILY_SHARED`, integer 0/1. Portable default `false`.</summary>
    [JsonProperty("shared", NullValueHandling = NullValueHandling.Ignore)]
    public bool? Shared { get; init; }

    /// <summary>`BuiltInParameter.FAMILY_ALLOW_CUT_WITH_VOIDS`, integer 0/1. Portable default `false`.</summary>
    [JsonProperty("cutWithVoidsWhenLoaded", NullValueHandling = NullValueHandling.Ignore)]
    public bool? CutWithVoidsWhenLoaded { get; init; }

    /// <summary>
    ///     `BuiltInParameter.FAMILY_CONTENT_PART_TYPE`, an integer whose values are `Autodesk.Revit.DB.PartType`.
    ///     <see cref="FamilyPartType" /> mirrors that enum by NAME; the number is not portable. Many categories
    ///     do not carry the parameter at all, and then this key is absent rather than `Undefined`.
    /// </summary>
    [JsonProperty("partType", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyPartType? PartType { get; init; }

    /// <summary>
    ///     `BuiltInParameter.OMNICLASS_CODE`, a string such as `23.80.20.11.14`. Revit derives the description
    ///     from the code, so only the code is authored. Revit 2026 removed the parameter (`ClassificationEntries`
    ///     replaces it); the year split is the lowering's problem.
    /// </summary>
    [JsonProperty("omniClass", NullValueHandling = NullValueHandling.Ignore)]
    public string? OmniClass { get; init; }
}

/// <summary>
///     Mirrors `Autodesk.Revit.DB.PartType` by name, verified member-for-member against the Revit 2023 and
///     2026 API assemblies. Mapping is by name in both directions, so a member Revit renames fails loudly
///     instead of silently changing meaning.
/// </summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyPartType {
    Normal, DuctMounted, JunctionBox, AttachesTo, BreaksInto, Elbow, Tee, Transition, Cross, Cap, TapPerpendicular,
    TapAdjustable, Offset, Union, PanelBoard, Transformer, SwitchBoard, OtherPanel, EquipmentSwitch, Switch,
    ValveBreaksInto, SpudPerpendicular, SpudAdjustable, Damper, Wye, LateralTee, LateralCross, Pants, MultiPort,
    ValveNormal, JunctionBoxTee, JunctionBoxCross, PipeFlange, JunctionBoxElbow, ChannelCableTrayElbow,
    ChannelCableTrayVerticalElbow, ChannelCableTrayCross, ChannelCableTrayTee, ChannelCableTrayTransition,
    ChannelCableTrayUnion, ChannelCableTrayOffset, ChannelCableTrayMultiPort, LadderCableTrayElbow,
    LadderCableTrayVerticalElbow, LadderCableTrayCross, LadderCableTrayTee, LadderCableTrayTransition,
    LadderCableTrayUnion, LadderCableTrayOffset, LadderCableTrayMultiPort, InlineSensor, Sensor, EndCap,
    HandrailBracketHardware, PanelBracketHardware, TerminationHardware, Rails, Handrails, TopRails,
    PipeMechanicalCoupling, Undefined
}

/// <summary>
///     One embedded Revit size table: the Revit CSV verbatim, including its `Name##type##unit` header row,
///     because that is exactly what `FamilySizeTableManager` imports and exports. `LookupTableCsvCodec`
///     stays the one codec and runs at lowering; the validator checks only the header shape.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelLookupTable {
    [JsonProperty("csv", Required = Required.Always)]
    public string Csv { get; init; } = string.Empty;
}

/// <summary>
///     The `SpatialElementCalculationPoint`. <see cref="Offset" /> is its distance from the family origin
///     along the direction the placement implies; omitted means the PE one-foot convention. Not a Revit
///     parameter, which is why it lives here and not in <see cref="FamilyModelSettings" />.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelRoomCalculationPoint {
    [JsonProperty("enabled", Required = Required.Always)]
    public bool Enabled { get; init; }

    [JsonProperty("offset", NullValueHandling = NullValueHandling.Ignore)]
    public PortableLength? Offset { get; init; }
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelUnmodeledFact {
    [JsonProperty("reason", Required = Required.Always)]
    public UnmodeledReason Reason { get; init; }

    [JsonProperty("path", Required = Required.Always)]
    public string Path { get; init; } = string.Empty;

    [JsonProperty("facts")]
    public Dictionary<string, string> Facts { get; init; } = new(StringComparer.Ordinal);
}

/// <summary>Closed. Each member names WHY the fact cannot be expressed by name; the path names WHERE.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum UnmodeledReason {
    KindNotInVocabulary,             // sweep, blend, revolve, freeform, imported geometry, model text
    CurveNotLineOrCircle,            // arc, ellipse, spline in a sketch
    SketchLineUnlocked,              // a sketch line locked to no plane keeps numeric endpoints in facts
    PlaneNotAxisAligned,
    PlaneNotNamed,                   // Revit's default name `Reference Plane`; capture emits plane-<n> and flags it
    DimensionToFace,                 // a dimension referencing a form face rather than a plane
    FormSketchPlaneOnReferenceLine,  // VERDICTS-R2 §3: a form sketched on a line or its endpoint
    HingePlaneNotConstructible,      // nested hosted on a reference line end plane (gotcha 27)
    NumericRotation,                 // LocationPoint.Rotation or a turned sketch with no labeled angle
    IdentityNotUnique,
    ArrayMemberNotNested,
    ArrayRadial,
    ArrayAnchorNotObservable,
    ConnectorOnCurvedFace,
    ConnectorFaceNotOnPlane,
    ConnectorOnNestedFace,           // kaitpw 2026-09-06: the connector rides a nested instance's face; the host names no plane for it
    FormulaNameNotDeclared,
    ParameterMetadataUnreadable,
    LookupTableUnreadable,
    PartTypeNotPortable,
    RoomPointNotOnAxis,
    TemplateUnknown,
    ViewNotStock,
    ThirdPartyStorage                // DataStorage / extensible storage observed; never read
}

// ───────────────────────────── slot grammar ─────────────────────────────

/// <summary>
///     A length slot: `param:&lt;Length parameter&gt;` or a <see cref="PortableScalar" /> length literal.
///     Parsed at deserialize time; anything else is a parse error at the JSON path. Sign is admitted by the
///     grammar and rejected by the validator everywhere except <see cref="FamilyModelRefPlane.At" />.
/// </summary>
[JsonConverter(typeof(PortableLengthConverter))]
public readonly record struct PortableLength(string? Parameter, double? Feet, string Text) {
    public bool IsParameter => this.Parameter != null;

    public static PortableLength Parse(string text) {
        if (text.StartsWith("param:", StringComparison.Ordinal) && text.Length > 6)
            return new PortableLength(text[6..], null, text);
        if (PortableScalar.TryParse(text, out var scalar) && scalar.Kind == PortableScalarKind.Length)
            return new PortableLength(null, scalar.Feet, text);
        throw new JsonSerializationException(
            $"'{text}' is not a length. Legal: param:<Length parameter> or a literal such as 6in, 1/2in, 150mm, 1' - 6\".");
    }

    public static PortableLength FromFeet(double feet) => new(null, feet, feet.ToString("R", CultureInfo.InvariantCulture) + "ft");

    public override string ToString() => this.Text;
}

/// <summary>An angle slot: `param:&lt;Angle parameter&gt;` or a literal `45deg`.</summary>
[JsonConverter(typeof(PortableAngleConverter))]
public readonly record struct PortableAngle(string? Parameter, double? Degrees, string Text) {
    public bool IsParameter => this.Parameter != null;

    public static PortableAngle Parse(string text) {
        if (text.StartsWith("param:", StringComparison.Ordinal) && text.Length > 6)
            return new PortableAngle(text[6..], null, text);
        if (PortableScalar.TryParse(text, out var scalar) && scalar.Kind == PortableScalarKind.Angle)
            return new PortableAngle(null, scalar.Value, text);
        throw new JsonSerializationException(
            $"'{text}' is not an angle. Legal: param:<Angle parameter> or a literal such as 45deg.");
    }

    public override string ToString() => this.Text;
}

/// <summary>
///     A parameter value: parsed by ONE grammar into a <see cref="Kind" /> the validator checks against the
///     parameter's <see cref="DataType" />. `param:` is never legal here (a value that follows another
///     parameter is a formula, gotcha 18). `Yes`/`No` are the Yes/No literals; an unsuffixed number is Integer
///     or Number; anything else is Text, and Text on a measurable parameter is `value-datatype-mismatch`.
///     Values of non-length, non-angle specs (`208V`, `280 CFM`) are Text here and are normalized through
///     Revit units by the reconciler (critic F5), never by this grammar.
/// </summary>
[JsonConverter(typeof(PortableValueConverter))]
public readonly record struct PortableValue(PortableValueKind Kind, string Text, double? Number) {
    public static PortableValue Parse(string text) {
        if (text.StartsWith("param:", StringComparison.Ordinal))
            throw new JsonSerializationException($"'{text}': a value may not reference a parameter; use formula.");
        if (PortableScalar.TryParse(text, out var scalar))
            return scalar.Kind == PortableScalarKind.Angle
                ? new PortableValue(PortableValueKind.Angle, text, scalar.Value)
                : new PortableValue(PortableValueKind.Length, text, scalar.Feet);
        if (text is "Yes" or "No")
            return new PortableValue(PortableValueKind.YesNo, text, text == "Yes" ? 1 : 0);
        if (long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var integer))
            return new PortableValue(PortableValueKind.Integer, text, integer);
        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
            return new PortableValue(PortableValueKind.Number, text, number);
        return new PortableValue(PortableValueKind.Text, text, null);
    }

    public override string ToString() => this.Text;
}

[JsonConverter(typeof(StringEnumConverter))]
public enum PortableValueKind { Length, Angle, YesNo, Integer, Number, Text }

public sealed class PortableLengthConverter : JsonConverter<PortableLength> {
    public override PortableLength ReadJson(JsonReader reader, Type objectType, PortableLength existingValue, bool hasExistingValue, JsonSerializer serializer) =>
        reader.TokenType == JsonToken.String
            ? PortableLength.Parse((string)reader.Value!)
            : throw new JsonSerializationException($"Expected a length string at {reader.Path}.");

    public override void WriteJson(JsonWriter writer, PortableLength value, JsonSerializer serializer) => writer.WriteValue(value.Text);
}

public sealed class PortableAngleConverter : JsonConverter<PortableAngle> {
    public override PortableAngle ReadJson(JsonReader reader, Type objectType, PortableAngle existingValue, bool hasExistingValue, JsonSerializer serializer) =>
        reader.TokenType == JsonToken.String
            ? PortableAngle.Parse((string)reader.Value!)
            : throw new JsonSerializationException($"Expected an angle string at {reader.Path}.");

    public override void WriteJson(JsonWriter writer, PortableAngle value, JsonSerializer serializer) => writer.WriteValue(value.Text);
}

public sealed class PortableValueConverter : JsonConverter<PortableValue> {
    public override PortableValue ReadJson(JsonReader reader, Type objectType, PortableValue existingValue, bool hasExistingValue, JsonSerializer serializer) =>
        reader.TokenType switch {
            JsonToken.String => PortableValue.Parse((string)reader.Value!),
            JsonToken.Integer or JsonToken.Float => PortableValue.Parse(Convert.ToString(reader.Value, CultureInfo.InvariantCulture)!),
            JsonToken.Boolean => PortableValue.Parse((bool)reader.Value! ? "Yes" : "No"),
            _ => throw new JsonSerializationException($"Expected a value string at {reader.Path}.")
        };

    public override void WriteJson(JsonWriter writer, PortableValue value, JsonSerializer serializer) => writer.WriteValue(value.Text);
}

/// <summary>
///     Accepts an enum member by name, or by any spelling that matches after dropping everything but letters
///     and digits, case-insensitively (`Generic Models` → `GenericModels`). Writes the member name.
/// </summary>
public sealed class LenientEnumConverter<T> : JsonConverter<T> where T : struct, Enum {
    private static readonly Dictionary<string, T> ByKey = ((T[])Enum.GetValues(typeof(T))).ToDictionary(v => Key(v.ToString()), v => v);

    public static string Key(string text) => new(text.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    public static bool TryParse(string text, out T value) => ByKey.TryGetValue(Key(text), out value);

    public override T ReadJson(JsonReader reader, Type objectType, T existingValue, bool hasExistingValue, JsonSerializer serializer) {
        if (reader.TokenType == JsonToken.String && TryParse((string)reader.Value!, out var value)) return value;
        throw new JsonSerializationException($"'{reader.Value}' is not a {typeof(T).Name} at {reader.Path}. Legal: {string.Join(", ", Enum.GetNames(typeof(T)))}");
    }

    public override void WriteJson(JsonWriter writer, T value, JsonSerializer serializer) => writer.WriteValue(value.ToString());
}

/// <summary>
///     <see cref="DataType" /> input: the token, the Revit UI label, or a forge id. A forge id is matched by
///     its stem (`autodesk.spec.aec:length-2.0.1` → `length`); labels by <see cref="LenientEnumConverter{T}.Key" />.
/// </summary>
public sealed class DataTypeConverter : JsonConverter<DataType> {
    // ponytail: hand-written alias table; regenerate from RevitLabelCatalog per year when the table exists.
    private static readonly Dictionary<string, DataType> Aliases = new[] {
        ("Length (Common)", "length", DataType.Length), ("Area (Common)", "area", DataType.Area),
        ("Volume (Common)", "volume", DataType.Volume), ("Angle (Common)", "angle", DataType.Angle),
        ("Integer (Common)", "spec.int", DataType.Integer), ("Number (Common)", "number", DataType.Number),
        ("Yes/No (Common)", "spec.bool", DataType.YesNo), ("Text (Common)", "spec.string", DataType.Text),
        ("URL (Common)", "spec.url", DataType.Url), ("Material (Common)", "material", DataType.Material),
        ("Multiline Text (Common)", "multilineText", DataType.MultilineText),
        ("Electrical Potential (Electrical)", "potential", DataType.ElectricalPotential),
        ("Current (Electrical)", "current", DataType.Current), ("Apparent Power (Electrical)", "apparentPower", DataType.ApparentPower),
        ("Wattage (Electrical)", "wattage", DataType.Wattage), ("Number of Poles (Electrical)", "numberOfPoles", DataType.NumberOfPoles),
        ("Air Flow (HVAC)", "airFlow", DataType.AirFlow), ("Pressure (HVAC)", "pressure", DataType.Pressure),
        ("Temperature (HVAC)", "temperature", DataType.Temperature), ("Flow (Piping)", "flow", DataType.PipingFlow),
        ("Pipe Size (Piping)", "pipeSize", DataType.PipeSize), ("Duct Size (HVAC)", "ductSize", DataType.DuctSize),
        ("Velocity (HVAC)", "velocity", DataType.HvacVelocity), ("Slope (Common)", "slope", DataType.Slope),
        ("Currency (Common)", "currency", DataType.Currency), ("Load Classification (Electrical)", "loadClassification", DataType.LoadClassification)
    }.SelectMany(a => new[] { (LenientEnumConverter<DataType>.Key(a.Item1), a.Item3), (a.Item2.ToLowerInvariant(), a.Item3) })
     .Concat(((DataType[])Enum.GetValues(typeof(DataType))).Select(v => (LenientEnumConverter<DataType>.Key(v.ToString()), v)))
     .GroupBy(p => p.Item1).ToDictionary(g => g.Key, g => g.First().Item2, StringComparer.Ordinal);

    public static bool TryParse(string text, out DataType value) {
        var t = text.Trim();
        if (Aliases.TryGetValue(LenientEnumConverter<DataType>.Key(t), out value)) return true;
        var colon = t.LastIndexOf(':');
        var stem = colon >= 0 ? t[(colon + 1)..] : t;
        var dash = stem.IndexOf('-');
        if (dash > 0) stem = stem[..dash];
        return Aliases.TryGetValue(stem.ToLowerInvariant(), out value);
    }

    public override DataType ReadJson(JsonReader reader, Type objectType, DataType existingValue, bool hasExistingValue, JsonSerializer serializer) {
        if (reader.TokenType == JsonToken.String && TryParse((string)reader.Value!, out var value)) return value;
        throw new JsonSerializationException($"'{reader.Value}' is not a dataType at {reader.Path}. Legal: {string.Join(", ", Enum.GetNames(typeof(DataType)))}");
    }

    public override void WriteJson(JsonWriter writer, DataType value, JsonSerializer serializer) => writer.WriteValue(value.ToString());
}

/// <summary>
///     The one literal grammar. Suffixed: `6in`, `1/2in`, `1 1/2in`, `150mm`, `2ft`, `0.5m`, `45deg`.
///     Feet-inches (Revit's display form, critic F17): `1' - 0 1/2"`, `1'-6"`, `2"`, `3'`, `21.2"`.
///     Lengths resolve to <see cref="Feet" />; angles keep degrees in <see cref="Value" />.
/// </summary>
public readonly record struct PortableScalar(PortableScalarKind Kind, double Value, string Unit) {
    private const string Number = @"(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:\s+\d+/\d+)?|\d+/\d+)";

    private static readonly Regex Suffixed = new(
        $@"^\s*(?<number>[+-]?{Number})\s*(?<unit>mm|cm|in|ft|m|deg)\s*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex FeetInches = new(
        $@"^\s*(?<sign>[+-])?\s*(?:(?<feet>{Number})\s*'\s*-?\s*)?(?:(?<inch>{Number})\s*"")?\s*$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public double Feet => this.Unit switch {
        "mm" => this.Value / 304.8, "cm" => this.Value / 30.48, "m" => this.Value / 0.3048,
        "in" => this.Value / 12.0, _ => this.Value
    };

    public static bool TryParse(string? text, out PortableScalar scalar) {
        scalar = default;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var match = Suffixed.Match(text!);
        if (match.Success && TryParseNumber(match.Groups["number"].Value, out var value)) {
            var unit = match.Groups["unit"].Value;
            scalar = new PortableScalar(unit == "deg" ? PortableScalarKind.Angle : PortableScalarKind.Length, value, unit);
            return true;
        }
        var fi = FeetInches.Match(text!);
        if (!fi.Success || !(fi.Groups["feet"].Success || fi.Groups["inch"].Success)) return false;
        var feet = 0.0;
        if (fi.Groups["feet"].Success && !TryParseNumber(fi.Groups["feet"].Value, out feet)) return false;
        var inches = 0.0;
        if (fi.Groups["inch"].Success && !TryParseNumber(fi.Groups["inch"].Value, out inches)) return false;
        var sign = fi.Groups["sign"].Value == "-" ? -1 : 1;
        scalar = new PortableScalar(PortableScalarKind.Length, sign * (feet + inches / 12.0), "ft");
        return true;
    }

    private static bool TryParseNumber(string text, out double value) {
        var sign = 1.0;
        var s = text.Trim();
        if (s.StartsWith("-", StringComparison.Ordinal)) { sign = -1; s = s[1..]; } else if (s.StartsWith("+", StringComparison.Ordinal)) s = s[1..];
        var parts = s.Split([' '], StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 2 && double.TryParse(parts[0], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var whole) && TryFraction(parts[1], out var f)) { value = sign * (whole + f); return true; }
        if (parts.Length == 1 && TryFraction(parts[0], out var only)) { value = sign * only; return true; }
        if (parts.Length == 1 && double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var n)) { value = sign * n; return true; }
        value = 0; return false;
    }

    private static bool TryFraction(string text, out double value) {
        var p = text.Split('/');
        if (p.Length == 2 && double.TryParse(p[0], NumberStyles.None, CultureInfo.InvariantCulture, out var a) && double.TryParse(p[1], NumberStyles.None, CultureInfo.InvariantCulture, out var b) && b != 0) { value = a / b; return true; }
        value = 0; return false;
    }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum PortableScalarKind { Length, Angle }

// ───────────────────────────── parse entry ─────────────────────────────

public sealed record FamilyModelDiagnostic(string Code, string Path, string Message);

public sealed record FamilyModelParseResult(FamilyModel? Value, IReadOnlyList<FamilyModelDiagnostic> Diagnostics);

public static class FamilyModelJson {
    public static readonly JsonSerializerSettings Settings = new() {
        MissingMemberHandling = MissingMemberHandling.Error,
        NullValueHandling = NullValueHandling.Ignore,
        Formatting = Formatting.Indented
    };

    /// <summary>
    ///     Strict parse, macro expansion, then validation. Duplicate keys, unknown members, bad enum tokens
    ///     and bad literals are `invalid-json`; everything after is a validator code. A returned model never
    ///     contains a macro.
    /// </summary>
    public static FamilyModelParseResult Parse(string json) {
        try {
            var token = JToken.Parse(json, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
            if (token is JObject o) o.Remove("$schema");
            var model = token.ToObject<FamilyModel>(JsonSerializer.Create(Settings))
                        ?? throw new JsonSerializationException("Family model deserialized to null.");
            var diagnostics = FamilyModelMacros.Expand(model);
            if (diagnostics.Count > 0) return new FamilyModelParseResult(null, diagnostics);
            return new FamilyModelParseResult(model, FamilyModelValidator.Validate(model));
        } catch (JsonException ex) {
            return new FamilyModelParseResult(null, [new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.InvalidJson, "$", ex.Message)]);
        }
    }

    public static string Serialize(FamilyModel model) => JsonConvert.SerializeObject(model, Settings);
}

/// <summary>
///     Parse-time macro expansion (VERDICTS-R2 §1; r2-schema §5 names the emitted elements). Runs before
///     validation and mutates the freshly parsed model in place.
///     <para><b>Prism `s`</b> with `center: [A, B]`, `bottom: BOT`, width W, depth D, height H emits ref
///     planes `s.left`/`s.right` (normal PlusX, seed ∓W/2), `s.front`/`s.back` (PlusY, ∓D/2), `s.top` (PlusZ,
///     seed H); EQ dims `s.eq-lr` `[s.left, A, s.right]` and `s.eq-fb` `[s.front, B, s.back]`; dims `s.width`,
///     `s.depth`, `s.height` (BOT→top, view Front), each labeled when the driver is `param:` else locked;
///     and Extrusion `s` sketched on BOT with one loop of four lines on `s.left`, `s.back`, `s.right`,
///     `s.front`, start BOT, end `s.top`.</para>
///     <para><b>Cylinder `s`</b> emits `s.top`, `s.height`, and Extrusion `s` whose profile is one Circle
///     centred on `[A, B]` with the diameter driver carried on the circle. (Deviation from r2-schema §5: no
///     `s.radius` dim, because a diameter parameter cannot label a radial dimension; the circle owns it.)</para>
///     Seeds come from a literal driver or the driving parameter's uniform literal value; otherwise one foot.
///     A seed is never truth (see <see cref="FamilyModelRefPlane.At" />). Extra form properties (`void`, `subcategory`,
///     `material`, `visible`, `visibility`) ride on the extrusion unchanged. A macro slug that collides with a
///     declared plane or dimension name is `macro-name-collision`.
/// </summary>
public static class FamilyModelMacros {
    public static readonly string[] PrismSuffixes = [".left", ".right", ".front", ".back", ".top"];

    public static IReadOnlyList<FamilyModelDiagnostic> Expand(FamilyModel m) {
        var d = new List<FamilyModelDiagnostic>();
        // Revit retains connected symbolic loops, not JSON grouping names.
        foreach (var (name, detail) in m.Details.Where(p => p.Value.Family is null && p.Value.Curves is { Count: > 1 }).ToList()) {
            var names = Enumerable.Range(1, detail.Curves!.Count).Select(i => $"{name}.loop-{i}").ToList();
            if (names.Any(m.Details.ContainsKey)) {
                d.Add(new(FamilyModelDiagnosticCodes.MacroNameCollision, $"$.details.{name}", "Generated loop name is already declared."));
                continue;
            }
            m.Details.Remove(name);
            for (var i = 0; i < names.Count; i++)
                m.Details[names[i]] = new FamilyModelDetail { View = detail.View, Curves = [detail.Curves[i]], Visible = detail.Visible, Align = detail.Align };
        }
        foreach (var (slug, f) in m.Forms.Where(f => f.Value.Kind != FormKind.Extrusion).ToList()) {
            var path = $"$.forms.{slug}";
            var prism = f.Kind == FormKind.Prism;
            Forbid(path, d, ("sketchPlane", f.SketchPlane != null), ("profile", f.Profile != null), ("start", f.Start != null), ("end", f.End != null),
                (prism ? "diameter" : "width", prism ? f.Diameter != null : f.Width != null), (prism ? "" : "depth", !prism && f.Depth != null));
            var missing = prism
                ? new[] { ("width", f.Width is null), ("depth", f.Depth is null), ("height", f.Height is null), ("center", f.Center is null), ("bottom", f.Bottom is null) }
                : [("diameter", f.Diameter is null), ("height", f.Height is null), ("center", f.Center is null), ("bottom", f.Bottom is null)];
            foreach (var (slot, absent) in missing) if (absent) d.Add(new(FamilyModelDiagnosticCodes.Required, $"{path}.{slot}", $"{f.Kind} needs {slot}."));
            if (f.Center is { Count: not 2 }) d.Add(new(FamilyModelDiagnosticCodes.CenterTwoPlanes, $"{path}.center", "Two plane names."));
            if (d.Count > 0) continue;

            var (a, b, bot) = (f.Center![0], f.Center[1], f.Bottom!);
            var h = f.Height!.Value;
            var names = (prism ? PrismSuffixes : [".top"]).Select(s => slug + s)
                .Concat(prism ? [".eq-lr", ".eq-fb", ".width", ".depth", ".height"] : [".height"]).ToList();
            foreach (var n in names.Where(n => m.RefPlanes.ContainsKey(n) || m.Datums.ContainsKey(n) || m.Dimensions.ContainsKey(n)))
                d.Add(new(FamilyModelDiagnosticCodes.MacroNameCollision, path, $"'{n}' is already declared; the macro would emit it."));
            if (d.Count > 0) continue;

            if (prism) {
                var (w, dp) = (f.Width!.Value, f.Depth!.Value);
                var (hw, hd) = (Seed(m, w) / 2, Seed(m, dp) / 2);
                m.RefPlanes[slug + ".left"] = new FamilyModelRefPlane { Normal = Axis.PlusX, At = PortableLength.FromFeet(-hw) };
                m.RefPlanes[slug + ".right"] = new FamilyModelRefPlane { Normal = Axis.PlusX, At = PortableLength.FromFeet(hw) };
                m.RefPlanes[slug + ".front"] = new FamilyModelRefPlane { Normal = Axis.PlusY, At = PortableLength.FromFeet(-hd) };
                m.RefPlanes[slug + ".back"] = new FamilyModelRefPlane { Normal = Axis.PlusY, At = PortableLength.FromFeet(hd) };
                m.Dimensions[slug + ".eq-lr"] = new FamilyModelDim { Between = [slug + ".left", a, slug + ".right"], Equality = true };
                m.Dimensions[slug + ".eq-fb"] = new FamilyModelDim { Between = [slug + ".front", b, slug + ".back"], Equality = true };
                m.Dimensions[slug + ".width"] = Driven([slug + ".left", slug + ".right"], w, null);
                m.Dimensions[slug + ".depth"] = Driven([slug + ".front", slug + ".back"], dp, null);
            }
            m.RefPlanes[slug + ".top"] = new FamilyModelRefPlane { Normal = Axis.PlusZ, At = PortableLength.FromFeet(Seed(m, h)) };
            m.Dimensions[slug + ".height"] = Driven([bot, slug + ".top"], h, StockView.Front);
            var loop = prism
                ? new FamilyModelLoop { Curves = new[] { ".left", ".back", ".right", ".front" }.Select(s => new FamilyModelSketchCurve { Kind = CurveKind.Line, On = slug + s }).ToList() }
                : new FamilyModelLoop { Curves = [new FamilyModelSketchCurve { Kind = CurveKind.Circle, Center = [a, b], Diameter = f.Diameter }] };
            m.Forms[slug] = new FamilyModelForm {
                Kind = FormKind.Extrusion, Void = f.Void, Subcategory = f.Subcategory, Material = f.Material, Visible = f.Visible, Visibility = f.Visibility,
                SketchPlane = bot, Start = bot, End = slug + ".top", Profile = [loop]
            };
        }
        return d;
    }

    private static FamilyModelDim Driven(List<string> between, PortableLength driver, StockView? view) =>
        driver.IsParameter ? new FamilyModelDim { Between = between, Label = driver.Parameter, View = view } : new FamilyModelDim { Between = between, Locked = driver, View = view };

    private static double Seed(FamilyModel m, PortableLength driver) {
        if (driver.Feet is { } feet) return feet;
        if (m.Parameters.TryGetValue(driver.Parameter!, out var p) && p.Value is { Kind: PortableValueKind.Length, Number: { } n }) return n;
        return 1.0; // ponytail: seed only; Revit regen moves the plane onto its labeled dimension
    }

    private static void Forbid(string path, List<FamilyModelDiagnostic> d, params (string Slot, bool Present)[] slots) {
        foreach (var (slot, present) in slots) if (present && slot.Length > 0) d.Add(new(FamilyModelDiagnosticCodes.SlotNotLegalForKind, $"{path}.{slot}", $"{slot} is not a slot of this kind."));
    }
}

internal static class KeyValuePairDeconstruct {
    public static void Deconstruct<TKey, TValue>(this KeyValuePair<TKey, TValue> pair, out TKey key, out TValue value) {
        key = pair.Key;
        value = pair.Value;
    }
}
