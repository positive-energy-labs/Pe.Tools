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
                var group = spec.PropertiesGroup is { } pg ? SetParamMetadata.Group(pg) : new ForgeTypeId(string.Empty);
                if (spec.Shared == true) {
                    var definition = sharedSource?.Invoke(name) ?? throw new InvalidOperationException($"Shared parameter '{name}' has no definition source; supply one (APS cache or shared parameter file).");
                    _ = doc.FamilyManager.AddParameter(definition, group, spec.IsInstance ?? false);
                } else {
                    _ = doc.FamilyManager.AddParameter(name, group, SetParamMetadata.Spec(spec.DataType ?? throw new InvalidOperationException($"'{name}' has no dataType.")), spec.IsInstance ?? false);
                }
                logs.Add(new LogEntry(name).Success(spec.Shared == true ? "Added shared parameter." : $"Added {spec.DataType} parameter."));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
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
                if (spec.PropertiesGroup is { } pg && p.Definition is InternalDefinition def && def.GetGroupTypeId() != Group(pg)) { def.SetGroupTypeId(Group(pg)); notes.Add($"group {pg}"); }
                if (spec.Tooltip is { } tip && !p.IsShared) { fm.SetDescription(p, tip); notes.Add("tooltip"); }
                if (spec.DataType is { } dt && !p.IsShared && p.Definition.GetDataType() != Spec(dt)) throw new InvalidOperationException($"'{name}' is {p.Definition.GetDataType().TypeId}, desired {dt}; a data type cannot change in place.");
                logs.Add(notes.Count == 0 ? new LogEntry(name).Skip("Unchanged.") : new LogEntry(name).Success(string.Join(", ", notes)));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    public static ForgeTypeId Group(string label) =>
        Pe.Revit.DocumentData.Parameters.RevitLabelCatalog.GetLabelToPropertyGroupMap().TryGetValue(label, out var forge) ? forge : new ForgeTypeId(label);

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
        var fm = doc.FamilyManager;
        var type = fm.CurrentType;
        foreach (var p in fm.GetParameters()) {
            if (!string.IsNullOrWhiteSpace(p.Formula) || p.IsReadOnly) continue;
            var spec = p.Definition.GetDataType();
            var rule = rules.FirstOrDefault(r => r.Specs.Any(s => SetParamMetadata.Spec(s) == spec));
            if (rule is null || doc.HasValue(type, p)) continue;
            try {
                _ = doc.SetValue(p, rule.Value.Text, nameof(BuiltInCoercionStrategy.CoerceByStorageType));
                logs.Add(new LogEntry(p.Definition.Name).Success($"Blank → {rule.Value.Text}"));
            } catch (Exception ex) { logs.Add(new LogEntry(p.Definition.Name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
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
