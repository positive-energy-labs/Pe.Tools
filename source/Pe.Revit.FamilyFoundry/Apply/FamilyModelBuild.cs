using Autodesk.Revit.ApplicationServices;
using System.Globalization;
using Pe.Revit.Compat;
using Pe.Revit.DocumentData.Families.Loaded;
using Pe.Revit.DocumentData.Schedules.Apply;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.FamilyFoundry.Apply;

/// <summary>
///     The three call shapes of the reconciler as one-liners: build a fresh family from its template, reconcile
///     an open family document, and select the families a patch names in a project (r2-reconcile §6).
/// </summary>
public static class FamilyModelBuild {
    /// <summary>Fresh document from the header's template; caller owns it. Nested dependencies resolve from modelDirectory: sibling .family.json before .rfa.</summary>
    public static (Document Document, FamilyReceipt? Receipt, string TemplatePath) Build(Application application, FamilyModel model, ExecutionOptions? options = null, string? modelDirectory = null) =>
        Build(application, model, options, modelDirectory, []);

    private static (Document Document, FamilyReceipt? Receipt, string TemplatePath) Build(Application application, FamilyModel model, ExecutionOptions? options, string? modelDirectory, List<string> ancestors) {
        var name = model.Family.Name;
        if (ancestors.Contains(name, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Nested family dependency cycle: {string.Join(" -> ", ancestors.Append(name))}");
        var templatePath = FamilyTemplate.ResolveTemplatePath(application, model.Family.Template);
        var document = FamilyTemplate.NewDocument(application, model.Family);
        try {
            LoadDependencies(application, document, model, options, modelDirectory, [.. ancestors, name]);
            var receipt = Reconcile(document, model, options);
            return (document, receipt, templatePath);
        } catch {
            try { _ = document.Close(false); } catch { }
            throw;
        }
    }

    /// <summary>Build, save to `outputPath`, close. Returns the receipt (residue 0 is convergence).</summary>
    public static (FamilyReceipt? Receipt, string TemplatePath, Pe.Shared.RevitData.Reading Reading) BuildAndSave(Application application, FamilyModel model, string outputPath, bool overwrite = false, string? modelDirectory = null) {
        var (document, receipt, templatePath) = Build(application, model, modelDirectory: modelDirectory);
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            document.SaveAs(outputPath, new SaveAsOptions { OverwriteExistingFile = overwrite, Compact = true, MaximumBackups = 1 });
            return (receipt, templatePath, DocumentReading.Here(document));
        } finally {
            _ = document.Close(false);
        }
    }

    // Fresh builds resolve portable sibling dependencies here, before any placement operations run.
    private static void LoadDependencies(Application application, Document target, FamilyModel model, ExecutionOptions? options, string? directory, List<string> ancestors) {
        foreach (var name in model.Nested.Values.Select(n => n.Family)
                     .Concat(model.Details.Values.Select(d => d.Family).OfType<string>()).Distinct(StringComparer.Ordinal)) {
            if (string.IsNullOrWhiteSpace(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || name is "." or "..")
                throw new InvalidOperationException($"Nested family '{name}' must be a portable sibling file name.");
            if (string.IsNullOrWhiteSpace(directory))
                throw new InvalidOperationException($"ModelDirectory is required to resolve nested family '{name}'.");
            var jsonPath = Path.Combine(directory, name + ".family.json");
            var nativePath = Path.Combine(directory, name + ".rfa");
            Document? child = null;
            try {
                if (File.Exists(jsonPath)) {
                    var parsed = FamilyModelJson.Parse(File.ReadAllText(jsonPath));
                    if (parsed.Value is null || parsed.Diagnostics.Count != 0)
                        throw new InvalidOperationException($"Invalid dependency '{jsonPath}': {string.Join("; ", parsed.Diagnostics.Select(d => $"{d.Path}: {d.Message}"))}");
                    if (parsed.Value.Family.Name != name)
                        throw new InvalidOperationException($"Dependency '{jsonPath}' declares family '{parsed.Value.Family.Name}', expected '{name}'.");
                    child = Build(application, parsed.Value, options, directory, ancestors).Document;
                } else if (File.Exists(nativePath)) {
                    child = application.OpenDocumentFile(nativePath);
                    if (!child.IsFamilyDocument)
                        throw new InvalidOperationException($"Dependency '{nativePath}' is not a family document.");
                } else {
                    throw new FileNotFoundException($"Nested family '{name}' requires sibling '{jsonPath}' or '{nativePath}'.");
                }
                var loaded = child.LoadFamily(target, new DefaultFamilyLoadOptions())
                             ?? throw new InvalidOperationException($"Revit did not load nested family '{name}'.");
                // Unsaved documents and native sidecars can carry a different internal family name.
                if (loaded.Name != name) {
                    using var rename = new Transaction(target, "Name nested dependency");
                    rename.Start();
                    loaded.Name = name;
                    if (rename.Commit() != TransactionStatus.Committed)
                        throw new InvalidOperationException($"Nested family '{name}' could not be named.");
                }
                var types = loaded.GetFamilySymbolIds().Select(id => target.GetElement(id).Name).ToHashSet(StringComparer.Ordinal);
                foreach (var required in model.Nested.Values.Where(n => n.Family == name).Select(n => n.Type)
                             .Concat(model.Details.Values.Where(d => d.Family == name).Select(d => d.Type).OfType<string>()).Distinct(StringComparer.Ordinal))
                    if (!types.Contains(required))
                        throw new InvalidOperationException($"Nested family '{name}' has no type '{required}'. Available: {string.Join(", ", types)}");
            } finally {
                if (child is not null) _ = child.Close(false);
            }
        }
    }

    /// <summary>Reconcile an open family document to a full family.json (normalize) through the processor's family-document path.</summary>
    public static FamilyReceipt? Reconcile(Document familyDocument, FamilyModel model, ExecutionOptions? options = null, string? outputFolder = null, LoadAndSaveOptions? save = null) {
        var op = new ReconcileFamily(model);
        using var processor = new OperationProcessor(familyDocument, options);
        var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(op), null, outputFolder, save);
        var (_, error) = contexts.Single().OperationLogs;
        if (error is not null) throw new InvalidOperationException(error.Message, error);
        return op.LastReceipt;
    }

    /// <summary>The families a patch selects in a project: `{}` is every loaded, editable family.</summary>
    public static List<Family> FamiliesMatching(this Document project, PatchSelect select) {
        var names = select.Names is { Count: > 0 } n ? n.ToHashSet(StringComparer.Ordinal) : null;
        var categories = select.Categories is { Count: > 0 } c ? c.Select(FamilyTemplate.ResolveCategory).ToHashSet() : null;
        static bool Matches(string name, IncludeFamilies? filters) => filters is null ||
            filters.Equaling.Count + filters.Containing.Count + filters.StartingWith.Count == 0 ||
            filters.Equaling.Contains(name, StringComparer.Ordinal) ||
            filters.Containing.Any(value => name.Contains(value, StringComparison.Ordinal)) ||
            filters.StartingWith.Any(value => name.StartsWith(value, StringComparison.Ordinal));
        static bool Excluded(string name, ExcludeFamilies? filters) => filters is not null &&
            (filters.Equaling.Contains(name, StringComparer.Ordinal) ||
             filters.Containing.Any(value => name.Contains(value, StringComparison.Ordinal)) ||
             filters.StartingWith.Any(value => name.StartsWith(value, StringComparison.Ordinal)));
        var placed = select.PlacedOnly == true
            ? new FilteredElementCollector(project).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>().Select(i => i.Symbol.Family.Id).ToHashSet()
            : null;
        var candidates = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
            .Where(f => f.IsEditable && !f.IsInPlace)
            .Where(f => names is null || names.Contains(f.Name))
            .Where(f => Matches(f.Name, select.IncludeNames) && !Excluded(f.Name, select.ExcludeNames))
            .Where(f => categories is null || (f.FamilyCategory is { } cat && categories.Contains(cat.ToBuiltInCategory())))
            .Where(f => placed is null || placed.Contains(f.Id))
            .OrderBy(f => f.Name, StringComparer.Ordinal)
            .ToList();
        if (select.IncludeByCondition is not { } condition) return candidates;
        if (string.IsNullOrWhiteSpace(condition.FieldName)) {
            if (!string.IsNullOrWhiteSpace(condition.Value))
                throw new InvalidOperationException("IncludeByCondition requires FieldName when Value is set.");
            return candidates;
        }
        if (!Enum.IsDefined(typeof(ScheduleAuthoredFilterType), condition.FilterType))
            throw new InvalidOperationException($"IncludeByCondition has unknown FilterType '{condition.FilterType}'.");

        using var context = LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(project,
            candidates.Select(family => family.Id.Value()).ToHashSet());
        context.BeginTransaction("Family Foundry condition selection");
        try {
            LoadedFamiliesTempPlacementEngine.PlaceOneTempInstancePerPlaceableSymbol(context);
            var matchingIds = new HashSet<long>();
            var fieldFound = false;
            foreach (var group in candidates.GroupBy(f => f.FamilyCategory?.Id.Value() ??
                         throw new InvalidOperationException($"Family '{f.Name}' has no category for condition selection."))) {
                var placements = group.SelectMany(family => context.GetPlacedInstancesForFamily(family.Id.Value())).ToList();
                foreach (var family in group) {
                    var localMatches = MatchLocalFamilyParameter(project, family, condition,
                        context.GetPlacedInstancesForFamily(family.Id.Value()), out var familyHasField);
                    fieldFound |= familyHasField;
                    if (localMatches) matchingIds.Add(family.Id.Value());
                }

                var profile = new ScheduleProfile("Family Foundry condition", group.First().FamilyCategory!.Name) {
                    Filters = [condition]
                };
                if (ScheduleHelper.TryGetFamilyIdsMatchingFiltersAnyType(project, profile, placements, out var scheduleMatches)) {
                    fieldFound = true;
                    matchingIds.UnionWith(scheduleMatches);
                }
            }
            if (!fieldFound)
                throw new InvalidOperationException("Schedule filter evaluation could not apply every filter for 'Family Foundry condition'.");
            return candidates.Where(f => matchingIds.Contains(f.Id.Value())).ToList();
        } finally {
            context.RollBackTransaction();
        }
    }

    private static bool MatchLocalFamilyParameter(Document project, Family family, ScheduleFilterSpec condition,
        IReadOnlyList<TempPlacedSymbolRecord> placements, out bool fieldFound) {
        var elements = family.GetFamilySymbolIds().Select(project.GetElement)
            .Concat(placements.Select(placement => (Element)placement.Instance));
        var parameters = elements
            .SelectMany(element => element.GetParameters(condition.FieldName).Select(parameter => (element, parameter)))
            .Where(pair => !pair.parameter.IsShared &&
                           (pair.parameter.Definition as InternalDefinition)?.BuiltInParameter == BuiltInParameter.INVALID &&
                           project.GetElement(pair.parameter.Id) == null)
            .ToList();
        fieldFound = parameters.Count > 0;
        if (parameters.Select(pair => pair.parameter.Id.Value()).Distinct().Count() > 1)
            throw new InvalidOperationException(
                $"IncludeByCondition field '{condition.FieldName}' resolves to multiple local parameters in family '{family.Name}'.");
        return parameters.Any(pair => condition.FilterType == ScheduleAuthoredFilterType.HasParameter ||
                                      LocalRule(project, pair.parameter, condition).ElementPasses(pair.element));
    }

    private static FilterRule LocalRule(Document project, Parameter parameter, ScheduleFilterSpec condition) {
        var id = parameter.Id;
        var value = condition.Value ?? string.Empty;
        InvalidOperationException Invalid(string reason) => new(
            $"IncludeByCondition cannot apply {condition.FilterType} to local field '{condition.FieldName}': {reason}");

        if (condition.FilterType is ScheduleAuthoredFilterType.HasValue or ScheduleAuthoredFilterType.HasNoValue)
            return condition.FilterType == ScheduleAuthoredFilterType.HasValue
                ? ParameterFilterRuleFactory.CreateHasValueParameterRule(id)
                : ParameterFilterRuleFactory.CreateHasNoValueParameterRule(id);
        if (condition.FilterType is ScheduleAuthoredFilterType.IsAssociatedWithGlobalParameter or
            ScheduleAuthoredFilterType.IsNotAssociatedWithGlobalParameter) {
            var globalId = GlobalParametersManager.FindByName(project, value);
            if (globalId == ElementId.InvalidElementId)
                throw Invalid($"global parameter '{value}' was not found.");
            return condition.FilterType == ScheduleAuthoredFilterType.IsAssociatedWithGlobalParameter
                ? ParameterFilterRuleFactory.CreateIsAssociatedWithGlobalParameterRule(id, globalId)
                : ParameterFilterRuleFactory.CreateIsNotAssociatedWithGlobalParameterRule(id, globalId);
        }

        return parameter.StorageType switch {
            StorageType.String => StringRule(id, condition.FilterType, value, Invalid),
            StorageType.Integer when int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) =>
                NumericRule(id, condition.FilterType, parsed, Invalid),
            StorageType.Double when TryParseDouble(project, parameter, value, out var parsed) =>
                NumericRule(id, condition.FilterType, parsed, Invalid),
            StorageType.ElementId when long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) =>
                ElementIdRule(id, condition.FilterType, parsed.ToElementId(), Invalid),
            StorageType.Integer or StorageType.Double or StorageType.ElementId =>
                throw Invalid($"'{value}' is not a valid {parameter.StorageType} value."),
            _ => throw Invalid($"StorageType.{parameter.StorageType} is unsupported.")
        };
    }

    private static FilterRule StringRule(ElementId id, ScheduleAuthoredFilterType type, string value,
        Func<string, InvalidOperationException> invalid) => type switch {
        ScheduleAuthoredFilterType.Equal => ParameterFilterRuleFactory.CreateEqualsRule(id, value),
        ScheduleAuthoredFilterType.NotEqual => ParameterFilterRuleFactory.CreateNotEqualsRule(id, value),
        ScheduleAuthoredFilterType.GreaterThan => ParameterFilterRuleFactory.CreateGreaterRule(id, value),
        ScheduleAuthoredFilterType.GreaterThanOrEqual => ParameterFilterRuleFactory.CreateGreaterOrEqualRule(id, value),
        ScheduleAuthoredFilterType.LessThan => ParameterFilterRuleFactory.CreateLessRule(id, value),
        ScheduleAuthoredFilterType.LessThanOrEqual => ParameterFilterRuleFactory.CreateLessOrEqualRule(id, value),
        ScheduleAuthoredFilterType.Contains => ParameterFilterRuleFactory.CreateContainsRule(id, value),
        ScheduleAuthoredFilterType.NotContains => ParameterFilterRuleFactory.CreateNotContainsRule(id, value),
        ScheduleAuthoredFilterType.BeginsWith => ParameterFilterRuleFactory.CreateBeginsWithRule(id, value),
        ScheduleAuthoredFilterType.NotBeginsWith => ParameterFilterRuleFactory.CreateNotBeginsWithRule(id, value),
        ScheduleAuthoredFilterType.EndsWith => ParameterFilterRuleFactory.CreateEndsWithRule(id, value),
        ScheduleAuthoredFilterType.NotEndsWith => ParameterFilterRuleFactory.CreateNotEndsWithRule(id, value),
        _ => throw invalid($"{type} is unsupported for StorageType.String.")
    };

    private static FilterRule NumericRule(ElementId id, ScheduleAuthoredFilterType type, int value,
        Func<string, InvalidOperationException> invalid) => type switch {
        ScheduleAuthoredFilterType.Equal => ParameterFilterRuleFactory.CreateEqualsRule(id, value),
        ScheduleAuthoredFilterType.NotEqual => ParameterFilterRuleFactory.CreateNotEqualsRule(id, value),
        ScheduleAuthoredFilterType.GreaterThan => ParameterFilterRuleFactory.CreateGreaterRule(id, value),
        ScheduleAuthoredFilterType.GreaterThanOrEqual => ParameterFilterRuleFactory.CreateGreaterOrEqualRule(id, value),
        ScheduleAuthoredFilterType.LessThan => ParameterFilterRuleFactory.CreateLessRule(id, value),
        ScheduleAuthoredFilterType.LessThanOrEqual => ParameterFilterRuleFactory.CreateLessOrEqualRule(id, value),
        _ => throw invalid($"{type} is unsupported for StorageType.Integer.")
    };

    private static FilterRule NumericRule(ElementId id, ScheduleAuthoredFilterType type, double value,
        Func<string, InvalidOperationException> invalid) => type switch {
        ScheduleAuthoredFilterType.Equal => ParameterFilterRuleFactory.CreateEqualsRule(id, value, 1e-9),
        ScheduleAuthoredFilterType.NotEqual => ParameterFilterRuleFactory.CreateNotEqualsRule(id, value, 1e-9),
        ScheduleAuthoredFilterType.GreaterThan => ParameterFilterRuleFactory.CreateGreaterRule(id, value, 1e-9),
        ScheduleAuthoredFilterType.GreaterThanOrEqual => ParameterFilterRuleFactory.CreateGreaterOrEqualRule(id, value, 1e-9),
        ScheduleAuthoredFilterType.LessThan => ParameterFilterRuleFactory.CreateLessRule(id, value, 1e-9),
        ScheduleAuthoredFilterType.LessThanOrEqual => ParameterFilterRuleFactory.CreateLessOrEqualRule(id, value, 1e-9),
        _ => throw invalid($"{type} is unsupported for StorageType.Double.")
    };

    private static FilterRule ElementIdRule(ElementId id, ScheduleAuthoredFilterType type, ElementId value,
        Func<string, InvalidOperationException> invalid) => type switch {
        ScheduleAuthoredFilterType.Equal => ParameterFilterRuleFactory.CreateEqualsRule(id, value),
        ScheduleAuthoredFilterType.NotEqual => ParameterFilterRuleFactory.CreateNotEqualsRule(id, value),
        ScheduleAuthoredFilterType.GreaterThan => ParameterFilterRuleFactory.CreateGreaterRule(id, value),
        ScheduleAuthoredFilterType.GreaterThanOrEqual => ParameterFilterRuleFactory.CreateGreaterOrEqualRule(id, value),
        ScheduleAuthoredFilterType.LessThan => ParameterFilterRuleFactory.CreateLessRule(id, value),
        ScheduleAuthoredFilterType.LessThanOrEqual => ParameterFilterRuleFactory.CreateLessOrEqualRule(id, value),
        _ => throw invalid($"{type} is unsupported for StorageType.ElementId.")
    };

    private static bool TryParseDouble(Document project, Parameter parameter, string value, out double parsed) {
        var dataType = parameter.Definition.GetDataType();
        return UnitUtils.IsMeasurableSpec(dataType)
            ? ParameterStringIo.TryParseMeasuredValue(project.GetUnits(), dataType, value, out parsed)
            : double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed);
    }
}
