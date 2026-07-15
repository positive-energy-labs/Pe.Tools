using Autodesk.Revit.ApplicationServices;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Apply;

public sealed record FamilyModelBuildResult(
    Document Document,
    FamilyProfileApplyResult ApplyResult,
    string TemplatePath
);

/// <summary>
///     Creates a new family from portable authored truth. This is intentionally a new-document API: applying
///     geometry onto an arbitrary existing family is not a supported FFManager v1 promise.
/// </summary>
public static class FamilyModelBuilder {
    private static readonly string[] TemplateSubdirectories = [
        string.Empty,
        "English-Imperial",
        "English_I",
        "English",
        Path.Combine("Family Templates", "English-Imperial"),
        Path.Combine("Family Templates", "English_I"),
        Path.Combine("Family Templates", "English")
    ];

    public static FamilyModelBuildResult Build(Application application, FamilyModel model) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (model == null)
            throw new ArgumentNullException(nameof(model));

        var lowering = FamilyModelLowerer.Lower(model);
        if (lowering.Profile == null) {
            throw new InvalidOperationException(string.Join(Environment.NewLine,
                lowering.Diagnostics.Select(diagnostic => $"{diagnostic.Path}: {diagnostic.Message}")));
        }

        var templatePath = ResolveTemplatePath(application, model.Family.Template);
        Document? document = null;
        try {
            document = application.NewFamilyDocument(templatePath)
                       ?? throw new InvalidOperationException(
                           $"Revit did not create a family document from template '{templatePath}'.");
            if (!document.IsFamilyDocument)
                throw new InvalidOperationException($"Template '{templatePath}' did not create a family document.");

            var actualPlacement = GetPlacement(document.OwnerFamily.FamilyPlacementType);
            if (actualPlacement != model.Family.Placement) {
                throw new InvalidOperationException(
                    $"Template '{model.Family.Template}' creates {actualPlacement} families, but the model declares {model.Family.Placement}.");
            }

            ConfigureFamily(document, model.Family);
            SeedFamilyTypes(document, lowering.FamilyTypeNames);

            var applyResult = document.ApplyFamilyProfile(lowering.Profile, model.Family.Name);
            if (!applyResult.Success)
                throw new InvalidOperationException(applyResult.Error ?? "Family Model apply failed.");

            return new FamilyModelBuildResult(document, applyResult, templatePath);
        } catch {
            if (document != null) {
                try {
                    _ = document.Close(false);
                } catch {
                    // Preserve the build failure. Revit sometimes refuses a close while unwinding a failed transaction.
                }
            }

            throw;
        }
    }

    public static FamilyModelPlacement GetPlacement(FamilyPlacementType placementType) => placementType switch {
        FamilyPlacementType.WorkPlaneBased => FamilyModelPlacement.FaceHosted,
        FamilyPlacementType.OneLevelBasedHosted => FamilyModelPlacement.WallHosted,
        _ => FamilyModelPlacement.Unhosted
    };

    internal static string ResolveTemplatePath(Application application, string template) {
        var templateName = template.Trim();
        if (Path.IsPathRooted(templateName) ||
            templateName.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0) {
            throw new InvalidOperationException(
                "family.template is a portable installed-template name, not a machine path.");
        }

        if (!templateName.EndsWith(".rft", StringComparison.OrdinalIgnoreCase))
            templateName += ".rft";

        var candidates = TemplateSubdirectories
            .Select(subdirectory => string.IsNullOrWhiteSpace(subdirectory)
                ? Path.Combine(application.FamilyTemplatePath, templateName)
                : Path.Combine(application.FamilyTemplatePath, subdirectory, templateName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var resolved = candidates.FirstOrDefault(File.Exists);
        return resolved ?? throw new FileNotFoundException(
            $"Installed family template '{templateName}' was not found. Tried: {string.Join("; ", candidates)}");
    }

    private static void ConfigureFamily(Document document, FamilyModelHeader header) {
        var categories = RevitLabelCatalog.GetLabelToBuiltInCategoryMap();
        if (!categories.TryGetValue(header.Category, out var builtInCategory))
            throw new InvalidOperationException($"Revit family category '{header.Category}' was not found.");

        var category = Category.GetCategory(document, builtInCategory)
                       ?? throw new InvalidOperationException(
                           $"Category '{header.Category}' is not available in template '{header.Template}'.");

        using var transaction = new Transaction(document, "Configure family model");
        _ = transaction.Start();
        document.OwnerFamily.FamilyCategory = category;
        document.OwnerFamily.Name = header.Name.Trim();
        _ = transaction.Commit();
    }

    private static void SeedFamilyTypes(Document document, IReadOnlyList<string> typeNames) {
        if (typeNames.Count == 0)
            return;

        var manager = document.FamilyManager;
        var existing = manager.Types.Cast<FamilyType>()
            .Select(type => type.Name)
            .ToHashSet(StringComparer.Ordinal);
        var missing = typeNames.Where(name => !existing.Contains(name)).ToList();
        if (missing.Count == 0)
            return;

        // NewType is a transaction-only mutation. Seeding before parameters exist is deliberate: empty authored
        // types must survive without inventing a fake value assignment in the portable model.
        using var transaction = new Transaction(document, "Seed family model types");
        _ = transaction.Start();
        foreach (var typeName in missing)
            _ = manager.NewType(typeName);
        _ = transaction.Commit();
    }
}
