using Autodesk.Revit.ApplicationServices;
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Apply;

/// <summary>Template resolution and header configuration for a fresh family document. Harvested from FamilyModelBuilder.</summary>
public static class FamilyTemplate {
    private static readonly string[] TemplateSubdirectories = [
        string.Empty, "English-Imperial", "English_I", "English",
        Path.Combine("Family Templates", "English-Imperial"),
        Path.Combine("Family Templates", "English_I"),
        Path.Combine("Family Templates", "English")
    ];

    /// <summary>Resolves a portable installed-template NAME to the machine path Revit will open.</summary>
    public static string ResolveTemplatePath(Application application, string template) {
        var templateName = template.Trim();
        if (Path.IsPathRooted(templateName) ||
            templateName.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0)
            throw new InvalidOperationException("family.template is a portable installed-template name, not a machine path.");
        if (!templateName.EndsWith(".rft", StringComparison.OrdinalIgnoreCase)) templateName += ".rft";

        var candidates = TemplateSubdirectories
            .Select(sub => string.IsNullOrWhiteSpace(sub)
                ? Path.Combine(application.FamilyTemplatePath, templateName)
                : Path.Combine(application.FamilyTemplatePath, sub, templateName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return candidates.FirstOrDefault(File.Exists)
               ?? throw new FileNotFoundException($"Installed family template '{templateName}' was not found. Tried: {string.Join("; ", candidates)}");
    }

    /// <summary>New family document from the header's template; category and name set; placement cross-checked.</summary>
    public static Document NewDocument(Application application, FamilyModelHeader header) {
        var path = ResolveTemplatePath(application, header.Template);
        var document = application.NewFamilyDocument(path)
                       ?? throw new InvalidOperationException($"Revit did not create a family document from template '{path}'.");
        try {
            var actual = document.OwnerFamily.FamilyPlacementType.ToString();
            if (actual != header.Placement.ToString())
                throw new InvalidOperationException($"Template '{header.Template}' creates {actual} families, but the model declares {header.Placement}.");
            ConfigureFamily(document, header);
            return document;
        } catch {
            _ = document.Close(false);
            throw;
        }
    }

    /// <summary>Sets category and name inside its own transaction; the document must not be modifiable.</summary>
    public static void ConfigureFamily(Document document, FamilyModelHeader header) {
        var builtIn = ResolveCategory(header.Category);
        var category = Category.GetCategory(document, builtIn)
                       ?? throw new InvalidOperationException($"Category '{header.Category}' is not available in template '{header.Template}'.");
        using var transaction = new Transaction(document, "Configure family model");
        _ = transaction.Start();
        document.OwnerFamily.FamilyCategory = category;
        document.OwnerFamily.Name = header.Name.Trim();
        if (transaction.Commit() != TransactionStatus.Committed)
            throw new InvalidOperationException($"Family header '{header.Name}' did not commit.");
    }

    /// <summary>Token → BuiltInCategory by squashed English label (`GenericModels` == `Generic Models`).</summary>
    public static BuiltInCategory ResolveCategory(FamilyCategory category) {
        var key = LenientEnumConverter<FamilyCategory>.Key(category.ToString());
        foreach (var pair in RevitLabelCatalog.GetLabelToBuiltInCategoryMap())
            if (LenientEnumConverter<FamilyCategory>.Key(pair.Key) == key) return pair.Value;
        throw new InvalidOperationException($"Revit family category '{category}' was not found.");
    }
}
