using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     Portable authored truth for one family. This contract intentionally contains no ElementIds,
///     Revit API objects, or Family Foundry recovery metadata; capture must reconstruct it from the document.
/// </summary>
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

    [JsonProperty("types")]
    public Dictionary<string, Dictionary<string, string>> Types { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("planes")]
    public Dictionary<string, FamilyModelPlane> Planes { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("frames")]
    public Dictionary<string, FamilyModelFrame> Frames { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("solids")]
    public Dictionary<string, FamilyModelSolid> Solids { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("connectors")]
    public Dictionary<string, FamilyModelConnector> Connectors { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("roomCalculationPoint", NullValueHandling = NullValueHandling.Ignore)]
    public FamilyModelRoomCalculationPoint? RoomCalculationPoint { get; init; }

    [JsonProperty("unmodeled")]
    public List<FamilyModelUnmodeledFact> Unmodeled { get; init; } = [];
}

[JsonObject(MemberSerialization.OptIn)]
public sealed class FamilyModelRoomCalculationPoint {
    [JsonProperty("enabled", Required = Required.Always)]
    public bool Enabled { get; init; }
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
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilySolidKind {
    Prism,
    Cylinder,
    VoidPrism,
    VoidCylinder
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
        ValidateFrames(model.Frames, model.Planes, model.Solids, diagnostics);
        ValidateSolids(model.Solids, new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
        ValidateConnectors(model.Connectors, model.Frames, new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
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
        }
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
            GetSolidFaces(solid.Kind).Contains(reference.Member, StringComparer.Ordinal) &&
            !string.Equals(reference.Member, "Side", StringComparison.Ordinal))
            return;

        diagnostics.Add(new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.InvalidReference, path,
            $"Reference '{value}' does not resolve to a declared plane/solid face."));
    }

    private static IReadOnlyList<string> GetSolidFaces(FamilySolidKind kind) =>
        kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism
            ? ["Front", "Back", "Left", "Right", "Top", "Bottom"]
            : ["Top", "Bottom", "Side"];

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
        ISet<string> parameterNames,
        ICollection<FamilyModelDiagnostic> diagnostics
    ) {
        foreach (var pair in solids) {
            var slug = pair.Key;
            var solid = pair.Value;
            Require(slug, $"$.solids.{slug}", "Solid slug", diagnostics);
            if (!PortableFamilyReference.TryParse(solid.Frame, out var frame) ||
                frame.Kind != PortableFamilyReferenceKind.Frame) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidReference,
                    $"$.solids.{slug}.frame",
                    $"Solid '{slug}' frame must be a frame: reference."));
            } else if (!string.Equals(solid.Frame, BuiltInFamilyFrame, StringComparison.Ordinal)) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.UnsupportedFrame,
                    $"$.solids.{slug}.frame",
                    $"Frame '{solid.Frame}' is not yet supported; Phase 1 starts with the fixed family frame."));
            }

            var prism = solid.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism;
            var requiredDrivers = prism
                ? new[] { ("width", solid.Width), ("depth", solid.Depth), ("height", solid.Height) }
                : new[] { ("diameter", solid.Diameter), ("height", solid.Height) };
            var forbiddenDrivers = prism
                ? new[] { ("diameter", solid.Diameter) }
                : new[] { ("width", solid.Width), ("depth", solid.Depth) };

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
