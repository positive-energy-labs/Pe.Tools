using System.Text.RegularExpressions;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     The closed diagnostic code set. Every closed-set token error is <see cref="InvalidJson" /> from the
///     converters before any rule runs; the rest are validator rules (r2-schema §6). Rules that need the
///     installed template table or a nested family model (`unknown-template`, `unknown-nested-type`,
///     `unknown-instance-parameter`) live in the lowering, not here.
/// </summary>
public static class FamilyModelDiagnosticCodes {
    public const string InvalidJson = "invalid-json";
    public const string Required = "required";
    public const string ValueFormulaConflict = "value-formula-conflict";
    public const string ValueWithoutTypes = "value-without-types";
    public const string SharedOwnsDataType = "shared-owns-datatype";
    public const string SharedTooltipUnsupported = "shared-tooltip-unsupported";
    public const string IdentityChangeThroughGroup = "identity-change-through-group";
    public const string FormulaCopyDataType = "formula-copy-data-type";
    public const string ValueDataTypeMismatch = "value-datatype-mismatch";
    public const string FormulaUnknownName = "formula-unknown-name";
    public const string UnknownParameter = "unknown-parameter";
    public const string FormulaTypeOverride = "formula-type-override";
    public const string ValueNamesParameter = "value-names-parameter";
    public const string SeedIsLiteral = "seed-is-literal";
    public const string DatumNormalUnsigned = "datum-normal-unsigned";
    public const string RefPlaneNormalSigned = "refplane-normal-signed";
    public const string UnknownReference = "unknown-reference";
    public const string InvalidReference = "invalid-reference";
    public const string RefLineKeyPositional = "refline-key-positional";
    public const string RefLineFromTwoPlanes = "refline-from-two-planes";
    public const string RefLineFromParallel = "refline-from-parallel";
    public const string AngleNeedsAngleFrom = "angle-needs-angle-from";
    public const string DimensionBetweenTwo = "dimension-between-two";
    public const string EqualityNeedsThree = "equality-needs-three";
    public const string LabelLockedConflict = "label-locked-conflict";
    public const string LabelTypeMismatch = "label-type-mismatch";
    public const string LabelNotUnique = "label-not-unique";
    public const string SlotNotLegalForKind = "slot-not-legal-for-kind";
    public const string LoopNotClosed = "loop-not-closed";
    public const string LoopConsecutiveParallel = "loop-consecutive-parallel";
    public const string CenterTwoPlanes = "center-two-planes";
    public const string CenterParallel = "center-parallel";
    public const string LengthNotPositive = "length-not-positive";
    public const string DriverDataTypeMismatch = "driver-datatype-mismatch";
    public const string NestedIdentityNotUnique = "nested-identity-not-unique";
    public const string ArraySpacingKind = "array-spacing-kind";
    public const string ArrayCountBelowTwo = "array-count-below-two";
    public const string ConnectorPositionDuplicate = "connector-position-duplicate";
    public const string SystemTypeDomain = "system-type-domain";
    public const string PipeRound = "pipe-round";
    public const string DetailFamilyXorCurves = "detail-family-xor-curves";
    public const string LookupTableHeader = "lookup-table-header";
    public const string CoverageSectionUnknown = "coverage-section-unknown";
    public const string MacroNameCollision = "macro-name-collision";
    public const string UnmodeledState = "unmodeled-state";
    public const string Unverifiable = "unverifiable-change";
}

/// <summary>
///     Every rule that needs only the document. References resolve against DECLARED entries only (datums,
///     ref planes, ref lines, and the planes macros emitted); nothing resolves by assumption (critic F3).
///     Deliberately silent: <see cref="FamilyModelParameter.WasNamed" /> (names the current family, not this document).
/// </summary>
public static class FamilyModelValidator {
    public static IReadOnlyList<FamilyModelDiagnostic> Validate(FamilyModel m) {
        var d = new List<FamilyModelDiagnostic>();
        var normals = m.Datums.ToDictionary(p => p.Key, p => p.Value.Normal, StringComparer.Ordinal);
        foreach (var (k, v) in m.RefPlanes) normals[k] = v.Normal;
        var planes = new HashSet<string>(normals.Keys, StringComparer.Ordinal);
        var lines = new HashSet<string>(m.RefLines.Keys, StringComparer.Ordinal);
        // A formula resolves against declared parameters plus the family's built-in parameters, which the
        // template owns and the document only names (`Length`, `Width`, `Default Elevation`, …).
        var nameable = new HashSet<string>(m.Parameters.Keys.Concat(m.BuiltIns), StringComparer.Ordinal);

        foreach (var (name, p) in m.Parameters) {
            var path = $"$.parameters.{name}";
            if (p.Value != null && p.Formula != null) d.Add(new(FamilyModelDiagnosticCodes.ValueFormulaConflict, path, "value XOR formula."));
            if (p.Shared == true && (p.DataType != null || p.Tooltip != null && p.SharedSpecId is null)) d.Add(new(FamilyModelDiagnosticCodes.SharedOwnsDataType, path, "A shared parameter takes its dataType and tooltip from its definition."));
            if (p.SharedSpecId is not null && (p.Shared != true || p.SharedGuid is null || string.IsNullOrWhiteSpace(p.SharedSpecId))) d.Add(new(FamilyModelDiagnosticCodes.Required, path, "sharedSpecId requires shared=true and sharedGuid."));
            if (p.SharedGuid is { } guid && (p.Shared != true || guid == Guid.Empty)) d.Add(new(FamilyModelDiagnosticCodes.Required, path, "sharedGuid requires shared=true and a nonempty GUID."));
            if (p.Shared != true && p.DataType == null) d.Add(new(FamilyModelDiagnosticCodes.Required, $"{path}.dataType", "Family parameters declare dataType. Legal: " + string.Join(", ", Enum.GetNames(typeof(DataType)))));
            if (p.Value is { } v && p.DataType is { } dt) CheckValue(v, dt, $"{path}.value", nameable, d);
            if (p.Formula is { } f)
                foreach (var tok in FormulaNames(f).Where(t => !nameable.Contains(t)))
                    d.Add(new(FamilyModelDiagnosticCodes.FormulaUnknownName, $"{path}.formula", $"'{tok}' is neither a declared parameter nor a declared built-in. Nearest: {Nearest(tok, nameable)}"));
        }
        foreach (var (type, cells) in m.Types)
        foreach (var (name, v) in cells) {
            var path = $"$.types.{type}.{name}";
            if (!m.Parameters.TryGetValue(name, out var p)) { d.Add(new(FamilyModelDiagnosticCodes.UnknownParameter, path, $"Not declared. Nearest: {Nearest(name, m.Parameters.Keys)}")); continue; }
            if (p.Formula != null) d.Add(new(FamilyModelDiagnosticCodes.FormulaTypeOverride, path, "Formula-driven parameters take no per-type value."));
            if (p.DataType is { } dt) CheckValue(v, dt, path, nameable, d);
        }
        // RULING (kaitpw, 2026-09-06): Revit's stored sign for a template plane varies, so a datum normal
        // is unsigned; a refPlane seed runs along its normal, so a refPlane normal stays signed.
        foreach (var (name, dm) in m.Datums)
            if (dm.Normal.IsSigned())
                d.Add(new(FamilyModelDiagnosticCodes.DatumNormalUnsigned, $"$.datums.{name}.normal",
                    $"A datum normal is unsigned: Revit stores 'Center (Front/Back)' as MinusY in one template and PlusY in another, and a datum carries no seed for the sign to drive. Write {dm.Normal.Unsigned()}."));
        foreach (var (name, rp) in m.RefPlanes) {
            if (!rp.Normal.IsSigned())
                d.Add(new(FamilyModelDiagnosticCodes.RefPlaneNormalSigned, $"$.refPlanes.{name}.normal",
                    $"A refPlane normal is signed: the 'at' seed runs along it. Write Plus{rp.Normal} or Minus{rp.Normal}."));
            if (rp.At.IsParameter) d.Add(new(FamilyModelDiagnosticCodes.SeedIsLiteral, $"$.refPlanes.{name}.at", "The seed is a literal; a parameter drives a plane through a labeled dimension."));
        }
        foreach (var (name, rl) in m.RefLines) {
            var path = $"$.refLines.{name}";
            // RULING (kaitpw, 2026-09-06): a reference line has no Revit name, so its key is positional.
            if (!RefLineKey.IsMatch(name))
                d.Add(new(FamilyModelDiagnosticCodes.RefLineKeyPositional, path,
                    $"'{name}' is not a positional reference line key. Revit gives a reference line no name, so capture keys reference lines line-1, line-2, … in document order. Write line-<n>."));
            Plane(rl.On, $"{path}.on", planes, d);
            if (rl.From.Count != 2) d.Add(new(FamilyModelDiagnosticCodes.RefLineFromTwoPlanes, $"{path}.from", "Exactly two plane names."));
            foreach (var (f, i) in rl.From.Select((f, i) => (f, i))) Plane(f, $"{path}.from[{i}]", planes, d);
            if (rl.From.Count == 2 && Parallel(normals, rl.From[0], rl.From[1])) d.Add(new(FamilyModelDiagnosticCodes.RefLineFromParallel, $"{path}.from", "The two planes are parallel and do not meet."));
            if ((rl.Angle == null) != (rl.AngleFrom == null)) d.Add(new(FamilyModelDiagnosticCodes.AngleNeedsAngleFrom, path, "angle and angleFrom go together."));
            if (rl.AngleFrom is { } af) Plane(af, $"{path}.angleFrom", planes, d);
            Length(rl.Length, $"{path}.length", m, d);
            if (rl.Angle is { IsParameter: true } ang) Param(ang.Text, $"{path}.angle", m, DataType.Angle, d);
        }
        var labels = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, rl) in m.RefLines) if (rl.Angle is { IsParameter: true } ang) Label(ang.Parameter!, DataType.Angle, "an angular dimension", $"$.refLines.{name}.angle", name, [rl.AngleFrom ?? "", name], m, labels, d);
        foreach (var (slug, dim) in m.Dimensions) {
            var path = $"$.dimensions.{slug}";
            if (dim.Between.Count < 2) d.Add(new(FamilyModelDiagnosticCodes.DimensionBetweenTwo, $"{path}.between", "At least two references."));
            foreach (var (r, i) in dim.Between.Select((r, i) => (r, i)))
                if (!planes.Contains(r) && !lines.Contains(r)) d.Add(new(FamilyModelDiagnosticCodes.UnknownReference, $"{path}.between[{i}]", $"'{r}' is not a declared plane or line. Legal: {Legal(planes.Concat(lines))}"));
            if (dim.Equality == true && dim.Between.Count < 3) d.Add(new(FamilyModelDiagnosticCodes.EqualityNeedsThree, $"{path}.between", "EQ needs three or more references."));
            if (dim.Label != null && dim.Locked != null) d.Add(new(FamilyModelDiagnosticCodes.LabelLockedConflict, path, "label XOR locked."));
            if (dim.Label is { } l) Label(l, DataType.Length, "a linear dimension", $"{path}.label", slug, dim.Between, m, labels, d);
            if (dim.Locked is { } locked) Length(locked, $"{path}.locked", m, d);
        }
        foreach (var (slug, f) in m.Forms) {
            var path = $"$.forms.{slug}";
            if (f.Kind != FormKind.Extrusion) { d.Add(new(FamilyModelDiagnosticCodes.SlotNotLegalForKind, $"{path}.kind", "Macros expand at parse time; a parsed model holds only Extrusion.")); continue; }
            Forbid(path, d, ("width", f.Width != null), ("depth", f.Depth != null), ("height", f.Height != null), ("diameter", f.Diameter != null), ("center", f.Center != null), ("bottom", f.Bottom != null));
            if (f.SketchPlane is null || f.Profile is null || f.End is null) d.Add(new(FamilyModelDiagnosticCodes.Required, path, "Extrusion needs sketchPlane, profile, end."));
            if (f.SketchPlane is { } sp) Plane(sp, $"{path}.sketchPlane", planes, d);
            if (f.Start is { } st) Plane(st, $"{path}.start", planes, d);
            if (f.End is { } en) Plane(en, $"{path}.end", planes, d);
            foreach (var (loop, li) in (f.Profile ?? []).Select((l, i) => (l, i))) LoopRules(loop, $"{path}.profile[{li}]", m, planes, normals, d);
            if (f.Visible is { } vis) Param(vis, $"{path}.visible", m, DataType.YesNo, d);
        }
        var identities = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (slug, n) in m.Nested) {
            var path = $"$.nested.{slug}";
            Host(n.Host, $"{path}.host", planes, lines, d);
            foreach (var (a, i) in (n.Align ?? []).Select((a, i) => (a, i))) Plane(a.To, $"{path}.align[{i}].to", planes, d);
            foreach (var (k, v) in n.Associate ?? []) Param(v, $"{path}.associate.{k}", m, null, d);
            if (n.Visible is { } vis) Param(vis, $"{path}.visible", m, DataType.YesNo, d);
            var identity = $"{n.Family}|{n.Type}|{n.Host}|{string.Join(",", (n.Align ?? []).Select(a => a.Instance + ">" + a.To).OrderBy(s => s, StringComparer.Ordinal))}";
            if (!identities.Add(identity)) d.Add(new(FamilyModelDiagnosticCodes.NestedIdentityNotUnique, path, "Another nested entry has the same family, type, host and alignments; capture cannot tell them apart."));
        }
        foreach (var (slug, a) in m.Arrays) {
            var path = $"$.arrays.{slug}";
            if (!m.Nested.ContainsKey(a.Member)) d.Add(new(FamilyModelDiagnosticCodes.UnknownReference, $"{path}.member", $"No nested '{a.Member}'. Legal: {Legal(m.Nested.Keys)}"));
            Param(a.Label, $"{path}.label", m, DataType.Integer, d);
            if (a.MoveTo == ArrayAnchor.Second && (a.Spacing is null || a.SpacingPlane != null)) d.Add(new(FamilyModelDiagnosticCodes.ArraySpacingKind, path, "moveTo Second takes spacing (a length), not spacingPlane."));
            if (a.MoveTo == ArrayAnchor.Last && (a.SpacingPlane is null || a.Spacing != null)) d.Add(new(FamilyModelDiagnosticCodes.ArraySpacingKind, path, "moveTo Last takes spacingPlane, not spacing."));
            if (a.SpacingPlane is { } sp) Plane(sp, $"{path}.spacingPlane", planes, d);
            if (a.Spacing is { } s) Length(s, $"{path}.spacing", m, d);
            if (a.Label.StartsWith("param:", StringComparison.Ordinal) && m.Parameters.TryGetValue(a.Label[6..], out var lp) && lp.Value is { Kind: PortableValueKind.Integer, Number: < 2 })
                d.Add(new(FamilyModelDiagnosticCodes.ArrayCountBelowTwo, $"{path}.label", "An array count below 2 is not an array."));
        }
        var positions = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (slug, c) in m.Connectors) {
            var path = $"$.connectors.{slug}";
            Plane(c.On, $"{path}.on", planes, d);
            if (c.At.Count != 2) d.Add(new(FamilyModelDiagnosticCodes.CenterTwoPlanes, $"{path}.at", "Two positioning planes that cross on the connector plane."));
            foreach (var (p, i) in c.At.Select((p, i) => (p, i))) Plane(p, $"{path}.at[{i}]", planes, d);
            if (c.At.Count == 2 && (Parallel(normals, c.At[0], c.At[1]) || Parallel(normals, c.At[0], c.On) || Parallel(normals, c.At[1], c.On)))
                d.Add(new(FamilyModelDiagnosticCodes.CenterParallel, $"{path}.at", "on and the two at planes must be mutually crossing to fix one point."));
            if (!positions.Add($"{c.Domain}|{c.On}|{string.Join(",", c.At.OrderBy(s => s, StringComparer.Ordinal))}"))
                d.Add(new(FamilyModelDiagnosticCodes.ConnectorPositionDuplicate, path, "Two connectors of one domain at one position are coincident; capture cannot tell them apart."));
            if (!DomainAllows(c.Domain, c.SystemType)) d.Add(new(FamilyModelDiagnosticCodes.SystemTypeDomain, $"{path}.systemType", $"{c.SystemType} is not a {c.Domain} system type."));
            if (c.Domain == ConnectorDomain.Pipe && c.Shape is not (null or ConnectorShape.Round)) d.Add(new(FamilyModelDiagnosticCodes.PipeRound, $"{path}.shape", "Pipe connectors are Round."));
            if (c.FlowConfiguration == FlowConfiguration.Demand && c.Domain != ConnectorDomain.Pipe)
                d.Add(new(FamilyModelDiagnosticCodes.SlotNotLegalForKind, $"{path}.flowConfiguration", "Demand is only a Pipe flow configuration."));
            if (c.LossMethod == LossMethod.Table && c.Domain != ConnectorDomain.Pipe)
                d.Add(new(FamilyModelDiagnosticCodes.SlotNotLegalForKind, $"{path}.lossMethod", "Table is only a Pipe loss method."));
            foreach (var (n, v) in new[] { ("diameter", c.Diameter), ("width", c.Width), ("height", c.Height) }) if (v is { } len) Length(len, $"{path}.{n}", m, d);
            if (c.Angle is { IsParameter: true } ang) Param(ang.Text, $"{path}.angle", m, DataType.Angle, d);
            foreach (var (k, v) in c.Associate ?? []) Param(v, $"{path}.associate.{k}", m, null, d);
        }
        foreach (var (slug, det) in m.Details) {
            var path = $"$.details.{slug}";
            if ((det.Family is null) == (det.Curves is null)) d.Add(new(FamilyModelDiagnosticCodes.DetailFamilyXorCurves, path, "A detail is a nested Detail Item (family + type) XOR a loop of symbolic lines (curves)."));
            if (det.Family != null && det.Type is null) d.Add(new(FamilyModelDiagnosticCodes.Required, $"{path}.type", "A nested detail item names its type."));
            foreach (var (loop, li) in (det.Curves ?? []).Select((l, i) => (l, i))) LoopRules(loop, $"{path}.curves[{li}]", m, planes, normals, d);
            foreach (var (a, i) in (det.Align ?? []).Select((a, i) => (a, i))) Plane(a.To, $"{path}.align[{i}].to", planes, d);
            if (det.Visible is { } vis) Param(vis, $"{path}.visible", m, DataType.YesNo, d);
        }
        foreach (var (name, t) in m.LookupTables)
            if (!Regex.IsMatch(t.Csv.Split('\n')[0], @"^[^,]*(,[^,]+##[^,]+##[^,]*)+\s*$")) d.Add(new(FamilyModelDiagnosticCodes.LookupTableHeader, $"$.lookupTables.{name}.csv", "First row must be `,Name##type##unit,...` (Revit size-table header)."));
        if (m.RoomCalculationPoint?.Offset is { } off) Length(off, "$.roomCalculationPoint.offset", m, d);
        foreach (var section in m.Coverage.Keys.Where(k => !FamilyModel.SectionNames.Contains(k, StringComparer.Ordinal)))
            d.Add(new(FamilyModelDiagnosticCodes.CoverageSectionUnknown, $"$.coverage.{section}", $"Not a section. Legal: {string.Join(", ", FamilyModel.SectionNames)}"));
        foreach (var u in m.Unmodeled) d.Add(new(FamilyModelDiagnosticCodes.UnmodeledState, u.Path, $"'{u.Reason}' is observable but not executable."));
        return d;
    }

    private static void LoopRules(FamilyModelLoop loop, string path, FamilyModel m, ISet<string> planes, IReadOnlyDictionary<string, Axis> normals, List<FamilyModelDiagnostic> d) {
        var ons = loop.Curves.Where(x => x.Kind == CurveKind.Line).Select(x => x.On ?? string.Empty).ToList();
        foreach (var (curve, ci) in loop.Curves.Select((x, i) => (x, i))) {
            var cp = $"{path}.curves[{ci}]";
            if (curve.Kind == CurveKind.Line) {
                if (curve.On is null) d.Add(new(FamilyModelDiagnosticCodes.Required, $"{cp}.on", "A sketch line names the plane it lies on.")); else Plane(curve.On, $"{cp}.on", planes, d);
                Forbid(cp, d, ("center", curve.Center != null), ("diameter", curve.Diameter != null));
            } else {
                Forbid(cp, d, ("on", curve.On != null));
                if (curve.Center is not { Count: 2 } || curve.Diameter is null) d.Add(new(FamilyModelDiagnosticCodes.Required, cp, "Circle needs center [two planes] and diameter."));
                foreach (var (p, i) in (curve.Center ?? []).Select((p, i) => (p, i))) Plane(p, $"{cp}.center[{i}]", planes, d);
                if (curve.Center is { Count: 2 } c && Parallel(normals, c[0], c[1])) d.Add(new(FamilyModelDiagnosticCodes.CenterParallel, $"{cp}.center", "The two centre planes are parallel and do not cross."));
                if (curve.Diameter is { } dia) Length(dia, $"{cp}.diameter", m, d);
            }
        }
        if (ons.Count > 0 && ons.Count < 3) d.Add(new(FamilyModelDiagnosticCodes.LoopNotClosed, path, "A loop of lines needs at least three lines."));
        for (var i = 0; i < ons.Count; i++) {
            var n = ons[(i + 1) % ons.Count];
            if (Parallel(normals, ons[i], n)) d.Add(new(FamilyModelDiagnosticCodes.LoopConsecutiveParallel, path, $"'{ons[i]}' and '{n}' are parallel; consecutive lines must cross."));
        }
    }

    private static void CheckValue(PortableValue v, DataType dt, string path, HashSet<string> nameable, List<FamilyModelDiagnostic> d) {
        var ok = dt.Measure() switch {
            DataType.Length => v.Kind == PortableValueKind.Length,
            DataType.Angle => v.Kind == PortableValueKind.Angle,
            DataType.Integer or DataType.NumberOfPoles => v.Kind == PortableValueKind.Integer,
            DataType.YesNo => v.Kind == PortableValueKind.YesNo,
            DataType.Number => v.Kind is PortableValueKind.Integer or PortableValueKind.Number,
            _ => true // Text-like specs, and unit-carrying specs (`208V`, `280 CFM`) the reconciler normalizes through Revit units (F5)
        };
        if (!ok) d.Add(new(FamilyModelDiagnosticCodes.ValueDataTypeMismatch, path, $"'{v.Text}' reads as {v.Kind}; a {dt} parameter takes {Legal(dt)}."));
        // Gotcha 18: text that names a parameter is a formula, not a value. A text-like value is a string, so a name
        // there is literal text; a unit-carrying spec admits text only for Revit units to read.
        else if (v.Kind == PortableValueKind.Text && dt is not (DataType.Text or DataType.Url or DataType.Material
                     or DataType.MultilineText or DataType.LoadClassification)
                 && FormulaNames(v.Text).FirstOrDefault(nameable.Contains) is { } named)
            d.Add(new(FamilyModelDiagnosticCodes.ValueNamesParameter, path, $"'{v.Text}' names parameter '{named}'; a value that follows a parameter is a formula."));
    }

    private static string Legal(DataType dt) => dt.Measure() switch {
        DataType.Length => "a length literal such as 6in, 1/2in, 150mm, 1' - 6\"",
        DataType.Angle or DataType.Slope => "an angle literal such as 45deg",
        DataType.Integer or DataType.NumberOfPoles => "an integer such as 4",
        DataType.YesNo => "Yes or No",
        _ => "a number such as 7.5"
    };

    // Revit lets one parameter label many dimensions; identity for capture is label + reference set, so only that pair must be unique.
    private static void Label(string name, DataType need, string what, string path, string slug, IEnumerable<string> refs, FamilyModel m, Dictionary<string, string> labels, List<FamilyModelDiagnostic> d) {
        if (!m.Parameters.TryGetValue(name, out var p)) d.Add(new(FamilyModelDiagnosticCodes.UnknownParameter, path, $"'{name}' is not declared. Nearest: {Nearest(name, m.Parameters.Keys)}"));
        else if (p.DataType is { } dt && dt.Measure() != need.Measure()) d.Add(new(FamilyModelDiagnosticCodes.LabelTypeMismatch, path, $"'{name}' is {dt}; {what} needs {need}."));
        var key = name + "|" + string.Join(",", refs.OrderBy(r => r, StringComparer.Ordinal));
        if (labels.TryGetValue(key, out var other)) d.Add(new(FamilyModelDiagnosticCodes.LabelNotUnique, path, $"'{name}' already labels {other} between the same references; capture cannot tell them apart.")); else labels[key] = slug;
    }

    private static void Plane(string name, string path, ISet<string> planes, List<FamilyModelDiagnostic> d) {
        if (!planes.Contains(name)) d.Add(new(FamilyModelDiagnosticCodes.UnknownReference, path, $"No declared plane '{name}'. Legal: {Legal(planes)}"));
    }

    private static void Host(string host, string path, ISet<string> planes, ISet<string> lines, List<FamilyModelDiagnostic> d) {
        if (!host.StartsWith("line:", StringComparison.Ordinal)) { Plane(host, path, planes, d); return; }
        var body = host[5..];
        var dot = body.LastIndexOf('.');
        var ok = dot > 0 && body[(dot + 1)..] is "start" or "end" && lines.Contains(body[..dot]);
        if (!ok) d.Add(new(FamilyModelDiagnosticCodes.UnknownReference, path, $"'{host}' is not a declared plane or line end. Legal: {Legal(planes.Concat(lines.SelectMany(l => new[] { $"line:{l}.start", $"line:{l}.end" })))}"));
    }

    private static void Param(string text, string path, FamilyModel m, DataType? need, List<FamilyModelDiagnostic> d) {
        if (!text.StartsWith("param:", StringComparison.Ordinal) || text.Length == 6) { d.Add(new(FamilyModelDiagnosticCodes.InvalidReference, path, $"Write param:<Name>. Legal: {Legal(m.Parameters.Keys.Select(k => "param:" + k))}")); return; }
        if (!m.Parameters.TryGetValue(text[6..], out var p)) { d.Add(new(FamilyModelDiagnosticCodes.UnknownReference, path, $"No parameter '{text[6..]}'. Nearest: {Nearest(text[6..], m.Parameters.Keys)}")); return; }
        if (need is { } dt && p.DataType is { } has && has.Measure() != dt.Measure()) d.Add(new(FamilyModelDiagnosticCodes.DriverDataTypeMismatch, path, $"'{text[6..]}' is {p.DataType}; this slot needs {dt}."));
    }

    private static void Length(PortableLength v, string path, FamilyModel m, List<FamilyModelDiagnostic> d) {
        if (v.IsParameter) Param(v.Text, path, m, DataType.Length, d);
        else if (v.Feet <= 0) d.Add(new(FamilyModelDiagnosticCodes.LengthNotPositive, path, $"'{v.Text}' must be positive here."));
    }

    private static void Forbid(string path, List<FamilyModelDiagnostic> d, params (string Slot, bool Present)[] slots) {
        foreach (var (slot, present) in slots) if (present) d.Add(new(FamilyModelDiagnosticCodes.SlotNotLegalForKind, $"{path}.{slot}", $"{slot} is not a slot of this kind."));
    }

    private static readonly Regex RefLineKey = new(@"^line-[1-9][0-9]*$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static bool Parallel(IReadOnlyDictionary<string, Axis> normals, string a, string b) =>
        normals.TryGetValue(a, out var na) && normals.TryGetValue(b, out var nb) && na.Unsigned() == nb.Unsigned();

    private static bool DomainAllows(ConnectorDomain domain, ConnectorSystemType t) => domain switch {
        ConnectorDomain.Duct => t is ConnectorSystemType.SupplyAir or ConnectorSystemType.ReturnAir or ConnectorSystemType.ExhaustAir or ConnectorSystemType.OtherAir or ConnectorSystemType.Global or ConnectorSystemType.Fitting,
        ConnectorDomain.Pipe => t is >= ConnectorSystemType.DomesticColdWater and <= ConnectorSystemType.Fitting or ConnectorSystemType.Global,
        ConnectorDomain.Electrical => t >= ConnectorSystemType.PowerCircuit,
        _ => true
    };

    private static readonly HashSet<string> BuiltIns = new(
        ["if", "and", "or", "not", "sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "exp", "ln", "log", "round", "rounddown", "roundup", "size_lookup", "pi", "yes", "no", "true", "false"],
        StringComparer.OrdinalIgnoreCase);

    /// <summary>GROUNDING gotcha 17: strip string literals first, split on operators, drop built-ins and numbers with unit suffixes.</summary>
    public static IEnumerable<string> FormulaNames(string formula) {
        var stripped = Regex.Replace(formula, "\"[^\"]*\"", " ");
        foreach (var raw in Regex.Split(stripped, @"[-+*/^<>=,()]")) {
            var tok = raw.Trim();
            if (tok.Length == 0 || BuiltIns.Contains(tok) || Regex.IsMatch(tok, @"^\d")) continue;
            yield return tok;
        }
    }

    private static string Legal(IEnumerable<string> set) {
        var list = set.OrderBy(s => s, StringComparer.Ordinal).ToList();
        return list.Count == 0 ? "(nothing declared)" : list.Count <= 12 ? string.Join(", ", list) : string.Join(", ", list.Take(12)) + $" … (+{list.Count - 12})";
    }

    private static string Nearest(string name, IEnumerable<string> candidates) =>
        candidates.OrderBy(c => Levenshtein(name, c)).FirstOrDefault() ?? "(none declared)";

    private static int Levenshtein(string a, string b) {
        var m = new int[a.Length + 1, b.Length + 1];
        for (var i = 0; i <= a.Length; i++) m[i, 0] = i;
        for (var j = 0; j <= b.Length; j++) m[0, j] = j;
        for (var i = 1; i <= a.Length; i++)
        for (var j = 1; j <= b.Length; j++)
            m[i, j] = Math.Min(Math.Min(m[i - 1, j] + 1, m[i, j - 1] + 1), m[i - 1, j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
        return m[a.Length, b.Length];
    }
}
