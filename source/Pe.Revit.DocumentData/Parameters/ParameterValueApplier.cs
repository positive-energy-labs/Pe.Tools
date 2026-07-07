using Pe.Revit.Utils;
using Pe.Shared.RevitData;
using System.Globalization;

namespace Pe.Revit.DocumentData.Parameters;

/// <summary>
///     Bounded project-document parameter mutation core (doc-in/data-out, testable): redeems binding
///     handles (element id + parameter id) from the schedule cell-binding surface. Dry runs resolve,
///     validate, and parse every edit without opening a transaction; wet runs apply all edits in one
///     host-owned transaction (one Revit undo step) with dialog-suppressed failure handling.
///     <para>
///         Writability gates on <see cref="Parameter.IsReadOnly" /> ONLY. Never consult
///         <see cref="Parameter.UserModifiable" /> — it reports false for writable built-ins like
///         Mark and Type Comments even though IsReadOnly is false and Set() succeeds (proven in
///         ScheduleCellBindingProofTests).
///     </para>
/// </summary>
public static class ParameterValueApplier {
    public const int MaxEditsPerCall = 500;
    public const string DefaultTransactionName = "Pe Apply Parameter Values";

    public static ParameterValueApplyData Apply(Document document, ParameterValueApplyRequest request) {
        var edits = request.Edits ?? [];
        if (edits.Count == 0)
            return new ParameterValueApplyData(0, request.DryRun, []);

        if (edits.Count > MaxEditsPerCall) {
            // Cap violation rejects the whole call — no partial processing.
            return new ParameterValueApplyData(0, request.DryRun, [
                new ParameterValueEditResult(
                    0,
                    false,
                    $"Edit count {edits.Count} exceeds the {MaxEditsPerCall}-edit cap per call. Split the batch and retry.")
            ]);
        }

        if (request.DryRun) {
            // Reads and parsing need no transaction; nothing is written.
            var dryResults = new List<ParameterValueEditResult>(edits.Count);
            for (var i = 0; i < edits.Count; i++)
                dryResults.Add(ProcessEdit(document, edits[i], i, dryRun: true));

            return new ParameterValueApplyData(0, true, dryResults);
        }

        using var sandbox = DocumentSandbox.BeginCommit(
            document,
            string.IsNullOrWhiteSpace(request.TransactionName) ? DefaultTransactionName : request.TransactionName!);
        var commitFailures = new List<(bool IsError, string Message)>();
        var failureOptions = sandbox.Transaction.GetFailureHandlingOptions();
        _ = failureOptions.SetFailuresPreprocessor(new DialogSuppressingFailuresPreprocessor(commitFailures));
        _ = failureOptions.SetForcedModalHandling(false);
        sandbox.Transaction.SetFailureHandlingOptions(failureOptions);

        var applied = 0;
        var results = new List<ParameterValueEditResult>(edits.Count);
        for (var i = 0; i < edits.Count; i++) {
            var result = ProcessEdit(document, edits[i], i, dryRun: false);
            if (result.Ok)
                applied++;
            results.Add(result);
        }

        if (applied > 0)
            sandbox.Complete();

        foreach (var (_, message) in commitFailures)
            results.Add(new ParameterValueEditResult(edits.Count + results.Count, false, message));

        return new ParameterValueApplyData(applied, false, results);
    }

    private static ParameterValueEditResult ProcessEdit(
        Document document,
        ParameterValueEdit edit,
        int index,
        bool dryRun
    ) {
        try {
            if (edit.ParameterId == null && string.IsNullOrWhiteSpace(edit.ParameterName))
                return new ParameterValueEditResult(index, false,
                    "Edit requires parameterId (preferred: the binding handle) or parameterName.");

            var element = document.GetElement(edit.ElementId.ToElementId());
            if (element == null)
                return new ParameterValueEditResult(index, false,
                    $"Element {edit.ElementId} was not found in the active document.");

            var parameter = ResolveParameter(document, element, edit);
            if (parameter == null)
                return new ParameterValueEditResult(index, false,
                    $"Parameter '{DescribeParameterReference(edit)}' was not found on element {edit.ElementId}.");

            // IsReadOnly is the ONLY writability gate; UserModifiable lies for writable built-ins.
            if (parameter.IsReadOnly)
                return new ParameterValueEditResult(index, false,
                    $"Parameter '{parameter.Definition?.Name ?? DescribeParameterReference(edit)}' is read-only on element {edit.ElementId}.");

            var (parsedRaw, write) = ParseValue(document, parameter, edit.Value);
            if (!dryRun && !write())
                return new ParameterValueEditResult(index, false,
                    $"Revit rejected value '{edit.Value}' for parameter '{parameter.Definition?.Name}' on element {edit.ElementId}.",
                    parsedRaw);

            return new ParameterValueEditResult(index, true, null, parsedRaw);
        } catch (Exception ex) {
            return new ParameterValueEditResult(index, false, ex.Message);
        }
    }

    /// <summary>
    ///     Mirrors ScheduleParameterResolutionCache semantics: negative raw id resolves as a
    ///     BuiltInParameter; positive ids match the element's own parameter ids; otherwise the
    ///     ParameterElement's name (or the request's name) falls back to LookupParameter.
    /// </summary>
    private static Parameter? ResolveParameter(Document document, Element element, ParameterValueEdit edit) {
        var fallbackName = edit.ParameterName;
        if (edit.ParameterId is not { } rawParameterId)
            return LookupByName(element, fallbackName);

        if (rawParameterId < 0) {
            try {
                return element.get_Parameter((BuiltInParameter)rawParameterId)
                    ?? LookupByName(element, fallbackName);
            } catch {
                return LookupByName(element, fallbackName);
            }
        }

        var exactMatch = element.Parameters
            .Cast<Parameter>()
            .FirstOrDefault(parameter => parameter.Id.Value() == rawParameterId);
        if (exactMatch != null)
            return exactMatch;

        var parameterElementName = document.GetElement(rawParameterId.ToElementId())?.Name;
        return LookupByName(element, parameterElementName ?? fallbackName);
    }

    private static Parameter? LookupByName(Element element, string? name) =>
        string.IsNullOrWhiteSpace(name) ? null : element.LookupParameter(name);

    /// <summary>
    ///     Parses the wire value for the parameter's storage type (invariant culture) and returns the
    ///     invariant raw that will be written plus a deferred write. Doubles accept raw internal feet
    ///     first, then unit display strings (e.g. 79 °F, 2' 6") via UnitFormatUtils against the
    ///     parameter's spec. YesNo integers additionally accept yes/no/true/false.
    /// </summary>
    private static (string ParsedRaw, Func<bool> Write) ParseValue(
        Document document,
        Parameter parameter,
        string? value
    ) {
        if (parameter.StorageType == StorageType.String) {
            var stringValue = value ?? string.Empty;
            return (stringValue, () => parameter.Set(stringValue));
        }

        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException(
                $"A value is required for {parameter.StorageType} parameter '{parameter.Definition?.Name}'.");

        switch (parameter.StorageType) {
            case StorageType.Integer: {
                var intValue = ParseInteger(parameter, value);
                return (intValue.ToString(CultureInfo.InvariantCulture), () => parameter.Set(intValue));
            }
            case StorageType.Double: {
                var doubleValue = ParseDouble(document, parameter, value);
                return (doubleValue.ToString("G17", CultureInfo.InvariantCulture), () => parameter.Set(doubleValue));
            }
            case StorageType.ElementId: {
                var elementIdValue = long.Parse(value, CultureInfo.InvariantCulture);
                return (elementIdValue.ToString(CultureInfo.InvariantCulture),
                    () => parameter.Set(elementIdValue.ToElementId()));
            }
            default:
                throw new InvalidOperationException(
                    $"Unsupported storage type {parameter.StorageType} for parameter '{parameter.Definition?.Name}'.");
        }
    }

    private static int ParseInteger(Parameter parameter, string value) {
        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var intValue))
            return intValue;

        var isYesNo = parameter.Definition?.GetDataType() is { } dataType && dataType == SpecTypeId.Boolean.YesNo;
        if (isYesNo) {
            var normalized = value.Trim();
            if (normalized.Equals("yes", StringComparison.OrdinalIgnoreCase) ||
                normalized.Equals("true", StringComparison.OrdinalIgnoreCase))
                return 1;
            if (normalized.Equals("no", StringComparison.OrdinalIgnoreCase) ||
                normalized.Equals("false", StringComparison.OrdinalIgnoreCase))
                return 0;
        }

        throw new InvalidOperationException(
            $"Value '{value}' is not a valid integer for parameter '{parameter.Definition?.Name}'" +
            (isYesNo ? " (yes/no/true/false are also accepted)." : "."));
    }

    private static double ParseDouble(Document document, Parameter parameter, string value) {
        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var rawFeet))
            return rawFeet;

        var dataType = parameter.Definition?.GetDataType();
        if (dataType != null &&
            UnitFormatUtils.TryParse(document.GetUnits(), dataType, value, out var parsed))
            return parsed;

        throw new InvalidOperationException(
            $"Value '{value}' is neither a raw invariant double nor a parseable unit display string for parameter '{parameter.Definition?.Name}'.");
    }

    private static string DescribeParameterReference(ParameterValueEdit edit) =>
        edit.ParameterId?.ToString(CultureInfo.InvariantCulture) ?? edit.ParameterName ?? "<unspecified>";
}
