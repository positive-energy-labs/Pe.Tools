using Pe.Extensions.FamParameter;
using Pe.Extensions.FamParameter.Formula;
using System.Diagnostics;

namespace Pe.Extensions.FamDocument;

public static class Formula {
    private static HashSet<ForgeTypeId> _forbiddenDataTypes;

    /// <summary>
    ///     Datatypes for which formulas cannot be assigned
    /// </summary>
    /// <remarks> Must be a getter, when it is a simple statically initialized property it errors with NullReferences</remarks>
    public static HashSet<ForgeTypeId> ForbiddenDataTypes =>
        _forbiddenDataTypes ??= [
            SpecTypeId.String.Url,
            SpecTypeId.Reference.LoadClassification
        ];

    /// <summary>
    ///     Unset a formula on a family parameter. The same as calling
    ///     <see cref="TrySetFormula(FamilyDocument, FamilyParameter, string, out string)" /> with null or empty formula.
    /// </summary>
    /// <returns>
    ///     True if the formula was set successfully. On error, no message is returned nor any exception thrown, only
    ///     false is returned.
    /// </returns>
    /// <exception cref="Autodesk.Revit.Exceptions.InvalidOperationException">
    ///     Thrown when a type parameter formula references
    ///     instance parameters
    /// </exception>
    public static bool UnsetFormula(this FamilyDocument famDoc, FamilyParameter targetParam) {
        var success = famDoc.TrySetFormulaFast(targetParam, null, out _);
        return success;
    }

    /// <summary>
    ///     Set a formula on a family parameter, validating that type parameter formulas
    ///     only reference other type parameters. Instance parameter formulas can reference
    ///     both instance and type parameters.
    /// </summary>
    /// <returns>True if the formula was set successfully</returns>
    /// <exception cref="Autodesk.Revit.Exceptions.InvalidOperationException">
    ///     Thrown when a type parameter formula references instance parameters,
    ///     there is no valid family type, the parameter cannot be assigned a formula, or the operation make a circular chain
    ///     of references among the formulas.
    /// </exception>
    public static bool TrySetFormula(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        string formula,
        out string errorMessage
    ) {
        errorMessage = null;

        try {
            if (string.IsNullOrWhiteSpace(formula)) return famDoc.TrySetFormulaFast(targetParam, null, out errorMessage);

            var parameters = famDoc.FamilyManager.Parameters;

            // Validate all parameter-like tokens in the formula reference existing parameters
            var invalidParams = parameters.GetInvalidReferences(formula).ToList();
            if (invalidParams.Count != 0) {
                errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                    $"Formula references non-existent parameters: {string.Join(", ", invalidParams.Select(p => $"'{p}'"))}";
                return false;
            }

            // Type parameters can only reference other type parameters
            if (!targetParam.IsInstance) {
                var referencedParams = parameters.GetReferencedIn(formula);
                var instanceParams = referencedParams.Where(p => p.IsInstance).ToList();

                if (instanceParams.Count > 0) {
                    var instanceNames = instanceParams.Select(p => $"'{p.Name()}'");
                    errorMessage = $"Cannot set formula on type parameter '{targetParam.Name()}'. " +
                        $"Type parameter formulas cannot reference instance parameters: {string.Join(", ", instanceNames)}";
                    return false;
                }
            }

            var success = famDoc.TrySetFormulaFast(targetParam, formula, out errorMessage);
        } catch (Exception ex) {
            errorMessage = ex.ToStringDemystified();
            return false;
        }
        return true;
    }

    /// <summary>
    ///     Set a formula on a family parameter using the formula of another parameter.
    /// </summary>
    /// <exception cref="Autodesk.Revit.Exceptions.InvalidOperationException">
    ///     Thrown when a type parameter formula references instance parameters,
    ///     there is no valid family type, the parameter cannot be assigned a formula, or the operation make a circular chain
    ///     of references among the formulas.
    /// </exception>
    /// <returns>True if the formula was set successfully</returns>
    public static bool TrySetFormula(this FamilyDocument famDoc,
        FamilyParameter targetParam,
        FamilyParameter sourceParam,
        out string errorMessage) {
        if (string.IsNullOrWhiteSpace(sourceParam.Formula)) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                           $"Source parameter '{sourceParam.Name()}' has no formula.";
            return false;
        }

        var srcDataType = sourceParam.Definition.GetDataType();
        var tgtDataType = targetParam.Definition.GetDataType();
        if (srcDataType != tgtDataType) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                           $"Source parameter '{sourceParam.Name()}' has datatype '{srcDataType}' but target parameter '{targetParam.Name()}' has datatype '{tgtDataType}'.";
            return false;
        }

        return famDoc.TrySetFormula(targetParam, sourceParam.Formula, out errorMessage);
    }

    /// <summary>
    ///     Set a formula on a family parameter without validation.
    ///     Use this for batch operations where you trust the input and need performance.
    ///     Revit will still throw if there's a cycle, but the error will be less descriptive.
    ///     Thiswill check if the target datatype is settable
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         <b>When to use:</b> Migrations, imports, or batch operations with known-good formulas.
    ///     </para>
    ///     <para>
    ///         <b>When NOT to use:</b> User-entered formulas, untrusted input, or when you need helpful error messages.
    ///     </para>
    /// </remarks>
    /// <exception cref="Autodesk.Revit.Exceptions.InvalidOperationException">
    ///     Thrown by Revit if the formula is invalid (cryptic message).
    /// </exception>
    public static bool TrySetFormulaFast(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        string formula,
        out string errorMessage
    ) {
        errorMessage = null;

        try {
            if (ForbiddenDataTypes.Contains(targetParam.Definition.GetDataType())) {
                errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                               $"This datatype formula-forbidden, among these others: {string.Join(", ", ForbiddenDataTypes.Select(d => d.ToLabel()))}.";
                return false;
            }

            famDoc.FamilyManager.SetFormula(targetParam, string.IsNullOrWhiteSpace(formula) ? null : formula);
            return true;
        } catch (Exception ex) {
            errorMessage = ex.ToStringDemystified();
            return false;
        }
    }
}