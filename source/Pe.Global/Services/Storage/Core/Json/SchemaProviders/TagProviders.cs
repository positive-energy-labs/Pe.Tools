using Autodesk.Revit.DB;
using Pe.Global.Services.AutoTag.Core;
using Pe.Global.Services.Document;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Provides category names that can be auto-tagged (have corresponding tag categories).
/// </summary>
public class TaggableCategoryNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            var taggableCategories = CategoryTagMapping.GetTaggableCategories();
            var categoryNames = taggableCategories
                .Select(cat => CategoryTagMapping.GetCategoryName(doc, cat))
                .Where(name => name != null)
                .Cast<string>()
                .OrderBy(name => name);

            return categoryNames;
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides multi-category tag family names available in the current document.
/// </summary>
public class MultiCategoryTagProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null) return [];

            // Get all multi-category tag families
            var tagFamilies = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol))
                .OfCategory(BuiltInCategory.OST_MultiCategoryTags)
                .Cast<FamilySymbol>()
                .Select(fs => fs.FamilyName)
                .Distinct()
                .OrderBy(name => name);

            return tagFamilies;
        } catch {
            return [];
        }
    }
}
