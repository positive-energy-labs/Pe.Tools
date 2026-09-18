using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData;
using System.Globalization;

namespace Pe.Revit.DocumentData.Parameters;

/// <summary>
///     Bounded project-document parameter mutation core (doc-in/data-out). Every edit resolves its exact target and
///     reads <see cref="ParameterTarget" /> evidence; <see cref="ParameterEditPlan" /> judges it (Expected vs
///     Current, admission groups, alias conflicts, coalescing) before anything is written. Dry runs read, judge and
///     parse without opening a transaction and return Current per edit; wet runs write in one host-owned transaction
///     (one Revit undo step) with dialog-suppressed failure handling.
///     <para>
///         Writability gates on <see cref="Parameter.IsReadOnly" /> ONLY. Never consult
///         <see cref="Parameter.UserModifiable" /> — it reports false for writable built-ins like
///         Mark and Type Comments even though IsReadOnly is false and Set() succeeds (proven in
///         ScheduleCellBindingProofTests).
///     </para>
/// </summary>
public static class ParameterValueApplier {
    public const string DefaultTransactionName = "Pe Apply Parameter Values";

    /// <summary>Each edit is its own admission group. Over the cap throws an ArgumentException; nothing is processed.</summary>
    public static ParameterValueApplyData Apply(Document document, ParameterValueApplyRequest request) {
        var edits = request.Edits ?? [];
        if (edits.Count > ParameterValueApplyBounds.MaxEditsPerCall)
            throw new ArgumentException(
                $"Edit count {edits.Count} exceeds the {ParameterValueApplyBounds.MaxEditsPerCall}-edit cap per call. Split the batch and retry.",
                nameof(request));
        if (edits.Count == 0)
            return new ParameterValueApplyData(0, request.DryRun, []);

        var groups = edits.Select(edit => (IReadOnlyList<ParameterValueEdit>)[edit]).ToList();
        if (request.DryRun)
            return new ParameterValueApplyData(0, true, Flatten(ApplyGroups(document, groups, dryRun: true)));

        using var sandbox = DocumentSandbox.BeginCommit(
            document,
            string.IsNullOrWhiteSpace(request.TransactionName) ? DefaultTransactionName : request.TransactionName!);
        var commitFailures = new List<(bool IsError, string Message)>();
        var failureOptions = sandbox.Transaction.GetFailureHandlingOptions();
        _ = failureOptions.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(commitFailures));
        _ = failureOptions.SetForcedModalHandling(false);
        sandbox.Transaction.SetFailureHandlingOptions(failureOptions);

        var results = Flatten(ApplyGroups(document, groups, dryRun: false)).ToList();
        var applied = results.Count(result => result.Ok);

        if (applied > 0)
            sandbox.Complete();

        foreach (var (_, message) in commitFailures)
            results.Add(new ParameterValueEditResult(edits.Count + results.Count, false, message));

        return new ParameterValueApplyData(applied, false, results);
    }

    /// <summary>
    ///     Judges and writes (or, dry, validates) grouped edits in the caller's transaction. A group is admitted whole.
    ///     Result [g][k] answers groups[g][k], with Index = k. Coalesced writes over the cap throw before any write.
    /// </summary>
    internal static IReadOnlyList<IReadOnlyList<ParameterValueEditResult>> ApplyGroups(
        Document document,
        IReadOnlyList<IReadOnlyList<ParameterValueEdit>> groups,
        bool dryRun
    ) {
        var flat = groups.SelectMany((group, g) => group.Select((edit, k) => (Group: g, Slot: k, Edit: edit))).ToList();
        var resolved = flat.Select(item => Resolve(document, item.Edit, dryRun)).ToList();
        var plan = ParameterEditPlan.Build(
            flat.Select((item, i) => new ParameterEditPlan.Edit(item.Group, item.Edit, resolved[i].Current, resolved[i].Refusal)).ToList(),
            dryRun);
        if (plan.Writes.Count > ParameterValueApplyBounds.MaxEditsPerCall)
            throw new ArgumentException(
                $"Coalesced native write count {plan.Writes.Count} exceeds the {ParameterValueApplyBounds.MaxEditsPerCall}-write cap.");

        var answers = new ParameterValueEditResult?[flat.Count];
        foreach (var write in plan.Writes) {
            var done = Write(document, resolved[write.Edit].Parameter!, flat[write.Edit].Edit, dryRun);
            foreach (var i in write.Edits) answers[i] = done;
        }
        var results = groups.Select(group => new ParameterValueEditResult[group.Count]).ToArray();
        for (var i = 0; i < flat.Count; i++) {
            var (group, slot, _) = flat[i];
            var answer = answers[i] ?? new ParameterValueEditResult(slot, false, plan.Refusals[i]);
            results[group][slot] = answer with { Index = slot, Current = resolved[i].Current };
        }
        return results;
    }

    private static IReadOnlyList<ParameterValueEditResult> Flatten(IReadOnlyList<IReadOnlyList<ParameterValueEditResult>> groups) =>
        groups.SelectMany(group => group).Select((result, index) => result with { Index = index }).ToList();

    /// <summary>
    ///     A parameterId resolves exactly: negative as a BuiltInParameter, positive against the element's own
    ///     parameter ids. A name resolves only on a dry run (discovery); a wet run must say which parameter it means.
    /// </summary>
    private static (Parameter? Parameter, ParameterTarget? Current, string? Refusal) Resolve(
        Document document, ParameterValueEdit edit, bool dryRun
    ) {
        try {
            var element = document.GetElement(edit.ElementId.ToElementId());
            if (element == null)
                return (null, null, $"Element {edit.ElementId} was not found in the active document.");

            Parameter? parameter;
            if (edit.ParameterId is { } parameterId)
                parameter = ExactParameter(element, parameterId);
            else if (!dryRun)
                return (null, null, "A wet run addresses the parameter by exact parameterId; parameterName is dry-run discovery only.");
            else if (string.IsNullOrWhiteSpace(edit.ParameterName))
                return (null, null, "Edit requires parameterId, or parameterName on a dry run.");
            else
                parameter = element.LookupParameter(edit.ParameterName);

            return parameter == null
                ? (null, null, $"Parameter '{DescribeParameterReference(edit)}' was not found on element {edit.ElementId}.")
                : (parameter, ParameterTargets.Read(element, parameter, edit.Expected?.ParameterName ?? edit.ParameterName), null);
        } catch (Exception ex) {
            return (null, null, ex.Message);
        }
    }

    private static Parameter? ExactParameter(Element element, long parameterId) {
        if (parameterId < 0) {
            try {
                return element.get_Parameter((BuiltInParameter)parameterId);
            } catch {
                return null;
            }
        }
        return element.Parameters.Cast<Parameter>().FirstOrDefault(parameter => parameter.Id.Value() == parameterId);
    }

    private static ParameterValueEditResult Write(Document document, Parameter parameter, ParameterValueEdit edit, bool dryRun) {
        try {
            // IsReadOnly is the ONLY writability gate; UserModifiable lies for writable built-ins.
            if (parameter.IsReadOnly)
                return new ParameterValueEditResult(0, false,
                    $"Parameter '{parameter.Definition?.Name ?? DescribeParameterReference(edit)}' is read-only on element {edit.ElementId}.");

            var (parsedRaw, parsedDisplay, write) = ParseValue(document, parameter, edit);
            if (!dryRun && !write())
                return new ParameterValueEditResult(0, false,
                    $"Revit rejected value '{edit.Value}' for parameter '{parameter.Definition?.Name}' on element {edit.ElementId}.",
                    parsedRaw, parsedDisplay);

            return new ParameterValueEditResult(0, true, null, parsedRaw, parsedDisplay);
        } catch (Exception ex) {
            return new ParameterValueEditResult(0, false, ex.Message);
        }
    }

    /// <summary>
    ///     Parses the wire value for the parameter's storage type (invariant culture) and returns the
    ///     invariant raw that will be written, a display round-trip echo for measurable doubles, and
    ///     a deferred write. Double semantics are strict: an explicit Unit converts exactly via
    ///     UnitUtils.ConvertToInternalUnits (canonical, document-independent); RawInternal accepts
    ///     internal units verbatim; bare numerals on measurable specs are REJECTED as ambiguous
    ///     (they'd silently mean internal units); unit display strings (79 °F, 2' 6") still parse
    ///     via UnitFormatUtils. YesNo integers additionally accept yes/no/true/false.
    /// </summary>
    private static (string ParsedRaw, string? ParsedDisplay, Func<bool> Write) ParseValue(
        Document document,
        Parameter parameter,
        ParameterValueEdit edit
    ) {
        var value = edit.Value;
        if (parameter.StorageType != StorageType.Double && !string.IsNullOrWhiteSpace(edit.Unit))
            throw new InvalidOperationException(
                $"Unit '{edit.Unit}' was supplied but parameter '{parameter.Definition?.Name}' has {parameter.StorageType} storage; units apply to Double parameters only.");

        if (parameter.StorageType == StorageType.String) {
            var stringValue = value ?? string.Empty;
            return (stringValue, null, () => parameter.Set(stringValue));
        }

        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException(
                $"A value is required for {parameter.StorageType} parameter '{parameter.Definition?.Name}'.");

        switch (parameter.StorageType) {
            case StorageType.Integer: {
                var intValue = ParseInteger(parameter, value);
                return (intValue.ToString(CultureInfo.InvariantCulture), null, () => parameter.Set(intValue));
            }
            case StorageType.Double: {
                var doubleValue = ParseDouble(document, parameter, edit, value);
                return (
                    doubleValue.ToString("G17", CultureInfo.InvariantCulture),
                    FormatDisplayEcho(document, parameter, doubleValue),
                    () => parameter.Set(doubleValue));
            }
            case StorageType.ElementId: {
                var elementIdValue = long.Parse(value, CultureInfo.InvariantCulture);
                return (elementIdValue.ToString(CultureInfo.InvariantCulture), null,
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

    private static double ParseDouble(Document document, Parameter parameter, ParameterValueEdit edit, string value) {
        var dataType = parameter.Definition?.GetDataType();
        var isMeasurable = IsMeasurableSpec(dataType);

        if (!string.IsNullOrWhiteSpace(edit.Unit)) {
            if (edit.RawInternal)
                throw new InvalidOperationException("Unit and rawInternal are mutually exclusive; pass one.");
            if (!isMeasurable)
                throw new InvalidOperationException(
                    $"Unit '{edit.Unit}' was supplied but parameter '{parameter.Definition?.Name}' has no measurable spec; omit unit.");
            if (!double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
                throw new InvalidOperationException(
                    $"With an explicit unit, value must be a plain invariant number; got '{value}'.");

            var unitTypeId = ParameterUnitResolver.Resolve(edit.Unit!, dataType!);
            return UnitUtils.ConvertToInternalUnits(number, unitTypeId);
        }

        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var bare)) {
            if (edit.RawInternal || !isMeasurable)
                return bare;

            // Refusing is the correctness feature: a bare numeral would silently mean internal
            // units (feet, ft³/s...) — "1500" intended as CFM would write ~900,000 CFM.
            throw new InvalidOperationException(
                $"Bare numeric value '{value}' is ambiguous for measurable parameter '{parameter.Definition?.Name}'. Pass unit (e.g. unit: \"CFM\"), or rawInternal: true if the value is already in internal units.");
        }

        if (dataType != null &&
            UnitFormatUtils.TryParse(document.GetUnits(), dataType, value, out var parsed))
            return parsed;

        throw new InvalidOperationException(
            $"Value '{value}' is not a parseable unit display string for parameter '{parameter.Definition?.Name}'. Prefer value + unit for exact conversion.");
    }

    private static bool IsMeasurableSpec(ForgeTypeId? dataType) {
        if (dataType == null || dataType.Empty())
            return false;

        try {
            return UnitUtils.IsMeasurableSpec(dataType);
        } catch {
            return false;
        }
    }

    private static string? FormatDisplayEcho(Document document, Parameter parameter, double internalValue) {
        var dataType = parameter.Definition?.GetDataType();
        if (!IsMeasurableSpec(dataType))
            return null;

        try {
            return UnitFormatUtils.Format(document.GetUnits(), dataType!, internalValue, forEditing: false);
        } catch {
            return null;
        }
    }

    private static string DescribeParameterReference(ParameterValueEdit edit) =>
        edit.ParameterId?.ToString(CultureInfo.InvariantCulture) ?? edit.ParameterName ?? "<unspecified>";
}
