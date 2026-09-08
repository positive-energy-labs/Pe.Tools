using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.Extensions.FamManager;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>`FamilyManager.RenameParameter`: rewrites formulas, keeps per-type values (gotcha 26, LAW).</summary>
public sealed class RenameParams((string From, string To)[] renames) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Rename {renames.Length} parameters: {string.Join(", ", renames.Select(r => $"{r.From}→{r.To}"))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (from, to) in renames) {
            try {
                var p = doc.FamilyManager.FindParameter(from) ?? throw new InvalidOperationException($"'{from}' is not in this family (rename-source-missing).");
                doc.FamilyManager.RenameParameter(p, to);
                logs.Add(new LogEntry(to).Success($"Renamed from '{from}'."));
            } catch (Exception ex) { logs.Add(new LogEntry(to).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }
}

/// <summary>
///     Add missing parameters. A family parameter needs its data type; a shared parameter resolves through the
///     shared-parameter source the caller supplies (APS cache or a shared parameter file), else it is refused.
/// </summary>
public sealed class AddParams((string Name, FamilyModelParameter Spec)[] parameters, Func<string, ExternalDefinition?>? sharedSource = null)
    : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Add {parameters.Length} parameters: {string.Join(", ", parameters.Select(p => p.Name))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (name, spec) in parameters) {
            try {
                if (doc.FamilyManager.FindParameter(name) is not null) { logs.Add(new LogEntry(name).Skip("Already exists.")); continue; }
                _ = Create(doc, name, spec, sharedSource);
                _ = ctx.CreatedParameters.Add(name);
                logs.Add(new LogEntry(name).Success(spec.Shared == true ? "Added shared parameter." : $"Added {spec.DataType} parameter."));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    internal static FamilyParameter Create(FamilyDocument doc, string name, FamilyModelParameter spec, Func<string, ExternalDefinition?>? sharedSource) {
        var group = spec.PropertiesGroup is { } pg ? SetParamMetadata.Group(pg) : new ForgeTypeId(string.Empty);
        var parameter = spec.Shared == true
            ? doc.FamilyManager.AddParameter(sharedSource?.Invoke(name) ?? throw new InvalidOperationException($"Shared parameter '{name}' has no definition source."), group, spec.IsInstance ?? false)
            : doc.FamilyManager.AddParameter(name, group, SetParamMetadata.Spec(spec.DataType ?? throw new InvalidOperationException($"'{name}' has no dataType.")), spec.IsInstance ?? false);
        return parameter ?? throw new InvalidOperationException($"Revit returned no parameter for '{name}' (group '{group.TypeId}', shared {spec.Shared == true}).");
    }
}

/// <summary>Instance/type, properties group, tooltip. Data type is not editable after creation; a mismatch is reported.</summary>
public sealed class SetParamMetadata((string Name, FamilyModelParameter Spec)[] parameters) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Set metadata on {parameters.Length} parameters";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        var fm = doc.FamilyManager;
        foreach (var (name, spec) in parameters) {
            try {
                var p = fm.FindParameter(name) ?? throw new InvalidOperationException($"'{name}' is not in this family.");
                var notes = new List<string>();
                if (spec.IsInstance is { } inst && p.IsInstance != inst) { if (inst) fm.MakeInstance(p); else fm.MakeType(p); notes.Add(inst ? "instance" : "type"); }
                // `null = delete` reaches here as a null field; the empty group and the empty description ARE the deleted forms.
                var group = spec.PropertiesGroup ?? string.Empty;
                if (p.Definition is InternalDefinition def && def.GetGroupTypeId() != Group(group)) { def.SetGroupTypeId(Group(group)); notes.Add($"group {(group.Length == 0 ? "Other" : group)}"); }
                // ponytail: a tooltip has no readback, so an unreadable native tooltip is indistinguishable from a deleted one and is cleared here.
                if (!p.IsShared) { fm.SetDescription(p, spec.Tooltip ?? string.Empty); if (spec.Tooltip is not null) notes.Add("tooltip"); }
                if (spec.DataType is { } dt && !p.IsShared && p.Definition.GetDataType() != Spec(dt)) throw new InvalidOperationException($"'{name}' is {p.Definition.GetDataType().TypeId}, desired {dt}; a data type cannot change in place.");
                logs.Add(notes.Count == 0 ? new LogEntry(name).Skip("Unchanged.") : new LogEntry(name).Success(string.Join(", ", notes)));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    public static ForgeTypeId Group(string label) {
        if (label.Length == 0 || label.Equals("Other", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId(string.Empty);
        var labels = Pe.Revit.DocumentData.Parameters.RevitLabelCatalog.GetLabelToPropertyGroupMap();
        if (labels.TryGetValue(label, out var forge)) return forge;
        var requested = new ForgeTypeId(label);
        if (Pe.Revit.DocumentData.Parameters.RevitLabelCatalog.GetPropertyGroupToLabelMap().ContainsKey(requested)) return requested;
        throw new InvalidOperationException($"Unknown parameter group '{label}'. Use a native GroupTypeId TypeId or a Revit group label.");
    }

    public static ForgeTypeId Spec(DataType dataType) => dataType switch {
        DataType.Length => SpecTypeId.Length, DataType.Area => SpecTypeId.Area, DataType.Volume => SpecTypeId.Volume, DataType.Angle => SpecTypeId.Angle,
        DataType.Integer => SpecTypeId.Int.Integer, DataType.Number => SpecTypeId.Number, DataType.YesNo => SpecTypeId.Boolean.YesNo, DataType.Text => SpecTypeId.String.Text,
        DataType.Url => SpecTypeId.String.Url, DataType.Material => SpecTypeId.Reference.Material, DataType.MultilineText => SpecTypeId.String.MultilineText,
        DataType.ElectricalPotential => SpecTypeId.ElectricalPotential, DataType.Current => SpecTypeId.Current, DataType.ApparentPower => SpecTypeId.ApparentPower,
        DataType.Wattage => SpecTypeId.Wattage, DataType.NumberOfPoles => SpecTypeId.Int.NumberOfPoles, DataType.AirFlow => SpecTypeId.AirFlow, DataType.Pressure => SpecTypeId.HvacPressure,
        DataType.Temperature => SpecTypeId.HvacTemperature, DataType.PipingFlow => SpecTypeId.Flow, DataType.PipeSize => SpecTypeId.PipeSize, DataType.DuctSize => SpecTypeId.DuctSize,
        DataType.HvacVelocity => SpecTypeId.HvacVelocity, DataType.Slope => SpecTypeId.Slope, DataType.Currency => SpecTypeId.Currency, DataType.LoadClassification => SpecTypeId.Reference.LoadClassification,
        _ => throw new InvalidOperationException($"No SpecTypeId for {dataType}.")
    };
}

/// <summary>A parameter that becomes a value must lose its formula first; a value set on a formula-driven parameter throws.</summary>
public sealed class ClearFormulas(string[] names) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Clear formulas on {names.Length} parameters";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var name in names) {
            try {
                var p = doc.FamilyManager.FindParameter(name) ?? throw new InvalidOperationException($"'{name}' is not in this family.");
                if (string.IsNullOrWhiteSpace(p.Formula)) { logs.Add(new LogEntry(name).Skip("No formula.")); continue; }
                doc.FamilyManager.SetFormula(p, null!);
                logs.Add(new LogEntry(name).Success("Formula cleared."));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }
}

/// <summary>Delete named types; refuses to delete the last one (gotcha 11).</summary>
public sealed class DeleteFamilyTypes(string[] names) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Delete {names.Length} family types: {string.Join(", ", names)}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        var fm = doc.FamilyManager;
        foreach (var name in names) {
            try {
                var type = fm.Types.Cast<FamilyType>().FirstOrDefault(t => t.Name == name);
                if (type is null) { logs.Add(new LogEntry(name).Skip("Not found.")); continue; }
                if (fm.Types.Size <= 1) { logs.Add(new LogEntry(name).Skip("The last type cannot be deleted.")); continue; }
                fm.CurrentType = type;
                fm.DeleteCurrentType();
                logs.Add(new LogEntry(name).Success("Deleted."));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }
}

/// <summary>
///     `run.blanksBecome`: per type, a parameter whose spec is in a rule and has no value (`HasValue(FamilyType, FamilyParameter)` false,
///     no formula) receives the rule's value. Spec-keyed so a blank Length or Yes/No is opt-in (critic F14).
/// </summary>
public sealed class SetBlankValues(IReadOnlyList<BlankRule> rules) : TypeOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"run.blanksBecome: {string.Join("; ", rules.Select(r => $"{string.Join("/", r.Specs)} → {r.Value.Text}"))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        var type = doc.FamilyManager.CurrentType;
        foreach (var p in doc.FamilyManager.GetParameters()) {
            try {
                if (Fill(doc, type, p, rules, ctx.CreatedParameters.Contains(p.Definition.Name)) is { } written)
                    logs.Add(new LogEntry(p.Definition.Name).Success($"Blank → {written}"));
            } catch (Exception ex) { logs.Add(new LogEntry(p.Definition.Name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    /// <summary>
    ///     Writes the rule value into a blank cell and returns it, else null. Revit has no blank for numbers: a parameter this run created
    ///     reads 0 until something writes it, so for created parameters 0 is the blank (kaitpw 2026-09-08). `type` must be the current type.
    /// </summary>
    public static string? Fill(FamilyDocument doc, FamilyType type, FamilyParameter p, IReadOnlyList<BlankRule> rules, bool created) {
        if (!string.IsNullOrWhiteSpace(p.Formula) || p.IsReadOnly) return null;
        var spec = p.Definition.GetDataType();
        var rule = rules.FirstOrDefault(r => r.Specs.Any(s => SetParamMetadata.Spec(s) == spec));
        if (rule is null) return null;
        var createdZero = created && p.StorageType switch {
            StorageType.Double => type.AsDouble(p) is null or 0, StorageType.Integer => type.AsInteger(p) is null or 0, _ => false };
        if (doc.HasValue(type, p) && !createdZero) return null;
        _ = doc.SetValue(p, rule.Value.Text, nameof(BuiltInCoercionStrategy.CoerceByStorageType));
        return rule.Value.Text;
    }
}

/// <summary>The closed `settings` key set onto the family element; every write is read back (harvested from FamilyModelBuilder).</summary>
public sealed class SetFamilySettings(FamilyModelSettings settings) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => "Set family-level settings (alwaysVertical, shared, cutWithVoidsWhenLoaded, partType, omniClass)";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        var family = doc.OwnerFamily;
        Set(family, BuiltInParameter.FAMILY_ALWAYS_VERTICAL, "alwaysVertical", settings.AlwaysVertical, logs);
        Set(family, BuiltInParameter.FAMILY_SHARED, "shared", settings.Shared, logs);
        Set(family, BuiltInParameter.FAMILY_ALLOW_CUT_WITH_VOIDS, "cutWithVoidsWhenLoaded", settings.CutWithVoidsWhenLoaded, logs);
        if (settings.PartType is { } pt) {
            try {
                var partType = (PartType)Enum.Parse(typeof(PartType), pt.ToString());
                var p = family.get_Parameter(BuiltInParameter.FAMILY_CONTENT_PART_TYPE) ?? throw new InvalidOperationException("no Part Type parameter");
                _ = p.Set((int)partType);
                logs.Add(new LogEntry("partType").Success(pt.ToString()));
            } catch (Exception ex) { logs.Add(new LogEntry("partType").Error(ex)); }
        }
        if (settings.OmniClass is { } omni) {
#if REVIT2026_OR_GREATER
            logs.Add(new LogEntry("omniClass").Error("Revit 2026 removed the OmniClass Number parameter."));
#else
            try {
                var p = family.get_Parameter(BuiltInParameter.OMNICLASS_CODE) ?? throw new InvalidOperationException("no OmniClass parameter");
                _ = p.Set(omni);
                logs.Add(p.AsString() == omni ? new LogEntry("omniClass").Success(omni) : new LogEntry("omniClass").Error($"Revit stored '{p.AsString()}'."));
            } catch (Exception ex) { logs.Add(new LogEntry("omniClass").Error(ex)); }
#endif
        }
        return new OperationLog(this.Name, logs);
    }

    private static void Set(Family family, BuiltInParameter bip, string key, bool? value, List<LogEntry> logs) {
        if (value is not { } v) return;
        try {
            var p = family.get_Parameter(bip) ?? throw new InvalidOperationException($"no '{bip}' parameter");
            if (p.IsReadOnly) throw new InvalidOperationException($"'{bip}' is read-only here");
            _ = p.Set(v ? 1 : 0);
            logs.Add(p.AsInteger() == (v ? 1 : 0) ? new LogEntry(key).Success(v.ToString()) : new LogEntry(key).Error($"Revit stored {p.AsInteger()}."));
        } catch (Exception ex) { logs.Add(new LogEntry(key).Error(ex)); }
    }
}
