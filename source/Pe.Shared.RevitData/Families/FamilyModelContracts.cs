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

    [JsonProperty("solids")]
    public Dictionary<string, FamilyModelSolid> Solids { get; init; } = new(StringComparer.Ordinal);

    [JsonProperty("unmodeled")]
    public List<FamilyModelUnmodeledFact> Unmodeled { get; init; } = [];
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
        ValidateSolids(model.Solids, new HashSet<string>(parameters.Keys, StringComparer.Ordinal), diagnostics);
        foreach (var fact in model.Unmodeled) {
            diagnostics.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.UnmodeledState,
                fact.Path,
                $"Family state '{fact.Reason}' is observable but not executable by this Family Model version."));
        }
        return diagnostics;
    }

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
