using Autodesk.Revit.DB;
using Pe.Global.Services.Document;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using System.Reflection;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Provides family type names (symbol names) filtered by a selected family name.
/// </summary>
public class FamilyTypeNamesByFamilyProvider : IDependentOptionsProvider {
    public const string FamilyNameDependency = "FamilyName";
    public IReadOnlyList<string> DependsOn => [FamilyNameDependency];

    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .Cast<FamilySymbol>()
                .Select(symbol => symbol.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name);
        } catch {
            return [];
        }
    }

    public IEnumerable<string> GetExamples(IReadOnlyDictionary<string, string> siblingValues) {
        if (!siblingValues.TryGetValue(FamilyNameDependency, out var familyName) ||
            string.IsNullOrWhiteSpace(familyName))
            return this.GetExamples();

        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .Cast<FamilySymbol>()
                .Where(symbol => string.Equals(symbol.FamilyName, familyName, StringComparison.OrdinalIgnoreCase))
                .Select(symbol => symbol.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name);
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides family names filtered by the selected category name.
/// </summary>
public class FamilyNamesByCategoryProvider : IDependentOptionsProvider {
    public IReadOnlyList<string> DependsOn => [OptionContextKeys.CategoryName];

    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .Select(family => family.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name);
        } catch {
            return [];
        }
    }

    public IEnumerable<string> GetExamples(IReadOnlyDictionary<string, string> siblingValues) {
        if (!siblingValues.TryGetValue(OptionContextKeys.CategoryName, out var categoryName) ||
            string.IsNullOrWhiteSpace(categoryName))
            return this.GetExamples();

        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .Where(family => family.FamilyCategory != null &&
                                 string.Equals(family.FamilyCategory.Name, categoryName, StringComparison.OrdinalIgnoreCase))
                .Select(family => family.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name);
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides schedule names filtered by category.
/// </summary>
public class ScheduleNamesByCategoryProvider : IDependentOptionsProvider {
    public const string ScheduleCategoryNameDependency = "ScheduleCategoryName";
    public IReadOnlyList<string> DependsOn => [ScheduleCategoryNameDependency];

    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(schedule => !schedule.IsTemplate)
                .Select(schedule => schedule.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name);
        } catch {
            return [];
        }
    }

    public IEnumerable<string> GetExamples(IReadOnlyDictionary<string, string> siblingValues) {
        if (!siblingValues.TryGetValue(ScheduleCategoryNameDependency, out var categoryName) ||
            string.IsNullOrWhiteSpace(categoryName))
            return this.GetExamples();

        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            var category = doc.Settings.Categories
                .Cast<Category>()
                .FirstOrDefault(cat => string.Equals(cat.Name, categoryName, StringComparison.OrdinalIgnoreCase));
            if (category == null) return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(schedule => !schedule.IsTemplate)
                .Where(schedule => schedule.Definition?.CategoryId == category.Id)
                .Select(schedule => schedule.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name);
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides schedulable field names for schedules in a selected category.
/// </summary>
public class SchedulableFieldNamesByCategoryProvider : IDependentOptionsProvider {
    public IReadOnlyList<string> DependsOn => [ScheduleNamesByCategoryProvider.ScheduleCategoryNameDependency];

    public IEnumerable<string> GetExamples() => [];

    public IEnumerable<string> GetExamples(IReadOnlyDictionary<string, string> siblingValues) {
        if (!siblingValues.TryGetValue(ScheduleNamesByCategoryProvider.ScheduleCategoryNameDependency, out var categoryName) ||
            string.IsNullOrWhiteSpace(categoryName))
            return [];

        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            var category = doc.Settings.Categories
                .Cast<Category>()
                .FirstOrDefault(cat => string.Equals(cat.Name, categoryName, StringComparison.OrdinalIgnoreCase));
            if (category == null) return [];

            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var schedules = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(schedule => !schedule.IsTemplate)
                .Where(schedule => schedule.Definition?.CategoryId == category.Id);

            foreach (var schedule in schedules) {
                var definition = schedule.Definition;
                if (definition == null) continue;

                foreach (var field in definition.GetSchedulableFields()) {
                    var fieldName = field.GetName(doc);
                    if (!string.IsNullOrWhiteSpace(fieldName))
                        _ = names.Add(fieldName);
                }
            }

            return names.OrderBy(name => name);
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides common schedule field formatting source modes.
/// </summary>
public class ScheduleFormattingModeProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() => ["ProjectUnits", "ScheduleFieldFormat"];
}

/// <summary>
///     Provides all UnitTypeId names as formatting options.
/// </summary>
public class UnitTypeIdNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        var names = typeof(UnitTypeId)
            .GetProperties(BindingFlags.Public | BindingFlags.Static)
            .Where(property => property.PropertyType == typeof(ForgeTypeId))
            .Select(property => property.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name);
        return names;
    }
}

/// <summary>
///     Provides built-in mapping strategy names for stress-test dropdown behavior.
/// </summary>
public class MappingStrategyNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() => [
        "Strict",
        "CoerceByStorageType",
        "CoerceMeasurableToNumber"
    ];
}
