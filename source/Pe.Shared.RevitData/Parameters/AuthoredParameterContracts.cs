using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum AuthoredParameterAssignmentKind {
    Value,
    Formula
}

[ExportTsSchema]
public sealed record AuthoredParameterAssignment(
    AuthoredParameterAssignmentKind Kind,
    string Value
);

[ExportTsSchema]
public abstract class AuthoredParameterDeclaration {
    [Description("Parameter name. Authored parameter declarations are name-first and resolve richer identity only after collection or compilation.")]
    [Required]
    public string Name { get; init; } = string.Empty;

    [Description("Optional Revit properties group label or Forge type id. Shared parameters use resolved definition metadata for identity and datatype; this only controls family binding placement.")]
    public string? PropertiesGroup { get; init; }

    [Description("Optional instance/type scope for the family parameter binding.")]
    public bool? IsInstance { get; init; }

    [Description("Optional literal value applied uniformly to all family types. Mutually exclusive with Formula.")]
    public string? Value { get; init; }

    [Description("Optional formula applied uniformly to all family types. Mutually exclusive with Value.")]
    public string? Formula { get; init; }

    public AuthoredParameterAssignment? GetAssignment() {
        var hasValue = !string.IsNullOrWhiteSpace(this.Value);
        var hasFormula = !string.IsNullOrWhiteSpace(this.Formula);
        if (hasValue && hasFormula)
            throw new InvalidOperationException($"Parameter '{this.Name}' cannot define both Value and Formula.");
        if (hasValue)
            return new AuthoredParameterAssignment(AuthoredParameterAssignmentKind.Value, this.Value!);
        if (hasFormula)
            return new AuthoredParameterAssignment(AuthoredParameterAssignmentKind.Formula, this.Formula!);
        return null;
    }
}

[ExportTsSchema]
public class AuthoredSharedParameterDeclaration : AuthoredParameterDeclaration;

[ExportTsSchema]
public class AuthoredFamilyParameterDeclaration : AuthoredParameterDeclaration {
    [Description("Optional family-parameter datatype label or Forge type id used when creating a missing family parameter. Existing family parameter datatype changes are intentionally not migrated.")]
    public string? DataType { get; init; }

    [Description("Optional tooltip/description for local family parameters.")]
    public string? Tooltip { get; init; }
}
